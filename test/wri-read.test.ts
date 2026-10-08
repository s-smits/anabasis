// The whole-run investigation's reader folds one log into six rows and the triggers that start its
// lanes. This round is small enough to count by hand: one practice task, one task screened and
// admitted on the parent's fails alone, one anchor task, a refusal ruled a check defect that stays
// in the tally, and an edit made after the last practice.
import { describe, expect, it } from "bun:test";
import { type Condition, conditionId } from "../src/kernel/condition.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { overview, rendered, TRIGGERS } from "../tools/wri/read.ts";

const START = Date.parse("2026-10-08T12:00:00Z");
const events: LogEvent[] = [];
const record = (kind: EventKind, data: JsonObject) => {
  events.push({ at: new Date(START + events.length * 1_000).toISOString(), kind, data });
};

const condition = (task: string, harness: string): Condition => ({
  contract: "c1",
  harness,
  task,
  model: "p/m",
  effort: "high",
  prices: { "p/m": { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } },
  runtime: {},
  compaction: "off",
  solverTools: "s1",
  verifierTools: "v1",
  sandbox: "x1",
  limits: {
    wallSeconds: 100,
    turns: 8,
    shellDefaultSeconds: 10,
    shellMaxSeconds: 20,
    concurrency: 1,
    diskBytes: 1,
  },
  host: "host-1",
  side: "test",
});

let solves = 0;
/** One finished solve of `task` under `harness`, with the verdict a refusal carries. */
function solve(task: string, harness: string, outcome: "pass" | "fail"): string {
  const ran = condition(task, harness);
  const id = `s${String((solves += 1))}`;
  record("condition.recorded", { id: conditionId(ran), condition: requireJsonValue(ran) });
  record("solve.started", { solve: id, condition: conditionId(ran), limits: { wallSeconds: 100 } });
  record("solve.call", { solve: id, turn: 1, tool: "submit", isError: false });
  record("solve.finished", {
    solve: id,
    ending: outcome === "pass" ? { outcome } : { outcome, kind: "rejected" },
    seconds: 50,
    responseModels: ["m-1"],
    metered: 1,
  });
  if (outcome === "fail") record("verdict", { solve: id, task, kind: "fail", blocking: ["check-a"] });
  return id;
}

record("contract.frozen", { contract: "c1", checks: "k1" });
record("checker.read", {
  contract: "c1",
  checks: "k1",
  faults: [],
  rows: [{ id: "check-a", instrument: "authored", passed: 3, refused: 1, caught: 1, named: 1 }],
});
for (const version of ["t1", "t2", "a1"]) {
  record("task.proposed", { version });
  for (const gate of [1, 2, 3, 4]) record("task.gate", { version, gate, outcome: "passed", controls: "d" });
}
record("anchor.drawn", { tasks: ["a1"] });
record("task.state", { version: "t1", state: "released" });
record("build.started", { session: "b-1", parent: "hp", tasks: ["t1"] });
record("build.call", { session: "b-1", tool: "write_file", args: { path: "agent/tools.mjs" } });
record("build.call", { session: "b-1", tool: "practice", args: { task: "t1" } });
solve("t1", "hc", "fail");
record("build.call", { session: "b-1", tool: "write_file", args: { path: "agent/BUILT_AGENTS.md" } });
record("build.finished", { session: "b-1", ended: "finished", harness: "hc", changed: true, metered: 2 });
// Screening: the parent fails t2 twice and the child passes it, so the parent's fails admit it.
solve("t2", "hp", "fail");
solve("t2", "hp", "fail");
solve("t2", "hc", "pass");
record("task.state", { version: "t2", state: "admitted", session: "b-1" });
// Scoring, counted from the admission on, and the anchor.
const refused = solve("t2", "hp", "fail");
solve("t2", "hc", "pass");
solve("a1", "hp", "pass");
solve("a1", "hc", "pass");
record("referee.finding", {
  solve: refused,
  task: "t2",
  ruling: "check-defect",
  check: "check-a",
  probes: [],
});
record("comparison.reported", {
  session: "b-1",
  versions: ["t2"],
  scored: { wins: 1, losses: 0, ties: 0 },
  anchor: { reading: "not-tested", informative: 0 },
  flagged: ["t2"],
  short: [],
  unscreened: [],
  fresh: "hc",
  reading: "no-step",
});

