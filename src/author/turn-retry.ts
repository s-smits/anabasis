/**
 * Bounded retries for an authoring turn the provider or transport ended with no build output.
 *
 * Failed or aborted no-output turns are retried, except for disabled accounts and allowances that
 * name no reset time; the original typed failure still owns environment-blocked classification.
 * A limit that names its reset waits until then instead of the backoff step, still within the
 * three attempts.
 *
 * A retry is a paid attempt: the same two gates as the first attempt are asked before and after
 * the wait, so a stop or spent budget ends the run instead of sleeping through it.
 */
import { fullrunLine } from "../observe/run-observer.ts";
import type { ModelAttemptGate } from "../run/campaign-budget.ts";
import type { ProviderResourceBudget } from "../run/provider-resource-budget.ts";
import type { BuilderExecutionRecorder, TurnRetryRow } from "./builder-execution.ts";
import { raceAbort } from "./builder-tool-receipts.ts";
import { allowanceWait } from "../truth/provider-reset.ts";

/** The whole retry budget for one turn: three further attempts with growing waits, then the typed
 *  non-result. */
export const TURN_RETRY_BACKOFF_MS = [120_000, 300_000, 600_000] as const;

/** Wake a little after the provider's stated reset rather than exactly on it, so a clock that is
 *  a few seconds behind ours does not spend an attempt on the same refusal. */
export const PROVIDER_RESET_MARGIN_MS = 60_000;

/** Enough of the transport's own words to recognise the cause in the recorded row. */
const REASON_MAX_CHARS = 300;

/** A refusal no wait clears: the organisation, account or workspace itself is disabled. */
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
  // An allowance that names when it clears is a wait; one that names no reset time ends the run.
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
  // Ask the paid admissions before waiting, so a refused retry spends no wait.
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
  // A reset wait is stated as its end time rather than a count of seconds.
  const waiting =
    resetAt === null
      ? `${String(Math.round(waitMs / 1_000))}s`
      : `until ${resetAt.toISOString()}, the reset the provider named`;
  fullrunLine(
    `turn retry ${row.attempt}/${row.of} (role ${row.role}): turn ${status} with no build output; waiting ${waiting} — ${row.reason}`,
  );
  // The controller's cancellation signal ends the wait, and the gates asked afterwards turn it into
  // the stop cause the caller handles. The abort clears the timer so it cannot keep the process
  // alive.
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
