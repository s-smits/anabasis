// What the comparisons on record say of a campaign, over hand-built logs: whether three checkpoints
// have passed without a step, each report read as it was found, the tasks that wait for a person,
// the one outcome an Examiner hears of a task, and the billed dollars a cap counts. No solve runs
// here; `round.test.ts` makes the reports.
import { describe, expect, it } from "bun:test";
import { type Condition, conditionId, settingId } from "../src/kernel/condition.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import {
  answered,
  awaitingLabel,
  billedFor,
  lastReports,
  latestBuilt,
  outcomesOf,
  pairsReported,
  stopRule,
} from "../src/kernel/reports.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
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
/** Solves of `task` under `harness` made for `comparison`, one an entry: true for a valid answer,
 *  false for a rejected one. */
function solved(comparison: string, task: string, harness: string, valid: readonly boolean[]) {
  const ran = condition(task, harness);
  const id = conditionId(ran);
  return [
    event("condition.recorded", { id, condition: requireJsonValue(ran) }),
    ...valid.flatMap((each) => {
      solves += 1;
      const solve = `s-${String(solves)}`;
      return [
        event("solve.started", { solve, condition: id, comparison }),
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
    const lower = (session: string) => reported(session, "below-starter", "h4");
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
  });

  it("keeps a comparison where it first reported, whenever a person settled it", () => {
    const flat = (session: string) => reported(session, "no-step", "h2");
    // b-1 read a step. Two comparisons later a person settles it, and it is a step still: it
    // stays the first of the three, and two checkpoints have passed since.
    const log = [...sessions, reported("b-1", "step", "h2"), flat("b-2"), flat("b-3")];
    const settled = [...log, reported("b-1", "step", "h2", { settled: { labelled: 1 } })];
    expect(lastReports(settled).map(({ session, index }) => [session, index])).toEqual([
      ["b-1", 3],
      ["b-2", 4],
      ["b-3", 5],
    ]);
    expect(lastReports(settled)[0]?.data.settled).toEqual({ labelled: 1 });
    expect(stopRule(settled)).toEqual({ checkpoints: 3, sinceStep: 2, stop: false });
    // And a settling that takes the step away is read where the comparison stands, too.
    const undone = [...log, reported("b-1", "no-step", "h2", { settled: { labelled: 1 } })];
    expect(stopRule(undone)).toEqual({ checkpoints: 3, sinceStep: 3, stop: true });
  });

  it("counts no comparison of harnesses no Builder session changed", () => {
    // Two comparisons of harnesses the campaign began with, and then one round that read no step.
    const gates = [reported("g0", "no-step", "start"), reported("g2", "no-step", "start")];
    expect(stopRule(gates)).toEqual({ checkpoints: 0, sinceStep: 0, stop: false });
    const round = [...gates, ...sessions, reported("b-1", "no-step", "h2")];
    expect(stopRule(round)).toEqual({ checkpoints: 1, sinceStep: 1, stop: false });
    // A session that left its harness as it was names the harness it started from, which no
    // session made.
    const idle = event("build.finished", { session: "b-0", harness: "start", changed: false });
    expect(stopRule([idle, ...gates])).toEqual({ checkpoints: 0, sinceStep: 0, stop: false });
  });

  it("counts a harness set against the starter once: as the reference, and not as the guard after another", () => {
    const versus = (session: string, old: string, reading: string) =>
      reported(session, reading, "h2", { old, starter: "base" });
    // While the starter is the reference, a comparison with it is the checkpoint.
    expect(stopRule([...sessions, versus("b-1", "base", "no-step")])).toMatchObject({ checkpoints: 1 });
    // After a comparison with another reference left the starter unread, the comparison with the
    // starter is that one's reading against it, and no second checkpoint.
    const guarded = [...sessions, versus("b-1", "h1", "starter-unread"), versus("g-1", "base", "no-step")];
    expect(stopRule(guarded)).toEqual({ checkpoints: 1, sinceStep: 1, stop: false });
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
      ...solved("b-2", "v1", "h2", [F]),
      event("task.state", { version: "v2", state: "released" }),
    ];
    const [found] = lastReports(later);
    expect(found === undefined ? [] : pairsReported(later, found)).toMatchObject([
      { task: "v1", fresh: [P, P] },
      { task: "v2" },
    ]);
  });

  it("is read the same once a person has settled it, though a task it tallied has left the set since", () => {
    // v2 is released and v1 refused after the comparison reported, and then a person settles it.
    // Every fold reads the comparison as its first report found it.
    const settled = [
      ...log,
      event("task.state", { version: "v2", state: "released" }),
      event("task.state", { version: "v1", state: "refused" }),
      reported("b-1", "no-step", "h2", { ...terms, versions: ["v1", "v2"], settled: { labelled: 1 } }),
    ];
    const [found] = lastReports(settled);
    expect(found?.data.settled).toEqual({ labelled: 1 });
    expect(found === undefined ? [] : pairsReported(settled, found)).toMatchObject([
      { task: "v1", old: [F, F], fresh: [P, P] },
      { task: "v2", old: [F, P], fresh: [F, P] },
    ]);
    expect(awaitingLabel(settled)).toEqual([]);
    expect(outcomesOf(settled)).toEqual(
      new Map([
        ["v1", "won"],
        ["v2", "tie"],
      ]),
    );
  });

  it("counts the comparison's own solves, and none another comparison made of the same harness", () => {
    const again = [
      ...log,
      ...solved("b-2", "v1", "h1", [P, P]),
      ...solved("b-2", "v1", "h3", [P, F]),
      reported("b-2", "no-step", "h3", { ...terms, fresh: "h3", versions: ["v1"] }),
    ];
    const [first, second] = lastReports(again);
    // The reference harness failed v1 twice for the first comparison and passed it twice for this one.
    expect(second === undefined ? [] : pairsReported(again, second)).toMatchObject([
      { task: "v1", old: [P, P], fresh: [P, F] },
    ]);
    expect(first === undefined ? [] : pairsReported(again, first)[0]).toMatchObject({ old: [F, F] });
  });

  it("is nothing for a report that compared nothing, or one whose solves name no comparison", () => {
    const bare = [...heldOut("v1"), reported("b-1", "no-change", null, { scored: null })];
    expect(lastReports(bare).flatMap((each) => pairsReported(bare, each))).toEqual([]);
    const before = [
      ...heldOut("v1"),
      ...solved("", "v1", "h1", [P, P]),
      ...solved("", "v1", "h2", [P, P]),
      reported("b-1", "no-step", "h2", { old: "h1", solves: 2, setting: SETTING, versions: ["v1"] }),
    ];
    expect(lastReports(before).flatMap((each) => pairsReported(before, each))).toEqual([]);
  });
});

