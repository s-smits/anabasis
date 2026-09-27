/** When a provider limit names the time it clears, so a turn can wait for it instead of ending
 *  the run. Two callers read it: `awaitTurnRetry` for a Builder turn, and `retryAfterNamedReset`
 *  below for a review call. `PROVIDER_ALLOWANCE` in runtime-blocker.ts decides which refusals are
 *  allowances at all. */
import { fullrunLine } from "../observe/run-observer.ts";
import type { ProviderResourceBudget } from "../run/provider-resource-budget.ts";
import { PROVIDER_ALLOWANCE } from "./runtime-blocker.ts";

/** Wake a little after the provider's stated reset rather than exactly on it, so a clock that is
 *  a few seconds behind ours does not spend an attempt on the same refusal. */
export const PROVIDER_RESET_MARGIN_MS = 60_000;

/**
 * When the provider said it will accept work again, or null when it named no usable clock.
 *
 * A session limit that carries a reset time is a wait, not exhaustion. `PROVIDER_ALLOWANCE` reads
 * "resets 12pm (Europe/Amsterdam)" and "resets 6:30pm" alike as spent, which abandons a live
 * campaign hours before the clock the provider has just handed it. The clause is the provider's own
 * number, so `awaitTurnRetry` sleeps on it rather than guessing a backoff that cannot reach it.
 *
 * Resolving to the clock's next occurrence bounds the wait below a day by construction, which is
 * the whole shape a session limit has. A clause naming a calendar date is left unresolved instead:
 * "resets Sep 12 at 8am" read as a bare clock would sleep until tomorrow morning for a weekly or
 * monthly allowance that clears in days, and no turn should sit through one of those.
 */
const RESET_CLAUSE = /\bresets?\s+([^\n;]{1,48})/i;
const RESET_CLOCK = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;
const RESET_ZONE = /\b([A-Za-z]+\/[A-Za-z_+-]+)\b/;
const RESET_DATE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i;

/** What the allowances in one turn's error text let the caller do. `refuse` is an allowance that
 *  named no clock -- no wait clears it, so the caller ends the run -- and `at` is the instant they
 *  have all cleared, or null when the text names no allowance and the caller keeps its own backoff.
 *
 *  Each clock belongs to the allowance that named it. Reading one clause across the whole list lets
 *  a session limit naming 12pm speak for a monthly spend limit standing beside it — that one names
 *  no clock and no wait clears it, so the turn sleeps until noon only to be refused again. Where
 *  several allowances stand, work resumes when the last of them lifts, not the first. */
interface AllowanceWait {
  refuse: boolean;
  at: Date | null;
}

/** What a review wait reads besides the refusal: the paid budget whose stop ends it, and, for
 *  tests, the clock and the timer. */
export interface ReviewResetWait {
  providerBudget?: ProviderResourceBudget;
  now?: () => Date;
  wait?: (ms: number) => Promise<void>;
}

/** How far the named zone's wall clock stands from UTC at that instant. */
function zoneShiftMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const field = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return (
    Date.UTC(
      field("year"),
      field("month") - 1,
      field("day"),
      field("hour"),
      field("minute"),
      field("second"),
    ) - at.getTime()
  );
}

/** The instant at which the named zone's clock reads this wall time. One correction settles the
 *  hour a daylight-saving change moves; a second pass cannot improve on it. */
function instantOf(wallMs: number, timeZone: string): number {
  const first = wallMs - zoneShiftMs(new Date(wallMs), timeZone);
  return wallMs - zoneShiftMs(new Date(first), timeZone);
}

