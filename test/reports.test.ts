// What the comparisons on record say of a campaign, over hand-built logs: whether three checkpoints
// have passed without a step, each report read as it was found, the tasks that wait for a person,
// the one outcome an Examiner hears of a task, and the billed dollars a cap counts. No solve runs
// here; `round.test.ts` makes the reports.
import { describe, expect, it } from "bun:test";
import { type Condition, conditionId, settingId } from "../src/kernel/condition.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import {
  awaitingLabel,
  billedSince,
  lastReports,
  latestBuilt,
  outcomesOf,
  pairsReported,
  stopRule,
} from "../src/kernel/reports.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";

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
    diskBytes: 1024,
  },
  host: "h",
  side: "test",
});
const SETTING = settingId(condition("any", "any"));

let solves = 0;
/** Solves of `task` under `harness`, one an entry: true for a valid answer, false for a rejected one. */
function solved(task: string, harness: string, valid: readonly boolean[]) {
  const ran = condition(task, harness);
  const id = conditionId(ran);
  return [
    event("condition.recorded", { id, condition: requireJsonValue(ran) }),
    ...valid.flatMap((each) => {
      solves += 1;
      const solve = `s-${String(solves)}`;
      return [
        event("solve.started", { solve, condition: id }),
        event("solve.finished", { solve, ending: { outcome: each ? "pass" : "fail" }, billed: 2 }),
      ];
    }),
  ];
}
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
    scored: { wins: 0, losses: 0, ties: 1 },
    versions: ["v1"],
    ...more,
  });

describe("the harness a Builder goes on from", () => {
  const built = (session: string, harness: string, more: JsonObject = {}) =>
    event("build.finished", { session, harness, changed: true, ended: "finished", ...more });

  it("is the one its last whole session left, step or none, and null before any", () => {
    expect(latestBuilt([])).toBeNull();
    expect(latestBuilt([built("b-1", "h2"), reported("b-1", "no-step", "h2")])).toBe("h2");
    expect(latestBuilt([built("b-1", "h2"), built("b-2", "h3")])).toBe("h3");
    // A session that left its harness as it was, was killed or crashed leaves nothing to go on from.
    expect(latestBuilt([built("b-1", "h2"), built("b-2", "h2", { changed: false })])).toBe("h2");
    expect(latestBuilt([built("b-1", "h2"), built("b-2", "h3", { ended: "killed" })])).toBe("h2");
    expect(latestBuilt([built("b-1", "h2", { ended: "crashed" })])).toBeNull();
    // A session cut at its wall is a whole session.
    expect(latestBuilt([built("b-1", "h2", { ended: "wall" })])).toBe("h2");
  });
});

describe("the stop rule", () => {
  /** The harnesses Builder sessions left, which is what makes a comparison of one a checkpoint. */
  const sessions = ["h2", "h3", "h4"].map((harness) =>
    event("build.finished", { session: `s-${harness}`, harness, changed: true, ended: "finished" }),
  );

  it("stops after three checkpoints without a step, counted from the last step", () => {
    const flat = (session: string) => reported(session, "no-step", "h2");
    expect(stopRule([])).toEqual({ checkpoints: 0, sinceStep: 0, stop: false });
    expect(stopRule([...sessions, flat("b-1"), flat("b-2")])).toEqual({
      checkpoints: 2,
      sinceStep: 2,
      stop: false,
    });
    expect(stopRule([...sessions, flat("b-1"), flat("b-2"), flat("b-3")])).toMatchObject({
      sinceStep: 3,
      stop: true,
    });
    // A step starts the count again, and a result short of one for another reason counts.
    const after = [...sessions, flat("b-1"), flat("b-2"), reported("b-3", "step", "h3"), flat("b-4")];
    expect(stopRule(after)).toEqual({ checkpoints: 4, sinceStep: 1, stop: false });
    const lower = (session: string) => reported(session, "below-baseline", "h4");
    expect(stopRule([...after, lower("b-5"), lower("b-6")])).toMatchObject({ sinceStep: 3, stop: true });
  });

  it("counts a comparison and nothing else: a session that changed nothing, a stop or a cap compared nothing", () => {
    const idle = (session: string) => reported(session, "no-change", null, { scored: null });
    const stopped = (session: string) => reported(session, "check-defects", "h2", { scored: null });
    const capped = (session: string) => reported(session, "not-scored", "h2", { scored: null, capped: true });
    // Every task set aside until a person has labelled its rejections: a tally of no task.
    const waiting = reported("b-5", "not-scored", "h2", { versions: [], aside: ["v1"] });
    const log = [...sessions, idle("b-1"), idle("b-2"), stopped("b-3"), capped("b-4"), waiting];
    expect(stopRule(log)).toEqual({ checkpoints: 0, sinceStep: 0, stop: false });
    // A report a person settled is its checkpoint's one report, read as the labels left it.
    const settled = [...sessions, reported("b-1", "no-step", "h2"), reported("b-1", "step", "h2")];
    expect(stopRule(settled)).toEqual({ checkpoints: 1, sinceStep: 0, stop: false });
    expect(lastReports(settled).map(({ session, index }) => [session, index])).toEqual([["b-1", 4]]);
  });

  it("counts no comparison of harnesses no Builder session left: the first experiment is no checkpoint", () => {
    // The baseline against the starting harness, twice, and then one round that read no step.
    const gates = [reported("g0", "no-step", "baseline"), reported("g2", "no-step", "baseline")];
    expect(stopRule(gates)).toEqual({ checkpoints: 0, sinceStep: 0, stop: false });
    const round = [...gates, ...sessions, reported("b-1", "no-step", "h2")];
    expect(stopRule(round)).toEqual({ checkpoints: 1, sinceStep: 1, stop: false });
  });
});

