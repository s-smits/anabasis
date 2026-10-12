// The whole-run investigation's reader folds one log into six rows and the triggers that start its
// lanes. This campaign is small enough to count by hand: one practice task and four held-out ones,
// a round whose comparison sets two tasks aside on rejections, a ruling of a check defect, an edit
// made after the last practice, and then comparisons that tie, find no valid answer, meet their cap
// and are settled by hand.
import { describe, expect, it } from "bun:test";
import { type Condition, conditionId, settingId } from "../src/kernel/condition.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined, keyIfNotNull } from "../src/meta/optional-key.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { TRIGGERS } from "../tools/wri/folds.ts";
import { overview, rendered } from "../tools/wri/read.ts";

const START = Date.parse("2026-10-09T12:00:00Z");
const REPORTED = "comparison.reported";
const PROPOSED = "task.proposed";
const BUILD_STARTED = "build.started";
const SOLVE_STARTED = "solve.started";
const SOLVE_FINISHED = "solve.finished";
const COMPARISON_STARTED = "comparison.started";
const GATE = "task.gate";
const HELD = ["v1", "v2", "v3", "v4"];
const TESTED = { wins: 0, losses: 0, ties: 0, p: 1 };
/** A report's fields where a case names none: a comparison that tallied nothing and stopped nowhere. */
const REPORT = {
  scored: TESTED,
  billed: null,
  against: null,
  noise: null,
  counted: null,
  versions: [],
  disputed: [],
  aside: [],
  short: [],
  capped: false,
  settled: null,
};
const events: LogEvent[] = [];
/** A writer of events onto `log`, a second apart from the start. */
const appendTo = (log: LogEvent[]) => (kind: EventKind, data: JsonObject) => {
  log.push({ at: new Date(START + log.length * 1_000).toISOString(), kind, data });
};
const record = appendTo(events);

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
const SETTING = settingId(condition("any", "any"));

let solves = 0;
/** The comparison the next solves are made for: none until one starts. */
let comparison: string | null = null;
/** One finished solve of `task` under `harness`: a valid answer, one a check rejected, with the
 *  verdict a rejection carries, none within its limits, or none though its limits left it room. */
function solve(task: string, harness: string, outcome: "pass" | "rejected" | "late" | "silent"): string {
  const ran = condition(task, harness);
  const id = `s${String((solves += 1))}`;
  record("condition.recorded", { id: conditionId(ran), condition: requireJsonValue(ran) });
  record(SOLVE_STARTED, {
    solve: id,
    condition: conditionId(ran),
    limits: { wallSeconds: 100 },
    ...keyIfNotNull("comparison", comparison),
  });
  record("solve.call", { solve: id, turn: 1, tool: "submit", isError: false });
  record(SOLVE_FINISHED, {
    solve: id,
    ending:
      outcome === "pass"
        ? { outcome }
        : {
            outcome: "fail",
            kind: { late: "wall-ended", silent: "no-answer", rejected: "rejected" }[outcome],
          },
    seconds: 50,
    responseModels: ["m-1"],
    billed: 1,
  });
  if (outcome === "rejected") record("verdict", { solve: id, task, kind: "fail", blocking: ["check-a"] });
  return id;
}

/** A comparison's start and where it stands, as `src/builder/round.ts` writes one. */
function started(session: string, old: string, fresh: string) {
  const terms = { old, fresh, starter: "hbase", setting: SETTING, solves: 1, level: 0.1 };
  comparison = session;
  record(COMPARISON_STARTED, { session, ...terms, noise: false, cap: null, tasks: HELD });
  return { session, ...terms, tasks: 4 };
}

record("contract.frozen", { contract: "c1", checks: "k1" });
record("checker.read", {
  contract: "c1",
  checks: "k1",
  faults: [],
  rows: [{ id: "check-a", instrument: "authored", passed: 3, refused: 1, caught: 1, named: 1 }],
});
for (const version of ["t1", ...HELD]) {
  record(PROPOSED, { version });
  record(GATE, { version, gate: 1, outcome: "passed" });
}
record("task.state", { version: "t1", state: "released" });
record(BUILD_STARTED, { session: "b-1", parent: "hp", tasks: ["t1"] });
record("build.call", { session: "b-1", tool: "write_file", args: { path: "agent/tools.mjs" } });
record("build.call", { session: "b-1", tool: "practice", args: { task: "t1" } });
// The practice solve runs under the state as it then stood, hb; the edit after it makes hc.
solve("t1", "hb", "rejected");
record("build.call", { session: "b-1", tool: "edit", args: { path: "agent/BUILT_AGENTS.md" } });
record("build.finished", { session: "b-1", ended: "finished", harness: "hc", changed: true, billed: 2 });
// The round's comparison. The reference harness's answers to v1 and v2 are rejected, one ruled a
// check defect and one ruled by nobody, and it gives none to v3 and v4 within its limits. The new
// harness answers all four.
const round = started("b-1", "hp", "hc");
const defect = solve("v1", "hp", "rejected");
solve("v1", "hc", "pass");
solve("v2", "hp", "rejected");
solve("v2", "hc", "pass");
for (const version of ["v3", "v4"]) {
  solve(version, "hp", "late");
  solve(version, "hc", "pass");
}
record("referee.finding", {
  solve: defect,
  task: "v1",
  ruling: "check-defect",
  check: "check-a",
  probes: [],
});
const OWN = {
  ...REPORT,
  ...round,
  scored: { wins: 2, losses: 0, ties: 0, p: 0.25, unsolved: 0 },
  // A report written before 2026-10-11 holds the same test at each shorter budget and the spread
  // of what repeated solves used; no trigger reads either.
  budgets: [{ turns: 4, wins: 1, losses: 0, ties: 1, p: 0.5 }],
  spread: { turns: { tasks: 2, median: 2, most: 3 }, cpu: null, seconds: { tasks: 2, median: 1, most: 1 } },
  noise: { wins: 0, losses: 0, ties: 2, p: 1 },
  counted: { wins: 4, losses: 0, ties: 0, p: 0.0625 },
  versions: ["v3", "v4"],
  aside: ["v1", "v2"],
  reading: "no-step",
};
record(REPORTED, OWN);

const seen = overview(events);
const detail = (name: keyof typeof TRIGGERS) =>
  seen.triggers.find((trigger) => trigger.name === name)?.detail;
/** The triggers of the log as it stands now, each name's last detail. */
const later = () => {
  const { triggers } = overview(events);
  return (name: keyof typeof TRIGGERS) => triggers.findLast((trigger) => trigger.name === name)?.detail;
};

/** b-1's first practice solve again, as a solve of a later session still running: its condition, its
 *  start and its end, under a new solve id. */
