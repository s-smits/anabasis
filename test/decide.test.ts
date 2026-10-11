// Move 7 of a campaign over hand-built logs: each row of the plan's decision table, and the order
// the rows are asked in (`src/builder/decide.ts`), and what a campaign runs by (`opening.ts`).

import { describe, expect, it } from "bun:test";
import { decide, unpromoted } from "../src/builder/decide.ts";
import type { Decided } from "../src/builder/move.ts";
import type { Plan } from "../src/builder/ground.ts";
import { openingOf, planOf } from "../src/builder/opening.ts";
import { pendingWords } from "../src/builder/word.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";

/** Tasks by how many of their two solves were valid: none, one, both. */
type Valid = readonly [number, number, number];

const at = "2026-10-09T00:00:00.000Z";
const HELD = ["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8", "v9", "v10", "v11", "v12"];
const HALF: Valid = [4, 4, 4];
const ALL: Valid = [0, 0, 12];
const NONE: Valid = [12, 0, 0];
const PLAN: Plan = {
  sessions: 1,
  // The plan's three, which these rows were written against; the default is six (`PATIENCE`).
  patience: 3,
  unprepared: false,
  wanted: { target: 12, level: 0.1, trigger: 0.25 },
};
const event = (kind: EventKind, data: JsonObject): LogEvent => ({ at, kind, data });
const heldOut = (version: string) => [
  event("task.proposed", { version, taskId: version }),
  event("task.gate", { version, gate: 1, outcome: "passed" }),
];
const READ = event("checker.read", { contract: "c", checks: "k", faults: [] });
/** A campaign set up: its checker read with no fault, six tasks held out and one released. */
const SET_UP = [
  READ,
  ...HELD.flatMap(heldOut),
  ...heldOut("p1"),
  event("task.state", { version: "p1", state: "released" }),
];
/** A Builder session that left `harness`, changed unless `more` says otherwise. */
const built = (id: string, harness: string, more: JsonObject = {}) =>
  event("build.finished", { session: id, harness, changed: true, ended: "finished", ...more });
const setting = (modelTurns: number | null) =>
  event("campaign.setting", { solver: null, minutes: 120, turns: 24, modelTurns, tasks: null, target: 12 });
/** A comparison of `fresh` with the reference `old`, begun and reported as `more` says. */
function compared(
  id: string,
  fresh: string,
  reading: string,
  more: {
    readonly old?: string;
    readonly tally?: readonly [number, number, number];
    readonly valid?: { readonly old: Valid; readonly fresh: Valid };
    readonly noise?: boolean;
    readonly extra?: JsonObject;
  } = {},
): LogEvent[] {
  const sides = { old: more.old ?? "start", fresh, starter: "start" };
  // The tally decides since 10 October, not the word: a step's default tally clears the trigger
  // alone and the level with its repeat (`readTwice`), and any other reading's clears neither.
  const [wins, losses, ties] = more.tally ?? (reading === "step" ? [5, 0, 7] : [4, 4, 4]);
  return [
    event("comparison.started", { session: id, ...sides, noise: more.noise ?? false }),
    event("comparison.reported", {
      session: id,
      ...sides,
      reading,
      scored: { wins, losses, ties },
      versions: HELD,
      valid: { old: [...(more.valid?.old ?? HALF)], fresh: [...(more.valid?.fresh ?? HALF)] },
      setting: null,
      ...more.extra,
    }),
  ];
}
const move = (events: readonly LogEvent[], plan: Plan = PLAN): Decided => decide(events, plan);

