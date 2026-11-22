// WRI2P2's driver reads each run's trigger from its log (two promotions, an all-tied comparison or
// twelve hours), and pauses a live run after its next comparison before its investigation opens.
import { describe, expect, it } from "bun:test";
import { dueLines, openingOf } from "#skills/run-improvement-campaign/scripts/wri2p2.ts";
import { clockTurns, progressOf as rowOf, triggerOf } from "#tools/runs/said.ts";
import type { LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";

const live = { name: "r", host: "here", live: true };
const HOUR = 3_600_000;
const OPENED = Date.parse("2026-11-04T00:00:00.000Z");
const at = (hours: number) => new Date(OPENED + hours * HOUR).toISOString();
const event = (hours: number, kind: LogEvent["kind"], data: JsonObject = {}): LogEvent => ({
  at: at(hours),
  kind,
  data,
});
const opening = (hours = 0) => event(hours, "campaign.opened");
const reported = (hours: number, wins: number, losses: number, ties: number, reading = "no-step") =>
  event(hours, "comparison.reported", { reading, scored: { wins, losses, ties } });

describe("the trigger", () => {
  it("opens at the promotions, at an all-tied comparison or at the hours, and never on a live run short of all three", () => {
    const now = OPENED + 3 * HOUR;
    const short = [opening(), reported(2, 3, 1, 4)];
    expect(triggerOf(rowOf(live, short, now))).toBeNull();
    const promoted = [opening(), event(1, "harness.promoted"), event(2, "harness.promoted")];
    expect(triggerOf(rowOf(live, promoted, now))).toBe("2 promotions");
    const tied = rowOf(live, [opening(), reported(2, 0, 0, 8)], now);
    expect(triggerOf(tied)).toBe("a comparison left no task untied");
    // A live run is timed to now, so one in a long wait still reaches the hours.
    expect(triggerOf(rowOf(live, short, OPENED + 13 * HOUR))).toBe("13.0 h since its opening");
  });

  it("reads a comparison that scored nothing as no tie, since it tested nothing", () => {
    const unscored = [opening(), reported(2, 0, 0, 0, "not-scored")];
    expect(triggerOf(rowOf(live, unscored, OPENED + 3 * HOUR))).toBeNull();
  });

  it("opens on a run that closed after a comparison, and not on one that never compared", () => {
    const closed = [opening(), reported(1, 1, 1, 0), event(2, "campaign.ended", { ending: "stop" })];
    expect(triggerOf(rowOf({ ...live, live: false }, closed, OPENED))).toBe("closed (stop)");
    const empty = [opening(), event(1, "campaign.ended", { ending: "exam" })];
    expect(triggerOf(rowOf({ ...live, live: false }, empty, OPENED))).toBeNull();
  });
});

describe("a run's step at its trigger", () => {
  const row = { name: "r1", host: "here", live: true };
  const pausing = (args: string[]) => [{ pid: 1, cwd: "/w", args }];

  it("pauses a live run after its next comparison before its investigation opens", () => {
    expect(openingOf(row, "2 promotions", [])).toEqual([
      "step: pause · 2 promotions; the investigation opens once the run stops after its next comparison",
      "  bun run runs pause r1 --after reported --yes",
    ]);
  });

  it("waits while a pause of the run is armed, and opens once the run has stopped", () => {
    const armed = pausing(["bun", "tools/runs/cli.ts", "pause", "r1", "--after", "reported", "--yes"]);
    expect(openingOf(row, "2 promotions", armed)[0]).toStartWith("step: waits");
    expect(
      openingOf(row, "2 promotions", pausing(["bun", "tools/runs/cli.ts", "continue", "r1"]))[0],
    ).toStartWith("step: pause");
    expect(openingOf(row, "2 promotions", pausing(["bun", "cli.ts", "pause", "r2"]))[0]).toStartWith(
      "step: pause",
    );
    expect(openingOf({ ...row, live: false }, "2 promotions", armed)[0]).toBe("step: open · 2 promotions");
    expect(openingOf(row, null, [])).toEqual(["step: run"]);
  });
});

describe("the clock trigger", () => {
  it("says the second a live run's clock trigger turns, which a timer set to the minute would miss", () => {
    // Opened 46.5 s past the minute: at twelve hours past that minute the trigger has not turned.
    const opened = [event(46.5 / 3600, "campaign.opened")];
    const minute = OPENED + 12 * HOUR;
    const early = rowOf({ name: "r1", host: "here", live: true }, opened, minute);
    expect(triggerOf(early)).toBeNull();
    const turns = clockTurns(early, minute);
    expect(turns).toBe("2026-11-04T12:00:47Z");
    // Hostile: the trigger stands at the second said and not at the one before it.
    const read = (when: number) => triggerOf(rowOf({ name: "r1", host: "here", live: true }, opened, when));
    expect(read(Date.parse(turns))).toBe("12.0 h since its opening");
    expect(read(Date.parse(turns) - 1000)).toBeNull();
    const step = openingOf(early, null, [], null, turns);
    expect(step).toEqual([`step: run · its clock trigger turns at ${turns}`]);
    const lines = dueLines([{ row: early, last: minute, dir: null, step }], () => minute, minute);
    expect(lines).toEqual([
      "due at 2026-11-04T12:00Z · nothing owed · 1 run(s) live",
      `run · r1 · its clock trigger turns at ${turns}`,
    ]);
    // A stopped run has no clock to wait for.
    expect(openingOf({ ...early, live: false }, null, [], null, turns)).toEqual(["step: run"]);
  });
});