function practisedAgain(): LogEvent[] {
  // A start names its condition and an end its ending; a practice solve's start names no comparison.
  const start = events.findIndex(
    ({ data }) => data.condition !== undefined && data.solve !== undefined && data.comparison === undefined,
  );
  const id = events[start]?.data.solve;
  const end = events.findIndex(({ data }) => data.solve === id && data.ending !== undefined);
  return events
    .slice(start - 1, end + 1)
    .flatMap((event) =>
      event.data.tool === undefined
        ? [{ ...event, data: event.data.solve === id ? { ...event.data, solve: "s-again" } : event.data }]
        : [],
    );
}

describe("the whole-run investigation's reader", () => {
  it("settles the six rows from the log alone", () => {
    expect(seen.rows.map((row) => row.id)).toEqual(["A", "B", "C", "D", "E", "F"]);
    const lines = seen.rows.flatMap((row) => row.lines);
    expect(lines).toContain("frozen: contract c1, check program k1");
    expect(lines).toContain("test side: fail rejected 3, fail wall-ended 2, pass 4");
    expect(lines).toContain("0 of 9 finished solves name no response model");
    expect(lines).toContain("states: held 4, released 1");
    expect(lines).toContain("4 tasks held out, for a comparison to score; 1 released for practice");
    // A role the log holds no event of is no row: the Diagnoser's seat went on 11 October.
    expect(lines).toContain("billed dollars: solver 9.00, builder 2.00, referee 0.00");
    expect(lines).toContain("b-1: hp > hc, ended finished, 0 practice solves, reading b-1 no-step");
  });

  it("gives every trigger the lane its table names", () => {
    expect(seen.triggers.length).toBeGreaterThan(0);
    for (const trigger of seen.triggers) {
      expect(trigger.lane).toBe(TRIGGERS[trigger.name]);
    }
  });

  it("starts the instrument lanes on an authored check and a rejection ruled a check defect", () => {
    expect(detail("INSTRUMENT AUTHORED")).toBe("1 of 1 checks decide by their author's own computation");
    expect(detail("CHECK DEFECT RULED")).toBe("1 of 3; by check: check-a 1");
    expect(detail("REFUSED UNREAD")).toBe("2 of 3 refused answers no reviewer ruled on");
  });

  it("reads what a comparison left out on its rejections, and what that could move", () => {
    // Two rejections under the reference harness set two tasks aside: one ruled a check defect,
    // one ruled by nobody. Left out, a task the new harness would have won is no win of its.
    expect(detail("SET ASIDE BY SIDE")).toBe(
      "b-1: 2 rejections set 2 tasks aside, 2 under the reference harness and 0 under the others",
    );
    expect(detail("SET ASIDE AND UNSETTLED")).toBe(
      "2 tasks left out of a comparison on a rejection no person has labelled",
    );
    expect(detail("READING MOVES WITH THE SET-ASIDE")).toBe(
      "b-1: 2-0 without the 2 tasks set aside, 4-0 were their rejections to stand, and only one of the two clears its level",
    );
    expect(detail("SCORED SET MOVED")).toBe("b-1: 2 of 4 tasks it began with are not in its tally");
    expect(detail("FEW INFORMATIVE PAIRS")).toBe(
      "b-1: 2 of 2 tasks tell the harnesses apart; at level 0.1 the least sweep that clears is 4-0, and no result with a loss clears on 2 pairs",
    );
    expect(detail("CHAIN")).toBe("b-1 hp>hc no-step");
  });

  it("reads the budget from what a comparison measured: its own noise", () => {
    // The report's rows at shorter budgets and its spread, which were read until 2026-10-11, start
    // no trigger.
    expect(seen.triggers.some((trigger) => trigger.detail.includes("turns 4"))).toBe(false);
    expect(seen.triggers.some((trigger) => trigger.detail.includes("at the median"))).toBe(false);
    expect(detail("REFERENCE AGAINST ITSELF")).toBe(
      "b-1: 0 won, 0 lost and 2 tied between two samples of the reference harness",
    );
    expect(detail("WALL SHARE")).toBe("b-1: median 50.0% under the reference harness, 50.0% under the new");
    expect(detail("MISSES AT A LIMIT")).toBe(
      "b-1: 2 of 4 reference misses and 0 of 0 new at a limit (wall-ended 2)",
    );
  });

  it("reads what the Builder did before it stopped", () => {
    expect(detail("HARNESS CHANGED")).toBe(
      "b-1: hp to hc; written by its file tools and shell: agent/tools.mjs, agent/BUILT_AGENTS.md",
    );
    // A session a stop cut leaves no end record, and its writes are all there is of its harness.
    const stopped: LogEvent[] = [
      ...events,
      {
        at: new Date(START).toISOString(),
        kind: "build.started",
        data: { session: "b-2", parent: "hc", tasks: ["t1"] },
      },
      {
        at: new Date(START).toISOString(),
        kind: "build.call",
        data: { session: "b-2", tool: "write", args: { path: "agent/tools.mjs" } },
      },
    ];
    const cut = (name: string) =>
      overview(stopped).triggers.findLast((trigger) => trigger.name === name)?.detail;
    expect(cut("HARNESS CHANGED")).toBe(
      "b-2: hc to what a stop left unsaved; written by its file tools and shell: agent/tools.mjs",
    );
    // Its writes stand in for the end record wherever a trigger asks whether it touched the
    // harness: recode's cut session wrote its tool chain and called neither check nor practice,
    // and both lanes stayed shut on 10 October.
    expect(cut("NEVER CHECKED")).toBe("b-2: no check_harness call");
    expect(cut("NO PRACTICE")).toBe("b-2: the harness changed and no practice solve ran");
    // A session with no end record may still be running when the log is read: buffer-a's b-2 read
    // as "ended never, 0 practice solves" with three practice solves in the log (11 October).
    expect(cut("SESSION ENDED")).toBe("b-2: not finished by the log's last event");
    expect(overview([...stopped, ...practisedAgain()]).rows.flatMap((row) => row.lines)).toContain(
      "b-2: hc > none, ended not yet: open at the log's end, 1 practice solve, reading none",
    );
    expect(detail("TOOLS EDITED")).toBe("b-1: agent/tools.mjs");
    // The tally is of the solves under the harness the session left, whichever comparison ran them.
    expect(detail("TOOLS CALLED")).toBe("hc, left by b-1, over 4 test-side solves: submit 4");
    // A tool tree written by shell is the tree too: esp32's b-1 kept 9 tool files on 12 October and
    // its file tools wrote none of them.
    const shelled = overview([
      ...stopped,
      {
        at: new Date(START).toISOString(),
        kind: "build.call",
        data: {
          session: "b-2",
          tool: "bash",
          args: { command: "mv .toolchain/lib/a.js .toolchain/lib/a.cjs" },
        },
      },
    ]).triggers.flatMap(({ name, detail: said }) =>
      said.startsWith("b-2:") && (name === "HARNESS CHANGED" || name === "TOOLS EDITED") ? [said] : [],
    );
    expect(shelled).toEqual([
      "b-2: hc to what a stop left unsaved; written by its file tools and shell: agent/tools.mjs, .toolchain",
      "b-2: agent/tools.mjs, .toolchain",
    ]);
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
      "TIED TASKS",
      "TIES BETWEEN VALID ANSWERS",
      "NO VALID ANSWER",
      "AWAITING A LABEL",
      "CUT BY ITS CAP",
      "VALID BY HARNESS",
      "EXAMINER NEVER FINISHED",
      "STEP NOT REPEATED",
      "SETTLED BY HAND",
    ] as const) {
      expect(names).not.toContain(absent);
    }
    expect(rendered(seen)).toContain("CHECK DEFECT RULED (lane 4): 1 of 3; by check: check-a 1");
  });

  it("names the ties between valid answers, and a task with no valid answer on record after two comparisons", () => {
    // A fifth held-out task, which no solve on record has answered: the round's new harness
    // answered the other four, and a task with a valid answer on record is feasible for good.
    record(PROPOSED, { version: "v5" });
    record(GATE, { version: "v5", gate: 1, outcome: "passed" });
    // Two comparisons of the reference harness with the starter. Both answer v1 to v4 validly
    // every time, and neither gives v5 an answer, though no solve of it is cut at a limit.
    for (const session of ["g-1", "g-2"]) {
      const terms = started(session, "hp", "hbase");
      for (const harness of ["hp", "hbase"]) {
        solve("v5", harness, "silent");
        for (const version of HELD) solve(version, harness, "pass");
      }
      const scored = { ...TESTED, ties: 5, unsolved: 1 };
      record(REPORTED, { ...REPORT, ...terms, scored, versions: [...HELD, "v5"], reading: "no-step" });
      const said = later();
      expect(said("TIED TASKS")).toEndWith(`${session}: 5 of 5, 1 of them with no valid answer`);
      // Four of five tasks tie with valid answers on both sides: the plan's condition for an objective.
      expect(said("TIES BETWEEN VALID ANSWERS")).toEndWith(`${session}: 4 of 5 tasks`);
      expect(said("NO VALID ANSWER")).toBe("1 of 5 scored tasks have no valid answer from any harness");
      expect(said("AWAITING A LABEL")).toBe(
        session === "g-1"
          ? undefined
          : "1 task with no valid answer on record after two comparisons that cut no solve of it at a limit, left out of the scored set until a person labels each: v5",
      );
    }
    expect(later()("CHAIN")).toBe("b-1 hp>hc no-step; g-1 hp>hbase no-step; g-2 hp>hbase no-step");
  });

  it("names a comparison its cap cut, one that tallied nothing, and one below the starter", () => {
    record(REPORTED, {
      ...REPORT,
      ...started("g-3", "hp", "hbase"),
      scored: null,
      capped: true,
      reading: "not-scored",
    });
    expect(later()("CUT BY ITS CAP")).toBe("g-3: the dollar cap ended it before it was read");
    record(REPORTED, { ...REPORT, ...started("g-4", "hp", "hbase"), reading: "not-scored" });
    expect(later()("NOTHING SCORED")).toBe(
      "g-4: no task was scored, of 4 asked for; the report reads not-scored",
    );
    // A report of before 2026-10-11 may read `below-starter`, with the tally against the starter
    // beside it: no trigger reads either since.
    record(REPORTED, {
      ...REPORT,
      ...started("g-5", "hp", "hd"),
      scored: { ...TESTED, wins: 4, p: 0.0625, unsolved: 0 },
      against: { ...TESTED, wins: 1, losses: 3 },
      versions: HELD,
      reading: "below-starter",
    });
    expect(overview(events).triggers.some((trigger) => trigger.detail.includes("against the starter"))).toBe(
      false,
    );
  });

  it("names a step no second comparison of the same two harnesses has repeated", () => {
    const stepped = {
      scored: { ...TESTED, wins: 4, p: 0.0625, unsolved: 0 },
      versions: HELD,
      reading: "step",
    };
    record(REPORTED, { ...REPORT, ...started("g-6", "hp", "he"), ...stepped });
    expect(later()("STEP NOT REPEATED")).toBe(
      "1 step no second comparison of the same two harnesses has repeated",
    );
    // The same two harnesses compared once more, on fresh solves: the step is repeated.
    record(REPORTED, { ...REPORT, ...started("g-7", "hp", "he"), ...stepped });
    expect(later()("STEP NOT REPEATED")).toBeUndefined();
  });

  it("says what a person's labels settled, beside what the comparison's own report read", () => {
    // The first round's report, written again as the labels left it: v1's rejection a check defect,
    // v2's earned. The test now clears its level, and the starter was never solved for it.
    record("task.state", { version: "v1", state: "disputed", session: "b-1" });
    record(REPORTED, {
      ...OWN,
      scored: { wins: 3, losses: 0, ties: 0, p: 0.125, unsolved: 0 },
      counted: null,
      versions: ["v2", "v3", "v4"],
      disputed: ["v1"],
      aside: [],
      reading: "starter-unread",
      settled: { labelled: 2, defects: 1, disputed: ["v1"], restored: ["v2"] },
    });
    const said = later();
    expect(overview(events).triggers.find(({ name }) => name === "SETTLED BY HAND")?.detail).toBe(
      "b-1: 2 rejections labelled, 1 a check defect, 1 task disputed and 1 restored; the comparison's own report read no-step, the settled one reads starter-unread",
    );
    // The comparison's own report still says what its set-aside tasks could move, and nothing of
    // it waits for a person any more.
    expect(
      overview(events).triggers.find(({ name }) => name === "READING MOVES WITH THE SET-ASIDE"),
    ).toBeDefined();
    expect(said("SET ASIDE AND UNSETTLED")).toBeUndefined();
    // A settled comparison stands where it first reported: the first of the chain still.
    expect(said("CHAIN")).toStartWith("b-1 hp>hc starter-unread; g-1 hp>hbase no-step");
  });

  it("says of an empty log only that it has no checker on record", () => {
    expect(overview([]).triggers.map((trigger) => trigger.name)).toEqual([
      "NO CHECKER READING",
      "CHECKER NOT FROZEN",
    ]);
    // A log with no billed role says so, where the line read "billed dollars: " for a moment.
    expect(overview([]).rows.flatMap((row) => row.lines)).toContain("billed dollars: none");
  });
});