const seen = overview(events);
const detail = (name: keyof typeof TRIGGERS) =>
  seen.triggers.find((trigger) => trigger.name === name)?.detail;

describe("the whole-run investigation's reader", () => {
  it("settles the six rows from the log alone", () => {
    expect(seen.rows.map((row) => row.id)).toEqual(["A", "B", "C", "D", "E", "F"]);
    const lines = seen.rows.flatMap((row) => row.lines);
    expect(lines).toContain("frozen: contract c1, check program k1");
    expect(lines).toContain("test side: fail rejected 4, pass 4");
    expect(lines).toContain("0 of 8 finished solves name no response model");
    expect(lines).toContain("states: admitted 1, held 1, released 1; anchor 1");
    expect(lines).toContain("b-1: hp > hc, ended finished, 0 practice solves, reading no-step");
  });

  it("gives every trigger the lane its table names", () => {
    expect(seen.triggers.length).toBeGreaterThan(0);
    for (const trigger of seen.triggers) {
      expect(trigger.lane).toBe(TRIGGERS[trigger.name]);
    }
  });

  it("starts the instrument lanes on an authored check and a refusal ruled a check defect", () => {
    expect(detail("INSTRUMENT AUTHORED")).toBe("1 of 1 checks decide by their author's own computation");
    expect(detail("CHECK DEFECT RULED")).toBe("1 of 4; by check: check-a 1");
    expect(detail("REFUSED UNREAD")).toBe("3 of 4 refused answers no reviewer ruled on");
    expect(detail("FLAGGED AND STILL COUNTED")).toBe(
      "1 task with a fail ruled a check defect stayed in a comparison",
    );
  });

  it("reads a round's solves by what each was for", () => {
    // Two screening fails under the parent chose the task; the fail after the admission scores it.
    expect(detail("ADMITTED BY")).toBe("b-1: the parent's fails 1, the child's 0, both 0");
    expect(detail("FEW INFORMATIVE PAIRS")).toBe("b-1: 1 of 1 tasks tell the harnesses apart");
    expect(detail("ANCHOR NOT HELD")).toBe("b-1: not-tested, 0 informative");
    expect(detail("WALL SHARE")).toBe("b-1: median 50.0% under the parent, 50.0% under the child");
    expect(detail("CHAIN")).toBe("b-1 hp>hc no-step");
  });

  it("reads what the Builder did before it stopped", () => {
    expect(detail("HARNESS CHANGED")).toBe(
      "b-1: hp to hc; written by write_file: agent/tools.mjs, agent/BUILT_AGENTS.md",
    );
    expect(detail("TOOLS EDITED")).toBe("b-1: agent/tools.mjs");
    expect(detail("FINAL BYTES NEVER PRACTISED")).toBe("b-1: 1 edit after the last practice");
    expect(detail("PRACTICE FAILS")).toBe("b-1: 1 fail, 0 ruled earned, 0 passed in a later practice");
    expect(detail("NEVER CHECKED")).toBe("b-1: no check_harness call");
  });

  it("fires nothing it has no event for, and prints each trigger with its lane", () => {
    const names = seen.triggers.map((trigger) => trigger.name);
    for (const absent of ["NON-RESULTS", "HOST CODE MOVED", "TASKS CARRIED", "SUPPLY THIN", "FLIPS"]) {
      expect(names).not.toContain(absent);
    }
    expect(rendered(seen)).toContain("CHECK DEFECT RULED (lane 4): 1 of 4; by check: check-a 1");
  });

  it("says of an empty log only that it has no checker on record", () => {
    expect(overview([]).triggers.map((trigger) => trigger.name)).toEqual([
      "NO CHECKER READING",
      "CHECKER NOT FROZEN",
    ]);
  });
});