describe("the exam and the tasks, before anything is built", () => {
  it("reads a checker nobody has read, and ends on one whose faults nobody froze", () => {
    expect(move([])).toMatchObject({ move: "accept" });
    const faulty = event("checker.read", { contract: "c", checks: "k", faults: ["check-a: authored"] });
    expect(move([faulty, ...HELD.flatMap(heldOut)])).toMatchObject({ move: "end", ending: "exam" });
    // The operator's freeze of that reading lets the campaign go on.
    const frozen = event("contract.frozen", { contract: "c", checks: "k", admitted: ["check-a"] });
    expect(move([faulty, frozen, ...SET_UP.slice(1)])).toMatchObject({ move: "build" });
  });

  it("drafts the exam of a campaign that opened from a prompt, and ends where three drafts did not stand", () => {
    const plan = { ...PLAN, prompted: true };
    expect(move([], plan)).toEqual({
      move: "draft",
      why: "the campaign opened from a prompt and holds no exam: the Examiner drafts its rules, its checks and its first tasks",
    });
    const fell = (tries: number) => event("draft.finished", { session: "d-1", stands: false, tries });
    expect(move([fell(2)], plan)).toEqual({
      move: "draft",
      why: "2 drafts did not stand at the host's reading, and 1 more may be put",
    });
    expect(move([fell(2), fell(1)], plan)).toEqual({
      move: "end",
      ending: "exam",
      why: "the exam was not accepted: 3 drafts in 2 sessions did not stand at the host's reading",
    });
    // Three sessions that put no draft end it too: on the exam where one was read, and as the
    // environment's where every session crashed before a draft, with what the crash said.
    expect(move([fell(0), fell(0), fell(0)], plan)).toMatchObject({ move: "end", ending: "exam" });
    const crashed = event("draft.finished", {
      session: "d-1",
      stands: false,
      tries: 0,
      ended: "crashed",
      crash: "exited 1",
    });
    expect(move([crashed, crashed, crashed], plan)).toEqual({
      move: "end",
      ending: "environment",
      why: "no draft was put: the Examiner's session crashed 3 times (exited 1)",
    });
    expect(move([crashed, fell(1), crashed], plan)).toMatchObject({ move: "end", ending: "exam" });
    expect(move([crashed, crashed], plan)).toMatchObject({ move: "draft" });
    // A draft that stood is the exam, and it is read like any other.
    const stood = event("exam.drafted", { session: "d-1", draft: { domain: "a field" } });
    expect(move([fell(1), stood], plan)).toMatchObject({ move: "accept" });
    // A campaign over a stored pack drafts nothing.
    expect(move([])).toMatchObject({ move: "accept" });
  });

  it("reads the exam again where the operator admits a check its last reading did not hold admitted", () => {
    const reading = (admitted: readonly string[], faults: readonly string[]) =>
      event("checker.read", { contract: "c", checks: "k", faults: [...faults], admitted: [...admitted] });
    const unadmitted = [
      reading([], ["check-a stands on the operator's word alone"]),
      ...HELD.flatMap(heldOut),
    ];
    expect(move(unadmitted)).toMatchObject({ move: "end", ending: "exam" });
    expect(move(unadmitted, { ...PLAN, admits: ["check-a"] })).toEqual({
      move: "accept",
      why: "the operator admits check-a: the exam is read again",
    });
    // Read with it admitted and a fault left, the exam is not accepted, and is not read a third time.
    const left = [reading(["check-a"], ["check-b has refused nothing"]), ...HELD.flatMap(heldOut)];
    expect(move(left, { ...PLAN, admits: ["check-a"] })).toMatchObject({ move: "end", ending: "exam" });
  });

  it("takes a pack's tasks in, has some written where there are none, and releases practice", () => {
    expect(move([READ], { ...PLAN, unprepared: true })).toMatchObject({ move: "prepare" });
    expect(move([READ])).toEqual({ move: "examine", room: false, why: "the campaign holds no task" });
    expect(move([READ, ...HELD.flatMap(heldOut)])).toMatchObject({
      move: "prepare",
      why: "no task is released for practice: the contract's draw releases some",
    });
  });
});

describe("a word the operator left", () => {
  const word = (data: JsonObject) => event("campaign.word", data);
  const ready = [...SET_UP, built("b-1", "h1")];

  it("ends the campaign on a stop, once: the event that acts on a word names it", () => {
    const stopped = [...ready, word({ word: "stop", why: "the host is needed" })];
    expect(move(stopped)).toEqual({
      move: "end",
      ending: "operator",
      why: "the operator's word: the host is needed",
      answers: [ready.length],
    });
    // Named by the ending it caused, the word is heard, and the campaign goes on when run again.
    const ended = event("campaign.ended", { ending: "operator", answers: [ready.length] });
    expect(move([...stopped, ended])).toMatchObject({ move: "compare" });
    expect(pendingWords([...stopped, ended])).toEqual([]);
    // A stop is read before anything else, whatever the log holds: here, no exam at all.
    expect(move([word({ word: "stop" })])).toMatchObject({ ending: "operator", why: "the operator's word" });
  });

  it("has other tasks written before anything is built or compared, once the exam stands", () => {
    const asked = [...ready, word({ word: "tasks", why: "three batches tied" })];
    expect(move(asked)).toEqual({
      move: "examine",
      room: true,
      why: "the operator asked for other tasks: three batches tied",
      answers: [ready.length],
    });
    // Before the exam was read, the exam comes first, and the word waits.
    expect(move([word({ word: "tasks" })])).toMatchObject({ move: "accept" });
    // A word for another total is the command's to act on, and changes no move.
    expect(move([...ready, word({ word: "budget", dollars: 50 })])).toMatchObject({ move: "compare" });
    expect(pendingWords([...ready, word({ word: "budget", dollars: 50 })])).toMatchObject([
      { at: ready.length, word: "budget", dollars: 50 },
    ]);
  });
});