describe("the reader on a log written before the plan after the v1 review", () => {
  // Such a log holds four gates a task, the states screening moved a task through, the anchor's
  // draw, a stronger side's solves and reports that name no setting. The reader reads it as
  // history: its tasks are held out, and none of its old kinds starts a lane.
  const log: LogEvent[] = [];
  const put = appendTo(log);
  for (const version of ["t2", "a1"]) {
    put(PROPOSED, { version });
    for (const gate of [1, 2, 3, 4]) put(GATE, { version, gate, outcome: "passed", controls: "d" });
  }
  put("anchor.drawn", { tasks: ["a1"] });
  const strong = { ...condition("t2", "hp"), side: "strong" as const };
  put("condition.recorded", { id: conditionId(strong), condition: requireJsonValue(strong) });
  put(SOLVE_STARTED, { solve: "w1", condition: conditionId(strong), limits: { wallSeconds: 100 } });
  put(SOLVE_FINISHED, { solve: "w1", ending: { outcome: "pass" }, seconds: 50 });
  put(BUILD_STARTED, { session: "b-1", parent: "hp", tasks: [] });
  put("build.finished", { session: "b-1", ended: "finished", harness: "hc", changed: true });
  put("task.state", { version: "t2", state: "admitted", session: "b-1" });
  put("anchor.scored", { session: "b-1", reading: "held", wins: 0, losses: 0, ties: 1 });
  put(REPORTED, {
    session: "b-1",
    level: 0.1,
    versions: ["t2"],
    scored: { wins: 1, losses: 0, ties: 0 },
    flagged: [],
    unflagged: null,
    counted: "no-step",
    fresh: "hc",
    reading: "no-step",
  });
  const old = overview(log);

  it("holds its tasks out and says its stronger side's solves apart", () => {
    const lines = old.rows.flatMap((row) => row.lines);
    expect(lines).toContain("states: held 2");
    expect(lines).toContain("2 tasks held out, for a comparison to score; 0 released for practice");
    expect(lines).toContain("strong side: pass 1");
    expect(old.triggers.find(({ name }) => name === "CHAIN")?.detail).toBe("b-1 hp>hc no-step");
    for (const trigger of old.triggers) expect(trigger.lane).toBe(TRIGGERS[trigger.name]);
  });
});

