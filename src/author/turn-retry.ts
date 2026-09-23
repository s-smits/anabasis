/**
 * Bounded retries for an authoring turn the provider or transport ended with no build output.
 *
 * Three runs on 2026-09-03 ended `environment-blocked` on the first such turn. run53-sol-0903
 * (source 5515372d) and run55-sol-0903 (source 66536c5b) both settled "Your access token could not
 * be refreshed because you have since logged out or signed in to another account", and
 * truss-run12-sol-0903 settled the per-turn settle cap while the host had no internet for an hour.
 * Every one of those failures was transient: the campaign, the session workspace and the candidate
 * all survived it, and the only thing that ended was the run.
 *
 * So a failed or aborted no-output turn is retried, except for a disabled account and an allowance
 * that names no clock. The original typed failure still owns environment-blocked classification,
 * and a generic 429, an overload and a token-refresh error all stay eligible for these retries.
 *
 * A limit that says when it resets waits for that instant instead of a step of the ladder below.
 * Campaign 3fd52f9e-28 ended twice on 2026-09-17 against "resets 12pm" and "resets 6:30pm"
 * (Europe/Amsterdam), spending no wait at all, because the allowance matcher read a clock-bounded
 * session limit as exhaustion. Seventeen minutes of ladder could not have reached either clock, so
 * the wait has to be the provider's own number; the three attempts still bound it.
 *
 * A retry is a paid attempt, and it reserves its own provider turn through the same two gates the
 * first attempt passed. Those gates are asked on both sides of the wait, so a controller stop, a
 * spent campaign cap or an exhausted provider budget ends the run instead of sleeping through it:
 * before the wait for one that already holds, and after it for one that arrives while it runs,
 * which for a reset wait is most of the hours it covers.
 */
import { fullrunLine } from "../observe/run-observer.ts";
import type { ModelAttemptGate } from "../run/campaign-budget.ts";
import type { ProviderResourceBudget } from "../run/provider-resource-budget.ts";
import type { BuilderExecutionRecorder, TurnRetryRow } from "./builder-execution.ts";
import { raceAbort } from "./builder-tool-receipts.ts";
import { allowanceWait } from "../truth/provider-reset.ts";

/** The whole retry budget for one turn: three further attempts, then the typed non-result. The
 *  waits grow because the observed causes clear on different clocks — a re-login lands in minutes,
 *  a home network outage took closer to an hour. */
export const TURN_RETRY_BACKOFF_MS = [120_000, 300_000, 600_000] as const;

/** Wake a little after the provider's stated reset rather than exactly on it, so a clock that is
 *  a few seconds behind ours does not spend an attempt on the same refusal. */
export const PROVIDER_RESET_MARGIN_MS = 60_000;

/** Enough of the transport's own words to recognise the cause in the recorded row. */
const REASON_MAX_CHARS = 300;

/** A refusal no wait clears: the provider says the organisation, account or workspace itself is
 *  disabled, which only its administrator changes. opus-20260905T065506215Z waited out all three
 *  backoffs, 17 minutes, on the same HTTP 403 "Your organization has disabled Claude subscription
 *  access" before ending on the clause it would have ended on at once. The transient set stays
 *  decided on the turn's outcome; this names the one permanent shape. */
export const PERMANENT_REFUSAL =
  /\b(?:organi[sz]ation|account|workspace)\b[^\n]{0,80}\b(?:disabled|deactivated|suspended)\b/i;

export interface TurnRetryContext {
  /** The authoring role whose turn failed, as the non-result would have named it. */
  role: string;
  /** The session turn being retried. */
  turn: number;
  attemptGate?: ModelAttemptGate;
  providerBudget?: ProviderResourceBudget;
  /** The recorded home of the retry rows. */
  recorder: BuilderExecutionRecorder;
  /** Test interface for the backoff wall, matching `BuildAgentSessions.waitMs`. */
  wait?: (ms: number) => Promise<void>;
}

/**
 * Wait out one retry of a no-output turn, or say the retry budget is spent. `true` means the
 * caller should run the same turn again; `false` means it should raise the turn's non-result.
 */
export async function awaitTurnRetry(
  context: TurnRetryContext,
  retried: number,
  status: "failed" | "aborted",
  errorMessages: readonly string[],
): Promise<boolean> {
  const ladderMs = TURN_RETRY_BACKOFF_MS[retried];
  if (ladderMs === undefined) return false;
  // The transport's error text, flattened onto one bounded line.
  const joined = errorMessages.join("; ").replace(/\s+/g, " ").trim();
  const reason = (joined === "" ? "no error recorded" : joined).slice(0, REASON_MAX_CHARS);
  // An allowance that names when it clears is a wait; one that names no clock ends the run. Each
  // clock is read from the allowance that named it, so a session limit naming noon cannot speak for
  // a monthly spend limit beside it, which no wait clears (src/truth/provider-reset.ts).
  const allowance = allowanceWait(errorMessages);
  const resetAt = allowance.at;
  if (allowance.refuse || errorMessages.some((error) => PERMANENT_REFUSAL.test(error))) {
    fullrunLine(
      `turn retry refused (role ${context.role}): provider access or allowance is unavailable — ${reason}`,
    );
    return false;
  }
  const waitMs =
    resetAt === null ? ladderMs : Math.max(resetAt.getTime() - Date.now(), 0) + PROVIDER_RESET_MARGIN_MS;
  // Ask the paid admissions first: a retry the budget or a controller stop would refuse must not
  // spend the wait before finding that out.
  context.attemptGate?.assertAttemptAvailable();
  context.providerBudget?.assertAvailable("builder");
  const row: TurnRetryRow = {
    role: context.role,
    turn: context.turn,
    attempt: retried + 1,
    of: TURN_RETRY_BACKOFF_MS.length,
    status,
    reason,
    waitMs,
  };
  context.recorder.turnRetried(row);
  // A reset wait runs for hours, where a count of seconds says nothing an operator can act on.
  const waiting =
    resetAt === null
      ? `${String(Math.round(waitMs / 1_000))}s`
      : `until ${resetAt.toISOString()}, the reset the provider named`;
  fullrunLine(
    `turn retry ${row.attempt}/${row.of} (role ${row.role}): turn ${status} with no build output; waiting ${waiting} — ${row.reason}`,
  );
  // A reset wait runs for hours, so it ends when the controller does. `cancellationSignal` is the
  // abort FullRunClosure raises on SIGINT, SIGTERM and a provider denial, and asking the same two
  // gates again afterwards turns it back into the stop cause the caller already handles. Without
  // this the operator's stop is read once, before the sleep, and the run sleeps past it.
  //
  // Clearing the timer is what ends the wait, not resolving it. Racing `Bun.sleep(8_000)` against
  // an abort at 200 ms returns at 201 ms and exits the process at 8002 ms, while the same race over
  // a timer the abort clears exits at 201 ms. A run stopped during a wait until a provider-named
  // reset would otherwise keep its process alive to that reset with terminal.json already
  // written.
  const stopped = context.providerBudget?.cancellationSignal;
  await (context.wait === undefined
    ? new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, waitMs);
        stopped?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      })
    : raceAbort(context.wait(waitMs), stopped));
  context.attemptGate?.assertAttemptAvailable();
  context.providerBudget?.assertAvailable("builder");
  return true;
}