describe("the outcome an Examiner hears of a task", () => {
  const tasks = ["won", "tied", "unsolved", "aside", "waiting"];
  const terms = { old: "h1", fresh: "h2", solves: 2, setting: SETTING };
  const log = [
    ...tasks.flatMap(heldOut),
    // One harness is valid more often; which one is not said.
    ...solved("b-1", "won", "h1", [F, F]),
    ...solved("b-1", "won", "h2", [P, F]),
    ...solved("b-1", "tied", "h1", [P, F]),
    ...solved("b-1", "tied", "h2", [F, P]),
    ...solved("b-1", "unsolved", "h1", [F, F]),
    ...solved("b-1", "unsolved", "h2", [F, F]),
    ...solved("b-1", "aside", "h1", [P, F]),
    ...solved("b-1", "aside", "h2", [P, P]),
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
      ...solved("b-2", "tied", "h1", [F, F]),
      ...solved("b-2", "tied", "h3", [P, P]),
      ...solved("b-2", "aside", "h1", [P, P]),
      ...solved("b-2", "aside", "h3", [P, P]),
      reported("b-2", "no-step", "h3", { ...terms, fresh: "h3", versions: ["tied", "aside"] }),
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

  it("is no 'no valid answer' where a solve outside the test answered: the starter, or the reference again", () => {
    // The test's own four solves of the task were all rejected. The reference harness's third
    // solve, made to read it against itself, was valid, and on another task the starter's was.
    const beside = [
      ...heldOut("again"),
      ...heldOut("lower"),
      ...solved("g-1", "again", "h1", [F, F, P, F]),
      ...solved("g-1", "again", "h2", [F, F]),
      ...solved("g-1", "lower", "h1", [F, F]),
      ...solved("g-1", "lower", "h2", [F, F]),
      ...solved("g-1", "lower", "base", [P, F]),
      reported("g-1", "no-step", "h2", { ...terms, versions: ["again", "lower"] }),
    ];
    expect(answered(beside, "g-1")).toEqual(new Set(["again", "lower"]));
    expect([...outcomesOf(beside).values()]).toEqual(["tie", "tie"]);
  });
});

describe("the tasks that go to a person as possibly infeasible", () => {
  const terms = { old: "h1", solves: 2, setting: SETTING };
  /** One more comparison of the two tasks: `hard` answered validly or not, `easy` always. */
  const compared = (log: readonly LogEvent[], session: string, fresh: string, hard: boolean) => [
    ...log,
    ...solved(session, "hard", "h1", [F, F]),
    ...solved(session, "hard", fresh, [hard, F]),
    ...solved(session, "easy", "h1", [P, P]),
    ...solved(session, "easy", fresh, [P, P]),
    reported(session, "no-step", fresh, { ...terms, fresh, versions: ["hard", "easy"] }),
  ];
  const start = [...heldOut("hard"), ...heldOut("easy")];
  const once = compared(start, "b-1", "h2", F);
  const twice = compared(once, "b-2", "h3", F);

  it("are the ones no harness answered validly in two comparisons in a row", () => {
    expect(awaitingLabel(once)).toEqual([]);
    expect(awaitingLabel(twice)).toEqual(["hard"]);
    // A valid answer in the second comparison ends the run, and it starts again after it.
    const valid = compared(once, "b-2", "h3", P);
    expect(awaitingLabel(valid)).toEqual([]);
    expect(awaitingLabel(compared(valid, "b-3", "h4", F))).toEqual([]);
    expect(awaitingLabel(compared(compared(valid, "b-3", "h4", F), "b-4", "h5", F))).toEqual(["hard"]);
  });

  it("wait until a person keeps the task, which counts its comparisons anew, or refuses it", () => {
    const kept = [...twice, event("task.state", { version: "hard", state: "held", reason: "feasible" })];
    expect(awaitingLabel(kept)).toEqual([]);
    expect(awaitingLabel(compared(kept, "b-3", "h4", F))).toEqual([]);
    expect(awaitingLabel(compared(compared(kept, "b-3", "h4", F), "b-4", "h5", F))).toEqual(["hard"]);
    // A settling of an earlier comparison, made after the label, is no comparison after it.
    const settled = [
      ...kept,
      reported("b-2", "no-step", "h3", { ...terms, fresh: "h3", versions: ["hard", "easy"], settled: {} }),
    ];
    expect(awaitingLabel(compared(settled, "b-3", "h4", F))).toEqual([]);
  });

  it("are not the ones the starter answered, though the test's two harnesses did not", () => {
    const lower = (log: readonly LogEvent[], session: string) => {
      const whole = compared(log, session, "h2", F);
      // The starter's solves are made before the comparison reports.
      return [...whole.slice(0, -1), ...solved(session, "hard", "base", [P, F]), ...whole.slice(-1)];
    };
    expect(awaitingLabel(lower(lower(start, "b-1"), "b-2"))).toEqual([]);
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
      event("build.started", { session: "b-1" }),
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

  it("holds a session still running to what it has billed so far", () => {
    const log = [event("build.started", { session: "b-1" }), ...paid("s-b", 6), ...paid("s-c", 2)];
    expect(billedFor(log, "b-1")).toBe(8);
  });
});