describe("what is built and what is compared", () => {
  it("builds while no session has left a harness that is not the reference", () => {
    expect(move(SET_UP)).toMatchObject({ move: "build" });
    // A session that left the harness as it was, having practised on nothing, leaves nothing to
    // compare and had nothing to work on: the tasks change before another session is paid for.
    expect(move([...SET_UP, built("b-1", "start", { changed: false })])).toMatchObject({
      move: "examine",
      room: true,
      why: "Builder session b-1 left its harness as it was, and no practice solve of its failed: it had nothing to work on, so the tasks have to change before another session is paid for",
    });
  });

  it("compares the first harness after one session, the two harnesses alone", () => {
    // The reference against itself is the operator's `--noise` on a checkpoint since
    // 2026-10-11, and no move of the table: the table read only whether one was made, never what
    // it read, and it cost half as many solves again beside every first comparison.
    const first = move([...SET_UP, built("b-1", "h1")]);
    expect(first).toMatchObject({ move: "compare", fresh: "latest", reference: "promoted" });
    expect(first).not.toHaveProperty("noise");
  });

  it("has tasks written before a comparison where the campaign holds fewer than it scores", () => {
    // Six held of the twelve a comparison scores: the two campaigns on the operator's host (9 and
    // 10 October) compared on 6 where the setting asked for 12, and came one win short three times.
    const six = [
      READ,
      ...HELD.slice(0, 6).flatMap(heldOut),
      ...heldOut("p1"),
      event("task.state", { version: "p1", state: "released" }),
    ];
    expect(move([...six, built("b-1", "h1")])).toEqual({
      move: "examine",
      room: false,
      why: "the campaign holds 6 of the 12 tasks a comparison scores, and harness h1 has not been compared under the campaign's setting: the Examiner writes more first",
    });
    // Three sessions in a row that hold out none end the campaign on its exam.
    const idle = ["x-1", "x-2", "x-3"].map((id) =>
      event("exam.finished", { session: id, held: [], refused: [], proposed: 0 }),
    );
    expect(move([...six, built("b-1", "h1"), ...idle])).toMatchObject({ move: "end", ending: "exam" });
    // Held out to the count, the comparison is made.
    expect(move([...six, built("b-1", "h1"), ...HELD.slice(6).flatMap(heldOut)])).toMatchObject({
      move: "compare",
    });
  });

  it("lets a comparison that began go on under its id, before anything else", () => {
    const begun = event("comparison.started", { session: "g-1", old: "start", fresh: "h1", noise: true });
    expect(move([...SET_UP, built("b-1", "h1"), begun, built("b-2", "h2")])).toEqual({
      move: "compare",
      id: "g-1",
      fresh: "h1",
      reference: "start",
      why: "comparison g-1 began and has not reported: it goes on from its log",
    });
  });

  it("runs the plan's sessions before the next comparison, and one before the first", () => {
    const after = [...SET_UP, built("b-1", "h1"), ...compared("g-1", "h1", "no-step")];
    const three = { ...PLAN, sessions: 3 };
    expect(move([...after, built("b-2", "h2")], three)).toEqual({
      move: "build",
      why: "1 of 3 Builder sessions before the next comparison have run",
    });
    const ready = [...after, built("b-2", "h2"), built("b-3", "h3"), built("b-4", "h4")];
    expect(move(ready, three)).toMatchObject({ move: "compare", fresh: "latest" });
  });

  it("writes tasks where the next comparison would be short of them", () => {
    // A campaign that holds four tasks, three of them closed by the reference, valid in every
    // solve: one to win, where a first reading takes two, and the reference at three solves in
    // four leaves room. At twelve tasks the two cannot both hold since 10 October's trigger: one
    // task to untie means eleven closed, which is no room, and the no-room row answers.
    const four = { versions: HELD.slice(0, 4) };
    const small = { ...PLAN, wanted: { ...PLAN.wanted, target: 4 } };
    const tied = [
      READ,
      ...HELD.slice(0, 4).flatMap(heldOut),
      ...heldOut("p1"),
      event("task.state", { version: "p1", state: "released" }),
      built("b-1", "h1"),
      ...compared("g-1", "h1", "no-step", {
        tally: [1, 0, 3],
        valid: { old: [1, 0, 3], fresh: [1, 0, 3] },
        extra: four,
      }),
    ];
    expect(move([...tied, built("b-2", "h2")], small)).toEqual({
      move: "examine",
      room: false,
      why: "the last comparison left too few tasks for the next to untie",
    });
    // Before another session as much as after one: a comparison with room that left too few tasks
    // to untie is answered with tasks, where t-2 (10 October) got two unchanged sessions and a stop.
    expect(move(tied, small)).toEqual({
      move: "examine",
      room: false,
      why: "comparison g-1 read no step with room to gain and left too few tasks for the next to untie: harness h1 can only tie again on the tasks the reference harness answered in every solve",
    });
    // Enough to untie, and the Builder builds again. A 4-3 clears no trigger; a 6-2 (p 0.14)
    // would buy the repeat.
    const untied = [...SET_UP, built("b-1", "h1"), ...compared("g-1", "h1", "no-step", { tally: [4, 3, 5] })];
    expect(move(untied)).toMatchObject({ move: "build" });
    expect(
      move([...SET_UP, built("b-1", "h1"), ...compared("g-1", "h1", "no-step", { tally: [6, 2, 4] })]),
    ).toMatchObject({ move: "compare" });
    // Tasks held out since count whole, and the comparison is admitted.
    const more = ["v13", "v14", "v15", "v16"].flatMap(heldOut);
    expect(move([...tied, built("b-2", "h2"), ...more], small)).toMatchObject({ move: "compare" });
    // Before any session too: t-3 (10 October) built twice on the tasks its Examiner had just
    // written, changed nothing, and stopped before comparing on them.
    expect(move([...tied, ...more], small)).toEqual({
      move: "compare",
      fresh: "latest",
      reference: "promoted",
      why: "comparison g-1 read no step with room to gain, and tasks were written since: harness h1 is compared on them",
    });
  });
});

