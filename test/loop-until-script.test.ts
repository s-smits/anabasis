// A session's wait for a run's event was written by hand five times on 13 November 2026, each a
// shell loop over the log: one named its bound in tenths of an hour as hours, and one ended as
// failed because its last line counted no ending. Each case is an invented log cut to time and kind.
import { describe, expect, it } from "bun:test";
import { boundOf, reachedOf, untilLine } from "#skills/run-improvement-campaign/scripts/until.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";

const OPENED = Date.UTC(2026, 10, 13, 5, 0);
const HOUR = 3_600_000;
const event = (kind: EventKind, hours = 0): LogEvent => ({
  at: new Date(OPENED + hours * HOUR).toISOString(),
  kind,
  data: {},
});
const run = [event("campaign.opened"), event("comparison.started", 1), event("comparison.reported", 2)];
const third = boundOf("comparison.reported:3");
const promoted = boundOf("harness.promoted");

describe("what ends a wait for a run's event", () => {
  it("waits below a bound and ends at it, naming the bound that came first", () => {
    expect(reachedOf(run, [third, promoted], null, OPENED + 3 * HOUR)).toBeNull();
    const two = [...run, event("comparison.reported", 4), event("comparison.reported", 5)];
    expect(reachedOf(two, [third, promoted], null, OPENED + 5 * HOUR)).toBe("3 comparison.reported");
    expect(reachedOf([...run, event("harness.promoted", 3)], [third, promoted], null, OPENED)).toBe(
      "1 harness.promoted",
    );
  });

  it("ends at the run's ending whatever was asked, so it never waits on a run at rest", () => {
    expect(reachedOf([...run, event("campaign.ended", 3)], [third], null, OPENED + 3 * HOUR)).toBe(
      "an ending before any bound",
    );
    // A run its keeper started again wrote after the ending, and is waited on as before.
    const again = [...run, event("campaign.ended", 3), event("campaign.move", 4)];
    expect(reachedOf(again, [third], null, OPENED + 4 * HOUR)).toBeNull();
  });

  it("counts raw hours from the opening, in hours", () => {
    expect(reachedOf(run, [third], 9, OPENED + 8.9 * HOUR)).toBeNull();
    expect(reachedOf(run, [third], 9, OPENED + 9 * HOUR)).toBe("9 raw hours with no bound reached");
    // A log with no opening has no hour to count from.
    expect(reachedOf(run.slice(1), [third], 9, OPENED + 99 * HOUR)).toBeNull();
  });

  it("refuses a kind no log holds and a count below one, instead of waiting for good", () => {
    expect(() => boundOf("comparison.report:3")).toThrow("comparison.reported");
    expect(() => boundOf("harness.promoted:0")).toThrow("at least 1");
    expect(() => boundOf("harness.promoted:two")).toThrow("at least 1");
  });

  it("says one line: the run, why, each count asked for, the hours, then the session's words", () => {
    const said = untilLine("some-run", run, [third, promoted], "an ending before any bound", {
      now: OPENED + 2.5 * HOUR,
      say: "Read `runs view`.",
    });
    expect(said).toBe(
      "UNTIL (automated, not operator input) at 2026-11-13T07:30Z: some-run reached an ending before any bound; 1 comparison.reported, 0 harness.promoted; 2.5 raw hours since it opened. Read `runs view`.",
    );
    expect(said.includes("\n")).toBe(false);
  });
});
