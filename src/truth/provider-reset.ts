/** When a provider limit names the time it clears, so a turn can wait for it instead of ending
 *  the run. Its one caller is `awaitTurnRetry`; `PROVIDER_ALLOWANCE` in runtime-blocker.ts decides
 *  which refusals are allowances at all. */
import { PROVIDER_ALLOWANCE } from "./runtime-blocker.ts";

/**
 * When the provider said it will accept work again, or null when it named no usable clock.
 *
 * A session limit that carries a reset time, such as "resets 12pm (Europe/Amsterdam)", is a wait,
 * not exhaustion. The clause is the provider's own number, so `awaitTurnRetry` sleeps on it
 * rather than guessing a backoff that cannot reach it.
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
 *  Each clock belongs to the allowance that named it, so a session limit's clock never speaks for
 *  a spend limit beside it that names none. Where several allowances stand, work resumes when the
 *  last of them lifts, not the first. */
interface AllowanceWait {
  refuse: boolean;
  at: Date | null;
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