describe("the reader of a round compared with another harness than its session started from", () => {
  const log: LogEvent[] = [];
  const put = appendTo(log);
  /** One solve of v1 under `harness` for the round's comparison, ended as `ending` says. */
  const made = (id: string, harness: string, ending: JsonObject, seconds: number, cpu?: JsonObject) => {
    const ran = condition("v1", harness);
    put("condition.recorded", { id: conditionId(ran), condition: requireJsonValue(ran) });
    put(SOLVE_STARTED, {
      solve: id,
      condition: conditionId(ran),
      limits: { wallSeconds: 100 },
      comparison: "r-1",
    });
    put("solve.call", { solve: id, turn: 1, tool: "submit", isError: false });
    put(SOLVE_FINISHED, {
      solve: id,
      ending,
      seconds,
      responseModels: ["m-1"],
      ...keyIfDefined("cpu", cpu),
    });
  };
  put(PROPOSED, { version: "v1" });
  put(GATE, { version: "v1", gate: 1, outcome: "passed" });
  // The session goes on from the harness an earlier one left, hx. Its comparison is made against
  // the reference harness, href.
  put(BUILD_STARTED, { session: "r-1", parent: "hx", tasks: [] });
  put("build.finished", { session: "r-1", ended: "finished", harness: "hy", changed: true });
  // Two Examiner sessions: one ended, and one cut, since the comparison began after it.
  put("exam.started", { session: "x-8" });
  put("exam.finished", { session: "x-8", ended: "finished" });
  put("exam.started", { session: "x-9" });
  // Its turns are what x-9 spent: the end record a stop never wrote held nothing (2026-10-10).
  for (const turn of [1, 2]) put("exam.turn", { session: "x-9", turn, usage: { cost: { total: 0.25 } } });
  const terms = { session: "r-1", old: "href", fresh: "hy", starter: "hbase", setting: SETTING };
  put(COMPARISON_STARTED, { ...terms, solves: 1, level: 0.1, tasks: ["v1"] });
  made("q1", "href", { outcome: "non-result", kind: "provider", reason: "cut" }, 50);
  // A command of this solve was cut at its timeout, so one second is the CPU of the others alone.
  made("q2", "href", { outcome: "fail", kind: "wall-ended" }, 100, { seconds: 1, unmeasured: 1 });
  // The new harness's valid answer came in two seconds of a hundred, with one call.
  made("q3", "hy", { outcome: "pass" }, 2, { seconds: 1, unmeasured: 0 });
  put(REPORTED, {
    ...REPORT,
    ...terms,
    solves: 1,
    level: 0.1,
    tasks: 1,
    scored: { ...TESTED, wins: 1, p: 0.5, unsolved: 0 },
    valid: { old: [1, 0], fresh: [0, 1] },
    budgets: [{ prompts: 1, ...TESTED, ties: 1, valid: { old: [1, 0], fresh: [1, 0] } }],
    noise: { wins: 0, losses: 4, ties: 0, p: 1 },
    versions: ["v1"],
    reading: "no-step",
  });
  const seenHere = overview(log);
  const { triggers } = seenHere;
  const said = (name: keyof typeof TRIGGERS) => triggers.find((trigger) => trigger.name === name)?.detail;

  it("reads a quick win against the reference harness, which is what the task was lost under", () => {
    expect(said("WIN AT A SMALL WALL SHARE")).toBe(
      "r-1: 1 passed solves of tasks the reference harness failed, in few calls",
    );
  });

  it("gives each harness by itself at its limits, which the first gate reads", () => {
    // The row at a prompt budget, which a report of 8 October holds, is read no longer.
    expect(said("VALID BY HARNESS")).toBe("r-1: reference 1/0, new 0/1 at its limits");
  });

  it("says each comparison's non-results by the harness they fell under", () => {
    expect(said("NON-RESULTS")).toEndWith("r-1: 1 under the reference harness, 0 under the others");
  });

  it("reads no CPU figure off a solve: a log of 9 October holds one, and no trigger starts from it", () => {
    expect(seen.triggers.some((trigger) => trigger.name.includes("CPU"))).toBe(false);
  });

  it("names an Examiner session that started and never finished", () => {
    expect(said("EXAMINER NEVER FINISHED")).toBe("x-9");
  });

  // Until 11 October lane 27 opened on every live campaign's running Examiner session, and row F's
  // moves left out the move being made, whose `campaign.move` is written when it ends.
  it("names a session open at the log's end in row F, with what it did so far, and says it apart in lane 27", () => {
    const live = [...log];
    const more = appendTo(live);
    more("exam.started", { session: "x-10" });
    more("exam.turn", { session: "x-10", turn: 1, usage: { cost: { total: 0.25 } } });
    more(PROPOSED, { version: "v9", session: "x-10" });
    more(GATE, { version: "v9", gate: 1, outcome: "passed" });
    const read = overview(live);
    // `bun run runs stop` writes no ending, so an open session may be a stopped one, and the lane
    // still opens on it.
    expect(read.triggers.find((trigger) => trigger.name === "EXAMINER NEVER FINISHED")?.detail).toBe(
      "x-9; x-10 open at the log's end",
    );
    expect(read.rows.find((row) => row.id === "F")?.lines).toContain(
      `open at the log's end: x-10, an Examiner session: 1 turn and 1 task held out so far, last at ${live.at(-3)?.at ?? ""}`,
    );
  });

  // buffer-main's g-1 had four solves in flight on 11 October, and lane 27 read them as killed.
  it("reads a solve with no end as open while its comparison is, and as never finished once the campaign ended", () => {
    const live = [...log];
    const more = appendTo(live);
    more(COMPARISON_STARTED, {
      session: "g-9",
      old: "href",
      fresh: "hy",
      solves: 1,
      level: 0.1,
      tasks: ["v1"],
    });
    more(SOLVE_STARTED, { solve: "s-9", condition: "c-9", comparison: "g-9" });
    const lines = (read: readonly LogEvent[]) => overview(read).rows.flatMap((row) => row.lines);
    const never = (read: readonly LogEvent[]) =>
      overview(read).triggers.find((trigger) => trigger.name === "SOLVE NEVER FINISHED")?.detail;
    expect(never(live)).toBe("1 solve open at the log's end");
    expect(lines(live)).toContain("0 solves never finished, 1 open at the log's end");
    expect(lines(live)).toContain("open at the log's end: g-9, a comparison: 0 solves ended and 1 open");
    more("campaign.ended", { ending: "no-room" });
    expect(never(live)).toBe("1 solve");
    expect(lines(live)).toContain("1 solve never finished");
    expect(lines(live).some((line) => line.startsWith("open at the log's end"))).toBe(false);
  });

  it("counts the dollars of that session's turns, which no end record holds", () => {
    expect(seenHere.rows.flatMap((row) => row.lines)).toContain(
      "billed dollars: examiner 0.50, solver 0.00, builder 0.00",
    );
  });

  it("names a reference harness that loses to itself as it names one that wins: a step either way", () => {
    // Its later solves lost all four tasks to its first ones. The report's p is the test's own,
    // for the later sample winning, and reads 1.
    expect(said("REFERENCE AGAINST ITSELF")).toBe(
      "r-1: 0 won, 4 lost and 0 tied between two samples of the reference harness, which reads a step where none can be",
    );
  });
});

