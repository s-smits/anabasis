/**
 * One calendar week in one time zone, as the half-open UTC interval `[start, end)`.
 *
 * The boundary is local midnight on Monday, so the UTC instant it resolves to moves by an hour
 * when the zone changes its clocks. A window fixed in UTC would silently take an hour from one week
 * and give it to the next, which is exactly the run a weekly selection then files under the wrong
 * week.
 */

export interface WeekWindow {
  timeZone: string;
  week: "current" | "previous";
  start: string;
  end: string;
}

type LocalDate = { year: number; month: number; day: number };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function localParts(instant: Date, timeZone: string): Record<string, string> {
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(format.formatToParts(instant).map(({ type, value }) => [type, value]));
}

function shiftDate(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** The UTC instant of local midnight on `date`, found by correcting a UTC guess by the offset the
 *  zone reports for it; three passes settle any offset a real zone has. */
function zonedMidnight(date: LocalDate, timeZone: string): string {
  const nominal = Date.UTC(date.year, date.month - 1, date.day);
  let candidate = nominal;
  for (let pass = 0; pass < 3; pass += 1) {
    const parts = localParts(new Date(candidate), timeZone);
    const shown = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
    );
    candidate = nominal - (shown - candidate);
  }
  return new Date(candidate).toISOString();
}

/** The week holding `now` in `timeZone`, or the one before it. */
export function weekWindow(now: string, timeZone: string, week: WeekWindow["week"]): WeekWindow {
  const anchor = new Date(now);
  if (!Number.isFinite(anchor.getTime())) throw new Error(`invalid instant ${JSON.stringify(now)}`);
  const parts = localParts(anchor, timeZone);
  const offset = WEEKDAYS.indexOf(parts.weekday ?? "");
  if (offset === -1) throw new Error(`cannot resolve the weekday in ${timeZone}`);
  const monday = shiftDate(
    { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) },
    -offset,
  );
  const first = week === "previous" ? shiftDate(monday, -7) : monday;
  return {
    timeZone,
    week,
    start: zonedMidnight(first, timeZone),
    end: zonedMidnight(shiftDate(first, 7), timeZone),
  };
}

/** Whether `instant` falls inside the window; an unparseable instant falls inside none. */
export function withinWeek(instant: string, window: WeekWindow): boolean {
  const at = Date.parse(instant);
  return Number.isFinite(at) && at >= Date.parse(window.start) && at < Date.parse(window.end);
}
