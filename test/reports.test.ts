// What the comparisons on record say of a campaign, over hand-built logs: whether its patience has
// passed without a step, each report read as it was found, the one place each held-out task has
// (`poolOf`), what an Examiner hears of a task, and the billed dollars a cap counts. No solve runs
// here; `round.test.ts` makes the reports.
import { describe, expect, it } from "bun:test";
import { type Condition, conditionId, settingId } from "../src/kernel/condition.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import {
  billedAll,
  billedFor,
  comparedAs,
  lastReports,
  latestBuilt,
  type Outcome,
  pairsReported,
  poolOf,
  promoted,
  releaseOrder,
  roomOf,
  stopRule as stopOf,
} from "../src/kernel/reports.ts";
import { taskSets } from "../src/kernel/task.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
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
    diskBytes: 1024,
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
const cells = (log: readonly LogEvent[]) =>
  new Map([...poolOf(log).standings].map(([task, { cell }]) => [task, cell]));
/** Which of `tasks` a release holds back from its draw as failed by the reference: such a task is
 *  taken by halves and never drawn, so alone in a pool it is not released. */
const failedOf = (log: readonly LogEvent[], tasks: readonly string[]) =>
  tasks.filter((task) => releaseOrder(log, [task], 1, "seed").length === 0);

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