describe("practice, before a Builder session", () => {
  const plan = { ...PLAN, practice: 3 };
  const lost = compared("g-1", "h1", "no-step", { tally: [2, 6, 4] });

  it("is brought towards the count the campaign names once tasks were held out since the last release", () => {
    // One task is released of the three the campaign names, and nothing was held out since: a
    // release takes half of what is held once, and the Builder builds.
    expect(move(SET_UP, plan)).toMatchObject({ move: "build" });
    expect(move([...SET_UP, ...heldOut("v13")], plan)).toEqual({
      move: "prepare",
      why: "1 of the 3 practice tasks the campaign names are released, and tasks were held out since the last release: the contract's draw releases more before the Builder builds",
    });
    // The same before a later session, after a comparison that read no step with room. A task
    // held out since the comparison is compared on first (below, "what is built").
    const later = [...SET_UP, built("b-1", "h1"), ...heldOut("v13"), ...lost];
    expect(move(later, plan)).toMatchObject({ move: "prepare" });
    // Once it released, the campaign builds: nothing was held out since.
    const released = event("task.state", { version: "v13", state: "released" });
    expect(move([...later, released], plan)).toMatchObject({ move: "build" });
  });

  it("is left as it is where the count is reached, no count is held, or the setting names the tasks to score", () => {
    const more = [...SET_UP, ...heldOut("v13")];
    expect(move(more, { ...PLAN, practice: 1 })).toMatchObject({ move: "build" });
    expect(move(more)).toMatchObject({ move: "build" });
    // Six of the seven held-out tasks are named to score, and half of the one that is left is none.
    const named = event("campaign.setting", {
      solver: null,
      minutes: 120,
      turns: 24,
      modelTurns: null,
      tasks: HELD,
      target: 6,
    });
    expect(move([named, ...more], plan)).toMatchObject({ move: "build" });
    // A comparison is no Builder session: the release waits for one.
    expect(move([...more, built("b-1", "h1")], plan)).toMatchObject({ move: "compare" });
  });
});

describe("a step", () => {
  const stepped = [...SET_UP, built("b-1", "h1"), ...compared("g-1", "h1", "step", { tally: [8, 0, 4] })];

  it("is one draw when read once: the same two are compared again", () => {
    expect(move(stepped)).toEqual({
      move: "compare",
      fresh: "latest",
      reference: "promoted",
      why: "comparison g-1 cleared the trigger, which is one draw: the same two harnesses are compared again on fresh solves, and the two are read together",
    });
    // A comparison the operator asked for with the reference against itself changes no move.
    const noised = [
      ...SET_UP,
      built("b-1", "h1"),
      ...compared("g-1", "h1", "step", { tally: [8, 0, 4], noise: true }),
    ];
    expect(move(noised)).toEqual(move(stepped));
  });

  it("is promoted when read again", () => {
    const again = [...stepped, ...compared("g-2", "h1", "step", { tally: [10, 0, 2] })];
    expect(move(again)).toEqual({
      move: "promote",
      harness: "h1",
      why: "harness h1 read a step and its repeat",
    });
    // A repeat whose tally, summed with the step's, does not clear the level leaves the pair no
    // step: 8-0 and 1-4 are 9-4 (p 0.13), and with room the Builder builds again. The word of the
    // repeat decides nothing: 8-0 and a 4-4 repeat are 12-4 (p 0.01), a promotion.
    const refuted = [...stepped, ...compared("g-2", "h1", "no-step", { tally: [1, 4, 7] })];
    expect(move(refuted)).toMatchObject({ move: "build" });
    expect(move([...stepped, ...compared("g-2", "h1", "no-step", { tally: [4, 4, 4] })])).toMatchObject({
      move: "promote",
    });
    // A repeat that tied every task, or lost more than it won, is no repeat: summed alone an 8-0
    // and a 0-0-12 promoted on one draw (found by review, 11 October).
    expect(move([...stepped, ...compared("g-2", "h1", "no-step", { tally: [0, 0, 12] })])).not.toMatchObject({
      move: "promote",
    });
    expect(move([...stepped, ...compared("g-2", "h1", "no-step", { tally: [3, 4, 5] })])).not.toMatchObject({
      move: "promote",
    });
  });

  it("is named for promotion though later sessions left another harness, and one read once is not", () => {
    // A campaign of 9 October: two steps against the starter, then sessions and comparisons went
    // on by hand against that harness, which nobody had promoted.
    const later = [built("b-2", "h2"), ...compared("b-2", "h2", "no-step", { old: "h1", tally: [4, 4, 4] })];
    const twice = [...stepped, ...compared("g1", "h1", "step", { tally: [4, 0, 3] }), ...later];
    expect(move(twice)).toEqual({
      move: "promote",
      harness: "h1",
      why: "harness h1 read a step and its repeat, and was not promoted: what later sessions left is read against it once it is the reference",
    });
    // Promoted, the comparison made against it is the campaign's, and the table reads it.
    const promoted = event("harness.promoted", { harness: "h1" });
    expect(move([...twice, promoted])).toEqual({
      move: "build",
      why: "comparison b-2 read no step with room to gain: harness h2 did not help",
    });
    // A comparison made against it by name before the promotion has read the tasks: where it
    // answered nearly everything, the tasks change.
    const named = compared("b-3", "h2", "no-step", {
      old: "h1",
      tally: [0, 0, 12],
      valid: { old: ALL, fresh: ALL },
    });
    expect(move([...twice, ...named, promoted])).toEqual({
      move: "examine",
      room: true,
      why: "comparison b-3 read no step, and the reference harness was valid on more than three solves in four: the tasks have to change",
    });
    // One step is one draw, whatever came after it.
    expect(move([...stepped, ...later])).toMatchObject({ move: "build" });
  });
});

