// The time lane's held-off first comparison and a live run's look at it, and `ending.ts --at`, on
// invented in-memory logs.
import { describe, expect, it } from "bun:test";
import { eventsAt } from "#skills/campaign-mechanics/scripts/ending.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { pulse } from "../tools/runs/pulse.ts";
import type { Run } from "../tools/runs/registry.ts";
import { indexOf } from "../tools/wri/folds.ts";
import { costTriggers } from "../tools/wri/time.ts";

const OPENED: JsonObject = {
  project: "p",
  budget: { dollars: 100, reserve: 10 },
  limit: null,
  sessions: 2,
  patience: 6,
  led: true,
};

function logOf() {
  const events: LogEvent[] = [];
  const api = {
    events,
    add: (minutes: number, kind: EventKind, data: JsonObject) => {
      events.push({ at: new Date(Date.UTC(2026, 9, 30, 0, minutes)).toISOString(), kind, data });
      return api;
    },
  };
  return api.add(0, "campaign.opened", OPENED).add(1, "checker.read", { faults: [] });
}

describe("a first comparison held off", () => {
  it("calls a first comparison held off at 75 minutes admissible: a trigger of the time lane, and one line of a live run's look", () => {
    const waiting = (end: number, compared = false) => {
      const log = logOf().add(2, "exam.started", { session: "x-1" });
      for (const [place, version] of ["a", "b", "c", "d", "e", "f", "g", "h"].entries()) {
        log
          .add(3 + place, "task.proposed", {
            session: "x-1",
            version,
            taskId: `t-${version}`,
            family: version,
          })
          .add(3 + place, "task.gate", { version, gate: 1, outcome: "passed" });
      }
      if (compared) log.add(end, "comparison.started", { session: "g-1" });
      return log.add(end, "task.proposed", { session: "x-1", version: "j", taskId: "t-j", family: "j" })
        .events;
    };
    const heldTrigger = (events: readonly LogEvent[]) =>
      costTriggers(indexOf(events)).find(({ name }) => name === "FIRST COMPARISON HELD OFF")?.detail;
    const tail = "(no comparison started), 0.00 h inside Builder waits";
    // The hostile case: a minute under the threshold is no finding.
    expect(heldTrigger(waiting(84))).toBeUndefined();
    expect(heldTrigger(waiting(85))).toBe(`admissible 1.25 h to log end ${tail}`);
    expect(heldTrigger(waiting(95, true))).toStartWith("admissible 1.42 h until first comparison started");

    const run: Run = {
      name: "r1",
      tree: "/wt",
      path: "/wt/.ana/d2/r1/log.jsonl",
      end: "comparison.reported",
    };
    const said = (events: readonly LogEvent[], before: Parameters<typeof pulse>[3], writing = true) => {
      const now = Date.parse(events.at(-1)?.at ?? "") + 60_000;
      const look = pulse(run, events, { writing, kept: false }, before, { now });
      return {
        seen: look.seen,
        lines: look.said.filter((line) => line.includes("first comparison admissible")),
      };
    };
    const looked = { lines: 0, open: true, quiet: false };
    expect(said(waiting(84), looked).lines).toEqual([]);
    const late = said(waiting(85), looked);
    expect(late.lines).toEqual(["⚠ first comparison admissible for 1.25 h without starting"]);
    // Said once, never of a campaign that began comparing, and never of one no process writes.
    expect(said(waiting(120), late.seen).lines).toEqual([]);
    expect(said(waiting(95, true), looked).lines).toEqual([]);
    expect(said(waiting(85), looked, false).lines).toEqual([]);
  });
});

describe("ending.ts --at", () => {
  const { events } = logOf()
    .add(2, "exam.started", { session: "x-1" })
    .add(10, "exam.started", { session: "x-2" });

  it("reads the log up to a line, or up to the last event at or before a time", () => {
    expect(eventsAt(events, "2")).toHaveLength(2);
    expect(eventsAt(events, "2026-10-30T00:05:00.000Z")).toHaveLength(3);
    expect(eventsAt(events, "2026-10-31T00:00:00.000Z")).toHaveLength(4);
  });

  it("refuses what is neither a line nor a time", () => {
    expect(() => eventsAt(events, "soon")).toThrow("--at takes a line or an ISO time");
  });
});
