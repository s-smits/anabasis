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
    // The admitted task is the pool, and the parent's three fails of it are on record.
    expect(lines).toContain(
      "against hp, where the campaign stands: 1 of the pool stop it, 0 it clears, 0 ended at the wall, 0 no solve has placed; 0 wait for a witness",
    );
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
    // The pool holds the task this round admitted, which the next round screens again.
    expect(detail("NO CANDIDATES HELD")).toBeUndefined();
    expect(detail("WHAT BINDS")).toBe(
      "tasks: 1 of the pool can be scored and a step takes 4: no Examiner session has written against this harness",
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
      // The report names neither its parent nor its solves a side, as an older log's does not.
      "RULINGS AGAINST THE EFFECT",
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
    // The pool is the two new candidates and the task an earlier round admitted. Of the three,
    // the one the draw puts last is the only one screened.
    const last = screeningOrder(["t2", "c1", "c2"], "c1", "b-3").at(-1) ?? "";
    solve(last, "hp", "pass");
    solve(last, "he", "pass");
    record("comparison.reported", { session: "b-3", versions: [], scored: null, reading: "no-change" });
    const said = overview(events).triggers.findLast(
      (trigger) => trigger.name === "SCREENED OUT OF THE DRAWN ORDER",
    );
    expect(said?.detail).toBe(
      "b-3: 1 of 1 screened tasks are not among the first 1 of the draw over 3 candidates",
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

describe("the reader on a campaign whose exam follows its harness", () => {
  const log: LogEvent[] = [];
  const put = (kind: EventKind, data: JsonObject) => {
    log.push({ at: new Date(START + log.length * 1_000).toISOString(), kind, data });
  };
  let made = 0;
  /** One finished solve, on the test side unless told. */
  const ran = (task: string, harness: string, outcome: "pass" | "fail", side: Condition["side"] = "test") => {
    const under = { ...condition(task, harness), side };
    const id = `m${String((made += 1))}`;
    put("condition.recorded", { id: conditionId(under), condition: requireJsonValue(under) });
    put("solve.started", { solve: id, condition: conditionId(under), limits: { wallSeconds: 100 } });
    put("solve.finished", {
      solve: id,
      ending: outcome === "pass" ? { outcome } : { outcome, kind: "rejected" },
      seconds: 50,
    });
    return id;
  };
  for (const version of ["t2", "t3", "a1"]) {
    put("task.proposed", { version });
    for (const gate of [1, 2, 3, 4]) put("task.gate", { version, gate, outcome: "passed", controls: "d" });
  }
  put("anchor.drawn", { tasks: ["a1"] });
  // A task a session wrote, which the stronger solver did not pass under the first harness.
  put("exam.started", { session: "x-1", standsOn: "hp" });
  put("task.proposed", { version: "r1", taskId: "r1", session: "x-1", task: { taskId: "r1" } });
  put("task.gate", { version: "r1", gate: 1, outcome: "passed" });
  put("task.gate", { version: "r1", gate: 2, outcome: "too-hard", solve: ran("r1", "hp", "fail", "strong") });
  put("task.state", { version: "r1", state: "too-hard", session: "x-1" });
  put("exam.word", { session: "x-1", version: "r1", word: "too hard" });
  put("exam.finished", { session: "x-1", proposed: 1, words: { r1: "too hard" } });
  // Round one: both harnesses fail t2 twice, and both pass t3 three times.
  put("build.started", { session: "b-1", parent: "hp", tasks: [] });
  put("build.finished", { session: "b-1", ended: "finished", harness: "hc", changed: true });
  for (const harness of ["hp", "hc"]) for (const _nth of [1, 2]) ran("t2", harness, "fail");
  put("task.state", { version: "t2", state: "admitted", session: "b-1" });
  for (const harness of ["hp", "hc"]) for (const _nth of [1, 2, 3]) ran("t3", harness, "pass");
  put("task.state", { version: "t3", state: "too-easy", session: "b-1" });
  ran("t2", "hp", "fail");
  ran("t2", "hc", "fail");
  const report = { level: 0.1, screening: { solves: 3, fails: 2 }, short: [], unscreened: [] };
  put("comparison.reported", { ...report, session: "b-1", versions: ["t2"], fresh: "hc", reading: "step" });
  // A session after the step that still stood on the first harness, and tried the reach task again.
  put("exam.started", { session: "x-2", standsOn: "hp", reach: ["r1"] });
  put("task.gate", { version: "r1", gate: 2, outcome: "passed", solve: ran("r1", "hp", "pass", "strong") });
  put("task.gate", { version: "r1", gate: 3, outcome: "passed" });
  put("task.state", { version: "r1", state: "held", session: "x-2" });
  put("exam.finished", { session: "x-2", proposed: 0, words: { r1: "scored" } });
  // Round two starts from the step. Its parent's three fails of t2 are on record, so it admits the
  // task again with no screening solve, and scores it on fresh ones.
  put("build.started", { session: "b-2", parent: "hc", tasks: [] });
  put("build.finished", { session: "b-2", ended: "finished", harness: "hd", changed: true });
  put("task.state", { version: "t2", state: "admitted", session: "b-2", carried: true });
  ran("t2", "hc", "fail");
  ran("t2", "hd", "pass");
  put("comparison.reported", {
    ...report,
    session: "b-2",
    versions: ["t2"],
    fresh: "hd",
    reading: "no-step",
  });
  const seenLater = overview(log);
  const of = (name: keyof typeof TRIGGERS) =>
    seenLater.triggers.flatMap((trigger) => (trigger.name === name ? [trigger.detail] : []));

  it("names the parent's solves a round read from the log, and what it kept and retired", () => {
    expect(of("PARENT SIDE ON RECORD")).toEqual([
      "b-2: 3 solves of the parent on 1 task were made before the round and read by its screening; 1 admitted on them with no screening solve of the round, 0 retired",
    ]);
    // The second round's admission rests on the parent's fails, though it made no screening solve.
    expect(of("ADMITTED BY")).toEqual([
      "b-1: the parent's fails 0, the child's 0, both 1; 2 of 2 candidates screened, the first of the draw",
      "b-2: the parent's fails 1, the child's 0, both 0; 1 of 1 candidate screened, the first of the draw",
    ]);
    expect(of("RETIRED BY A ROUND")).toEqual(["b-1: 1, 0 of them admitted by an earlier round"]);
    expect(of("SCORED SET CARRIED")).toEqual([]);
  });

  it("reads a reach task by its last stronger solve, and names a session that stood behind the step", () => {
    expect(of("TOO HARD")).toEqual([]);
    expect(of("WITNESSED ON A LATER TRY")).toEqual([
      "1 of 1 tasks a stronger solve had failed were passed when tried again",
    ]);
    expect(of("EXAMINER BEHIND THE FRONTIER")).toEqual(["x-2 stood on hp, and the last step had left hc"]);
    // x-2 proposed nothing and bracketed the task it tried again: one of the one it put to the
    // stronger solver, and not one of none.
    expect(of("BRACKETED BY SESSION")).toEqual(["x-1 0 of 1; x-2 1 of 1"]);
  });

  it("says where the campaign stands and what binds its climb", () => {
    const lines = seenLater.rows.flatMap((row) => row.lines);
    expect(lines).toContain(
      "against hc, where the campaign stands: 1 of the pool stop it, 0 it clears, 0 ended at the wall, 0 no solve has placed; 0 wait for a witness",
    );
    // No session wrote against the harness the step left: the one after it stood on the first.
    expect(of("WHAT BINDS")).toEqual([
      "tasks: 1 of the pool can be scored and a step takes 4: no Examiner session has written against this harness",
    ]);
  });
});

describe("the reader on what a round's reading rests on", () => {
  const log: LogEvent[] = [];
  const put = (kind: EventKind, data: JsonObject) => {
    log.push({ at: new Date(START + log.length * 1_000).toISOString(), kind, data });
  };
  let made = 0;
  /** One finished solve under `harness`, with the host's code as `host` names it. */
  const ran = (task: string, harness: string, outcome: "pass" | "fail", host = "host-1") => {
    const under = { ...condition(task, harness), host };
    const id = `w${String((made += 1))}`;
    put("condition.recorded", { id: conditionId(under), condition: requireJsonValue(under) });
    put("solve.started", { solve: id, condition: conditionId(under), limits: { wallSeconds: 100 } });
    put("solve.finished", {
      solve: id,
      ending: outcome === "pass" ? { outcome } : { outcome, kind: "rejected" },
      seconds: 50,
    });
    return id;
  };
  const WON = ["v1", "v2", "v3", "v4"];
  for (const version of [...WON, "l1", "a1"]) {
    put("task.proposed", { version });
    for (const gate of [1, 2, 3, 4]) put("task.gate", { version, gate, outcome: "passed", controls: "d" });
  }
  put("anchor.drawn", { tasks: ["a1"] });
  const report = { level: 0.1, solves: 1, screening: { solves: 3, fails: 2 }, short: [], unscreened: [] };
  // Round one, at one solve a side: the child wins four tasks and loses one. The Referee read the
  // fails behind two of the wins and behind the loss, and let each stand.
  put("build.started", { session: "b-1", parent: "hp", tasks: [] });
  put("build.finished", { session: "b-1", ended: "finished", harness: "hc", changed: true });
  for (const version of [...WON, "l1"]) put("task.state", { version, state: "admitted", session: "b-1" });
  const fails = WON.map((version) => {
    const failed = ran(version, "hp", "fail");
    ran(version, "hc", "pass");
    return failed;
  });
  ran("l1", "hp", "pass");
  for (const read of [...fails.slice(0, 2), ran("l1", "hc", "fail")]) {
    put("referee.finding", { solve: read, ruling: "earned", probes: [] });
  }
  put("comparison.reported", {
    ...report,
    session: "b-1",
    old: "hp",
    fresh: "hc",
    versions: [...WON, "l1"],
    scored: { wins: 4, losses: 1, ties: 0 },
    reading: "no-step",
  });
  // Round two scores one task whose two sides ran under different host code: no pair to read.
  put("build.started", { session: "b-2", parent: "hp", tasks: [] });
  put("build.finished", { session: "b-2", ended: "finished", harness: "hd", changed: true });
  put("task.state", { version: "v1", state: "admitted", session: "b-2" });
  ran("v1", "hp", "fail");
  ran("v1", "hd", "pass", "host-2");
  put("comparison.reported", {
    ...report,
    session: "b-2",
    old: "hp",
    fresh: "hd",
    versions: ["v1"],
    scored: { wins: 1, losses: 0, ties: 0 },
    reading: "no-step",
  });
  const of = (name: keyof typeof TRIGGERS) =>
    overview(log).triggers.flatMap((trigger) => (trigger.name === name ? [trigger.detail] : []));

  it("sets each report's scored test against its reviewers, with their error unmeasured", () => {
    // 4-1 is 6 in 32 and does not clear; with the loss gone, 4-0 does. Two wins were read by nobody.
    expect(of("RULINGS AGAINST THE EFFECT")).toEqual([
      "b-1: 2 of 5 informative pairs rest on a fail no reviewer read; the scored test does not clear its level, and 1 of its 1 losses resting on a mistaken ruling would move it; the Referee's error is unmeasured",
    ]);
    // The round with no pairs to read is named by the lane that owns why.
    expect(of("PAIR DIFFERS BEYOND HARNESS")).toEqual(["b-2: host"]);
  });
});