describe("after a promotion", () => {
  /** h1 stepped twice and was promoted. */
  const promotedOn = (fresh: Valid) => [
    setting(40),
    ...SET_UP,
    built("b-1", "h1"),
    ...compared("g-1", "h1", "step", { tally: [8, 0, 4] }),
    ...compared("g-2", "h1", "step", { tally: [8, 0, 4], valid: { old: HALF, fresh } }),
    event("harness.promoted", { harness: "h1" }),
  ];

  it("has the tasks changed, once", () => {
    // Until 10 October the budget rule came first here: a harness valid on at most half at some
    // rung sent the campaign down a ladder of budgets, and t-10 climbed in turns instead of tasks.
    const log = promotedOn(ALL);
    expect(move(log)).toEqual({
      move: "examine",
      room: true,
      why: "harness h1 was promoted: the tasks have to change, to ones it fails",
    });
    const written = event("exam.finished", { session: "x-1", held: ["v13"], refused: [], proposed: 1 });
    // The tasks written are read by a control before a Builder session is paid for: the starter
    // against the promoted harness. t-4, t-9 and t-10 (10 October) built three times here instead.
    expect(move([...log, written, ...heldOut("v13")])).toEqual({
      move: "compare",
      fresh: "starter",
      reference: "promoted",
      why: "harness h1 is the reference, and 1 task was held out since the last comparison: the starter is compared with it on them, to read whether they leave it room before a Builder session is paid for",
    });
  });

  it("reads the control, and builds where the tasks leave the promoted harness room, on practice brought up from them", () => {
    const log = promotedOn(ALL);
    const written = event("exam.finished", { session: "x-1", held: ["v13"], refused: [], proposed: 1 });
    const control = (
      reading: string,
      valid: { old: Valid; fresh: Valid },
      tally: [number, number, number],
    ) => [
      ...log,
      written,
      ...heldOut("v13"),
      ...compared("g-3", "start", reading, { old: "h1", tally, valid, noise: true }),
    ];
    // The promoted harness, on the old side, valid on half: room. Practice is brought up by as
    // many again, the tasks it failed first, and then the Builder builds.
    const room = control("no-step", { old: HALF, fresh: HALF }, [2, 2, 8]);
    expect(move(room, { ...PLAN, practice: 3 })).toMatchObject({
      move: "prepare",
      practice: 4,
      why: "comparison g-3 read room in the tasks held out since the last release: the ones the reference harness failed are released first, up to 3 more practice tasks, before the Builder builds",
    });
    expect(move(room)).toEqual({
      move: "build",
      why: "comparison g-3 read the starter against harness h1 on the tasks held out since, and they leave it room: the Builder builds",
    });
    // The starter winning on the new tasks is room by another name, and no step to repeat.
    expect(move(control("step", { old: [8, 2, 2], fresh: HALF }, [6, 0, 6]))).toMatchObject({
      move: "build",
    });
    // Valid on every solve: no room, so the tasks have to change again.
    expect(move(control("no-step", { old: ALL, fresh: HALF }, [0, 0, 12]))).toMatchObject({
      move: "examine",
      room: true,
    });
    // With no tasks held out since and no control, the Builder builds as before.
    expect(move([...log, written])).toMatchObject({ move: "build" });
  });
});