describe("the reader of the load a comparison's solves started under", () => {
  /** A log of one comparison a row: its id, the one-minute load each of its solves started under,
   *  and the host's cores where the log holds them. */
  const read = (rows: readonly (readonly [string, readonly number[], number?])[]) => {
    const log: LogEvent[] = [];
    const put = appendTo(log);
    put("task.proposed", { version: "v1" });
    put(GATE, { version: "v1", gate: 1, outcome: "passed" });
    for (const [session, loads, cores] of rows) {
      const terms = { session, old: "hbase", fresh: "hy", starter: "hbase", setting: SETTING };
      put(COMPARISON_STARTED, { ...terms, solves: 1, level: 0.1, tasks: ["v1"] });
      for (const [index, load] of loads.entries()) {
        const ran = condition("v1", index % 2 === 0 ? "hbase" : "hy");
        const id = `${session}-${String(index)}`;
        put("condition.recorded", { id: conditionId(ran), condition: requireJsonValue(ran) });
        put(SOLVE_STARTED, {
          solve: id,
          condition: conditionId(ran),
          limits: { wallSeconds: 100 },
          load: [load, 1, 1],
          comparison: session,
          ...keyIfDefined("cores", cores),
        });
        put(SOLVE_FINISHED, {
          solve: id,
          ending: { outcome: "pass" },
          seconds: 50,
          responseModels: ["m-1"],
        });
      }
      put(REPORTED, { ...REPORT, ...terms, versions: ["v1"], reading: "no-step" });
    }
    const { triggers } = overview(log);
    for (const trigger of triggers) expect(trigger.lane).toBe(TRIGGERS[trigger.name]);
    return (name: keyof typeof TRIGGERS) =>
      triggers.flatMap((trigger) => (trigger.name === name ? [trigger.detail] : []));
  };

  it("names a comparison made over the host's cores, where the log holds them", () => {
    const said = read([
      ["g-1", [30, 34, 50, 28], 12],
      ["g-2", [5, 7, 6, 6], 12],
    ]);
    expect(said("HOST LOADED")).toEqual([
      "g-1: load 32.0 at the median and 50.0 at most when its solves started, on 12 cores",
    ]);
    // A log written before a solve's start held the cores has a load and nothing to hold it to.
    expect(read([["g-1", [30, 34, 50, 28]]])("HOST LOADED")).toEqual([]);
  });

  it("gives each comparison's median load where the busiest ran under twice the calmest or more", () => {
    const said = read([
      ["b-1", [30, 34, 50, 28]],
      ["g-1", [5, 7, 6, 6]],
    ]);
    expect(said("LOAD MOVED")).toEqual([
      "median load when each comparison's solves started, its first half then its second: b-1 32.0 then 39.0; g-1 6.0 then 6.0",
    ]);
  });

  it("names a comparison whose load moved within it, where it is the campaign's only one", () => {
    // esp32's g-1 on 12 October: its solves started at loads from 5.8 to 56.0 on 12 cores.
    expect(read([["g-1", [6, 8, 7, 45, 50, 56]]])("LOAD MOVED")).toEqual([
      "median load when each comparison's solves started, its first half then its second: g-1 7.0 then 50.0",
    ]);
  });

  it("says nothing of two comparisons under one load, of an idle host, or of one comparison", () => {
    const even = read([
      ["b-1", [30, 34], 64],
      ["g-1", [20, 22], 64],
    ]);
    expect([...even("LOAD MOVED"), ...even("HOST LOADED")]).toEqual([]);
    const idle = read([
      ["b-1", [0.4, 0.6]],
      ["g-1", [2, 3]],
    ]);
    expect(idle("LOAD MOVED")).toEqual([]);
    expect(read([["b-1", [30, 34]]])("LOAD MOVED")).toEqual([]);
  });

  it("reads the wall and the load on the solves a comparison measured, not on the non-results it reran", () => {
    // Buffer's g-1 on 12 October: provider attempts of a second or two at a low load, then reruns.
    const log: LogEvent[] = [];
    const put = appendTo(log);
    const terms = { session: "g-1", old: "hbase", fresh: "hy", starter: "hbase", setting: SETTING };
    put(COMPARISON_STARTED, { ...terms, solves: 1, level: 0.1, tasks: ["v1"] });
    const ran = (id: string, harness: string, load: number, ending: JsonObject, seconds: number) => {
      const made = condition("v1", harness);
      put("condition.recorded", { id: conditionId(made), condition: requireJsonValue(made) });
      put(SOLVE_STARTED, {
        solve: id,
        condition: conditionId(made),
        limits: { wallSeconds: 100 },
        load: [load, 1, 1],
        cores: 12,
        comparison: "g-1",
      });
      put(SOLVE_FINISHED, { solve: id, ending, seconds, responseModels: ["m-1"] });
    };
    for (const harness of ["hbase", "hy"]) {
      ran(`${harness}-cut`, harness, 2, { outcome: "non-result", kind: "provider" }, 1);
      ran(`${harness}-cut-again`, harness, 2, { outcome: "non-result", kind: "provider" }, 1);
      ran(`${harness}-rerun`, harness, 30, { outcome: "pass" }, 50);
    }
    put(REPORTED, { ...REPORT, ...terms, versions: ["v1"], reading: "no-step" });
    const { triggers } = overview(log);
    expect(triggers.flatMap((trigger) => (trigger.lane === 26 ? [trigger.detail] : []))).toEqual([
      "g-1: median 50.0% under the reference harness, 50.0% under the new",
      "g-1: load 30.0 at the median and 30.0 at most when its solves started, on 12 cores",
    ]);
  });
});