describe("a report read as it was found", () => {
  const began = heldOut("v1").length + heldOut("v2").length;
  const terms = { old: "h1", fresh: "h2", solves: 2, setting: SETTING, began };
  const log = [
    ...heldOut("v1"),
    ...heldOut("v2"),
    ...solved("v1", "h1", [F, F]),
    ...solved("v1", "h2", [P, P]),
    ...solved("v2", "h1", [F, P]),
    ...solved("v2", "h2", [F, P]),
    reported("b-1", "no-step", "h2", { ...terms, versions: ["v1", "v2"] }),
  ];
  const [report] = lastReports(log);

  it("is its scored tasks' pairs under its own two harnesses and setting", () => {
    expect(report === undefined ? [] : pairsReported(log, report)).toMatchObject([
      { task: "v1", old: [F, F], fresh: [P, P] },
      { task: "v2", old: [F, P], fresh: [F, P] },
    ]);
  });

  it("stays what it was after its tasks moved and further solves were made", () => {
    const later = [
      ...log,
      // A later comparison solved v1 again under the same harness, and v2 was released since.
      ...solved("v1", "h2", [F]),
      event("task.state", { version: "v2", state: "released" }),
    ];
    const [found] = lastReports(later);
    expect(found === undefined ? [] : pairsReported(later, found)).toMatchObject([
      { task: "v1", fresh: [P, P] },
      { task: "v2" },
    ]);
  });

  it("counts both sides from where its comparison began, and no solve made before", () => {
    const again = [
      ...log,
      ...solved("v1", "h1", [P, P]),
      ...solved("v1", "h3", [P, F]),
      reported("b-2", "no-step", "h3", { ...terms, fresh: "h3", began: log.length, versions: ["v1"] }),
    ];
    const [, second] = lastReports(again);
    // The reference harness failed v1 twice for the first comparison and passed it twice for this one.
    expect(second === undefined ? [] : pairsReported(again, second)).toMatchObject([
      { task: "v1", old: [P, P], fresh: [P, F] },
    ]);
  });

  it("is nothing for a report that compared nothing, or one written before reports said where they began", () => {
    const bare = [...heldOut("v1"), reported("b-1", "no-change", null, { scored: null })];
    expect(lastReports(bare).flatMap((each) => pairsReported(bare, each))).toEqual([]);
    const before = [
      ...heldOut("v1"),
      reported("b-1", "no-step", "h2", { old: "h1", solves: 2, setting: SETTING, versions: ["v1"] }),
    ];
    expect(lastReports(before).flatMap((each) => pairsReported(before, each))).toEqual([]);
  });
});