describe("no step", () => {
  const first = [...SET_UP, built("b-1", "h1")];

  it("builds again where the comparison left room", () => {
    expect(move([...first, ...compared("g-1", "h1", "no-step")])).toEqual({
      move: "build",
      why: "comparison g-1 read no step with room to gain: harness h1 did not help",
    });
    expect(move([...first, ...compared("g-1", "h1", "below-starter")])).toMatchObject({ move: "build" });
  });

  it("has the tasks changed where the reference left no room, and ends once the Examiner's patience is spent", () => {
    const full = { old: ALL, fresh: ALL };
    const tied = [
      setting(40),
      ...first,
      ...compared("g-1", "h1", "no-step", { tally: [0, 0, 12], valid: full }),
    ];
    // Valid on every solve: the tasks change. Until 10 October a shorter budget came first, and
    // t-10 climbed in turns where it should have climbed in tasks; until 11 October a shorter
    // budget was the fallback once the Examiner's patience was spent.
    expect(move(tied)).toEqual({
      move: "examine",
      room: true,
      why: "comparison g-1 read no step, and the reference harness was valid on more than three solves in four: the tasks have to change",
    });
    // The tasks no solve answered are counted as the reference's failures, and are room: recode's
    // g-1 (10 October) read three in four with two tasks unanswered left out, where the row read
    // 7 of 12, and a simulated climb read "no room" four times on tasks written for room.
    const unanswered = [
      setting(40),
      ...first,
      ...compared("g-1", "h1", "no-step", {
        tally: [0, 0, 12],
        valid: { old: [4, 0, 8], fresh: [4, 0, 8] },
        extra: { scored: { wins: 0, losses: 0, ties: 12, unsolved: 4 } },
      }),
    ];
    expect(move(unanswered)).toMatchObject({
      move: "build",
      why: "comparison g-1 read no step with room to gain: harness h1 did not help",
    });
    // Once as many Examiner sessions as the campaign's patience held out nothing, the campaign
    // ends on its room.
    const idle = ["x-1", "x-2", "x-3"].map((id) =>
      event("exam.finished", { session: id, held: [], refused: [], proposed: 0 }),
    );
    expect(move([...tied, ...idle])).toEqual({
      move: "end",
      ending: "no-room",
      why: "3 Examiner sessions in a row held out no task (comparison g-1 read no step, and the reference harness was valid on more than three solves in four: the tasks have to change): the tasks could not be made to leave room",
    });
    // With tasks written since, the same two are compared on them: six among eighteen, of which
    // a draw of twelve scores four on average, where a first reading takes two.
    const more = ["v13", "v14", "v15", "v16", "v17", "v18"].flatMap(heldOut);
    expect(move([...tied, ...more])).toMatchObject({
      move: "compare",
      why: "comparison g-1 left no room, and tasks were written since",
    });
    // One session wrote one task: too few for the next comparison yet (a first reading takes two
    // untied), and not nothing.
    const session = (id: string, held: readonly string[]) =>
      event("exam.finished", { session: id, held: [...held], refused: [], proposed: held.length });
    const few = [session("x-1", ["v13"]), ...heldOut("v13")];
    expect(move([...tied, ...few])).toMatchObject({ move: "examine", room: true });
    expect(move([...tied, ...few, ...idle.slice(1)])).toMatchObject({ move: "examine" });
    expect(move([...tied, ...few, ...idle])).toMatchObject({ move: "end", ending: "no-room" });
  });

  it("reads room in the tasks neither harness answered: they are the ones a better harness could answer", () => {
    // Eight tasks answered by both on every solve, and four by nobody: the reference was valid on
    // two solves in three, which is room. Until 10 October the four were left out of the share,
    // and the simulated climb then read "no room" four times on tasks written for room, with no
    // Builder session between them.
    const mixed = { old: [4, 0, 8], fresh: [4, 0, 8] } as const;
    const read = (unsolved: number) =>
      compared("g-1", "h1", "no-step", {
        tally: [0, 0, 12],
        valid: mixed,
        extra: { scored: { wins: 0, losses: 0, ties: 12, unsolved } },
      });
    expect(move([...first, ...read(4)])).toMatchObject({
      move: "build",
      why: "comparison g-1 read no step with room to gain: harness h1 did not help",
    });
    expect(move([...first, ...read(0)])).toMatchObject({ move: "build" });
  });

  it("ends the campaign where the tasks could not be made to leave room", () => {
    const full = { tally: [0, 0, 12], valid: { old: ALL, fresh: ALL } } as const;
    const tries = ["g-1", "g-2", "g-3", "g-4"].flatMap((id) => compared(id, "h1", "no-step", full));
    expect(move([...first, ...tries.slice(0, 6)])).toMatchObject({ move: "examine", room: true });
    expect(move([...first, ...tries])).toMatchObject({ move: "end", ending: "no-room" });
  });

  it("has other tasks written where neither harness answered, at the one budget the campaign runs at", () => {
    // Until 11 October the next longer budget of a ladder came first here.
    const empty = { tally: [0, 0, 12], valid: { old: NONE, fresh: NONE } } as const;
    const nobody = [setting(40), ...first, ...compared("g-1", "h1", "no-step", empty)];
    expect(move(nobody)).toEqual({
      move: "examine",
      room: false,
      why: "comparison g-1 read no step, and neither harness was valid on one solve in four: other tasks are written",
    });
    const more = ["v13", "v14", "v15", "v16", "v17", "v18"].flatMap(heldOut);
    expect(move([...nobody, ...more])).toMatchObject({
      move: "compare",
      why: "comparison g-1 left neither harness an answer, and tasks were written since",
    });
  });

  it("ends on check defects and on a cap, and has tasks written where none was tallied", () => {
    const stopped = compared("g-1", "h1", "check-defects", { extra: { scored: null } });
    expect(move([...first, ...stopped])).toMatchObject({ move: "end", ending: "exam" });
    const capped = compared("g-1", "h1", "not-scored", { extra: { scored: null, capped: true } });
    expect(move([...first, ...capped])).toMatchObject({ move: "end", ending: "budget" });
    const aside = compared("g-1", "h1", "not-scored", { extra: { versions: [], aside: HELD } });
    expect(move([...first, ...aside])).toEqual({
      move: "examine",
      room: false,
      why: "comparison g-1 tallied no task",
    });
  });

  it("reads a step against a promoted reference as one, with no starter to hold it to", () => {
    // Until 2026-10-11 a step against a promoted reference was held to the starter's solves on
    // the tallied tasks, and `starter-unread` sent the new harness to the starter in a comparison
    // of its own. A log of before may hold the reading, and the table reads it as no step.
    const unread = compared("g-1", "h2", "starter-unread", { old: "h1", tally: [8, 0, 4] });
    const log = [
      ...SET_UP,
      built("b-1", "h1"),
      event("harness.promoted", { harness: "h1" }),
      setting(null),
      built("b-2", "h2"),
      ...unread,
    ];
    expect(move(log)).not.toMatchObject({ reference: "starter" });
    const stepped = [
      ...log.slice(0, -unread.length),
      ...compared("g-1", "h2", "step", { old: "h1", tally: [8, 0, 4] }),
    ];
    expect(move(stepped)).toMatchObject({
      move: "compare",
      fresh: "latest",
      reference: "promoted",
      why: "comparison g-1 cleared the trigger, which is one draw: the same two harnesses are compared again on fresh solves, and the two are read together",
    });
  });
});