describe("the reader of a comparison whose solves were told a bound, on a host whose meter reads zero", () => {
  // t-10 on 10 October: every solve told 3 of the model's turns, every finished solve's CPU 0, and
  // one rejection blocked by all four checks.
  const log: LogEvent[] = [];
  const put = appendTo(log);
  const made = (id: string, harness: string, ending: JsonObject) => {
    const ran = condition("v1", harness);
    put("condition.recorded", { id: conditionId(ran), condition: requireJsonValue(ran) });
    put(SOLVE_STARTED, {
      solve: id,
      condition: conditionId(ran),
      limits: { wallSeconds: 100, modelTurns: 3 },
      comparison: "t-1",
    });
    put("solve.call", { solve: id, turn: 1, tool: "submit", isError: false });
    put(SOLVE_FINISHED, {
      solve: id,
      ending,
      seconds: 5,
      responseModels: ["m-1"],
      cpu: { seconds: 0, unmeasured: 0 },
    });
  };
  put("contract.frozen", { contract: "c1", checks: "k1" });
  put("checker.read", { contract: "c1", checks: "k1", faults: [], rows: [] });
  put(PROPOSED, { version: "v1" });
  put(GATE, { version: "v1", gate: 1, outcome: "passed" });
  put(BUILD_STARTED, { session: "t-1", parent: "hp", tasks: [] });
  put("build.finished", { session: "t-1", ended: "finished", harness: "hc", changed: true });
  const terms = { session: "t-1", old: "hp", fresh: "hc", starter: "hp", setting: SETTING };
  put(COMPARISON_STARTED, { ...terms, solves: 1, level: 0.1, tasks: ["v1"] });
  made("u1", "hp", { outcome: "fail", kind: "rejected" });
  put("verdict", { solve: "u1", task: "v1", kind: "fail", blocking: ["check-a", "check-b"] });
  made("u2", "hc", { outcome: "pass" });
  put(REPORTED, {
    ...REPORT,
    ...terms,
    solves: 1,
    level: 0.1,
    tasks: 1,
    scored: { ...TESTED, wins: 1, p: 0.5, unsolved: 0 },
    valid: { old: [1, 0], fresh: [0, 1] },
    budgets: [{ turns: 2, ...TESTED, ties: 1, valid: { old: [1, 0], fresh: [1, 0] } }],
    versions: ["v1"],
    reading: "no-step",
  });
  const { triggers } = overview(log);
  const said = (name: keyof typeof TRIGGERS) => triggers.find((trigger) => trigger.name === name)?.detail;

  it("names the bound the solves were told beside each harness by itself", () => {
    expect(said("VALID BY HARNESS")).toBe("t-1: reference 1/0, new 0/1 at its limits (turns 3)");
  });

  it("reads no check as refusing most answers where every refusing check blocked the same ones", () => {
    expect(said("FAILS ON ONE CHECK")).toBeUndefined();
  });
});

describe("the reader of misses at a limit, by comparison and side", () => {
  /** A log of one comparison, g-1 of hp against hc, whose solves each end as a row says. */
  const read = (endings: readonly (readonly [string, JsonObject, number])[]) => {
    const log: LogEvent[] = [];
    const put = appendTo(log);
    put("task.proposed", { version: "v1" });
    put(GATE, { version: "v1", gate: 1, outcome: "passed" });
    const terms = { session: "g-1", old: "hp", fresh: "hc", starter: "hp", setting: SETTING };
    put(COMPARISON_STARTED, { ...terms, solves: 1, level: 0.1, tasks: ["v1"] });
    for (const [index, [harness, ending, seconds]] of endings.entries()) {
      const ran = condition("v1", harness);
      const id = `m${String(index)}`;
      put("condition.recorded", { id: conditionId(ran), condition: requireJsonValue(ran) });
      put(SOLVE_STARTED, {
        solve: id,
        condition: conditionId(ran),
        limits: { wallSeconds: 100, modelTurns: 8 },
        comparison: "g-1",
      });
      put(SOLVE_FINISHED, { solve: id, ending, seconds, responseModels: ["m-1"] });
    }
    put(REPORTED, { ...REPORT, ...terms, versions: ["v1"], reading: "no-step" });
    return overview(log).triggers.flatMap((trigger) =>
      trigger.name === "MISSES AT A LIMIT" ? [trigger.detail] : [],
    );
  };
  const refused = { outcome: "fail", kind: "rejected" };

  it("counts a miss on its turns, on its context or near its wall as at a limit, by side, with the bound told", () => {
    // recode on 10 October: 41 of 58 scored misses ended on turns, and a read of the wall saw none.
    expect(
      read([
        ["hp", { outcome: "fail", kind: "turns-ended" }, 40],
        ["hp", refused, 97],
        ["hp", refused, 40],
        ["hc", { outcome: "fail", kind: "context-ended" }, 40],
        ["hc", { outcome: "pass" }, 40],
      ]),
    ).toEqual([
      "g-1: 2 of 3 reference misses and 1 of 1 new at a limit (context-ended 1, turns-ended 1, wall share 1; turns 8)",
    ]);
  });

  it("stays quiet on misses a check refused inside the wall, and on a pass that used all of it", () => {
    expect(
      read([
        ["hp", refused, 40],
        ["hc", refused, 94],
        ["hc", { outcome: "pass" }, 99],
      ]),
    ).toEqual([]);
  });
});