describe("the outcome an Examiner hears of a task", () => {
  const tasks = ["won", "tied", "unsolved", "aside", "waiting"];
  const began = tasks.flatMap(heldOut).length;
  const terms = { old: "h1", fresh: "h2", solves: 2, setting: SETTING, began };
  const log = [
    ...tasks.flatMap(heldOut),
    // One harness is valid more often; which one is not said.
    ...solved("won", "h1", [F, F]),
    ...solved("won", "h2", [P, F]),
    ...solved("tied", "h1", [P, F]),
    ...solved("tied", "h2", [F, P]),
    ...solved("unsolved", "h1", [F, F]),
    ...solved("unsolved", "h2", [F, F]),
    ...solved("aside", "h1", [P, F]),
    ...solved("aside", "h2", [P, P]),
    reported("b-1", "no-step", "h2", { ...terms, versions: ["won", "tied", "unsolved"], aside: ["aside"] }),
  ];

  it("is that one harness won, a tie between valid answers, no valid answer yet, or disputed", () => {
    expect(outcomesOf(log)).toEqual(
      new Map([
        ["won", "won"],
        ["tied", "tie"],
        ["unsolved", "no-valid-answer"],
        // A rejection of an answer to it is not settled, so it was in no tally.
        ["aside", "disputed"],
      ]),
    );
    // A task no comparison has scored has no outcome.
    expect(outcomesOf(log).has("waiting")).toBe(false);
  });

  it("is read from the last comparison that scored the task", () => {
    const again = [
      ...log,
      ...solved("tied", "h1", [F, F]),
      ...solved("tied", "h3", [P, P]),
      ...solved("aside", "h1", [P, P]),
      ...solved("aside", "h3", [P, P]),
      reported("b-2", "no-step", "h3", {
        ...terms,
        fresh: "h3",
        began: log.length,
        versions: ["tied", "aside"],
      }),
    ];
    expect(outcomesOf(again)).toEqual(
      new Map([
        ["won", "won"],
        ["tied", "won"],
        ["unsolved", "no-valid-answer"],
        ["aside", "tie"],
      ]),
    );
  });
});

describe("the tasks that go to a person as possibly infeasible", () => {
  const began = heldOut("hard").length + heldOut("easy").length;
  const terms = { old: "h1", solves: 2, setting: SETTING };
  /** One more comparison of the two tasks: `hard` answered validly or not, `easy` always. */
  const compared = (log: readonly LogEvent[], session: string, fresh: string, hard: boolean) => [
    ...log,
    ...solved("hard", "h1", [F, F]),
    ...solved("hard", fresh, [hard, F]),
    ...solved("easy", "h1", [P, P]),
    ...solved("easy", fresh, [P, P]),
    reported(session, "no-step", fresh, { ...terms, fresh, began: log.length, versions: ["hard", "easy"] }),
  ];
  const start = [...heldOut("hard"), ...heldOut("easy")];
  const once = compared(start, "b-1", "h2", F);
  const twice = compared(once, "b-2", "h3", F);

  it("are the ones no harness answered validly in two comparisons in a row", () => {
    expect(began).toBe(start.length);
    expect(awaitingLabel(once)).toEqual([]);
    expect(awaitingLabel(twice)).toEqual(["hard"]);
    // A valid answer in the second comparison ends the run, and it starts again after it.
    const answered = compared(once, "b-2", "h3", P);
    expect(awaitingLabel(answered)).toEqual([]);
    expect(awaitingLabel(compared(answered, "b-3", "h4", F))).toEqual([]);
    expect(awaitingLabel(compared(compared(answered, "b-3", "h4", F), "b-4", "h5", F))).toEqual(["hard"]);
  });

  it("wait until a person keeps the task, which counts its comparisons anew, or refuses it", () => {
    const kept = [...twice, event("task.state", { version: "hard", state: "held", reason: "feasible" })];
    expect(awaitingLabel(kept)).toEqual([]);
    expect(awaitingLabel(compared(kept, "b-3", "h4", F))).toEqual([]);
    expect(awaitingLabel(compared(compared(kept, "b-3", "h4", F), "b-4", "h5", F))).toEqual(["hard"]);
  });
});

describe("the billed dollars a cap counts", () => {
  it("are every solve, session and reviewer's reading that ended since a place in the log", () => {
    const log = [
      event("solve.finished", { solve: "s-a", billed: 4 }),
      event("build.finished", { session: "b-1", billed: 10.5 }),
      event("solve.finished", { solve: "s-b", billed: 6 }),
      event("referee.finding", { solve: "s-b", billed: 0.4 }),
      event("diagnosis.recorded", { solve: "s-b", billed: 0.1 }),
      event("exam.finished", { session: "x-1", billed: 2 }),
      // A turn's own usage is in its solve's sum, and an ending with no sum adds nothing.
      event("solve.turn", { solve: "s-c", billed: 99 }),
      event("solve.finished", { solve: "s-c" }),
    ];
    expect(billedSince(log, 0)).toBe(23);
    expect(billedSince(log, 2)).toBe(8.5);
    expect(billedSince(log, log.length)).toBe(0);
  });
});
