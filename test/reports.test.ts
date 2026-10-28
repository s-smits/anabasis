// What the comparisons on record say of a campaign, over hand-built logs: whether its patience has
// passed without a step, each report read as it was found, the one place each held-out task has
// (`poolOf`), what an Examiner hears of a task, and the billed dollars a cap counts. No solve runs
// here; `round.test.ts` makes the reports.
import { describe, expect, it } from "bun:test";
import { type Condition, conditionId, settingId } from "../src/kernel/condition.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import {
  comparedAs,
  lastReports,
  pairsReported,
  poolOf,
  releaseOrder,
  stopRule as stopOf,
} from "../src/kernel/reports.ts";
import { billedAll, billedFor } from "../src/kernel/trace.ts";
import { taskSets } from "../src/kernel/task.ts";
import { asRecord, type JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { tallied } from "./helpers/tally.ts";
const BUILD_STARTED = "build.started";

const [P, F] = [true, false];
const at = "2026-10-09T00:00:00.000Z";
const event = (kind: EventKind, data: JsonObject): LogEvent => ({ at, kind, data });

const condition = (task: string, harness: string): Condition => ({
  contract: "c1",
  harness,
  task,
  model: "faux/solver",
  effort: "medium",
  prices: { "faux/solver": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  runtime: {},
  compaction: "off",
  solverTools: harness,
  verifierTools: "t1",
  sandbox: "p1",
  limits: {
    wallSeconds: 600,
    turns: 12,
    shellDefaultSeconds: 30,
    shellMaxSeconds: 60,
    concurrency: 1,
  },
  host: "h",
  side: "test",
});
const SETTING = settingId(condition("any", "any"));

let solves = 0;
/** Solves made for `comparison` under the condition `ran`, one an entry: true for a valid answer,
 *  false for a rejected one, and a fail's kind for a solve that ended so. */
function solvedUnder(comparison: string | undefined, ran: Condition, valid: readonly (boolean | string)[]) {
  const id = conditionId(ran);
  return [
    event("condition.recorded", { id, condition: requireJsonValue(ran) }),
    ...valid.flatMap((each) => {
      solves += 1;
      const solve = `s-${String(solves)}`;
      return [
        event("solve.started", { solve, condition: id, ...keyIfDefined("comparison", comparison) }),
        event("solve.finished", {
          solve,
          ending:
            each === true
              ? { outcome: "pass" }
              : { outcome: "fail", kind: each === false ? "rejected" : each },
          billed: 2,
        }),
        ...(each === false ? [event("referee.finding", { solve, ruling: "earned" })] : []),
      ];
    }),
  ];
}
const solved = (
  comparison: string | undefined,
  task: string,
  harness: string,
  valid: readonly (boolean | string)[],
) => solvedUnder(comparison, condition(task, harness), valid);
const heldOut = (version: string) => [
  event("task.proposed", { version, taskId: version }),
  event("task.gate", { version, gate: 1, outcome: "passed" }),
];
/** A report as a checkpoint writes one, as far as these folds read it. */
const reported = (session: string, reading: string, fresh: string | null, more: JsonObject = {}) =>
  event("comparison.reported", {
    session,
    reading,
    fresh,
    starter: "h1",
    scored: { wins: 0, losses: 0, ties: 1 },
    versions: ["v1"],
    ...more,
  });
const promotion = event("harness.promoted", { harness: "h2", from: "h1", rests: ["b-1"] });
/** Each solve of `sides`, in order, passed by a check that measured it so. */
const measuredAt = (sides: readonly LogEvent[], measures: readonly number[]) => {
  const started = sides.filter(({ kind }) => kind === "solve.started");
  return started.map(({ data }, index) =>
    event("verdict", { solve: data.solve ?? "", kind: "pass", answer: {}, objective: measures[index] ?? 0 }),
  );
};
/** Task versions in one order, whatever order a reader gave them in. */
const sorted = (versions: Iterable<string>) => [...versions].toSorted();
const pairsIn = (log: readonly LogEvent[]) => lastReports(log).map((report) => pairsReported(log, report));
/** Who won each task in its last comparison with the reference, and on which measure. */
const winners = (log: readonly LogEvent[]) =>
  new Map(
    [...poolOf(log).standings].map(([task, { won, by }]) => [
      task,
      won === null ? null : `${won} on ${String(by)}`,
    ]),
  );
/** Which of `tasks` the reference's last reading failed or left objective room on, before halving. */
const failedOf = (log: readonly LogEvent[], tasks: readonly string[]) => {
  const { outcomes, standings } = poolOf(log);
  return tasks.filter((task) => {
    const outcome = outcomes.get(task);
    return (
      outcome === "reference-none" ||
      outcome === "reference-some" ||
      (outcome === "reference-every" && (standings.get(task)?.room ?? 0) > 0)
    );
  });
};

describe("the reference harness of a campaign", () => {
  it("shows what a promotion rests on: each comparison that measured the harness, as it last read", () => {
    const log = [
      reported("b-1", "no-step", "h2", { old: "base" }),
      reported("g-1", "step", "h2", { old: "base" }),
      reported("b-2", "step", "h3", { old: "h2" }),
      // A settling writes a comparison's report once more, and the last one is its reading.
      reported("b-1", "step", "h2", { old: "base", settled: {} }),
    ];
    expect(comparedAs(log, "h2")).toEqual([
      { comparison: "b-1", against: "base", reading: "step" },
      { comparison: "g-1", against: "base", reading: "step" },
    ]);
    expect(comparedAs(log, "h9")).toEqual([]);
  });
});

describe("the stop rule", () => {
  /** A campaign whose patience is the plan's three; the default is six (`PATIENCE`). */
  const three = event("campaign.opened", { budget: null, limit: null, sessions: 1, patience: 3 });
  const stopRule = (log: readonly LogEvent[]) => stopOf([three, ...log]);
  const counted = (checkpoints: number, sinceStep: number) => ({
    checkpoints,
    sinceStep,
    stop: sinceStep >= 3,
  });
  /** A Builder session that left `harness`, changed unless `more` says otherwise. */
  const session = (id: string, harness: string, more: JsonObject = {}) =>
    event("build.finished", { session: id, harness, changed: true, ended: "finished", ...more });
  /** The harnesses Builder sessions left, which is what makes a comparison of one a checkpoint. */
  const sessions = ["h2", "h3", "h4", "h5", "h6", "h7"].map((harness) => session(`s-${harness}`, harness));
  const flat = (id: string, fresh: string, more: JsonObject = {}) => reported(id, "no-step", fresh, more);
  const two = [...sessions, flat("b-1", "h2"), flat("b-2", "h3")];
  it("stops after as many harnesses in a row that showed no gain as the patience, counted from the last step", () => {
    expect(stopRule([])).toEqual(counted(0, 0));
    expect(stopRule(two)).toEqual(counted(2, 2));
    expect(stopRule([...two, flat("b-3", "h4")])).toEqual(counted(3, 3));
    // A step starts the count again, and a result short of one for another reason counts.
    const after = [...two, reported("b-3", "step", "h4"), flat("b-4", "h5")];
    expect(stopRule(after)).toEqual(counted(4, 1));
    const lower = (id: string, fresh: string) => reported(id, "below-starter", fresh);
    expect(stopRule([...after, lower("b-5", "h6"), lower("b-6", "h7")])).toEqual(counted(6, 3));
    // A reading short of the level shows no gain: until 19 October a 2-0 at 0.10 bought a repeat
    // at the trigger and counted as one. An opening of then that holds a trigger is read past.
    const near = flat("b-3", "h4", tallied(2, 0, 10));
    expect(stopRule([...two, near])).toEqual(counted(3, 3));
    const old = event("campaign.opened", { ...three.data, terms: { trigger: "0.25", level: "0.1" } });
    expect(stopOf([old, ...two, near])).toEqual(counted(3, 3));
    expect(stopOf([old, ...two, reported("b-3", "step", "h4")])).toEqual(counted(3, 0));
  });

  // Fix row F48. On 9 October one harness was compared with the starter three times, each time on
  // more tasks, and the rule stopped the campaign: three repeats of one harness are one harness
  // that showed no gain.
  it("counts each pair of a harness and a reference once, where it first reported and as it last read", () => {
    const thrice = [...sessions, flat("g-1", "h2"), flat("g-2", "h2"), flat("g-3", "h2")];
    expect(stopRule(thrice)).toEqual(counted(1, 1));
    // Against another reference it is another pair, and the starter is a reference like any:
    // compared with another and then with the starter, a harness is two pairs.
    expect(stopRule([...thrice, flat("g-4", "h2", { old: "h3" })])).toEqual(counted(2, 2));
    const versus = (id: string, old: string) => reported(id, "no-step", "h2", { old, starter: "base" });
    expect(stopRule([...sessions, versus("b-1", "base")])).toEqual(counted(1, 1));
    expect(stopRule([...sessions, versus("b-1", "h1"), versus("g-1", "base")])).toEqual(counted(2, 2));
    // A pair showed a gain where any comparison of it read a step, which promotes it: a reading
    // of it after the step takes nothing from that. Until 19 October the pair read as its last.
    expect(stopRule([...sessions, reported("b-1", "step", "h2"), flat("g-1", "h2")])).toEqual(counted(1, 0));
    expect(stopRule([...two, reported("g-1", "step", "h3")])).toEqual(counted(2, 0));
    // Every comparison on record is read, whatever setting id it carries: the id names the host's
    // code too, so until 2026-10-11 a tree moved to a new commit began the count again
    // (`7f0add79:docs/simplify.md`, A4). A harness compared again under another id is one harness still.
    const earlier = [...sessions, flat("b-1", "h2", { setting: "s1" }), flat("b-2", "h3", { setting: "s1" })];
    expect(stopRule([...earlier, flat("b-3", "h4", { setting: "s2" })])).toEqual(counted(3, 3));
    expect(stopRule([...earlier, flat("b-3", "h3", { setting: "s2" })])).toEqual(counted(2, 2));
  });

  // Until 19 October two readings of a pair that promoted together were a step, though neither
  // read one alone (found by review, 14 October). One reading promotes since, and two readings
  // short of the level are no gain however they sum.
  it("reads a pair as a step where one of its comparisons read one, and counts each epoch apart", () => {
    const one = event("campaign.opened", { ...three.data, patience: 1 });
    const stage = (id: string, wins: number, losses: number) =>
      flat(id, "h2", { ...tallied(wins, losses, 0), level: 0.1 });
    const pair = [...sessions, stage("g-1", 3, 0), stage("g-2", 3, 1)];
    expect(stopOf([one, ...pair])).toEqual({ checkpoints: 1, sinceStep: 1, stop: true });
    const stepped = [...sessions, stage("g-1", 3, 0), reported("g-2", "step", "h2", tallied(4, 0, 0))];
    expect(stopOf([one, ...stepped])).toEqual({ checkpoints: 1, sinceStep: 0, stop: false });
    // A promotion starts an epoch: what showed no gain before it does not count after it.
    const toH2 = event("harness.promoted", { harness: "h2", from: "base", rests: [] });
    expect(stopRule([...two, toH2])).toEqual(counted(2, 0));
    expect(stopRule([...two, toH2, flat("b-3", "h4")])).toEqual(counted(3, 1));
  });

  it("counts no comparison that left the reference no room, and a step wherever it was read", () => {
    // A report lists its tasks by how many of their two solves were valid: none, one, both, and how
    // many were informative for each harness, valid on some solves and not all (`informative`).
    const valid = (old: number[], fresh: number[]) => ({
      valid: { old, fresh, informative: { old: old[1] ?? 0, fresh: fresh[1] ?? 0 } },
    });
    const full = valid([0, 0, 4], [0, 0, 4]);
    // Failed in every solve: since 12 October no room either, though the new harness answered one.
    const hard = valid([4, 0, 0], [3, 1, 0]);
    expect(stopRule([...sessions, flat("b-1", "h2", full), flat("b-2", "h3", hard)])).toEqual(counted(0, 0));
    // A task the reference answered on one solve of two is room, however few.
    const most = valid([0, 2, 2], [0, 0, 4]);
    const some = valid([3, 1, 0], [2, 2, 0]);
    expect(stopRule([...sessions, flat("b-1", "h2", most), flat("b-2", "h3", some)])).toEqual(counted(2, 2));
    expect(stopRule([...sessions, reported("b-1", "step", "h2", hard)])).toEqual(counted(1, 0));
  });

  it("counts no report that compared nothing, and no comparison of harnesses no Builder session changed", () => {
    const nothing = (id: string) => reported(id, "no-change", null, { scored: null });
    const stopped = (id: string) => reported(id, "check-defects", "h2", { scored: null });
    const capped = (id: string) => reported(id, "not-scored", "h2", { scored: null, capped: true });
    // Every task set aside until a person has labelled its rejections: a tally of no task.
    const waiting = reported("b-5", "not-scored", "h2", { versions: [], aside: ["v1"] });
    const log = [...sessions, nothing("b-1"), nothing("b-2"), stopped("b-3"), capped("b-4"), waiting];
    expect(stopRule(log)).toEqual(counted(0, 0));
    // Two comparisons of harnesses the campaign began with, and then one round that read no step.
    const gates = [reported("g0", "no-step", "start"), reported("g2", "no-step", "start")];
    expect(stopRule(gates)).toEqual(counted(0, 0));
    expect(stopRule([...gates, ...sessions, flat("b-1", "h2")])).toEqual(counted(1, 1));
  });
});

describe("a report read as it was found", () => {
  const terms = { old: "h1", fresh: "h2", solves: 2, setting: SETTING };
  const log = [
    ...heldOut("v1"),
    ...heldOut("v2"),
    ...solved("b-1", "v1", "h1", [F, F]),
    ...solved("b-1", "v1", "h2", [P, P]),
    ...solved("b-1", "v2", "h1", [F, P]),
    ...solved("b-1", "v2", "h2", [F, P]),
    reported("b-1", "no-step", "h2", { ...terms, versions: ["v1", "v2"] }),
  ];
  const found = [
    { task: "v1", old: [F, F], fresh: [P, P] },
    { task: "v2", old: [F, P], fresh: [F, P] },
  ];

  it("stays what it was after further solves, a release, a refusal and a person's settling", () => {
    // A later comparison solved v1 again under the same harness; v2 is released and v1 refused
    // after the comparison reported, and then a person settles it.
    const settled = [
      ...log,
      ...solved("b-2", "v1", "h2", [F]),
      event("task.state", { version: "v2", state: "released" }),
      event("task.state", { version: "v1", state: "refused" }),
      reported("b-1", "no-step", "h2", { ...terms, versions: ["v1", "v2"], settled: { labelled: 1 } }),
    ];
    expect(lastReports(settled)[0]?.data.settled).toEqual({ labelled: 1 });
    expect(pairsIn(settled)).toMatchObject([found]);
    // Every fold reads the comparison as its first report found it.
    const pool = poolOf(settled);
    expect(pool.awaiting).toEqual([]);
    expect(pool.outcomes).toEqual(
      new Map([
        ["v1", "reference-none"],
        ["v2", "reference-some"],
      ]),
    );
  });
});

describe("the outcome an Examiner hears of a task", () => {
  const terms = { old: "h1", fresh: "h2", solves: 2, setting: SETTING };

  it("reads the reference on the side it stood: old, fresh in the comparison its promotion rests on, and neither between two other harnesses", () => {
    // Until 11 October the old side was read always: h2, promoted on b-1 where it answered every
    // solve, was heard as the harness it replaced, valid in none, and a release took the tasks h1
    // failed as tasks the reference failed.
    const before = [
      ...heldOut("kept"),
      ...solved("b-1", "kept", "h1", [F, F]),
      ...solved("b-1", "kept", "h2", [P, P]),
      reported("b-1", "step", "h2", { ...terms, versions: ["kept"] }),
    ];
    const after = [...before, promotion];
    // A comparison of two harnesses neither of which is the reference says nothing of the
    // reference's own: the author hears that, and the counts hold nothing of it.
    const beside = [
      ...after,
      ...solved("g-2", "kept", "h3", [P, F]),
      ...solved("g-2", "kept", "h4", [F, F]),
      reported("g-2", "no-step", "h4", { ...terms, old: "h3", fresh: "h4", versions: ["kept"] }),
    ];
    // A control that reported first does not become the reference: the recorded starter is.
    const controlFirst = [
      ...heldOut("kept"),
      ...solved("control", "kept", "h3", [P, P]),
      ...solved("control", "kept", "h4", [P, P]),
      reported("control", "no-step", "h4", { ...terms, old: "h3", fresh: "h4", versions: ["kept"] }),
      ...before.slice(2),
    ];
    const read = (log_: readonly LogEvent[]) => ({
      outcome: poolOf(log_).outcomes.get("kept"),
      standing: poolOf(log_).standings.get("kept") ?? null,
      failed: failedOf(log_, ["kept"]),
    });
    const won = { won: "other", by: "validity", room: null } as const;
    expect(read(before)).toEqual({ outcome: "reference-none", standing: won, failed: ["kept"] });
    expect(read(after)).toEqual({
      outcome: "reference-every",
      standing: { won: "reference", by: "validity", room: null },
      failed: [],
    });
    expect(read(beside)).toEqual({ outcome: "earlier-reference", standing: null, failed: [] });
    expect(read(controlFirst)).toEqual({ outcome: "reference-none", standing: won, failed: ["kept"] });
    // And the task the promoted harness itself failed is the reference's failure from then on.
    const lost = [
      ...heldOut("a1"),
      ...solved("b-1", "a1", "h1", [P, P]),
      ...solved("b-1", "a1", "h2", [F, F]),
      reported("b-1", "step", "h2", { ...terms, versions: ["a1"] }),
    ];
    expect(failedOf(lost, ["a1"])).toEqual([]);
    expect(failedOf([...lost, promotion], ["a1"])).toEqual(["a1"]);
  });
});

describe("who won each task, as an Examiner hears it", () => {
  const terms = { old: "h1", fresh: "h2", solves: 2, setting: SETTING };

  it("names the side that won a task told apart and the measure that carried it, and none for a tie or a task set aside", () => {
    const tasks = ["every", "none", "other", "ours", "mixed", "aside"];
    const log = [
      ...tasks.flatMap(heldOut),
      ...solved("b-1", "every", "h1", [P, P]),
      ...solved("b-1", "every", "h2", [P, P]),
      ...solved("b-1", "none", "h1", [F, F]),
      ...solved("b-1", "none", "h2", [F, F]),
      ...solved("b-1", "other", "h1", [F, F]),
      ...solved("b-1", "other", "h2", [P, F]),
      ...solved("b-1", "ours", "h1", [P, P]),
      ...solved("b-1", "ours", "h2", [F, P]),
      ...solved("b-1", "mixed", "h1", [P, F]),
      ...solved("b-1", "mixed", "h2", [F, P]),
      reported("b-1", "no-step", "h2", { ...terms, versions: tasks.slice(0, 5), aside: ["aside"] }),
    ];
    // The reference's side is the old one; a task set aside there has an outcome and no winner.
    expect(winners(log)).toEqual(
      new Map([
        ["every", null],
        ["none", null],
        ["other", "other on validity"],
        ["ours", "reference on validity"],
        ["mixed", null],
      ]),
    );
    // Read from the record the outcome is read from: the same tasks but the one set aside.
    const { standings, outcomes } = poolOf(log);
    expect(sorted(standings.keys())).toEqual(sorted(outcomes.keys()).filter((task) => task !== "aside"));
    expect(standings.get("every")).toEqual({ won: null, by: null, room: null });
  });

  it("names the objective where it told two valid answers apart, and the same answers without one a tie", () => {
    const measured = (objective: JsonObject | null) => {
      const sides = [
        ...solved("b-1", "split", "h1", [P, P]),
        ...solved("b-1", "split", "h2", [P, P]),
        ...solved("b-1", "even", "h1", [P, P]),
        ...solved("b-1", "even", "h2", [P, P]),
      ];
      return [
        ...["split", "even"].flatMap(heldOut),
        ...sides,
        // Lower is better: on `split` the new harness's answers measure half the reference's.
        ...measuredAt(sides, [10, 10, 5, 5, 10, 10, 10, 10]),
        reported("b-1", "no-step", "h2", {
          ...terms,
          versions: ["split", "even"],
          ...keyIfDefined("objective", objective ?? undefined),
        }),
      ];
    };
    expect(winners(measured({ direction: "lower", margin: 0.01 }))).toEqual(
      new Map([
        ["split", "other on objective"],
        ["even", null],
      ]),
    );
    expect(winners(measured(null))).toEqual(
      new Map([
        ["split", null],
        ["even", null],
      ]),
    );
  });
});

describe("the tasks that go to a person as possibly infeasible", () => {
  const terms = { old: "h1", solves: 2, setting: SETTING };
  /** One more comparison of the two tasks: `hard` answered validly, rejected or ended as named,
   *  `easy` always answered. */
  const compared = (log: readonly LogEvent[], session: string, fresh: string, hard: boolean | string) => [
    ...log,
    ...solved(session, "hard", "h1", [F, F]),
    ...solved(session, "hard", fresh, [hard, F]),
    ...solved(session, "easy", "h1", [P, P]),
    ...solved(session, "easy", fresh, [P, P]),
    reported(session, "no-step", fresh, { ...terms, fresh, versions: ["hard", "easy"] }),
  ];
  const awaiting = (log: readonly LogEvent[]) => poolOf(log).awaiting;
  /** The tasks a release gives the Builder first because the reference harness answered them in
   *  no solve of two comparisons. */
  const unanswered = (log: readonly LogEvent[]) =>
    releaseOrder(log, ["hard", "easy"], 2, "seed").flatMap(([task, why]) =>
      why.includes("answered it in no solve of two comparisons") ? [task] : [],
    );
  const start = [...heldOut("hard"), ...heldOut("easy")];
  const once = compared(start, "b-1", "h2", F);
  const twice = compared(once, "b-2", "h3", F);

  it("are never the ones a valid answer is on record for, by a solve anywhere or the author's own proof, which moves no pair", () => {
    // A valid answer in the second comparison shows the task feasible, for every comparison after.
    const valid = compared(once, "b-2", "h3", P);
    expect(awaiting(valid)).toEqual([]);
    expect(awaiting(compared(compared(valid, "b-3", "h4", F), "b-4", "h5", F))).toEqual([]);
    // And so does one made before, as at a longer limit, or after the two that gave none.
    const before = compared(compared(compared(start, "b-0", "h0", P), "b-1", "h2", F), "b-2", "h3", F);
    expect(awaiting(before)).toEqual([]);
    expect(awaiting(compared(twice, "b-3", "h4", P))).toEqual([]);
    // One no reported comparison counts, as a solve made for a comparison that never reported, or
    // the starter's beside a comparison whose two harnesses answered nothing.
    expect(awaiting([...twice, ...solved("g-9", "hard", "h9", [P])])).toEqual([]);
    expect(
      awaiting([...twice.slice(0, -1), ...solved("b-2", "hard", "base", [P, F]), ...twice.slice(-1)]),
    ).toEqual([]);
    // The Examiner's `try_answer` passed an answer the host saw pass again under the task's own id
    // (11 October), at its gate or later: a valid answer is on record though no solve found one.
    const proof = event("task.feasible", { version: "hard", session: "x-1" });
    const atGate = twice.flatMap((each) =>
      each.kind === "task.gate" && each.data.version === "hard" ? [each, proof] : [each],
    );
    expect(awaiting(atGate)).toEqual([]);
    expect(awaiting(compared(atGate, "b-3", "h4", F))).toEqual([]);
    const proved = [...twice, proof];
    expect(awaiting(proved)).toEqual([]);
    expect(pairsIn(proved)).toEqual(pairsIn(twice));
    // It is the one fact an author hears beside an outcome that names no valid solve, whoever
    // gave the answer on record.
    expect(poolOf(twice).feasible).toEqual(new Set(["easy"]));
    expect(poolOf(proved).feasible).toEqual(new Set(["hard", "easy"]));
    expect(poolOf([...twice, ...solved(undefined, "hard", "h9", [P])]).feasible).toEqual(
      new Set(["hard", "easy"]),
    );
  });

  it("count a comparison whose solves used every model turn the condition names, and no wall it cut", () => {
    // Under `--solve-model-turns` the turns are the budget, told on every tool result: a solve that
    // used them all without an answer is the budget's verdict, and until 19 October such a task
    // stayed in the draw for good (sim-turns, sim-turns2: 706 of 1,144 solves).
    const told = (task: string, harness: string): Condition => {
      const plain = condition(task, harness);
      return { ...plain, limits: { ...plain.limits, modelTurns: 16 } };
    };
    const setting = settingId(told("any", "any"));
    const bounded = (log: readonly LogEvent[], session: string, fresh: string, hard: boolean | string) => [
      ...log,
      ...solvedUnder(session, told("hard", "h1"), [hard, hard]),
      ...solvedUnder(session, told("hard", fresh), [hard, F]),
      ...solvedUnder(session, told("easy", "h1"), [P, P]),
      ...solvedUnder(session, told("easy", fresh), [P, P]),
      reported(session, "no-step", fresh, { ...terms, setting, fresh, versions: ["hard", "easy"] }),
    ];
    const spent = bounded(bounded(start, "b-1", "h2", "turns-ended"), "b-2", "h3", "turns-ended");
    expect(awaiting(spent)).toEqual(["hard"]);
    expect(poolOf(spent).scorable).toEqual(["easy"]);
    // The nearest hostile cases: the same task under the same bound, its solves ended by the wall
    // or a full context, stays; and a valid answer on record keeps it, whatever ended the solves.
    for (const kind of ["wall-ended", "context-ended"]) {
      const cut = bounded(bounded(start, "b-1", "h2", kind), "b-2", "h3", kind);
      expect(awaiting(cut)).toEqual([]);
      expect(poolOf(cut).scorable).toEqual(["hard", "easy"]);
    }
    expect(awaiting([...spent, event("task.feasible", { version: "hard", session: "x-1" })])).toEqual([]);
    expect(awaiting([...spent, ...solved(undefined, "hard", "h9", [P])])).toEqual([]);
    // The reference's history reads each comparison as none valid, and names no solve cut.
    expect(poolOf(spent).histories.get("hard")?.reads).toEqual([
      { valid: "none", cut: false },
      { valid: "none", cut: false },
    ]);
    // A log written before 19 October: `judge` read spent turns first, so a solve whose last allowed
    // reply was cut at its length, or whose context overflowed then, ended `turns-ended`. Its last
    // `solve.turn` says so, and it stays a cut, as it read when it was written. So does a log of
    // before 14 October, when a provider failure on the last allowed turn ended `turns-ended` too.
    const lastTurned = (log: readonly LogEvent[], turn: JsonObject) =>
      log.flatMap((each) =>
        each.kind === "solve.finished" && asRecord(each.data.ending)?.kind === "turns-ended"
          ? [event("solve.turn", { solve: each.data.solve ?? "", turn: 16, ...turn }), each]
          : [each],
      );
    for (const turn of [
      { stopReason: "length", error: null },
      { stopReason: "error", error: "prompt is too long: 213462 tokens > 200000 maximum" },
      { stopReason: "error", error: "API Error: 529 overloaded" },
    ]) {
      const old = lastTurned(spent, turn);
      expect(awaiting(old)).toEqual([]);
      expect(poolOf(old).scorable).toEqual(["hard", "easy"]);
      expect(
        poolOf(old)
          .histories.get("hard")
          ?.reads.map(({ cut }) => cut),
      ).toEqual([true, true]);
    }
    // A last turn that ended as any other did is the budget's, recorded or not.
    expect(awaiting(lastTurned(spent, { stopReason: "toolUse", error: null }))).toEqual(["hard"]);
  });

  it("go to the Builder first at a release, cut at a limit or not, while they are held out and the reference answered them in no solve", () => {
    // t-5 (10 October): two tasks no solve answered in two comparisons, every solve of them cut
    // at 2 told turns, so no person was asked either; the draw released another task.
    expect(unanswered(once)).toEqual([]);
    expect(unanswered(twice)).toEqual(["hard"]);
    const cut = compared(compared(start, "b-1", "h2", "turns-ended"), "b-2", "h3", "turns-ended");
    expect(unanswered(cut)).toEqual(["hard"]);
    expect(awaiting(cut)).toEqual([]);
    // Only the reference harness's own valid answer settles it: one of the new harness's leaves
    // it first, so which held-out task the new harness won moves no release (rule 3).
    expect(unanswered(compared(twice, "b-3", "h4", P))).toEqual(["hard"]);
    expect(
      unanswered([
        ...twice,
        ...solved("b-3", "hard", "h1", [P, F]),
        ...solved("b-3", "hard", "h4", [F, F]),
        ...solved("b-3", "easy", "h1", [P, P]),
        ...solved("b-3", "easy", "h4", [P, P]),
        reported("b-3", "no-step", "h4", { ...terms, fresh: "h4", versions: ["hard", "easy"] }),
      ]),
    ).toEqual([]);
  });
});

describe("the release before the draw", () => {
  // Four held-out tasks the reference harness failed in the last comparison, and two it answered.
  const terms = { old: "h1", fresh: "h2", solves: 2, setting: SETTING };
  const tasks = ["f1", "f2", "f3", "f4", "a1", "a2"];
  const log = [
    ...tasks.flatMap(heldOut),
    ...tasks.flatMap((task) => [
      ...solved("b-1", task, "h1", task.startsWith("f") ? [F, F] : [P, P]),
      ...solved("b-1", task, "h2", [P, P]),
    ]),
    reported("b-1", "no-step", "h2", { ...terms, versions: tasks }),
  ];
  const taken = (events: readonly LogEvent[], count: number) =>
    releaseOrder(events, tasks, count, "seed").map(([version]) => version);

  it("takes half of the tasks the reference failed, and the draw cannot release the other half", () => {
    expect(failedOf(log, tasks)).toEqual(["f1", "f2", "f3", "f4"]);
    // Half of the failed, in the order they failed, then the draw over every task neither list
    // holds: the kept half stays scored, and `a1` and `a2`, which the reference answered in every
    // solve, are drawn like `n1`. From 16 to 20 October the draw left them out.
    const fresh = [...log, ...heldOut("n1")];
    const order = releaseOrder(fresh, [...tasks, "n1"], 4, "seed");
    expect(order.map(([version]) => version)).toEqual(["f1", "f2", "a1", "a2"]);
    // The failed tasks are said to be released for their failure, and the drawn ones for nothing.
    expect(order.map(([, why]) => why.includes("failed"))).toEqual([true, true, false, false]);
    // Asked for more than the draw's pool holds, the release takes what there is and no kept task.
    expect(taken(log, 6).toSorted()).toEqual(["a1", "a2", "f1", "f2"]);
    // Half is rounded up, so one failed task alone is released, and a task the reference answered
    // in some solves is failed as one it answered in none: until 16 October neither went, and
    // between buffer-159-opus's two promotions its Builder's practice passed 10 of 10.
    const once = [
      ...["s1", "a1"].flatMap(heldOut),
      ...solved("b-1", "s1", "h1", [P, F]),
      ...solved("b-1", "s1", "h2", [P, P]),
      ...solved("b-1", "a1", "h1", [P, P]),
      ...solved("b-1", "a1", "h2", [P, P]),
      reported("b-1", "no-step", "h2", { ...terms, versions: ["s1", "a1"] }),
    ];
    expect(releaseOrder(once, ["s1", "a1"], 1, "seed").map(([version]) => version)).toEqual(["s1"]);
  });

  it("releases the same tasks whichever held-out task the new harness bettered by the objective", () => {
    // Two logs with equal tallies, one task won and one tied, which differ only in which task the
    // new harness's answers measured half the reference's. The release reads the reference's own
    // solves alone, so the Builder reads one practice set either way (AGENTS.md rule 3). Drawing
    // from `poolOf`'s frontier released `a1` from one and `a2` from the other.
    const won = (better: string) => {
      const sides = ["a1", "a2"].flatMap((task) => [
        ...solved("b-1", task, "h1", [P, P]),
        ...solved("b-1", task, "h2", [P, P]),
      ]);
      const measures = better === "a1" ? [10, 10, 5, 5, 10, 10, 10, 10] : [10, 10, 10, 10, 10, 10, 5, 5];
      return [
        ...["a1", "a2"].flatMap(heldOut),
        ...sides,
        ...measuredAt(sides, measures),
        reported("b-1", "no-step", "h2", {
          ...terms,
          versions: ["a1", "a2"],
          objective: { direction: "lower", margin: 0.01 },
        }),
      ];
    };
    expect(poolOf(won("a1")).frontier).toEqual(["a1"]);
    expect(poolOf(won("a2")).frontier).toEqual(["a2"]);
    expect(releaseOrder(won("a1"), ["a1", "a2"], 1, "seed")).toEqual(
      releaseOrder(won("a2"), ["a1", "a2"], 1, "seed"),
    );
  });

  it("releases the same tasks whichever held-out task the new harness won where the reference answered neither", () => {
    // Two campaigns with equal tallies over two comparisons, which differ only in which of two
    // tasks the reference never answers the new harness won. Until 26 October a valid answer of
    // any harness took a task off the first list, so the other task was released from each, and
    // the Builder could read which one its harness had won (AGENTS.md rule 3).
    const won = (task: string) => [
      ...["u1", "u2"].flatMap(heldOut),
      ...["b-1", "b-2"].flatMap((session) => [
        ...["u1", "u2"].flatMap((each) => [
          ...solved(session, each, "h1", [F, F]),
          ...solved(session, each, "h2", each === task ? [P, P] : [F, F]),
        ]),
        reported(session, "no-step", "h2", { ...terms, versions: ["u1", "u2"] }),
      ]),
    ];
    expect(releaseOrder(won("u1"), ["u1", "u2"], 1, "seed")).toEqual(
      releaseOrder(won("u2"), ["u1", "u2"], 1, "seed"),
    );
  });

  it("puts first a task the reference answered in every solve where its own better answer leaves it room", () => {
    // The reference's two answers to one task measure 10 and 5, lower being better: it answered in
    // every solve and still has room, which the draw alone left to chance until 21 October.
    const roomIn = (task: string) => {
      const sides = ["a1", "a2"].flatMap((each) => [
        ...solved("b-1", each, "h1", [P, P]),
        ...solved("b-1", each, "h2", [P, P]),
      ]);
      const measures = task === "a1" ? [10, 5, 10, 10, 10, 10, 10, 10] : [10, 10, 10, 10, 10, 5, 10, 10];
      return [
        ...["a1", "a2"].flatMap(heldOut),
        ...sides,
        ...measuredAt(sides, measures),
        reported("b-1", "no-step", "h2", {
          ...terms,
          versions: ["a1", "a2"],
          objective: { direction: "lower", margin: 0.01 },
        }),
      ];
    };
    for (const task of ["a1", "a2"]) {
      expect(releaseOrder(roomIn(task), ["a1", "a2"], 1, "seed").map(([version]) => version)).toEqual([task]);
    }
  });

  it("takes no practice priority from a rejection set aside until its comparison is settled", () => {
    // The reference answers `f1` once here, so it is no task it never answered (`unanswered`).
    const pending = [
      ...log,
      ...solved("b-2", "f1", "h1", [P, F]),
      ...solved("b-2", "f1", "h2", [P, P]),
      ...solved("b-2", "a1", "h1", [P, P]),
      ...solved("b-2", "a1", "h2", [P, P]),
      reported("b-2", "no-step", "h2", { ...terms, versions: ["a1"], aside: ["f1"] }),
    ];
    expect(failedOf(pending, tasks)).toEqual(["f2", "f3", "f4"]);
    expect(poolOf(pending).outcomes.get("f1")).toBe("disputed");
    expect(taken(pending, 1)).toEqual(["f2"]);
    // Settled, it joins the failures where its last comparison stands: after the three.
    const settled = [
      ...pending,
      reported("b-2", "no-step", "h2", { ...terms, versions: ["a1", "f1"], aside: [] }),
    ];
    expect(failedOf(settled, tasks)).toEqual(["f1", "f2", "f3", "f4"]);
    expect(taken(settled, 2)).toEqual(["f2", "f3"]);
  });
});

describe("the tasks the reference harness exhausted", () => {
  const terms = { old: "h1", solves: 2 };
  const read = event("checker.read", { contract: "c", checks: "k", faults: [] });
  const closed = ["e1", "e2", "e3", "open"];
  /** One comparison of the four tasks under `setting`: `e1` to `e3` answered by both sides in
   *  every solve, `open` by the reference only; and of `more`, which nobody answers. */
  const compared = (
    log: readonly LogEvent[],
    session: string,
    fresh: string,
    setting: string,
    more: readonly string[] = [],
  ) => [
    ...log,
    ...["e1", "e2", "e3"].flatMap((task) => [
      ...solved(session, task, "h1", [P, P]),
      ...solved(session, task, fresh, [P, P]),
    ]),
    ...solved(session, "open", "h1", [P, P]),
    ...solved(session, "open", fresh, [F, P]),
    ...more.flatMap((task) => [
      ...solved(session, task, "h1", [F, F]),
      ...solved(session, task, fresh, [F, F]),
    ]),
    reported(session, "no-step", fresh, { ...terms, fresh, setting, versions: [...closed, ...more] }),
  ];
  const start = [read, ...closed.flatMap(heldOut)];

  it("are the ones the reference answered in every solve of one comparison, and stay in the draw as retained tasks", () => {
    expect(poolOf(start).exhausted).toEqual([]);
    // All four: `open` too, which the new harness failed once and the reference never did, since
    // a changed harness can only tie or lose it. Until 10 October both sides had to answer a
    // task, and a simulated climb drew closed tasks into its set three comparisons running. Until
    // 15 October it took two comparisons, and a promoted harness had stood in one.
    const once = compared(start, "b-1", "h2", SETTING);
    const { exhausted, retained, scorable, frontier, outcomes } = poolOf(once);
    expect(sorted(exhausted)).toEqual(closed);
    // Until 16 October two of the four left the draw by the contract's hash, never to be read
    // again under that reference; every one now stays scorable, off the frontier.
    expect(sorted(retained)).toEqual(closed);
    expect(sorted(scorable)).toEqual(closed);
    expect(frontier).toEqual([]);
    // The Examiner hears each as the reference's every-solve task that it is.
    expect(closed.map((task) => outcomes.get(task))).toEqual(closed.map(() => "reference-every"));
    // A report under another setting id counts with the rest: the id names the host's code too,
    // and a campaign runs at one setting. Until 2026-10-11 the count started again there, and a
    // tree moved to a new commit drew every closed task again. A released task is no held-out one.
    expect(poolOf(compared(once, "b-3", "h4", "other")).exhausted).toEqual(exhausted);
    const released = [...once, event("task.state", { version: exhausted[0] ?? "", state: "released" })];
    expect(poolOf(released).exhausted).not.toContain(exhausted[0]);
    // Its last reading decides: one that leaves `e1` open opens it again, and in four campaigns'
    // logs 3 of 34 rechecks did. One where a limit cut a solve of the reference's says neither.
    const reread = (valid: readonly (boolean | string)[]) => [
      ...once,
      ...solved("b-4", "e1", "h1", valid),
      ...solved("b-4", "e1", "h5", [P, P]),
      reported("b-4", "no-step", "h5", { ...terms, fresh: "h5", setting: SETTING, versions: ["e1"] }),
    ];
    const spent = (log: readonly LogEvent[]) => [...poolOf(log).exhausted, ...poolOf(log).retained];
    expect(spent(reread([F, P]))).not.toContain("e1");
    expect(spent(reread(["wall-ended", P]))).toContain("e1");
  });

  it("spares a task the objective told two valid answers apart on: the next harness can still win it", () => {
    // The same two comparisons, under an objective: on `e1` the new harness's answers are the
    // better, on `e2` the two sides are even. Until 11 October both
    // closed alike, and the Examiner was told `e1` could only tie again.
    const measured = (log: readonly LogEvent[], session: string, fresh: string) => {
      const sides = [
        ...solved(session, "e1", "h1", [P, P]),
        ...solved(session, "e1", fresh, [P, P]),
        ...solved(session, "e2", "h1", [P, P]),
        ...solved(session, "e2", fresh, [P, P]),
      ];
      return [
        ...log,
        ...sides,
        ...measuredAt(sides, [10, 10, 5, 5, 10, 10, 10, 10]),
        reported(session, "no-step", fresh, {
          ...terms,
          fresh,
          setting: SETTING,
          versions: ["e1", "e2"],
          objective: { direction: "lower", margin: 0.01 },
        }),
      ];
    };
    const log = measured(measured([read, ...["e1", "e2"].flatMap(heldOut)], "b-1", "h2"), "b-2", "h3");
    // `e2` alone qualifies and is retained, and `e1` stays on the frontier.
    expect(poolOf(log)).toMatchObject({ exhausted: ["e2"], retained: ["e2"], frontier: ["e1"] });
    expect(poolOf(log).outcomes.get("e1")).toBe("reference-every");
    expect(poolOf(measured(log, "b-3", "h4")).exhausted).toEqual(["e2"]);
    // An author's answer on record that outdoes every answer on `e2` keeps it open: the room it was
    // held for stays on the frontier (19 October). One within a billionth closes it as before.
    const authored = (measure: number) =>
      poolOf([
        ...log,
        event("task.feasible", {
          version: "e2",
          session: "x-1",
          objective: { quantity: "q", direction: "lower", measure },
        }),
      ]);
    expect(authored(5)).toMatchObject({ exhausted: [], frontier: ["e1", "e2"] });
    expect(authored(10 - 1e-9)).toMatchObject({ exhausted: ["e2"], frontier: ["e1"] });
    // Half a per cent better is under the room floor and closes it, as it holds no draft at the gate.
    expect(authored(9.95)).toMatchObject({ exhausted: ["e2"], frontier: ["e1"] });
  });

  it("hold each held-out task in exactly one place: scorable or waiting for a person, with the exhausted among the retained and the retained among the scorable", () => {
    const others = ["hard", "new", "gone", "out"];
    const begun = [...start, ...others.flatMap(heldOut)];
    const log = [
      ...compared(compared(begun, "b-1", "h2", SETTING, ["hard", "gone"]), "b-2", "h3", SETTING, [
        "hard",
        "gone",
      ]),
      // Unanswered twice like `hard`, and refused since; and one released before any comparison.
      event("task.state", { version: "gone", state: "refused" }),
      event("task.state", { version: "out", state: "released" }),
    ];
    const { scorable, awaiting, exhausted, retained } = poolOf(log);
    const { held } = taskSets(log);
    expect(held.toSorted()).toEqual([...closed, "hard", "new"].toSorted());
    expect(awaiting).toEqual(["hard"]);
    expect(sorted(exhausted)).toEqual(closed);
    expect(sorted([...scorable, ...awaiting])).toEqual(sorted(held));
    expect(scorable).toContain("new");
    expect(exhausted.every((task) => retained.includes(task))).toBe(true);
    expect(retained.every((task) => scorable.includes(task))).toBe(true);
    // The scorable tasks stand in the order they were held out.
    expect(scorable).toEqual(held.filter((task) => scorable.includes(task)));
  });
});

describe("the billed dollars a cap counts", () => {
  /** One solve's two events, started for `comparison` where it names one. */
  const paid = (solve: string, billed: number, comparison?: string) => [
    event("solve.started", { solve, ...keyIfDefined("comparison", comparison) }),
    event("solve.finished", { solve, billed }),
  ];

  it("are the comparison's own solves and their rulings, and in a round the session's spend", () => {
    const log = [
      // An earlier comparison's solve, and a practice solve of another session.
      ...paid("s-a", 4, "g-0"),
      ...paid("s-p", 1),
      event(BUILD_STARTED, { session: "b-1" }),
      // The session's practice solve and its reviewers, which name no comparison.
      ...paid("s-b", 6),
      event("referee.finding", { solve: "s-b", billed: 0.4 }),
      event("diagnosis.recorded", { solve: "s-b", billed: 0.1 }),
      event("build.finished", { session: "b-1", billed: 10.5 }),
      // Another comparison ran before the round's own went on.
      ...paid("s-c", 5, "g-1"),
      event("exam.finished", { session: "x-1", billed: 2 }),
      ...paid("s-d", 3, "b-1"),
      event("referee.finding", { solve: "s-d", billed: 0.5 }),
      // A turn's own usage is in its solve's sum, and an ending with no sum adds nothing.
      event("solve.started", { solve: "s-e", comparison: "b-1" }),
      event("solve.turn", { solve: "s-e", billed: 99 }),
      event("solve.finished", { solve: "s-e" }),
    ];
    expect(billedFor(log, "b-1")).toBe(20.5);
    // A checkpoint has no session: its own solves alone.
    expect(billedFor(log, "g-1")).toBe(5);
    expect(billedFor(log, "g-0")).toBe(4);
    expect(billedFor(log, "none")).toBe(0);
  });

  it("include the turns and compactions of a solve or a session with no end in the total, and of a solve of the comparison in its cap", () => {
    const usage = (total: number) => ({ input: 1, output: 1, cost: { total } });
    const compacted = (kind: EventKind, id: JsonObject, total: number) =>
      event(kind, { ...id, tokensBefore: 9, seconds: 1, error: null, usages: [usage(total)] });
    const log = [
      // A solve of g-1 killed after one turn and one compaction of pi's loop.
      event("solve.started", { solve: "s-k", comparison: "g-1" }),
      event("solve.turn", { solve: "s-k", usage: usage(1) }),
      compacted("solve.compacted", { solve: "s-k" }, 2),
      // A finished solve's compaction is in its sum, and is not counted again.
      ...paid("s-f", 4, "g-1"),
      compacted("solve.compacted", { solve: "s-f" }, 8),
      // A Builder session of round b-1 killed after a turn and a compaction.
      event(BUILD_STARTED, { session: "b-1" }),
      event("build.turn", { session: "b-1", usage: usage(0.5) }),
      compacted("build.compacted", { session: "b-1" }, 0.25),
    ];
    expect(billedAll(log)).toBeCloseTo(3 + 4 + 0.75, 10);
    expect(billedFor(log.slice(0, 3), "g-1")).toBe(3);
    expect(billedFor(log, "g-1")).toBe(7);
    expect(billedFor(log, "g-2")).toBe(0);
    // A live Builder's own turns count before its next tool can spend on another seat.
    expect(billedFor(log, "b-1")).toBe(0.75);
  });
});