describe("the reference harness of a campaign", () => {
  const promotedTo = (harness: string) => event("harness.promoted", { harness, from: "base", rests: [] });

  it("is the one the operator last promoted, and none until then", () => {
    expect(promoted([])).toBeNull();
    expect(promoted([promotedTo("h2")])).toBe("h2");
    expect(promoted([promotedTo("h2"), promotedTo("h5")])).toBe("h5");
    // A reference named on one command promotes nothing: only the event does.
    expect(promoted([reported("b-1", "step", "h2", { old: "h9" })])).toBeNull();
  });

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
  const three = event("campaign.opened", { budget: null, limit: null, ladder: [], sessions: 1, patience: 3 });
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
  /** A session that left its harness as it was, after practice solves that ended as `shown` says. */
  const idle = (id: string, shown: readonly boolean[], more: JsonObject = {}) => [
    event("build.started", { session: id }),
    ...solved(undefined, "p1", "h2", shown),
    session(id, "h2", { changed: false, ...more }),
  ];
  const two = [...sessions, flat("b-1", "h2"), flat("b-2", "h3")];

  it("counts a cut Builder's harness only where it was frozen at a checkpoint before the cut, and a checkpoint whatever the session leaves later", () => {
    for (const ended of ["killed", "crashed"]) {
      const cut = [session("b-1", "h2", { ended }), flat("g-1", "h2")];
      expect(stopRule(cut)).toEqual(counted(0, 0));
      expect(stopRule([event("build.checkpoint", { session: "b-1", harness: "h2" }), ...cut])).toEqual(
        counted(1, 1),
      );
    }
    const live = [
      event(BUILD_STARTED, { session: "b-1" }),
      event("build.checkpoint", { session: "b-1", harness: "h2" }),
      flat("g-1", "h2"),
    ];
    expect(stopRule(live)).toEqual(counted(1, 1));
    expect(stopRule([...live, session("b-1", "h3")])).toEqual(counted(1, 1));
  });
  it("stops after as many harnesses in a row that showed no gain as the patience, counted from the last step", () => {
    expect(stopRule([])).toEqual(counted(0, 0));
    expect(stopRule(two)).toEqual(counted(2, 2));
    expect(stopRule([...two, flat("b-3", "h4")])).toEqual(counted(3, 3));
    // A step starts the count again, and a result short of one for another reason counts.
    const after = [...two, reported("b-3", "step", "h4"), flat("b-4", "h5")];
    expect(stopRule(after)).toEqual(counted(4, 1));
    const lower = (id: string, fresh: string) => reported(id, "below-starter", fresh);
    expect(stopRule([...after, lower("b-5", "h6"), lower("b-6", "h7")])).toEqual(counted(6, 3));
    // A reading under the trigger showed a gain: it bought the repeat, and reads `no-step` by
    // itself. Counted as no gain, a 2-0 at level 0.10 ended a campaign of patience 3 before its
    // repeat was bought (found by review, 11 October). The trigger is the opening's where it
    // names one, as a term, and 0.25 otherwise: a 1-0 clears neither.
    const bought = flat("b-3", "h4", tallied(2, 0, 10));
    expect(stopRule([...two, bought])).toEqual(counted(3, 0));
    expect(stopRule([...two, flat("b-3", "h4", tallied(1, 0, 11))])).toEqual(counted(3, 3));
    const strict = event("campaign.opened", { ...three.data, terms: { trigger: "0.1" } });
    expect(stopOf([strict, ...two, bought])).toEqual(counted(3, 3));
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
    // The pair reads as its last comparison: a step its repeat does not read again was one draw,
    // and one the repeat reads is the step the count starts again from.
    expect(stopRule([...sessions, reported("b-1", "step", "h2"), flat("g-1", "h2")])).toEqual(counted(1, 1));
    expect(stopRule([...two, reported("g-1", "step", "h3")])).toEqual(counted(2, 0));
    // Every comparison on record is read, whatever setting id it carries: the id names the host's
    // code too, so until 2026-10-11 a tree moved to a new commit began the count again
    // (`docs/simplify.md`, A4). A harness compared again under another id is one harness still.
    const earlier = [...sessions, flat("b-1", "h2", { setting: "s1" }), flat("b-2", "h3", { setting: "s1" })];
    expect(stopRule([...earlier, flat("b-3", "h4", { setting: "s2" })])).toEqual(counted(3, 3));
    expect(stopRule([...earlier, flat("b-3", "h3", { setting: "s2" })])).toEqual(counted(2, 2));
  });

  it("reads room by the tasks informative for the reference, too-hard where nobody answered", () => {
    const report = (old: number[], fresh: number[], told: number) => ({
      valid: { old, fresh, informative: { old: told, fresh: 0 } },
    });
    expect(roomOf(report([0, 0, 12], [0, 0, 12], 0))).toBe("none");
    expect(roomOf(report([0, 0, 12], [0, 0, 12], 1))).toBe("room");
    expect(roomOf(report([12, 0, 0], [12, 0, 0], 0))).toBe("too-hard");
    // The reference failing everything the new harness answered leaves the reference none.
    expect(roomOf(report([12, 0, 0], [0, 0, 12], 0))).toBe("none");
    // The reference's side is `fresh` in the comparison it was promoted on.
    expect(
      roomOf({ valid: { old: [12, 0, 0], fresh: [0, 3, 9], informative: { old: 0, fresh: 3 } } }, "fresh"),
    ).toBe("room");
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

  it("counts a session that left its harness as it was where a practice solve of its failed, in its place, and none that was killed or crashed", () => {
    // A session that was shown a failure and declined it: a practice solve of its own, a fail,
    // between its start and its end. One whose every practice solve passed had nothing to work on,
    // which is the supply's fault: all ten campaigns of 9 and 10 October stopped on three such.
    const log = [
      session("b-1", "h2"),
      flat("b-1", "h2"),
      ...idle("b-2", [false]),
      ...idle("b-3", [true, false]),
    ];
    expect(stopRule(log)).toEqual(counted(3, 3));
    const passing = [session("b-1", "h2"), flat("b-1", "h2"), ...idle("b-2", [true]), ...idle("b-3", [])];
    expect(stopRule(passing)).toEqual(counted(1, 1));
    expect(
      stopRule([
        ...idle("b-1", [false]),
        ...idle("b-2", [false], { ended: "killed" }),
        ...idle("b-3", [false], { ended: "crashed" }),
      ]),
    ).toEqual(counted(1, 1));
    // A step after them starts the count again.
    expect(stopRule([...log, session("b-4", "h3"), reported("b-4", "step", "h3")])).toEqual(counted(4, 0));
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

  it("reads a settled comparison by its last report, where it first reported", () => {
    // b-1 read a step. Two comparisons later a person settles it, and it is a step still: it
    // stays the first of the three, and two checkpoints have passed since.
    const log = [...sessions, reported("b-1", "step", "h2"), flat("b-2", "h3"), flat("b-3", "h4")];
    const settled = [...log, reported("b-1", "step", "h2", { settled: { labelled: 1 } })];
    expect(lastReports(settled).map(({ session: id, index }) => [id, index])).toEqual([
      ["b-1", 6],
      ["b-2", 7],
      ["b-3", 8],
    ]);
    expect(lastReports(settled)[0]?.data.settled).toEqual({ labelled: 1 });
    expect(stopRule(settled)).toEqual(counted(3, 2));
    // A settling that takes the step away, or gives one, is read where the comparison stands.
    const undone = [...log, reported("b-1", "no-step", "h2", { settled: { labelled: 1 } })];
    expect(stopRule(undone)).toEqual(counted(3, 3));
    expect(stopRule([...sessions, flat("b-1", "h2"), reported("b-1", "step", "h2")])).toEqual(counted(1, 0));
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

  it("is its scored tasks' pairs under its own two harnesses, counting its own solves and none another comparison made", () => {
    expect(pairsIn(log)).toMatchObject([found]);
    const again = [
      ...log,
      ...solved("b-2", "v1", "h1", [P, P]),
      ...solved("b-2", "v1", "h3", [P, F]),
      reported("b-2", "no-step", "h3", { ...terms, fresh: "h3", versions: ["v1"] }),
    ];
    // The reference harness failed v1 twice for the first comparison and passed it twice for this one.
    expect(pairsIn(again)).toMatchObject([found, [{ task: "v1", old: [P, P], fresh: [P, F] }]]);
  });

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

  it("is nothing for a report that compared nothing, or one whose solves name no comparison", () => {
    const bare = [...heldOut("v1"), reported("b-1", "no-change", null, { scored: null })];
    expect(pairsIn(bare)).toEqual([[]]);
    const before = [
      ...heldOut("v1"),
      ...solved("", "v1", "h1", [P, P]),
      ...solved("", "v1", "h2", [P, P]),
      reported("b-1", "no-step", "h2", { old: "h1", solves: 2, setting: SETTING, versions: ["v1"] }),
    ];
    expect(pairsIn(before)).toEqual([[]]);
  });
});

describe("the outcome an Examiner hears of a task", () => {
  const tasks = ["won", "tied", "unsolved", "aside", "waiting"];
  const terms = { old: "h1", fresh: "h2", solves: 2, setting: SETTING };
  /** One comparison of four of the tasks, the new harness answering as `fresh` says. */
  const compared = (fresh: Record<string, readonly boolean[]>) => [
    ...tasks.flatMap(heldOut),
    ...solved("b-1", "won", "h1", [F, F]),
    ...solved("b-1", "won", "h2", fresh.won ?? []),
    ...solved("b-1", "tied", "h1", [P, F]),
    ...solved("b-1", "tied", "h2", fresh.tied ?? []),
    ...solved("b-1", "unsolved", "h1", [F, F]),
    ...solved("b-1", "unsolved", "h2", fresh.unsolved ?? []),
    ...solved("b-1", "aside", "h1", [P, F]),
    ...solved("b-1", "aside", "h2", fresh.aside ?? []),
    reported("b-1", "no-step", "h2", { ...terms, versions: ["won", "tied", "unsolved"], aside: ["aside"] }),
  ];
  const log = compared({ won: [P, F], tied: [F, P], unsolved: [F, F], aside: [P, P] });
  const heard = new Map<string, Outcome>([
    ["won", "reference-none"],
    ["tied", "reference-some"],
    ["unsolved", "reference-none"],
    // A rejection of an answer to it is not settled, so it was in no tally.
    ["aside", "disputed"],
  ]);

  it("is how the reference harness did on it, in every solve, some or none, or that it is disputed, whatever the other harness answered", () => {
    // The reference is the comparison's old side. A task no comparison has scored has no outcome.
    expect(poolOf(log).outcomes).toEqual(heard);
    // The hostile case of rule 3: two logs that differ only in what the new harness answered,
    // and so in which harness won each task, give the author the same outcomes.
    const flipped = compared({ won: [F, F], tied: [P, P], unsolved: [P, P], aside: [F, F] });
    expect(poolOf(flipped).outcomes).toEqual(heard);
  });

  it("is read from the last comparison that scored the task, whatever setting id its report carries", () => {
    const again = [
      ...log,
      ...solved("b-2", "tied", "h1", [F, F]),
      ...solved("b-2", "tied", "h3", [P, P]),
      ...solved("b-2", "aside", "h1", [P, P]),
      ...solved("b-2", "aside", "h3", [P, P]),
      reported("b-2", "no-step", "h3", { ...terms, fresh: "h3", versions: ["tied", "aside"] }),
    ];
    expect(poolOf(again).outcomes).toEqual(
      new Map([...heard, ["tied", "reference-none"], ["aside", "reference-every"]]),
    );
    // Until 2026-10-11 a task whose last report carried another setting id than the last report's
    // read `earlier-setting`. A campaign runs at one setting since, and the id names the host's
    // code too, which a tree moved to a new commit changes: a report under another id is read.
    const shorter = (task: string, harness: string): Condition => {
      const ran = condition(task, harness);
      return { ...ran, limits: { ...ran.limits, modelTurns: 3 } };
    };
    const shortened = [
      ...log,
      ...solvedUnder("b-2", shorter("tied", "h1"), [F, F]),
      ...solvedUnder("b-2", shorter("tied", "h2"), [P, P]),
      reported("b-2", "no-step", "h2", {
        ...terms,
        setting: settingId(shorter("any", "any")),
        versions: ["tied"],
      }),
    ];
    expect(poolOf(shortened).outcomes).toEqual(new Map([...heard, ["tied", "reference-none"]]));
  });

  it("reads the reference's counted solves alone: not its third, made to read it against itself, nor the starter's", () => {
    // The test's own four solves of the task were all rejected. The reference harness's third
    // solve, made to read it against itself, was valid, and on another task the starter's was:
    // neither is counted, and the author hears the reference valid in no solve of either.
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
    expect([...poolOf(beside).outcomes.values()]).toEqual(["reference-none", "reference-none"]);
  });

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
    const won = { cell: "other-won", solves: 2 } as const;
    expect(read(before)).toEqual({ outcome: "reference-none", standing: won, failed: ["kept"] });
    expect(read(after)).toEqual({
      outcome: "reference-every",
      standing: { cell: "reference-won", solves: 2 },
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

describe("where a task stands in the counts an Examiner hears", () => {
  const terms = { old: "h1", fresh: "h2", solves: 2, setting: SETTING };

  it("tells a tie both harnesses answered in every solve from one neither answered in any, and a task told apart by the side that won it", () => {
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
    // Four of the five are ties or losses to a tally; the two ties a plain count would merge are
    // apart, and the reference's side is the old one.
    expect(cells(log)).toEqual(
      new Map([
        ["every", "tied-every"],
        ["none", "tied-none"],
        ["other", "other-won"],
        ["ours", "reference-won"],
        ["mixed", "tied-mixed"],
        ["aside", "aside"],
      ]),
    );
    // Read from the record the outcome is read from: the same tasks, and the solves a side.
    const { standings, outcomes } = poolOf(log);
    expect(sorted(standings.keys())).toEqual(sorted(outcomes.keys()));
    expect(standings.get("every")).toEqual({ cell: "tied-every", solves: 2 });
    expect(standings.get("aside")).toEqual({ cell: "aside", solves: null });
  });

  it("counts a task the objective told apart between two valid answers as told apart, and the same answers without one as a tie", () => {
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
    expect(cells(measured({ direction: "lower", margin: 0.01 }))).toEqual(
      new Map([
        ["split", "other-won"],
        ["even", "tied-every"],
      ]),
    );
    expect(cells(measured(null))).toEqual(
      new Map([
        ["split", "tied-every"],
        ["even", "tied-every"],
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
  /** The tasks a release gives the Builder first because no solve answered them in two comparisons. */
  const unanswered = (log: readonly LogEvent[]) =>
    releaseOrder(log, ["hard", "easy"], 2, "seed").flatMap(([task, why]) =>
      why.includes("no solve answered it in two comparisons") ? [task] : [],
    );
  const start = [...heldOut("hard"), ...heldOut("easy")];
  const once = compared(start, "b-1", "h2", F);
  const twice = compared(once, "b-2", "h3", F);

  it("are the ones with no valid answer on record after two comparisons, and leave the scored set", () => {
    expect(awaiting(once)).toEqual([]);
    expect(poolOf(once).scorable).toEqual(["hard", "easy"]);
    expect(awaiting(twice)).toEqual(["hard"]);
    expect(poolOf(twice).scorable).toEqual(["easy"]);
    // A task no longer held out waits for nobody.
    expect(awaiting([...twice, event("task.state", { version: "hard", state: "released" })])).toEqual([]);
  });

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
    // It is the one fact an author hears beside an outcome that names no side: a tie nobody
    // answered is counted apart where a valid answer is known.
    expect(poolOf(twice).feasible).toEqual(new Set(["easy"]));
    expect(poolOf(proved).feasible).toEqual(new Set(["hard", "easy"]));
    expect(poolOf(twice).standings.get("hard")).toEqual({ cell: "tied-none", solves: 2 });
    expect(poolOf(proved).standings.get("hard")).toEqual({ cell: "tied-none-known", solves: 2 });
    const elsewhere = [...twice, ...solved(undefined, "hard", "h9", [P])];
    expect(poolOf(elsewhere).standings.get("hard")).toEqual({ cell: "tied-none-known", solves: 2 });
  });

  it("do not count a comparison that cut a solve of the task at a limit", () => {
    for (const kind of ["wall-ended", "turns-ended", "context-ended"]) {
      const cut = compared(compared(start, "b-1", "h2", kind), "b-2", "h3", kind);
      expect(awaiting(cut)).toEqual([]);
      // One comparison that cut none is one, and the second such sends the task to a person.
      expect(awaiting(compared(cut, "b-3", "h4", F))).toEqual([]);
      expect(awaiting(compared(compared(cut, "b-3", "h4", F), "b-4", "h5", F))).toEqual(["hard"]);
      // A cut comparison between the two takes nothing from the count.
      const between = compared(compared(compared(start, "b-1", "h2", F), "b-2", "h3", kind), "b-3", "h4", F);
      expect(awaiting(between)).toEqual(["hard"]);
    }
    // A solve that gave up without an answer, or whose answer was rejected, was not cut.
    expect(awaiting(compared(compared(start, "b-1", "h2", "no-answer"), "b-2", "h3", "no-answer"))).toEqual([
      "hard",
    ]);
  });

  it("wait until a person keeps the task, which counts its comparisons anew", () => {
    const kept = [...twice, event("task.state", { version: "hard", state: "held", reason: "feasible" })];
    expect(awaiting(kept)).toEqual([]);
    expect(awaiting(compared(kept, "b-3", "h4", F))).toEqual([]);
    expect(awaiting(compared(compared(kept, "b-3", "h4", F), "b-4", "h5", F))).toEqual(["hard"]);
    // A settling of an earlier comparison, made after the label, is no comparison after it.
    const settled = [
      ...kept,
      reported("b-2", "no-step", "h3", { ...terms, fresh: "h3", versions: ["hard", "easy"], settled: {} }),
    ];
    expect(awaiting(compared(settled, "b-3", "h4", F))).toEqual([]);
  });

  it("go to the Builder first at a release, cut at a limit or not, while they are held out and no solve answered them", () => {
    // t-5 (10 October): two tasks no solve answered in two comparisons, every solve of them cut
    // at 2 told turns, so no person was asked either; the draw released another task.
    expect(unanswered(once)).toEqual([]);
    expect(unanswered(twice)).toEqual(["hard"]);
    const cut = compared(compared(start, "b-1", "h2", "turns-ended"), "b-2", "h3", "turns-ended");
    expect(unanswered(cut)).toEqual(["hard"]);
    expect(awaiting(cut)).toEqual([]);
    // A valid answer anywhere settles it.
    expect(unanswered(compared(twice, "b-3", "h4", P))).toEqual([]);
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
    // Half of the failed, in the order they failed, then the draw over the answered tasks alone:
    // the kept half stays scored.
    const order = releaseOrder(log, tasks, 4, "seed");
    expect(taken(log, 4).slice(0, 2)).toEqual(["f1", "f2"]);
    expect(taken(log, 4).slice(2).toSorted()).toEqual(["a1", "a2"]);
    expect(order.map(([, why]) => why)).toEqual([
      ": the reference harness failed it in the last comparison, and it is",
      ": the reference harness failed it in the last comparison, and it is",
      ":",
      ":",
    ]);
    // Asked for more than the draw's pool holds, the release takes what there is and no kept task.
    expect(taken(log, 6).toSorted()).toEqual(["a1", "a2", "f1", "f2"]);
  });

  it("keeps the reference's failures through empty reports and comparisons of other harnesses, until the reference answers the task", () => {
    for (const reading of ["no-change", "not-scored", "check-defects"]) {
      for (const versions of [[], ["f1"]]) {
        const empty = [
          ...log,
          ...solved("empty", "f1", "h1", [P, P]),
          reported("empty", reading, "h2", { ...terms, versions, scored: null }),
        ];
        expect(releaseOrder(empty, tasks, 4, "seed")).toEqual(releaseOrder(log, tasks, 4, "seed"));
      }
    }
    const control = [
      ...solved("control", "a1", "h3", [F, F]),
      ...solved("control", "a1", "h4", [P, P]),
      reported("control", "no-step", "h4", { ...terms, old: "h3", fresh: "h4", versions: ["a1"] }),
    ];
    expect(failedOf([...log, ...control], tasks)).toEqual(["f1", "f2", "f3", "f4"]);
    expect(failedOf([...log, promotion, ...control], tasks)).toEqual([]);
    // A later comparison between other harnesses leaves a task nothing of the reference's own: no
    // failure, as its outcome says.
    const other = [
      ...log,
      ...solved("control", "f1", "h3", [F, F]),
      ...solved("control", "f1", "h4", [P, P]),
      reported("control", "no-step", "h4", { ...terms, old: "h3", fresh: "h4", versions: ["f1"] }),
    ];
    expect(poolOf(other).outcomes.get("f1")).toBe("earlier-reference");
    expect(failedOf(other, tasks)).toEqual(["f2", "f3", "f4"]);
    const answered = [
      ...log,
      ...solved("b-2", "f1", "h1", [P, P]),
      ...solved("b-2", "f1", "h2", [P, P]),
      reported("b-2", "no-step", "h2", { ...terms, versions: ["f1"] }),
    ];
    expect(failedOf(answered, tasks)).toEqual(["f2", "f3", "f4"]);
    expect(poolOf(answered).outcomes.get("f2")).toBe("reference-none");
  });

  it("takes no practice priority from a rejection set aside until its comparison is settled", () => {
    const pending = [
      ...log,
      ...solved("b-2", "f1", "h1", [F, F]),
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

  it("are the ones the reference answered in every solve of two comparisons, but for a third the contract's hash keeps as the retained set", () => {
    const once = compared(start, "b-1", "h2", SETTING);
    expect(poolOf(once).exhausted).toEqual([]);
    expect(poolOf(once).retained).toEqual([]);
    // All four: `open` too, which the new harness failed once and the reference never did, since
    // a changed harness can only tie or lose it. Until 10 October both sides had to answer a
    // task, and a simulated climb drew closed tasks into its set three comparisons running.
    const twice = compared(once, "b-2", "h3", SETTING);
    const { exhausted, retained, scorable, outcomes } = poolOf(twice);
    expect(sorted([...exhausted, ...retained])).toEqual(closed);
    expect(retained).toHaveLength(2);
    expect(scorable).toEqual(closed.filter((task) => retained.includes(task)));
    // The Examiner hears it as one outcome a task, and the kept ones keep theirs.
    expect(closed.filter((task) => outcomes.get(task) === "exhausted")).toEqual(
      closed.filter((task) => exhausted.includes(task)),
    );
    expect(retained.map((task) => outcomes.get(task))).toEqual(["reference-every", "reference-every"]);
    // A report under another setting id counts with the rest: the id names the host's code too,
    // and a campaign runs at one setting. Until 2026-10-11 the count started again there, and a
    // tree moved to a new commit drew every closed task again. A released task is no held-out one.
    expect(poolOf(compared(twice, "b-3", "h4", "other")).exhausted).toEqual(exhausted);
    const released = [...twice, event("task.state", { version: exhausted[0] ?? "", state: "released" })];
    expect(poolOf(released).exhausted).not.toContain(exhausted[0]);
  });

  it("spares a task the objective told two valid answers apart on: the next harness can still win it", () => {
    // The same two comparisons, under an objective: on `e1` the new harness's answers are the
    // better by more than the margin, on `e2` the two sides are even. Until 11 October both
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
    // `e2` alone qualifies; of one task the hash keeps one, so nothing is retired, and `e1` reads
    // as the reference's every-solve task that it is.
    expect(poolOf(log)).toMatchObject({ exhausted: [], retained: ["e2"], scorable: ["e1", "e2"] });
    expect(poolOf(log).outcomes.get("e1")).toBe("reference-every");
    expect(poolOf(measured(log, "b-3", "h4")).exhausted).toEqual([]);
  });

  it("hold each held-out task in exactly one place: scorable, waiting for a person, or exhausted, with the retained among the scorable", () => {
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
    expect(exhausted).toHaveLength(2);
    expect(sorted([...scorable, ...awaiting, ...exhausted])).toEqual(sorted(held));
    expect(scorable).toContain("new");
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

  it("holds a session still running to what it has billed so far", () => {
    const log = [event(BUILD_STARTED, { session: "b-1" }), ...paid("s-b", 6), ...paid("s-c", 2)];
    expect(billedFor(log, "b-1")).toBe(8);
  });

  it("counts a live Builder's turns before nested tools spend, and its final sum only once", () => {
    const log = [
      event(BUILD_STARTED, { session: "b-1" }),
      event("build.turn", { session: "b-1", usage: { cost: { total: 2 } } }),
      event("build.compacted", { session: "b-1", usages: [{ cost: { total: 1 } }] }),
      ...paid("nested", 4, "g-1"),
    ];
    expect(billedFor(log, "b-1")).toBe(7);
    expect(billedFor(log, "g-1")).toBe(4);
    expect(billedAll(log)).toBe(7);
    log.push(event("build.finished", { session: "b-1", billed: 3 }));
    expect(billedFor(log, "b-1")).toBe(7);
    expect(billedAll(log)).toBe(7);
  });

  it("remembers a live Builder's frozen checkpoint before its session finishes", () => {
    const log = [
      event("build.finished", { session: "b-0", harness: "before", changed: true, ended: "finished" }),
      event(BUILD_STARTED, { session: "b-1" }),
      event("build.checkpoint", { session: "b-1", harness: "current" }),
    ];
    expect(latestBuilt(log)).toBe("current");
    expect(latestBuilt([...log, event("build.finished", { session: "b-1", ended: "crashed" })])).toBe(
      "current",
    );
  });

  it("bills a session or a solve the run was killed in by its turns, and a finished one by its sum alone", () => {
    const turn = (kind: EventKind, id: JsonObject, total: number) =>
      event(kind, { ...id, usage: { input: 1, output: 1, cost: { total } } });
    // t-5 (10 October): b-1 killed at its seventh turn, three solves of g-1 cut with it.
    const log = [
      event(BUILD_STARTED, { session: "b-1" }),
      turn("build.turn", { session: "b-1" }, 0.07),
      turn("build.turn", { session: "b-1" }, 0.05),
      event("solve.started", { solve: "s-k", comparison: "g-1" }),
      turn("solve.turn", { solve: "s-k" }, 0.01),
      // Finished: the sum stands, and the turns are not counted again.
      event(BUILD_STARTED, { session: "b-2" }),
      turn("build.turn", { session: "b-2" }, 0.5),
      event("build.finished", { session: "b-2", billed: 0.5 }),
      ...paid("s-b", 6),
      turn("solve.turn", { solve: "s-b" }, 9),
      event("exam.started", { session: "x-1" }),
      turn("exam.turn", { session: "x-1" }, 0.2),
      // An Examiner's repair of its check program: one killed after a turn, one that summed its own.
      event("repair.started", { session: "r-1" }),
      turn("repair.turn", { session: "r-1" }, 0.3),
      event("repair.started", { session: "r-2" }),
      turn("repair.turn", { session: "r-2" }, 0.4),
      event("repair.finished", { session: "r-2", billed: 0.4 }),
    ];
    expect(billedAll(log)).toBeCloseTo(0.07 + 0.05 + 0.01 + 0.5 + 6 + 0.2 + 0.3 + 0.4, 10);
    expect(billedAll(log.filter(({ kind }) => !kind.endsWith(".turn")))).toBeCloseTo(6.5 + 0.4, 10);
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
