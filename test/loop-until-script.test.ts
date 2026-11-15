// A session's wait for a run's event was written by hand five times on 13 November 2026, each a
// shell loop over the log: one named its bound in tenths of an hour as hours, and one ended as
// failed because its last line counted no ending. Each case is an invented log cut to time and kind.
import { expect, it } from "bun:test";
import { boundOf, untilLine } from "#skills/run-improvement-campaign/scripts/until.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";

const OPENED = Date.UTC(2026, 10, 13, 5, 0);
const HOUR = 3_600_000;
const event = (kind: EventKind, hours = 0): LogEvent => ({
  at: new Date(OPENED + hours * HOUR).toISOString(),
  kind,
  data: {},
});
const run = [event("campaign.opened"), event("comparison.reported", 1), event("comparison.reported", 2)];
const bound = boundOf("comparison.reported:3");
/** Why a wait for three reports, or for `hours`, ended `after` hours past the opening, or null. */
const reached = (events: readonly LogEvent[], after: number, hours: number | null = null) =>
  untilLine("r", events, { bound, hours, say: null }, OPENED + after * HOUR)?.match(
    /reached ([^;]+);/,
  )?.[1] ?? null;

it("ends at the bound, at the run's ending whatever was asked, or at raw hours from the opening", () => {
  const ended = [...run, event("campaign.ended", 3)];
  // A run its keeper started again wrote after the ending, and is waited on as before.
  const again = [...ended, event("campaign.move", 4)];
  const cases: [readonly LogEvent[], number, number | null, string | null][] = [
    [run, 3, null, null],
    [[...run, event("comparison.reported", 3)], 3, null, "3 comparison.reported"],
    [ended, 3, null, "an ending before any bound"],
    [again, 4, null, null],
    [run, 8.9, 9, null],
    [run, 9, 9, "9 raw hours with no bound reached"],
    // A log with no opening has no hour to count from.
    [run.slice(1), 99, 9, null],
  ];
  for (const [events, after, hours, why] of cases) expect(reached(events, after, hours)).toBe(why);
});

it("refuses a kind no log holds and a count below one, instead of waiting for good", () => {
  expect(boundOf("harness.promoted")).toStrictEqual({ kind: "harness.promoted", count: 1 });
  expect(() => boundOf("comparison.report:3")).toThrow("is no event kind");
  for (const text of ["harness.promoted:0", "harness.promoted:two"]) {
    expect(() => boundOf(text)).toThrow("at least 1");
  }
});

it("says one line: the run, why, the count, the hours, then the session's words", () => {
  const wait = { bound, hours: null, say: "Read `runs view`." };
  expect(
    untilLine("some-run", [...run.slice(0, 2), event("campaign.ended", 2.5)], wait, OPENED + 2.5 * HOUR),
  ).toBe(
    "UNTIL (automated, not operator input) at 2026-11-13T07:30Z: some-run reached an ending before any bound; 1 comparison.reported; 2.5 raw hours since it opened. Read `runs view`.",
  );
});