describe("the stop", () => {
  const flat = ["h1", "h2", "h3"].flatMap((harness, nth) => [
    built(`b-${String(nth + 1)}`, harness),
    ...compared(`g-${String(nth + 1)}`, harness, "no-step"),
  ]);

  it("ends the campaign after as many moves without a gain as its patience, unless the operator says to go on", () => {
    // The campaign's patience is its opening's (`--patience`), read by the stop rule from the log;
    // the default is six, and this one bears three, as the plan had it.
    const opened = event("campaign.opened", {
      budget: null,
      limit: null,
      ladder: [],
      sessions: 1,
      patience: 3,
    });
    expect(move([opened, ...SET_UP, ...flat.slice(0, 6)])).toMatchObject({ move: "build" });
    expect(move([opened, ...SET_UP, ...flat])).toEqual({
      move: "end",
      ending: "stop",
      why: "3 moves in a row could have shown a gain and showed none: the campaign's patience is 3",
    });
    expect(move([opened, ...SET_UP, ...flat], { ...PLAN, pastStop: "new tasks since" })).toMatchObject({
      move: "build",
    });
    // By default the campaign bears six: three moves without a gain, and the Builder builds on.
    expect(move([...SET_UP, ...flat], { ...PLAN, patience: 6 })).toMatchObject({ move: "build" });
  });
});

describe("the budget and the bounds", () => {
  it("ends the campaign where less of its total is left than one solve is held at", () => {
    const spent = { ...PLAN, left: { dollars: 4.5, reserve: 10 } };
    expect(move([...SET_UP, built("b-1", "h1")], spent)).toEqual({
      move: "end",
      ending: "budget",
      why: "$4.50 of the campaign's budget are left, and one solve is held at $10",
    });
    // The exam is read and the tasks are set apart whatever is left: neither bills anything.
    expect(move([], spent)).toMatchObject({ move: "accept" });
    expect(
      move([...SET_UP, built("b-1", "h1")], { ...PLAN, left: { dollars: 10, reserve: 10 } }),
    ).toMatchObject({
      move: "compare",
    });
  });

  it("ends before a comparison that what is left would not hold, by what the last one billed", () => {
    // A step read once, by a comparison of two sides whose solves billed 1.00 in all: the repeat
    // solves two sides again, and would bill about 1.00.
    const solve = (id: string, billed: number) => [
      event("solve.started", { solve: id, comparison: "g-1" }),
      event("solve.finished", { solve: id, billed, ending: { outcome: "pass" } }),
    ];
    const [start, report] = compared("g-1", "h1", "step", { tally: [10, 0, 2] });
    const log = [
      ...SET_UP,
      built("b-1", "h1"),
      ...(start === undefined ? [] : [start]),
      ...solve("s-1", 0.6),
      ...solve("s-2", 0.4),
      ...(report === undefined ? [] : [report]),
    ];
    const left = (dollars: number) => ({ ...PLAN, left: { dollars, reserve: 0.4 } });
    expect(move(log, left(0.95))).toEqual({
      move: "end",
      ending: "budget",
      why: "$0.95 of the campaign's budget are left, and comparison g-1 billed $1.00 for 2 sides: the next solves 2 and would bill about $1.00, so it would be cut before it reports",
    });
    expect(move(log, left(1))).toMatchObject({ move: "compare" });
    // A comparison the operator asked for with the reference against itself solved three sides,
    // and the next two: a third less.
    const noised = log.map((each) =>
      each.kind === "comparison.started" ? { ...each, data: { ...each.data, noise: true } } : each,
    );
    expect(move(noised, left(0.66))).toMatchObject({ move: "end", ending: "budget" });
    expect(move(noised, left(0.67))).toMatchObject({ move: "compare" });
    // A campaign with no total, as a rehearsal's, is held to none.
    expect(move(log)).toMatchObject({ move: "compare" });
    // Under a setting no comparison has reported in, nothing says what one bills, and it starts.
    expect(move([...SET_UP, built("b-1", "h1")], left(0.5))).toMatchObject({ move: "compare" });
    // A comparison that began goes on under what is left: its solves so far stand in the log.
    const begun = [
      ...log,
      event("comparison.started", { session: "g-2", old: "start", fresh: "h1", starter: "start" }),
    ];
    expect(move(begun, left(0.5))).toMatchObject({ move: "compare", id: "g-2" });
  });

  it("ends where three Examiner sessions in a row held out no task", () => {
    const session = (id: string) =>
      event("exam.finished", { session: id, held: [], refused: [], proposed: 0 });
    expect(move([READ, session("x-1"), session("x-2")])).toMatchObject({ move: "examine" });
    expect(move([READ, session("x-1"), session("x-2"), session("x-3")])).toEqual({
      move: "end",
      ending: "exam",
      why: "3 Examiner sessions in a row held out no task (the campaign holds no task): the tasks could not be written",
    });
  });

  // On 11 October six Examiner sessions of one campaign crashed in a row on the provider's session
  // limit, each under a new id within minutes, and the campaign ended `no-room` with "the tasks
  // could not be written"; another lost a Builder session the same way. The provider's failure is
  // the environment's ending, and the campaign goes on from its log once it is run again.
  it("ends on its environment, not its exam, where three sessions in a row crashed, and goes on once run again", () => {
    const EXAM = "exam.finished";
    const crashed = (kind: typeof EXAM | "build.finished", id: string) =>
      event(kind, {
        session: id,
        held: [],
        refused: [],
        proposed: 0,
        ended: "crashed",
        crash: "limit reached",
      });
    const idle = (id: string) =>
      event(EXAM, { session: id, held: [], refused: [], proposed: 0, ended: "finished" });
    // A crashed session is not idle: two crashes and one idle session are one idle session.
    expect(move([READ, crashed(EXAM, "x-1"), crashed(EXAM, "x-2"), idle("x-3")])).toMatchObject({
      move: "examine",
    });
    const dead = [
      READ,
      idle("x-1"),
      crashed(EXAM, "x-2"),
      crashed("build.finished", "b-1"),
      crashed(EXAM, "x-3"),
    ];
    expect(move(dead)).toEqual({
      move: "end",
      ending: "environment",
      why: "3 sessions in a row crashed (limit reached): nothing was written or built by them. Run the command again by the campaign's name once the provider is back",
    });
    // Run again after that ending, the count starts afresh: the next session is tried.
    const ended = event("campaign.ended", { ending: "environment", why: "3 sessions in a row crashed" });
    expect(move([...dead, ended])).toMatchObject({ move: "examine" });
    expect(move([...dead, ended, crashed(EXAM, "x-4"), crashed(EXAM, "x-5")])).toMatchObject({
      move: "examine",
    });
    // A session that ended whole between crashes breaks the run.
    expect(
      move([READ, crashed(EXAM, "x-1"), crashed(EXAM, "x-2"), idle("x-3"), crashed(EXAM, "x-4")]),
    ).toMatchObject({
      move: "examine",
    });
  });
});