describe("the reader of the campaign's clock", () => {
  /** A log whose events stand at the minutes their rows give, from noon on 9 October. */
  const timed = (rows: readonly (readonly [number, EventKind, JsonObject])[]): LogEvent[] =>
    rows.map(([minute, kind, data]) => ({ at: new Date(START + minute * 60_000).toISOString(), kind, data }));
  /** A Builder session with a command of 29.5 minutes, then nothing open for 20, then an Examiner
   *  turn of 28; its practice solves each took `seconds`. */
  const silences = (seconds: number, stretch = 1) => {
    const practice = [1, 2, 3].flatMap((index): [number, EventKind, JsonObject][] => [
      [0, SOLVE_STARTED, { solve: `p${String(index)}`, limits: { wallSeconds: 900 } }],
      [0, SOLVE_FINISHED, { solve: `p${String(index)}`, ending: { outcome: "pass" }, seconds }],
    ]);
    const log = timed([
      [0, BUILD_STARTED, { session: "b-1", parent: "hp", tasks: [] }],
      ...practice,
      [
        30 * stretch,
        "build.call",
        { session: "b-1", tool: "bash", isError: false, ms: 29.5 * stretch * 60_000 },
      ],
      [30 * stretch, "build.turn", { session: "b-1", turn: 2, usage: { output: 400 } }],
      [31 * stretch, "build.finished", { session: "b-1", ended: "finished", harness: "hc" }],
      [51 * stretch, "exam.started", { session: "x-1" }],
      [52 * stretch, "exam.turn", { session: "x-1", turn: 1, usage: { output: 300 } }],
      [80 * stretch, PROPOSED, { version: "v1", session: "x-1" }],
      [80 * stretch, "exam.turn", { session: "x-1", turn: 2, usage: { output: 118_906 } }],
      [81 * stretch, "exam.finished", { session: "x-1", ended: "finished" }],
    ]);
    return overview(log).triggers.flatMap((trigger) =>
      trigger.name === "LONG SILENCES" ? [trigger.detail] : [],
    );
  };

  it("names each long silence by what ran through it, against the campaign's own median solve", () => {
    // Solves of 50 s put the line at the floor of ten minutes, and the silence between moves is read.
    expect(silences(50)).toEqual([
      "3 gaps over 10.0 min, the floor: 30.0 min builder command; 28.0 min examiner turn (118,906 output tokens); 20.0 min between moves",
    ]);
    // Solves of five minutes put it at 25 minutes, past the silence between moves.
    expect(silences(300)).toEqual([
      "2 gaps over 25.0 min, 5 times the median finished solve: 30.0 min builder command; 28.0 min examiner turn (118,906 output tokens)",
    ]);
  });

  it("stays quiet on gaps under the floor, however short the solves", () => {
    expect(silences(1, 0.3)).toEqual([]);
  });

  it("puts the hours by role beside the dollars, a cut session to its stop and a session beside a comparison once", () => {
    const log = timed([
      [0, BUILD_STARTED, { session: "b-1", parent: "hp", tasks: [] }],
      // A stop cut b-1, and the campaign resumed half an hour later.
      [60, "campaign.ended", {}],
      [90, BUILD_STARTED, { session: "b-2", parent: "hp", tasks: [] }],
      [150, "build.finished", { session: "b-2", ended: "finished", harness: "hc" }],
      [150, COMPARISON_STARTED, { session: "g-1", old: "hp", fresh: "hc", tasks: [] }],
      [160, "exam.started", { session: "x-1" }],
      [190, "exam.finished", { session: "x-1", ended: "finished" }],
      [210, REPORTED, { ...REPORT, session: "g-1", old: "hp", fresh: "hc", reading: "no-step" }],
    ]);
    expect(overview(log).rows[0]?.lines).toContain(
      "hours: builder 2.0 (57%), comparisons 1.0 (29%), examiner 0.5 (14%), between moves 0.5 (14%), of 3.5",
    );
  });

  it("counts a comparison a stop cut from its start to the stop, and again from the resume to its report", () => {
    // Buffer's g-1 on 12 October: a provider's limit ended the campaign mid-comparison, and the
    // reopened campaign went on with it under the same id and no second start.
    const log = timed([
      [0, COMPARISON_STARTED, { session: "g-1", old: "hp", fresh: "hc", tasks: [] }],
      [30, "campaign.ended", { ending: "environment" }],
      [90, SOLVE_STARTED, { solve: "s1", comparison: "g-1", limits: { wallSeconds: 900 } }],
      [120, REPORTED, { ...REPORT, session: "g-1", old: "hp", fresh: "hc", reading: "no-step" }],
    ]);
    expect(overview(log).rows[0]?.lines).toContain(
      "hours: comparisons 1.0 (50%), between moves 1.0 (50%), of 2.0",
    );
  });

  it("counts a drafting session's dollars as the Examiner's, as the host's budget does", () => {
    const log = timed([
      [0, "draft.started", { session: "d-1" }],
      [10, "draft.finished", { session: "d-1", ended: "finished", billed: 3 }],
      [20, "exam.started", { session: "x-1" }],
      [30, "exam.finished", { session: "x-1", ended: "finished", billed: 1 }],
      [40, "referee.finding", { solve: "p1", ruling: "earned", billed: 1 }],
    ]);
    const { rows, triggers } = overview(log);
    expect(rows[0]?.lines).toContain("billed dollars: examiner 4.00, referee 1.00");
    expect(triggers.filter((trigger) => trigger.name === "SPEND LED BY A ROLE")).toEqual([
      { lane: 28, name: "SPEND LED BY A ROLE", detail: "examiner: 80.0% of billed dollars" },
    ]);
  });
});