export function providerResetAt(message: string, now: Date = new Date()): Date | null {
  const clause = RESET_CLAUSE.exec(message)?.[1];
  if (clause === undefined || RESET_DATE.test(clause)) return null;
  const clock = RESET_CLOCK.exec(clause);
  if (clock === null) return null;
  const zone = RESET_ZONE.exec(clause)?.[1] ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const hour = (Number(clock[1]) % 12) + (clock[3]?.toLowerCase() === "pm" ? 12 : 0);
  const minute = Number(clock[2] ?? "0");
  try {
    // The wall date the provider means is today in its own zone, or tomorrow once that hour has passed.
    const wallNow = now.getTime() + zoneShiftMs(now, zone);
    const wallDay = Math.floor(wallNow / 86_400_000) * 86_400_000;
    const at = instantOf(wallDay + hour * 3_600_000 + minute * 60_000, zone);
    return new Date(
      at <= now.getTime() ? instantOf(wallDay + 86_400_000 + hour * 3_600_000 + minute * 60_000, zone) : at,
    );
  } catch {
    // An unparsable zone leaves the clause unresolved, and the caller keeps its ordinary backoff.
    return null;
  }
}

export function allowanceWait(messages: readonly string[], now: Date = new Date()): AllowanceWait {
  const clocks = messages.flatMap((message) =>
    PROVIDER_ALLOWANCE.test(message) ? [providerResetAt(message, now)] : [],
  );
  const named = clocks.flatMap((clock) => (clock === null ? [] : [clock.getTime()]));
  return {
    refuse: named.length < clocks.length,
    at: named.length === 0 ? null : new Date(Math.max(...named)),
  };
}

/**
 * Sleep for `ms`, or until the controller's stop fires, whichever is first.
 *
 * A reset wait runs for hours, so it has to end when the controller does: `stopped` is the abort
 * the run's closure raises on SIGINT, SIGTERM and a provider denial. Clearing the timer is what ends
 * the wait, not resolving it. A resolved race over a live timer keeps the process alive until that
 * timer fires, so a run stopped during a wait for a provider-named reset would hold its process open
 * to that reset with its terminal already written. `wait` is the test interface for the timer.
 */
export function sleepUnlessStopped(
  ms: number,
  stopped: AbortSignal | undefined,
  wait?: (ms: number) => Promise<void>,
): Promise<void> {
  if (stopped?.aborted === true) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      clearTimeout(timer);
      stopped?.removeEventListener("abort", done);
      resolve();
    };
    stopped?.addEventListener("abort", done, { once: true });
    if (wait === undefined) timer = setTimeout(done, ms);
    else wait(ms).then(done, done);
  });
}

/**
 * Run one review call, and run it once more after the reset the provider named when a session
 * limit refused it.
 *
 * A measured battery is reviewed once, so a review a session limit refused is lost for good: the
 * record says `failed`, the round moves on, and the next Builder round opens without the reading.
 * The limit's own text says when it lifts, which makes it a bounded pause rather than exhaustion,
 * the same reading `awaitTurnRetry` gives a Builder turn. Only an allowance that names a clock
 * waits. A generic 429, an overload or an allowance naming no clock keeps the first result, since no
 * wait is known to clear it.
 *
 * `errorOf` returns the call's recorded failure text, or null when it produced its reading. That
 * text joins the transport's messages with "; ", and they are split back apart so that each clock
 * is read from the allowance that named it. The budget is asked on both sides of the wait, so a
 * spent budget or a controller stop ends the run instead of sleeping through it.
 */
export async function retryAfterNamedReset<T>(
  role: string,
  run: () => Promise<T>,
  errorOf: (result: T) => string | null,
  context: ReviewResetWait = {},
): Promise<T> {
  const first = await run();
  const error = errorOf(first);
  if (error === null) return first;
  const now = context.now?.() ?? new Date();
  const allowance = allowanceWait(error.split("; "), now);
  if (allowance.refuse || allowance.at === null) return first;
  const { providerBudget } = context;
  providerBudget?.assertAvailable("review");
  fullrunLine(
    `review retry (role ${role}): refused by a provider limit; waiting until ${allowance.at.toISOString()}, the reset the provider named`,
  );
  await sleepUnlessStopped(
    Math.max(allowance.at.getTime() - now.getTime(), 0) + PROVIDER_RESET_MARGIN_MS,
    providerBudget?.cancellationSignal,
    context.wait,
  );
  providerBudget?.assertAvailable("review");
  return run();
}
