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
  billedAll,
  billedFor,
  comparedAs,
  exhausted,
  lastReports,
  latestBuilt,
  outcomesOf,
  pairsReported,
  promoted,
  referenceFailed,
  releaseOrder,
  stopRule as stopOf,
  unansweredTwice,
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
 *  false for a rejected one, and a fail's kind for a solve that ended so. */
function solved(
  comparison: string | undefined,
  task: string,
  harness: string,
  valid: readonly (boolean | string)[],
) {
  const ran = condition(task, harness);
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
  /** A campaign whose patience is the plan's three; the default is six (`PATIENCE`). */
  const three = event("campaign.opened", { budget: null, limit: null, ladder: [], sessions: 1, patience: 3 });
  const stopRule = (log: readonly LogEvent[]) => stopOf([three, ...log]);
  /** A Builder session that left `harness`, changed unless `more` says otherwise. */
  const session = (id: string, harness: string, more: JsonObject = {}) =>
    event("build.finished", { session: id, harness, changed: true, ended: "finished", ...more });
  /** The harnesses Builder sessions left, which is what makes a comparison of one a checkpoint. */
  const sessions = ["h2", "h3", "h4", "h5", "h6", "h7"].map((harness) => session(`s-${harness}`, harness));
  const flat = (id: string, fresh: string, more: JsonObject = {}) => reported(id, "no-step", fresh, more);

  it("stops after three harnesses in a row that showed no gain, counted from the last step", () => {
    expect(stopRule([])).toEqual({ checkpoints: 0, sinceStep: 0, stop: false });
    const two = [...sessions, flat("b-1", "h2"), flat("b-2", "h3")];
    expect(stopRule(two)).toEqual({ checkpoints: 2, sinceStep: 2, stop: false });
    expect(stopRule([...two, flat("b-3", "h4")])).toEqual({ checkpoints: 3, sinceStep: 3, stop: true });
    // A step starts the count again, and a result short of one for another reason counts.
    const after = [...two, reported("b-3", "step", "h4"), flat("b-4", "h5")];
    expect(stopRule(after)).toEqual({ checkpoints: 4, sinceStep: 1, stop: false });
    const lower = (id: string, fresh: string) => reported(id, "below-starter", fresh);
    expect(stopRule([...after, lower("b-5", "h6"), lower("b-6", "h7")])).toMatchObject({
      sinceStep: 3,
      stop: true,
    });
    // A reading under the trigger showed a gain: it bought the repeat, and reads `no-step` by
    // itself. Counted as no gain, a 2-0 at level 0.10 ended a campaign of patience 3 before its
    // repeat was bought (found by review, 11 October). The trigger is the opening's where it
    // names one, as a term, and 0.25 otherwise: a 1-0 clears neither.
    const bought = flat("b-3", "h4", { scored: { wins: 2, losses: 0, ties: 10 } });
    expect(stopRule([...two, bought])).toEqual({ checkpoints: 3, sinceStep: 0, stop: false });
    expect(stopRule([...two, flat("b-3", "h4", { scored: { wins: 1, losses: 0, ties: 11 } })])).toMatchObject(
      {
        stop: true,
      },
    );
    const strict = event("campaign.opened", { ...three.data, terms: { trigger: "0.1" } });
    expect(stopOf([strict, ...two, bought])).toMatchObject({ sinceStep: 3, stop: true });
  });

  // Fix row F48. On 9 October one harness was compared with the starter three times, each time on
  // more tasks, and the rule stopped the campaign: three repeats of one harness are one harness
  // that showed no gain.
  it("counts a harness once against one reference, however often the two are compared", () => {
    const thrice = [...sessions, flat("g-1", "h2"), flat("g-2", "h2"), flat("g-3", "h2")];
    expect(stopRule(thrice)).toEqual({ checkpoints: 1, sinceStep: 1, stop: false });
    // Against another reference it is another comparison.
    expect(stopRule([...thrice, flat("g-4", "h2", { old: "h3" })])).toMatchObject({ checkpoints: 2 });
    // The pair reads as its last comparison: a step its repeat does not read again was one draw,
    // and one the repeat reads is the step the count starts again from.
    const refuted = [...sessions, reported("b-1", "step", "h2"), flat("g-1", "h2")];
    expect(stopRule(refuted)).toEqual({ checkpoints: 1, sinceStep: 1, stop: false });
    const read = [...sessions, flat("b-1", "h2"), flat("b-2", "h3"), reported("g-1", "step", "h3")];
    expect(stopRule(read)).toEqual({ checkpoints: 2, sinceStep: 0, stop: false });
  });

  it("counts across the setting ids the reports carry: a campaign runs at one setting", () => {
    // Until 2026-10-11 whatever stood before the last comparison under another setting id was
    // cut. The id names the host's code too, so a tree moved to a new commit between two
    // comparisons began the count again (`docs/simplify.md`, A4).
    const earlier = [
      event("build.started", { session: "b-0" }),
      ...solved(undefined, "p1", "h2", [false]),
      session("b-0", "h2", { changed: false }),
      ...sessions,
      flat("b-1", "h2", { setting: "s1" }),
      flat("b-2", "h3", { setting: "s1" }),
    ];
    expect(stopRule(earlier)).toMatchObject({ checkpoints: 3, sinceStep: 3, stop: true });
    expect(stopRule([...earlier, flat("b-3", "h4", { setting: "s2" })])).toEqual({
      checkpoints: 4,
      sinceStep: 4,
      stop: true,
    });
    // A harness compared again is one harness, whatever id its two comparisons carry.
    expect(stopRule([...earlier, flat("b-3", "h3", { setting: "s2" })])).toMatchObject({ checkpoints: 3 });
  });

  it("counts no comparison that left no room, by the reference's share of valid solves and the new harness's", () => {
    // A report lists its tasks by how many of their two solves were valid: none, one, both.
    const full = { valid: { old: [0, 0, 4], fresh: [0, 0, 4] } };
    const hard = { valid: { old: [4, 0, 0], fresh: [3, 1, 0] } };
    expect(stopRule([...sessions, flat("b-1", "h2", full), flat("b-2", "h3", hard)])).toEqual({
      checkpoints: 0,
      sinceStep: 0,
      stop: false,
    });
    // Three solves in four is room still, and so is one harness valid on one solve in four.
    const most = { valid: { old: [0, 2, 2], fresh: [0, 0, 4] } };
    const some = { valid: { old: [4, 0, 0], fresh: [2, 2, 0] } };
    expect(stopRule([...sessions, flat("b-1", "h2", most), flat("b-2", "h3", some)])).toMatchObject({
      checkpoints: 2,
      sinceStep: 2,
    });
    // A step is a step wherever it was read.
    expect(stopRule([...sessions, reported("b-1", "step", "h2", hard)])).toEqual({
      checkpoints: 1,
      sinceStep: 0,
      stop: false,
    });
  });

  it("counts a session that left its harness as it was where a practice solve of its failed, in its place, and none that was killed or crashed", () => {
    // A session that was shown a failure and declined it: a practice solve of its own, a fail,
    // between its start and its end. One whose every practice solve passed had nothing to work on,
    // which is the supply's fault: all ten campaigns of 9 and 10 October stopped on three such.
    const idle = (id: string, shown: readonly boolean[], more: JsonObject = {}) => [
      event("build.started", { session: id }),
      ...solved(undefined, "p1", "h2", shown),
      session(id, "h2", { changed: false, ...more }),
    ];
    const log = [
      session("b-1", "h2"),
      flat("b-1", "h2"),
      ...idle("b-2", [false]),
      ...idle("b-3", [true, false]),
    ];
    expect(stopRule(log)).toEqual({ checkpoints: 3, sinceStep: 3, stop: true });
    const passing = [session("b-1", "h2"), flat("b-1", "h2"), ...idle("b-2", [true]), ...idle("b-3", [])];
    expect(stopRule(passing)).toEqual({ checkpoints: 1, sinceStep: 1, stop: false });
    expect(
      stopRule([
        ...idle("b-1", [false]),
        ...idle("b-2", [false], { ended: "killed" }),
        ...idle("b-3", [false], { ended: "crashed" }),
      ]),
    ).toEqual({ checkpoints: 1, sinceStep: 1, stop: false });
    // A step after them starts the count again.
    expect(stopRule([...log, session("b-4", "h3"), reported("b-4", "step", "h3")])).toMatchObject({
      sinceStep: 0,
      stop: false,
    });
  });

  it("counts no report that compared nothing: a round with nothing new, a stop on defects, a cap", () => {
    const idle = (id: string) => reported(id, "no-change", null, { scored: null });
    const stopped = (id: string) => reported(id, "check-defects", "h2", { scored: null });
    const capped = (id: string) => reported(id, "not-scored", "h2", { scored: null, capped: true });
    // Every task set aside until a person has labelled its rejections: a tally of no task.
    const waiting = reported("b-5", "not-scored", "h2", { versions: [], aside: ["v1"] });
    const log = [...sessions, idle("b-1"), idle("b-2"), stopped("b-3"), capped("b-4"), waiting];
    expect(stopRule(log)).toEqual({ checkpoints: 0, sinceStep: 0, stop: false });
    // A report a person settled is its checkpoint's one report, read as the labels left it.
    const settled = [...sessions, flat("b-1", "h2"), reported("b-1", "step", "h2")];
    expect(stopRule(settled)).toEqual({ checkpoints: 1, sinceStep: 0, stop: false });
  });

  it("keeps a comparison where it first reported, whenever a person settled it", () => {
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
    expect(stopRule(settled)).toEqual({ checkpoints: 3, sinceStep: 2, stop: false });
    // And a settling that takes the step away is read where the comparison stands, too.
    const undone = [...log, reported("b-1", "no-step", "h2", { settled: { labelled: 1 } })];
    expect(stopRule(undone)).toEqual({ checkpoints: 3, sinceStep: 3, stop: true });
  });

  it("counts no comparison of harnesses no Builder session changed", () => {
    // Two comparisons of harnesses the campaign began with, and then one round that read no step.
    const gates = [reported("g0", "no-step", "start"), reported("g2", "no-step", "start")];
    expect(stopRule(gates)).toEqual({ checkpoints: 0, sinceStep: 0, stop: false });
    const round = [...gates, ...sessions, flat("b-1", "h2")];
    expect(stopRule(round)).toEqual({ checkpoints: 1, sinceStep: 1, stop: false });
  });

  it("counts each pair of a harness and a reference once, the starter as a reference among them", () => {
    const versus = (id: string, old: string, reading: string) =>
      reported(id, reading, "h2", { old, starter: "base" });
    // While the starter is the reference, a comparison with it is the checkpoint.
    expect(stopRule([...sessions, versus("b-1", "base", "no-step")])).toMatchObject({ checkpoints: 1 });
    // A harness compared with another reference and then with the starter is two pairs. Until
    // 2026-10-11 the second was read as the first's reading against the starter
    // (`starter-unread`), which no comparison makes since.
    const both = [...sessions, versus("b-1", "h1", "no-step"), versus("g-1", "base", "no-step")];
    expect(stopRule(both)).toEqual({ checkpoints: 2, sinceStep: 2, stop: false });
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
        ["v1", "reference-none"],
        ["v2", "reference-some"],
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

  it("is how the reference harness did on it, in every solve, some or none, or that it is disputed", () => {
    // The reference is the comparison's old side; what the new harness answered is not heard.
    expect(outcomesOf(log)).toEqual(
      new Map([
        ["won", "reference-none"],
        ["tied", "reference-some"],
        ["unsolved", "reference-none"],
        // A rejection of an answer to it is not settled, so it was in no tally.
        ["aside", "disputed"],
      ]),
    );
    // A task no comparison has scored has no outcome.
    expect(outcomesOf(log).has("waiting")).toBe(false);
    // The hostile case of rule 3: two logs that differ only in what the new harness answered,
    // and so in which harness won each task, give the author the same outcomes.
    const flipped = [
      ...tasks.flatMap(heldOut),
      ...solved("b-1", "won", "h1", [F, F]),
      ...solved("b-1", "won", "h2", [F, F]),
      ...solved("b-1", "tied", "h1", [P, F]),
      ...solved("b-1", "tied", "h2", [P, P]),
      ...solved("b-1", "unsolved", "h1", [F, F]),
      ...solved("b-1", "unsolved", "h2", [P, P]),
      ...solved("b-1", "aside", "h1", [P, F]),
      ...solved("b-1", "aside", "h2", [F, F]),
      reported("b-1", "no-step", "h2", { ...terms, versions: ["won", "tied", "unsolved"], aside: ["aside"] }),
    ];
    expect(outcomesOf(flipped)).toEqual(outcomesOf(log));
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
        ["won", "reference-none"],
        ["tied", "reference-none"],
        ["unsolved", "reference-none"],
        ["aside", "reference-every"],
      ]),
    );
  });

  it("is each task's last report's, whatever setting id the report carries", () => {
    // Until 2026-10-11 a task whose last report carried another setting id than the last report's
    // read `earlier-setting`: t-10 on 10 October tied five tasks at 10 turns and read them "won"
    // at 3 without changing. A campaign runs at one setting since, and the id names the host's
    // code too, which a tree moved to a new commit changes: a report under another id is read.
    const shorter = (task: string, harness: string): Condition => {
      const ran = condition(task, harness);
      return { ...ran, limits: { ...ran.limits, modelTurns: 3 } };
    };
    const under = (task: string, harness: string, valid: readonly boolean[]) => {
      const ran = shorter(task, harness);
      return [
        event("condition.recorded", { id: conditionId(ran), condition: requireJsonValue(ran) }),
        ...valid.flatMap((each) => {
          solves += 1;
          const solve = `s-${String(solves)}`;
          return [
            event("solve.started", { solve, condition: conditionId(ran), comparison: "b-2" }),
            event("solve.finished", {
              solve,
              ending: each ? { outcome: "pass" } : { outcome: "fail", kind: "rejected" },
              billed: 2,
            }),
          ];
        }),
      ];
    };
    const shortened = [
      ...log,
      ...under("tied", "h1", [F, F]),
      ...under("tied", "h2", [P, P]),
      reported("b-2", "no-step", "h2", {
        ...terms,
        setting: settingId(shorter("any", "any")),
        versions: ["tied"],
      }),
    ];
    expect(outcomesOf(shortened)).toEqual(
      new Map([
        ["won", "reference-none"],
        ["tied", "reference-none"],
        ["unsolved", "reference-none"],
        ["aside", "disputed"],
      ]),
    );
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
    expect(answered(beside, "g-1")).toEqual(new Set(["again", "lower"]));
    expect([...outcomesOf(beside).values()]).toEqual(["reference-none", "reference-none"]);
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
  const start = [...heldOut("hard"), ...heldOut("easy")];
  const once = compared(start, "b-1", "h2", F);
  const twice = compared(once, "b-2", "h3", F);

  it("are the ones with no valid answer on record after two comparisons", () => {
    expect(awaitingLabel(once)).toEqual([]);
    expect(awaitingLabel(twice)).toEqual(["hard"]);
  });

  it("are never the ones some solve answered validly, in whatever comparison", () => {
    // A valid answer in the second comparison shows the task feasible, for every comparison after.
    const valid = compared(once, "b-2", "h3", P);
    expect(awaitingLabel(valid)).toEqual([]);
    expect(awaitingLabel(compared(compared(valid, "b-3", "h4", F), "b-4", "h5", F))).toEqual([]);
    // And so does one made before, as at a longer limit, or after the two that gave none.
    const before = compared(compared(compared(start, "b-0", "h0", P), "b-1", "h2", F), "b-2", "h3", F);
    expect(awaitingLabel(before)).toEqual([]);
    expect(awaitingLabel(compared(twice, "b-3", "h4", P))).toEqual([]);
    // And one no reported comparison counts, as a solve made for a comparison that never reported.
    expect(awaitingLabel([...twice, ...solved("g-9", "hard", "h9", [P])])).toEqual([]);
  });

  it("do not count a comparison that cut a solve of the task at a limit", () => {
    for (const kind of ["wall-ended", "turns-ended", "context-ended"]) {
      const cut = compared(compared(start, "b-1", "h2", kind), "b-2", "h3", kind);
      expect(awaitingLabel(cut)).toEqual([]);
      // One comparison that cut none is one, and the second such sends the task to a person.
      expect(awaitingLabel(compared(cut, "b-3", "h4", F))).toEqual([]);
      expect(awaitingLabel(compared(compared(cut, "b-3", "h4", F), "b-4", "h5", F))).toEqual(["hard"]);
      // A cut comparison between the two takes nothing from the count.
      const between = compared(compared(compared(start, "b-1", "h2", F), "b-2", "h3", kind), "b-3", "h4", F);
      expect(awaitingLabel(between)).toEqual(["hard"]);
    }
    // A solve that gave up without an answer, or whose answer was rejected, was not cut.
    expect(
      awaitingLabel(compared(compared(start, "b-1", "h2", "no-answer"), "b-2", "h3", "no-answer")),
    ).toEqual(["hard"]);
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

  it("are not the ones the host saw their author's try_answer pass: the proposal says so", () => {
    // The Examiner's `try_answer` passed an answer to the task before it proposed it (11 October):
    // the task has a valid answer on record though no solve found one, so it waits for nobody.
    const proposed = twice.map((each) =>
      each.kind === "task.proposed" && each.data.version === "hard"
        ? { ...each, data: { ...each.data, feasible: true } }
        : each,
    );
    expect(awaitingLabel(proposed)).toEqual([]);
    expect(awaitingLabel(compared(proposed, "b-3", "h4", F))).toEqual([]);
  });

  it("are not the ones the starter answered, though the test's two harnesses did not", () => {
    const lower = (log: readonly LogEvent[], session: string) => {
      const whole = compared(log, session, "h2", F);
      // The starter's solves are made before the comparison reports.
      return [...whole.slice(0, -1), ...solved(session, "hard", "base", [P, F]), ...whole.slice(-1)];
    };
    expect(awaitingLabel(lower(lower(start, "b-1"), "b-2"))).toEqual([]);
  });

  it("go to the Builder as well, cut at a limit or not, while they are held out and no solve answered them", () => {
    // t-5 (10 October): two tasks no solve answered in two comparisons, every solve of them cut
    // at 2 told turns, so no person was asked either; the draw released another task.
    expect(unansweredTwice(once)).toEqual([]);
    expect(unansweredTwice(twice)).toEqual(["hard"]);
    const cut = compared(compared(start, "b-1", "h2", "turns-ended"), "b-2", "h3", "turns-ended");
    expect(unansweredTwice(cut)).toEqual(["hard"]);
    expect(awaitingLabel(cut)).toEqual([]);
    // A valid answer anywhere settles it, and a released or refused task is no held-out one.
    expect(unansweredTwice(compared(twice, "b-3", "h4", P))).toEqual([]);
    expect(unansweredTwice([...twice, event("task.state", { version: "hard", state: "released" })])).toEqual(
      [],
    );
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
  const failed = referenceFailed(log);

  it("takes half of the tasks the reference failed, and the draw cannot release the other half", () => {
    expect(failed.toSorted()).toEqual(["f1", "f2", "f3", "f4"]);
    // Half of the failed, then the draw over the answered tasks alone: the kept half stays scored.
    const taken = releaseOrder(log, tasks, 4, "seed");
    const versions = taken.map(([version]) => version);
    expect(versions.slice(0, 2).every((version) => failed.includes(version))).toBe(true);
    expect(versions.slice(2).toSorted()).toEqual(["a1", "a2"]);
    expect(taken.slice(0, 2).every(([, why]) => why.includes("the reference harness failed it"))).toBe(true);
    // Asked for more than the draw's pool holds, the release takes what there is and no kept task.
    expect(
      releaseOrder(log, tasks, 6, "seed")
        .map(([version]) => version)
        .toSorted(),
    ).toEqual(["a1", "a2", ...versions.slice(0, 2).toSorted()]);
  });
});

describe("the tasks the reference harness exhausted", () => {
  const terms = { old: "h1", solves: 2 };
  const read = event("checker.read", { contract: "c", checks: "k", faults: [] });
  /** One comparison of the three tasks under `setting`: `e1` to `e3` answered by both sides in
   *  every solve, `open` by the reference only. */
  const compared = (log: readonly LogEvent[], session: string, fresh: string, setting: string) => [
    ...log,
    ...["e1", "e2", "e3"].flatMap((task) => [
      ...solved(session, task, "h1", [P, P]),
      ...solved(session, task, fresh, [P, P]),
    ]),
    ...solved(session, "open", "h1", [P, P]),
    ...solved(session, "open", fresh, [F, P]),
    reported(session, "no-step", fresh, { ...terms, fresh, setting, versions: ["e1", "e2", "e3", "open"] }),
  ];
  const start = [read, ...["e1", "e2", "e3", "open"].flatMap(heldOut)];

  it("are the ones the reference answered in every solve of two comparisons, but for a third kept by the contract's hash", () => {
    const once = compared(start, "b-1", "h2", SETTING);
    expect(exhausted(once)).toEqual([]);
    // All four: `open` too, which the new harness failed once and the reference never did, since
    // a changed harness can only tie or lose it. Until 10 October both sides had to answer a
    // task, and a simulated climb drew closed tasks into its set three comparisons running.
    const twice = compared(once, "b-2", "h3", SETTING);
    const spent = exhausted(twice);
    expect(spent).toHaveLength(2);
    expect(spent.every((task) => ["e1", "e2", "e3", "open"].includes(task))).toBe(true);
    // The Examiner hears it as one outcome a task, and the kept ones keep theirs.
    const heard = outcomesOf(twice);
    expect([...heard.values()].filter((outcome) => outcome === "exhausted")).toHaveLength(2);
    expect(heard.get("open") === "reference-every" || heard.get("open") === "exhausted").toBe(true);
    // A report under another setting id counts with the rest: the id names the host's code too,
    // and a campaign runs at one setting. Until 2026-10-11 the count started again there, and a
    // tree moved to a new commit drew every closed task again. A released task is no held-out one.
    expect(exhausted(compared(twice, "b-3", "h4", "other"))).toEqual(spent);
    const released = [...twice, event("task.state", { version: spent[0] ?? "", state: "released" })];
    expect(exhausted(released)).not.toContain(spent[0]);
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

  it("bills a session or a solve the run was killed in by its turns, and a finished one by its sum alone", () => {
    const turn = (kind: EventKind, id: JsonObject, total: number) =>
      event(kind, { ...id, usage: { input: 1, output: 1, cost: { total } } });
    // t-5 (10 October): b-1 killed at its seventh turn, three solves of g-1 cut with it.
    const log = [
      event("build.started", { session: "b-1" }),
      turn("build.turn", { session: "b-1" }, 0.07),
      turn("build.turn", { session: "b-1" }, 0.05),
      event("solve.started", { solve: "s-k", comparison: "g-1" }),
      turn("solve.turn", { solve: "s-k" }, 0.01),
      // Finished: the sum stands, and the turns are not counted again.
      event("build.started", { session: "b-2" }),
      turn("build.turn", { session: "b-2" }, 0.5),
      event("build.finished", { session: "b-2", billed: 0.5 }),
      ...paid("s-b", 6),
      turn("solve.turn", { solve: "s-b" }, 9),
      event("exam.started", { session: "x-1" }),
      turn("exam.turn", { session: "x-1" }, 0.2),
    ];
    expect(billedAll(log)).toBeCloseTo(0.07 + 0.05 + 0.01 + 0.5 + 6 + 0.2, 10);
    expect(
      billedAll(
        log.filter(({ kind }) => kind !== "build.turn" && kind !== "exam.turn" && kind !== "solve.turn"),
      ),
    ).toBe(6.5);
  });
});
