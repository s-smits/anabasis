// The move table replayed over a log (`tools/wri/table-timeline.ts`) and `ending.ts --at`, on
// invented in-memory logs: where a move changes between two points, which rows ran under another
// tree's code, which move was still under way at the log's end, and the Builder's waits.
import { describe, expect, it } from "bun:test";
import { eventsAt } from "#skills/campaign-mechanics/scripts/ending.ts";
import { conditionId } from "../src/kernel/condition.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { pulse } from "../tools/runs/pulse.ts";
import type { Run } from "../tools/runs/registry.ts";
import { indexOf } from "../tools/wri/folds.ts";
import { heldOff } from "../tools/runs/view.ts";
import { timelineLines } from "../tools/wri/table-timeline.ts";
import { costTriggers } from "../tools/wri/time.ts";
import { conditionOf } from "./helpers/logged-round.ts";

const OPENED: JsonObject = {
  project: "p",
  budget: { dollars: 100, reserve: 10 },
  limit: null,
  sessions: 2,
  patience: 6,
  led: true,
};
const HERE = "c0ffee00c0ffee00";
const OTHER = "0bad0bad0bad0bad";

/** A log under construction, one event a call, each `minutes` after the start. */
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

const proposed = (version: string) => ({ session: "x-1", version, taskId: `t-${version}`, family: "f" });
/** The rows of one kind: a line number, a time and the code it ran under, then the kind. */
const rowsOf = (lines: readonly string[], row: string) =>
  lines.filter((line) => /^\s*\d+\s/.test(line) && line.slice(41).startsWith(`${row} `));
function recorded(host: string) {
  const condition = { ...conditionOf("t", "h"), host };
  return { id: conditionId(condition), condition: requireJsonValue(condition) };
}
const lineOf = (row: string) => Number(row.trim().split(/\s+/)[0]);

