// The whole-run investigation's reader folds one log into six rows and the triggers that start its
// lanes. This round is small enough to count by hand: one practice task, one task screened and
// admitted on the parent's fails alone, one anchor task, a refusal ruled a check defect that stays
// in the tally, and an edit made after the last practice.
import { describe, expect, it } from "bun:test";
import { type Condition, conditionId } from "../src/kernel/condition.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { screeningOrder } from "../src/builder/round.ts";
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
// The practice solve runs under the state as it then stood, hb; the edit after it makes hc.
solve("t1", "hb", "fail");
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
  target: 1,
  level: 0.1,
  versions: ["t2"],
  scored: { wins: 1, losses: 0, ties: 0 },
  anchor: { reading: "not-tested", informative: 0 },
  flagged: ["t2"],
  unflagged: { scored: { wins: 0, losses: 0, ties: 0, p: 1 }, reading: "not-scored" },
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
    expect(lines).toContain("0 feasible tasks held outside the anchor, for a round to screen");
    expect(lines).toContain(
      "metered dollars: solver 8.00, builder 2.00, examiner 0.00, referee 0.00, diagnoser 0.00",
    );
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
    expect(detail("ADMITTED BY")).toBe(
      "b-1: the parent's fails 1, the child's 0, both 0; 1 of 1 candidate screened, the first of the draw",
    );
    expect(detail("FEW INFORMATIVE PAIRS")).toBe(
      "b-1: 1 of 1 tasks tell the harnesses apart; at level 0.1 the least sweep that clears is 4-0, and no result with a loss clears on 1 pair",
    );
    expect(detail("SCREENING RULE NOT ON RECORD")).toBe(
      "b-1: 3 screening solves, and the report names neither how many a harness nor how many fails admit",
    );
    // The one fail ruled a check defect is the parent's, counted after the admission; the two that
    // admitted the task were read by nobody.
    expect(detail("FLAGGED FAILS BY SIDE")).toBe(
      "b-1: 1 counted fail ruled a check defect, 1 under the parent and 0 under the child",
    );
    expect(detail("ADMITTED ON FLAGGED FAILS")).toBeUndefined();
    expect(detail("READING MOVES WITHOUT FLAGGED")).toBe(
      "b-1: no-step with 1 flagged task counted, not-scored without",
    );
    expect(detail("NO CANDIDATES HELD")).toBe(
      "no feasible task is held outside the anchor: a round has nothing to screen, and scores only what another route admitted",
    );
    expect(detail("ANCHOR NOT HELD")).toBe("b-1: not-tested, 0 informative");
    expect(detail("WALL SHARE")).toBe("b-1: median 50.0% under the parent, 50.0% under the child");
    expect(detail("CHAIN")).toBe("b-1 hp>hc no-step");
  });

  it("reads what the Builder did before it stopped", () => {
    expect(detail("HARNESS CHANGED")).toBe(
      "b-1: hp to hc; written by write_file: agent/tools.mjs, agent/BUILT_AGENTS.md",
    );
    expect(detail("TOOLS EDITED")).toBe("b-1: agent/tools.mjs");
    expect(detail("FINAL BYTES NEVER PRACTISED")).toBe(
      "b-1: no practice solve ran under hc, the harness measured; the last ran under hb",
    );
    expect(detail("PRACTICE FAILS")).toBe(
      "b-1: 1 fail, 0 ruled earned; the same task passed later under changed bytes 0, under the same bytes 0",
    );
    expect(detail("NEVER CHECKED")).toBe("b-1: no check_harness call");
  });

  it("fires nothing it has no event for, and prints each trigger with its lane", () => {
    const names = seen.triggers.map((trigger) => trigger.name);
    for (const absent of [
      "NON-RESULTS",
      "HOST CODE MOVED",
      "TASKS CARRIED",
      "SUPPLY THIN",
      "FLIPS",
      "NOTHING SCORED",
      "ANCHOR RATE BY ROUND",
    ]) {
      expect(names).not.toContain(absent);
    }
    expect(rendered(seen)).toContain("CHECK DEFECT RULED (lane 4): 1 of 4; by check: check-a 1");
  });

  it("names a round that scored nothing, and one harness measured on the anchor in two rounds", () => {
    // A second session from the same parent, in a round asked for no scored task.
    record("build.started", { session: "b-2", parent: "hp", tasks: ["t1"] });
    record("build.finished", { session: "b-2", ended: "finished", harness: "hd", changed: true });
    solve("a1", "hp", "fail");
    solve("a1", "hd", "pass");
    record("comparison.reported", {
      session: "b-2",
      target: 0,
      level: 0.1,
      screening: { solves: 3, fails: 2 },
      versions: [],
      scored: { wins: 0, losses: 0, ties: 0 },
      anchor: { reading: "not-tested", informative: 1 },
      fresh: "hd",
      reading: "not-scored",
    });
    const later = overview(events).triggers;
    const said = (name: keyof typeof TRIGGERS) => later.findLast((trigger) => trigger.name === name)?.detail;
    expect(said("NOTHING SCORED")).toBe(
      "b-2: no task was scored, at a target of 0; the report reads not-scored",
    );
    expect(said("ANCHOR RATE BY ROUND")).toBe("hp: 1 of 1 in b-1, 0 of 1 in b-2");
    expect(said("CHAIN")).toBe("b-1 hp>hc no-step; b-2 hp>hd not-scored");
    expect(later.filter((trigger) => trigger.name === "FEW INFORMATIVE PAIRS")).toHaveLength(1);
  });

  it("replays the screening order, and names a round that screened out of it", () => {
    for (const version of ["c1", "c2"]) {
      record("task.proposed", { version });
      for (const gate of [1, 2, 3, 4]) {
        record("task.gate", { version, gate, outcome: "passed", controls: "d" });
      }
    }
    record("build.started", { session: "b-3", parent: "hp", tasks: ["t1"] });
    record("build.finished", { session: "b-3", ended: "finished", harness: "he", changed: true });
    // Of two candidates, the one the draw puts last is the only one screened.
    const [, last = ""] = screeningOrder(["c1", "c2"], "c1", "b-3");
    solve(last, "hp", "pass");
    solve(last, "he", "pass");
    record("comparison.reported", { session: "b-3", versions: [], scored: null, reading: "no-change" });
    const said = overview(events).triggers.findLast(
      (trigger) => trigger.name === "SCREENED OUT OF THE DRAWN ORDER",
    );
    expect(said?.detail).toBe(
      "b-3: 1 of 1 screened tasks are not among the first 1 of the draw over 2 candidates",
    );
  });

  it("says what a person's labels settled, beside what the round's own report read", () => {
    // The first round's report, written again as the labels left it.
    record("comparison.reported", {
      session: "b-1",
      fresh: "hc",
      versions: [],
      scored: { wins: 0, losses: 0, ties: 0 },
      flagged: [],
      unflagged: null,
      counted: "not-scored",
      reading: "not-scored",
      settled: { labelled: 1, defects: 1, disputed: ["t2"] },
    });
    const later = overview(events).triggers;
    const said = (name: keyof typeof TRIGGERS) => later.find((trigger) => trigger.name === name)?.detail;
    expect(said("SETTLED BY HAND")).toBe(
      "b-1: 1 fail labelled, 1 a check defect, 1 task disputed; the round's own report read no-step, the settled one reads not-scored",
    );
    // The round's own report still says the reading moved without its flagged task.
    expect(said("READING MOVES WITHOUT FLAGGED")).toBe(
      "b-1: no-step with 1 flagged task counted, not-scored without",
    );
    expect(said("CHAIN")).toStartWith("b-1 hp>hc not-scored");
  });

  it("says of an empty log only that it has no checker on record", () => {
    expect(overview([]).triggers.map((trigger) => trigger.name)).toEqual([
      "NO CHECKER READING",
      "CHECKER NOT FROZEN",
    ]);
  });
});