describe("what a campaign runs by", () => {
  const opened = event("campaign.opened", {
    budget: { dollars: 400, reserve: 10 },
    limit: 40,
    sessions: 2,
    seats: { builder: { model: "claude/claude-opus-5-5", effort: "high" }, examiner: null, reviewer: null },
  });
  const billed = (dollars: number) => event("solve.finished", { solve: "s-1", billed: dollars });

  it("is its opening: the limit, the sessions, and what is left of its total", () => {
    expect(openingOf([])).toBeNull();
    expect(openingOf([opened])).toMatchObject({
      limit: 40,
      sessions: 2,
      seats: { examiner: null },
      prompt: null,
      solver: null,
    });
    // A campaign that opened from a prompt holds it, with who solves, and its plan says so.
    const asked = {
      ...opened.data,
      prompt: "Queues.",
      solver: { model: "claude/claude-sonnet-5-5", effort: "high" },
    };
    const prompted = event("campaign.opened", asked);
    expect(openingOf([prompted])).toMatchObject({ prompt: "Queues.", solver: asked.solver });
    expect(
      planOf([prompted], { unprepared: false, level: 0.1, trigger: 0.25, admits: ["check-a"] }),
    ).toMatchObject({
      prompted: true,
      admits: ["check-a"],
    });
    expect(
      planOf([opened, billed(31.5), billed(8.5)], { unprepared: false, level: 0.1, trigger: 0.25 }),
    ).toEqual({
      sessions: 2,
      patience: 6,
      unprepared: false,
      wanted: { target: 12, level: 0.1, trigger: 0.25 },
      left: { dollars: 360, reserve: 10 },
      prompted: false,
    });
  });

  it("is the defaults for a campaign opened before there was a record, and no total", () => {
    const plan = planOf([setting(15), setting(8)], {
      unprepared: true,
      level: 0.2,
      trigger: 0.3,
      target: 9,
      pastStop: "why",
    });
    expect(plan).toEqual({
      sessions: 3,
      patience: 6,
      unprepared: true,
      // The setting on record names twelve tasks to score, which stands over the caller's nine.
      wanted: { target: 12, level: 0.2, trigger: 0.3 },
      left: null,
      prompted: false,
      pastStop: "why",
    });
  });
});

describe("a promotion by hand", () => {
  it("is the plan's where the harness read a step and its repeat, and says why where not", () => {
    const stepped = [...SET_UP, built("b-1", "h1"), ...compared("g-1", "h1", "step", { tally: [8, 0, 4] })];
    expect(unpromoted(stepped, PLAN, "h1")).toBe(
      "harness h1 has not read a step and its repeat against the reference harness",
    );
    const again = [...stepped, ...compared("g-2", "h1", "step", { tally: [10, 0, 2] })];
    expect(unpromoted(again, PLAN, "h1")).toBeNull();
    // Another harness of the campaign rests on nothing.
    expect(unpromoted(again, PLAN, "h9")).toContain("harness h9 has not read a step and its repeat");
    // A record of the setting after the step changes nothing: a campaign runs at one setting, and
    // until 2026-10-11 a step read before a second record was none under the campaign's.
    expect(unpromoted([...again, setting(10)], PLAN, "h1")).toBeNull();
  });
});