describe("the reader of comparisons the campaign command named apart from its Builder sessions", () => {
  // The shape of the #107 campaigns: a comparison is a session of its own (`g-N`), one session's
  // harness is measured twice, and a later session leaves the same harness unchanged.
  const log: LogEvent[] = [];
  const put = appendTo(log);
  /** One solve of `task` under `harness` for comparison `measuredIn`, in `seconds` of a hundred. */
  const made = (task: string, harness: string, passed: boolean, measuredIn: string, seconds = 2) => {
    const ran = condition(task, harness);
    const id = `${measuredIn}-${task}-${harness}`;
    put("condition.recorded", { id: conditionId(ran), condition: requireJsonValue(ran) });
    put(SOLVE_STARTED, {
      solve: id,
      condition: conditionId(ran),
      limits: { wallSeconds: 100 },
      comparison: measuredIn,
    });
    put("solve.call", { solve: id, turn: 1, tool: "submit", isError: false });
    put(SOLVE_FINISHED, {
      solve: id,
      ending: passed ? { outcome: "pass" } : { outcome: "fail", kind: "rejected" },
      seconds,
      responseModels: ["m-1"],
    });
    put("verdict", {
      solve: id,
      task,
      ...(passed ? { kind: "pass" } : { kind: "fail", blocking: ["check-a"] }),
    });
  };
  /** A comparison of `hc` against `hp` on `tasks`, each row a task and whether each side passed it. */
  const compared = (session: string, rows: readonly (readonly [string, boolean, boolean])[]) => {
    const terms = { session, old: "hp", fresh: "hc", starter: "hbase", setting: SETTING };
    const tasks = rows.map(([task]) => task);
    put(COMPARISON_STARTED, { ...terms, solves: 1, level: 0.1, tasks });
    for (const [task, old, fresh] of rows) {
      made(task, "hp", old, session, 50);
      made(task, "hc", fresh, session);
    }
    put("campaign.move", { move: "compare" });
    put(REPORTED, {
      ...REPORT,
      ...terms,
      solves: 1,
      level: 0.1,
      tasks: rows.length,
      versions: tasks,
      reading: "no-step",
    });
  };
  put("campaign.opened", { budget: { dollars: 50, reserve: 1 } });
  put("campaign.ended", { ending: "exam" });
  put("checker.read", {
    contract: "c1",
    checks: "k1",
    faults: [],
    rows: [
      { id: "check-a", instrument: "computed", passed: 3, refused: 1, caught: 1, named: 1 },
      { id: "check-b", instrument: "computed", passed: 3, refused: 1, caught: 1, named: 1 },
    ],
  });
  for (const version of ["t1", "v1", "v2"]) {
    put(PROPOSED, { version });
    put(GATE, { version, gate: 1, outcome: "passed" });
  }
  put(BUILD_STARTED, { session: "b-1", parent: "hp", tasks: ["t1"] });
  put("build.finished", { session: "b-1", ended: "finished", harness: "hc", changed: true });
  put("campaign.move", { move: "build" });
  // g-1: the reference fails v1 and the new harness passes it. g-2: both pass v1, which no
  // comparison of g-2's lost, and the reference fails v2 where the new harness fails it too.
  compared("g-1", [["v1", false, true]]);
  compared("g-2", [
    ["v1", true, true],
    ["v2", false, false],
  ]);
  put(BUILD_STARTED, { session: "b-2", parent: "hc", tasks: ["t1"] });
  put("build.finished", { session: "b-2", ended: "finished", harness: "hc", changed: false });
  put("campaign.move", { move: "build" });
  put("campaign.ended", { ending: "stop" });
  const { rows, triggers } = overview(log);
  const said = (name: keyof typeof TRIGGERS) => triggers.find((trigger) => trigger.name === name)?.detail;
  const lines = rows.flatMap((row) => row.lines);

  it("gives a session the readings of every comparison of the harness it left, and none to one that left it as it was", () => {
    expect(lines).toContain(
      "b-1: hp > hc, ended finished, 0 practice solves, reading g-1 no-step, g-2 no-step",
    );
    expect(lines).toContain("b-2: hc > hc, ended finished, 0 practice solves, reading none");
  });

  it("reads a quick win only against a task its own comparison lost under the reference", () => {
    expect(said("WIN AT A SMALL WALL SHARE")).toBe(
      "b-1: 1 passed solves of tasks the reference harness failed, in few calls",
    );
  });

  it("names each comparison's won tasks by solve, and says nothing of a comparison that won none", () => {
    expect(triggers.filter((trigger) => trigger.name === "WINS").map((trigger) => trigger.detail)).toEqual([
      "g-1: 1 of 1 tasks won; passed under the new harness: g-1-v1-hc; failed under the reference: g-1-v1-hp",
    ]);
  });

  it("names a check that refused no answer, beside the answers the others refused", () => {
    expect(said("REFUSALS BY CHECK")).toBe(
      "1 of 2 checks refused none of 6 answers: check-b; the rest: check-a 3",
    );
  });

  it("gives the campaign's moves, its endings and its billed dollars against its budget", () => {
    expect(lines).toContain(
      "campaign: moves build 2, compare 2; ended exam at event 1, then stop at event 51; billed 0.00 of 50 dollars",
    );
  });
});

describe("the reader of a harness that answered for its solver", () => {
  /** A log of one Builder session that practised `t1` and left `hy`, then its comparison with `href`
   *  on `v1`. A practice row is one solve's calls in order; a compared row is the harness one ran
   *  under and its calls. */
  const read = (
    practice: readonly (readonly string[])[],
    compared: readonly (readonly [string, readonly string[]])[],
  ) => {
    const log: LogEvent[] = [];
    const put = appendTo(log);
    const made = (task: string, harness: string, calls: readonly string[], measuredIn: string | null) => {
      const ran = condition(task, harness);
      const id = `s${String(log.length)}`;
      put("condition.recorded", { id: conditionId(ran), condition: requireJsonValue(ran) });
      put(SOLVE_STARTED, {
        solve: id,
        condition: conditionId(ran),
        limits: { wallSeconds: 100 },
        ...keyIfNotNull("comparison", measuredIn),
      });
      for (const [turn, tool] of calls.entries()) {
        put("solve.call", { solve: id, turn, tool, isError: false });
      }
      put(SOLVE_FINISHED, { solve: id, ending: { outcome: "pass" }, seconds: 50, responseModels: ["m-1"] });
    };
    for (const version of ["t1", "v1"]) {
      put("task.proposed", { version });
      put(GATE, { version, gate: 1, outcome: "passed" });
    }
    put("build.started", { session: "p-1", parent: "href", tasks: ["t1"] });
    for (const calls of practice) made("t1", "hy", calls, null);
    put("build.finished", { session: "p-1", ended: "finished", harness: "hy", changed: true });
    const terms = { session: "p-1", old: "href", fresh: "hy", starter: "hbase", setting: SETTING };
    put(COMPARISON_STARTED, { ...terms, solves: 1, level: 0.1, tasks: ["v1"] });
    for (const [harness, calls] of compared) made("v1", harness, calls, "p-1");
    put(REPORTED, {
      ...REPORT,
      ...terms,
      solves: 1,
      level: 0.1,
      tasks: 1,
      versions: ["v1"],
      reading: "no-step",
    });
    const { triggers } = overview(log);
    return triggers.find((trigger) => trigger.name === "ANSWER FROM A PROGRAM")?.detail;
  };

  it("reads a practice solve that ran one program and submitted what it made", () => {
    // The shape of recode's practice on the #107 campaigns, 21 solves of 22 and each a pass.
    expect(
      read(
        [
          ["bash", "submit"],
          ["bash", "bash", "submit"],
        ],
        [],
      ),
    ).toBe("one shell call, then submit, in p-1: 1 of 2 practice solves");
  });

  it("puts each comparison's reference side beside its new one, since a solver can match it alone", () => {
    // A read before the one command still counts; a second command does not, and neither does a
    // trace with a write in it, which is the solver carrying the candidate as the rule permits.
    expect(
      read(
        [],
        [
          ["hy", ["read", "bash", "submit"]],
          ["hy", ["bash", "bash", "submit"]],
          ["href", ["bash", "submit"]],
          ["href", ["write", "bash", "submit"]],
        ],
      ),
    ).toBe("one shell call, then submit, in p-1: 1 of 2 under the new harness, 1 of 2 under the reference");
  });

  it("stays quiet on solves that worked through several commands or wrote their answer, and on the reference alone", () => {
    // Under the reference Starter these solvers take many commands and write `answer.json` with the
    // last: 57 of buffer's 68 reference solves ended on a shell call, and not one was a single call.
    expect(read([["bash", "bash", "submit"]], [["hy", ["write", "bash", "submit"]]])).toBeUndefined();
    expect(read([], [["href", ["bash", "submit"]]])).toBeUndefined();
  });
});