describe("table-timeline", () => {
  it("finds the task event that moved the table between two points, not the next point", () => {
    const log = logOf()
      .add(2, "exam.started", { session: "x-1" })
      .add(3, "task.proposed", proposed("v-1"))
      .add(4, "task.proposed", proposed("v-2"))
      .add(90, "exam.finished", { session: "x-1", ended: "finished", held: ["v-1"], seconds: 5000 });
    const tables = rowsOf(timelineLines(log.events, HERE), "table");
    expect(tables).toHaveLength(2);
    // The first proposal, line 4, moved it; the next point, `exam.finished`, is line 6.
    expect(lineOf(tables[1] ?? "")).toBe(4);
  });

  it("counts the Builder's waits inside the stretch a move stood named, and how long it stood", () => {
    const log = logOf()
      .add(2, "exam.started", { session: "x-1" })
      .add(3, "task.proposed", proposed("v-1"))
      .add(60, "build.call", {
        session: "b-1",
        toolCallId: "c-1",
        turn: 1,
        tool: "wait",
        args: {},
        isError: false,
        text: "",
        ms: 1_800_000,
      })
      .add(123, "exam.finished", { session: "x-1", ended: "finished", held: ["v-1"], seconds: 60 });
    const lines = timelineLines(log.events, HERE);
    const last = rowsOf(lines, "table").at(-1) ?? "";
    expect(last).toContain("named 2.00 h, 0.50 h of it inside Builder waits, until the log ends");
    expect(rowsOf(lines, "wait")[0]).toContain("from 00:30:00 to 01:00:00 (30.0 min)");
  });

  it("names where a first comparison became admissible, and the pool a compare began on", () => {
    const tasks = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    const log = logOf().add(2, "exam.started", { session: "x-1" });
    for (const [place, version] of tasks.entries()) {
      log
        .add(3 + place, "task.proposed", { session: "x-1", version, taskId: `t-${version}`, family: version })
        .add(3 + place, "task.gate", { version, gate: 1, outcome: "passed" });
    }
    log
      .add(20, "task.state", { version: "i", state: "released" })
      .add(30, "campaign.move", { move: "compare", code: "led", why: "w", session: "g-1" })
      .add(30, "comparison.started", { session: "g-1" })
      .add(40, "task.proposed", { session: "x-1", version: "j", taskId: "t-j", family: "j" });
    const lines = timelineLines(log.events, HERE);
    const admissible = rowsOf(lines, "admissible");
    // The eighth task held, at minute 10, opens admission; seven did not, and nothing after the
    // first comparison's start is a first position.
    expect(admissible).toHaveLength(1);
    expect(admissible[0]).toContain("from 00:10:00: 8 held out, 0 released · admission refuses nothing");
    // The comparison began twenty minutes later, with no Builder wait between; a log that never
    // compared counts to its end, at minute 40, and says so.
    expect(admissible[0]).toEndWith("· 0.33 h before one began, 0.00 h of it inside Builder waits");
    const never = log.events.filter(({ kind }) => kind !== "comparison.started");
    expect(heldOff(never)?.said).toBe(
      "0.50 h to the log's end, none begun, 0.00 h of it inside Builder waits",
    );
    expect(rowsOf(lines, "move").at(-1)).toContain("8 held out, 1 released · admission refuses nothing");
    const short = logOf().add(3, "task.proposed", proposed("v-1"));
    expect(rowsOf(timelineLines(short.events, HERE), "admissible")).toHaveLength(0);
  });

  it("calls a first comparison held off at 75 minutes admissible: a trigger of the time lane, and one line of a live run's look", () => {
    // Eight tasks held at minute 10, and the log's last event at `end`.
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
    const tail = "none begun, 0.00 h of it inside Builder waits";
    // The hostile case: a minute under the threshold is no finding.
    expect(heldTrigger(waiting(84))).toBeUndefined();
    expect(heldTrigger(waiting(85))).toBe(`admissible 1.25 h to the log's end, ${tail}`);
    expect(heldTrigger(waiting(95, true))).toStartWith("admissible 1.42 h before one began");

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
    expect(late.lines).toEqual(["⚠ a first comparison admissible for 1.25 h, none begun"]);
    // Said once, never of a campaign that began comparing, and never of one no process writes.
    expect(said(waiting(120), late.seen).lines).toEqual([]);
    expect(said(waiting(95, true), looked).lines).toEqual([]);
    expect(said(waiting(85), looked, false).lines).toEqual([]);
  });

  it("marks rows that ran under another tree's code, warns once, and counts no agreement", () => {
    const log = logOf()
      .add(2, "condition.recorded", recorded(OTHER))
      .add(3, "campaign.move", { move: "build", code: "asked", why: "w", session: "b-1" })
      .add(4, "build.started", { session: "b-1" })
      .add(5, "build.finished", { session: "b-1", ended: "finished", changed: false })
      .add(6, "condition.recorded", recorded(HERE))
      .add(7, "campaign.move", { move: "build", code: "led", why: "w", session: "b-2" })
      .add(8, "build.started", { session: "b-2" })
      .add(9, "build.finished", { session: "b-2", ended: "finished", changed: false });
    const lines = timelineLines(log.events, HERE);
    expect(lines.filter((line) => line.startsWith("warning:"))).toHaveLength(1);
    const [old, current] = rowsOf(lines, "move");
    // A log before 5 November reads `asked`, kept as recorded.
    expect(old).toContain("recorded build/asked b-1");
    expect(old).toContain(` ${OTHER.slice(0, 8)} `);
    expect(current).toContain(`=${HERE.slice(0, 8)}`);
    expect(lines.some((line) => /mismatch|differ|agree/.test(line))).toBe(false);
  });

  it("marks the move whose step is still open at the log's end, and none once it has ended", () => {
    const open = logOf()
      .add(2, "campaign.move", { move: "build", code: "led", why: "w", session: "b-1" })
      .add(3, "build.started", { session: "b-1" })
      .add(4, "campaign.move", { move: "prepare", code: "practice", why: "w" });
    const moves = rowsOf(timelineLines(open.events, HERE), "move");
    expect(moves[0]).toContain("b-1 open at the log's end");
    expect(moves[1]).not.toContain("open at the log's end");

    const ended = open.add(5, "build.finished", { session: "b-1", ended: "finished", changed: false });
    expect(timelineLines(ended.events, HERE).some((line) => line.includes("open at the log's end"))).toBe(
      false,
    );
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
