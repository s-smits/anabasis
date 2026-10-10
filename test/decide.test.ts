// Move 7 of a campaign over hand-built logs: each row of the plan's decision table, and the order
// the rows are asked in (`src/builder/decide.ts`), and what a campaign runs by (`opening.ts`).

import { describe, expect, it } from "bun:test";
import { type Decided, decide, unpromoted } from "../src/builder/decide.ts";
import type { Plan } from "../src/builder/ground.ts";
import { openingOf, planOf } from "../src/builder/opening.ts";
import { pendingWords } from "../src/builder/word.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";

/** Tasks by how many of their two solves were valid: none, one, both. */
type Valid = readonly [number, number, number];

const at = "2026-10-09T00:00:00.000Z";
const HELD = ["v1", "v2", "v3", "v4", "v5", "v6"];
const HALF: Valid = [2, 2, 2];
const ALL: Valid = [0, 0, 6];
const NONE: Valid = [6, 0, 0];
const PLAN: Plan = {
  limit: null,
  ladder: [],
  sessions: 1,
  unprepared: false,
  wanted: { target: 12, level: 0.1, restarted: [] },
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
    readonly budgets?: readonly JsonObject[];
    readonly noise?: boolean;
    readonly extra?: JsonObject;
  } = {},
): LogEvent[] {
  const sides = { old: more.old ?? "start", fresh, starter: "start" };
  const [wins, losses, ties] = more.tally ?? [2, 2, 2];
  return [
    event("comparison.started", { session: id, ...sides, noise: more.noise ?? false }),
    event("comparison.reported", {
      session: id,
      ...sides,
      reading,
      scored: { wins, losses, ties },
      versions: HELD,
      valid: { old: [...(more.valid?.old ?? HALF)], fresh: [...(more.valid?.fresh ?? HALF)] },
      budgets: [...(more.budgets ?? [])],
      setting: null,
      ...more.extra,
    }),
  ];
}
/** A budget row of a report: both harnesses' valid solves at so many of the model's turns. */
const row = (turns: number, old: Valid, fresh: Valid): JsonObject => ({
  turns,
  valid: { old: [...old], fresh: [...fresh] },
});
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
    // A session that left the harness as it was leaves nothing to compare.
    expect(move([...SET_UP, built("b-1", "start", { changed: false })])).toMatchObject({ move: "build" });
  });

  it("compares the first harness after one session, with the reference read against itself", () => {
    expect(move([...SET_UP, built("b-1", "h1")])).toMatchObject({
      move: "compare",
      fresh: "latest",
      reference: "promoted",
      noise: true,
    });
  });

  it("lets a comparison that began go on under its id, before anything else", () => {
    const begun = event("comparison.started", { session: "g-1", old: "start", fresh: "h1", noise: true });
    expect(move([...SET_UP, built("b-1", "h1"), begun, built("b-2", "h2")])).toEqual({
      move: "compare",
      id: "g-1",
      fresh: "h1",
      reference: "start",
      noise: true,
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
    expect(move(ready, three)).toMatchObject({ move: "compare", fresh: "latest", noise: true });
    // The reference was read against itself once under this setting, and is not again.
    const noised = [
      ...SET_UP,
      built("b-1", "h1"),
      ...compared("g-1", "h1", "no-step", { noise: true }),
      built("b-2", "h2"),
    ];
    expect(move(noised)).toMatchObject({ move: "compare", noise: false });
  });

  it("writes tasks where the next comparison would be short of them", () => {
    // One task untied of six leaves the next comparison about one, where a step takes four.
    const tied = [...SET_UP, built("b-1", "h1"), ...compared("g-1", "h1", "no-step", { tally: [1, 0, 5] })];
    expect(move([...tied, built("b-2", "h2")])).toEqual({
      move: "examine",
      room: false,
      why: "the last comparison left too few tasks for the next to untie",
    });
    // Tasks held out since count whole, and the comparison is admitted.
    const more = ["v7", "v8", "v9", "v10"].flatMap(heldOut);
    expect(move([...tied, built("b-2", "h2"), ...more])).toMatchObject({ move: "compare" });
  });
});

describe("practice, before a Builder session", () => {
  const plan = { ...PLAN, practice: 3 };
  const lost = compared("g-1", "h1", "no-step", { tally: [0, 2, 4] });

  it("is brought towards the count the campaign names once tasks were held out since the last release", () => {
    // One task is released of the three the campaign names, and nothing was held out since: a
    // release takes half of what is held once, and the Builder builds.
    expect(move(SET_UP, plan)).toMatchObject({ move: "build" });
    expect(move([...SET_UP, ...heldOut("v7")], plan)).toEqual({
      move: "prepare",
      why: "1 of the 3 practice tasks the campaign names are released, and tasks were held out since the last release: the contract's draw releases more before the Builder builds",
    });
    // The same before a later session, after a comparison that read no step with room.
    const later = [...SET_UP, built("b-1", "h1"), ...lost, ...heldOut("v7")];
    expect(move(later, plan)).toMatchObject({ move: "prepare" });
    // Once it released, the campaign builds: nothing was held out since.
    const released = event("task.state", { version: "v7", state: "released" });
    expect(move([...later, released], plan)).toMatchObject({ move: "build" });
  });

  it("is left as it is where the count is reached, no count is held, or the setting names the tasks to score", () => {
    const more = [...SET_UP, ...heldOut("v7")];
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
  const stepped = [...SET_UP, built("b-1", "h1"), ...compared("g-1", "h1", "step", { tally: [4, 0, 2] })];

  it("is one draw when read once: the same two are compared again, with the reference against itself", () => {
    expect(move(stepped)).toMatchObject({
      move: "compare",
      fresh: "latest",
      reference: "promoted",
      noise: true,
    });
    // Where the reference was read against itself under this setting, on the tasks the campaign
    // holds, that reading stands and the repeat solves the two harnesses alone.
    const noised = [
      ...SET_UP,
      built("b-1", "h1"),
      ...compared("g-1", "h1", "step", { tally: [4, 0, 2], noise: true }),
    ];
    expect(move(noised)).toEqual({
      move: "compare",
      fresh: "latest",
      reference: "promoted",
      noise: false,
      why: "comparison g-1 read a step, which is one draw: the same two harnesses are compared again on fresh solves. The reference was read against itself under this setting in comparison g-1, on the tasks the campaign holds",
    });
    // It is read again once tasks were held out since, and where the one on record is of
    // another reference harness.
    expect(move([...noised, ...heldOut("v7")])).toMatchObject({ move: "compare", noise: true });
    const other = [
      ...SET_UP,
      built("b-0", "h0"),
      ...compared("g-0", "h0", "no-step", { old: "other", noise: true }),
      built("b-1", "h1"),
      ...compared("g-1", "h1", "step", { tally: [4, 0, 2] }),
    ];
    expect(move(other)).toMatchObject({ move: "compare", noise: true });
  });

  it("is promoted when read again at the full limit", () => {
    const again = [...stepped, ...compared("g-2", "h1", "step", { tally: [5, 0, 1] })];
    expect(move(again)).toEqual({
      move: "promote",
      harness: "h1",
      why: "harness h1 read a step twice at the full limit",
    });
    // A repeat that reads no step leaves the pair no step: with room, the Builder builds again.
    const refuted = [...stepped, ...compared("g-2", "h1", "no-step")];
    expect(move(refuted)).toMatchObject({ move: "build" });
  });

  it("is named for promotion though later sessions left another harness, and one read once is not", () => {
    // A campaign of 9 October: two steps against the starter, then sessions and comparisons went
    // on by hand against that harness, which nobody had promoted.
    const later = [built("b-2", "h2"), ...compared("b-2", "h2", "no-step", { old: "h1", tally: [1, 1, 6] })];
    const twice = [...stepped, ...compared("g1", "h1", "step", { tally: [4, 0, 3] }), ...later];
    expect(move(twice)).toEqual({
      move: "promote",
      harness: "h1",
      why: "harness h1 read a step twice at the full limit, and was not promoted: what later sessions left is read against it once it is the reference",
    });
    // Promoted, the comparison made against it is the campaign's, and the table reads it.
    const promoted = event("harness.promoted", { harness: "h1" });
    expect(move([...twice, promoted])).toEqual({
      move: "build",
      why: "comparison b-2 read no step with room to gain: harness h2 did not help",
    });
    // The budget follows the promoted harness's own solves in the last comparison that holds any,
    // which is the one it was compared with by name: there it answered nearly everything, and at
    // five turns half.
    const named = compared("b-3", "h2", "no-step", {
      old: "h1",
      tally: [0, 0, 6],
      valid: { old: ALL, fresh: ALL },
      budgets: [row(5, HALF, HALF)],
    });
    expect(move([...twice, ...named, promoted], { ...PLAN, ladder: [5] })).toEqual({
      move: "budget",
      modelTurns: 5,
      why: "harness h1 was promoted, and it was valid on at most half its solves at 5 turns: the budget follows the reference",
    });
    // One step is one draw, whatever came after it.
    expect(move([...stepped, ...later])).toMatchObject({ move: "build" });
  });

  it("is read once at the full limit before a promotion, where it was read under a shorter budget", () => {
    const plan = { ...PLAN, limit: 40, ladder: [20, 10] };
    const short = [
      setting(10),
      ...SET_UP,
      built("b-1", "h1"),
      ...compared("g-1", "h1", "step", { tally: [4, 0, 2] }),
      ...compared("g-2", "h1", "step", { tally: [4, 0, 2] }),
    ];
    expect(move(short, plan)).toMatchObject({ move: "budget", modelTurns: 40 });
    const full = [...short, setting(40)];
    expect(move(full, plan)).toEqual({
      move: "compare",
      fresh: "latest",
      reference: "promoted",
      noise: false,
      why: "a step read again is read once at the full limit, where it must not lose",
    });
    // It did not lose there: it is promoted. It lost: the campaign returns to its budget and builds.
    const even = [...full, ...compared("g-3", "h1", "no-step", { tally: [1, 1, 4] })];
    expect(move(even, plan)).toMatchObject({ move: "promote", harness: "h1" });
    const lost = [...full, ...compared("g-3", "h1", "no-step", { tally: [0, 2, 4] })];
    expect(move(lost, plan)).toMatchObject({ move: "budget", modelTurns: 10 });
    expect(move([...lost, setting(10)], plan)).toEqual({
      move: "build",
      why: "harness h1 lost at the full limit and is not the reference",
    });
  });
});

describe("a budget the campaign has stood at before", () => {
  // The first campaign run by one command, on 9 October: the reference answered everything at 12
  // turns and at 2, and nothing at 1.
  const plan = { ...PLAN, limit: 12, ladder: [6, 3, 2, 1] };
  const full = { tally: [0, 0, 6], valid: { old: ALL, fresh: ALL } } as const;
  const empty = { tally: [0, 0, 6], valid: { old: NONE, fresh: NONE } } as const;
  const down = [
    setting(12),
    ...SET_UP,
    built("b-1", "h1"),
    ...compared("g-1", "h1", "no-step", { ...full, budgets: [row(2, NONE, NONE), row(1, NONE, NONE)] }),
    setting(2),
    ...compared("g-2", "h1", "no-step", { ...full, budgets: [row(1, NONE, NONE)] }),
    setting(1),
    ...compared("g-3", "h1", "no-step", empty),
  ];
  const session = (id: string, held: readonly string[]) =>
    event("exam.finished", { session: id, held: [...held], refused: [], proposed: held.length });

  it("returns to the budget that left no room where the next shorter one left neither harness an answer", () => {
    expect(move(down, plan)).toEqual({
      move: "budget",
      modelTurns: 2,
      why: "comparison g-3 read no step, and neither harness was valid on one solve in four. At 2 turns the reference harness left no room, so no budget of the ladder leaves room: the campaign stands at 2 turns, and the tasks have to change",
    });
  });

  it("takes up the comparisons it made there, and repeats none", () => {
    const back = [...down, setting(2)];
    expect(move(back, plan)).toEqual({
      move: "examine",
      room: true,
      why: "comparison g-2 read no step, the reference harness was valid on more than three solves in four, and no shorter budget leaves room: the tasks have to change",
    });
    // With tasks written since it was made, the same two are compared on them.
    const more = ["v7", "v8", "v9", "v10"];
    expect(move([...back, session("x-1", more), ...more.flatMap(heldOut)], plan)).toMatchObject({
      move: "compare",
      noise: false,
      why: "comparison g-2 left no room, and tasks were written since",
    });
  });

  it("goes on writing tasks while each session adds some, and ends where three in a row add none", () => {
    const back = [...down, setting(2)];
    const few = ["v7", "v8", "v9"].flatMap((version, index) => [
      session(`x-${String(index + 1)}`, [version]),
      ...heldOut(version),
    ]);
    // Three sessions wrote one task each: too few for the next comparison yet, and not nothing.
    expect(move([...back, ...few], plan)).toMatchObject({ move: "examine", room: true });
    const none = ["x-4", "x-5", "x-6"].map((id) => session(id, []));
    expect(move([...back, ...few, ...none.slice(0, 2)], plan)).toMatchObject({ move: "examine" });
    expect(move([...back, ...few, ...none], plan)).toMatchObject({ move: "end", ending: "no-room" });
  });

  it("takes a reading the two already have at the full limit, where a step was read twice below it", () => {
    const stepped = [
      setting(12),
      ...SET_UP,
      built("b-1", "h1"),
      ...compared("g-1", "h1", "no-step", { ...full, budgets: [row(2, HALF, HALF)] }),
      setting(2),
      ...compared("g-2", "h1", "step", { tally: [4, 0, 2] }),
      ...compared("g-3", "h1", "step", { tally: [4, 0, 2] }),
    ];
    expect(move(stepped, plan)).toEqual({
      move: "promote",
      harness: "h1",
      why: "harness h1 read a step twice at 2 turns, and did not lose at the full limit (comparison g-1)",
    });
    // A harness that was never read at the full limit is read there first.
    const unread = [
      ...stepped.slice(0, -4),
      built("b-2", "h2"),
      ...stepped
        .slice(-4)
        .map((each) => (each.data.fresh === "h1" ? { ...each, data: { ...each.data, fresh: "h2" } } : each)),
    ];
    expect(move(unread, plan)).toMatchObject({ move: "budget", modelTurns: 12 });
  });
});

describe("after a promotion", () => {
  const plan = { ...PLAN, limit: 40, ladder: [20, 10] };
  /** h1 stepped twice at the full limit, read also at 20 and at 10 turns, and was promoted. */
  const promotedOn = (budgets: readonly JsonObject[], fresh: Valid) => [
    setting(40),
    ...SET_UP,
    built("b-1", "h1"),
    ...compared("g-1", "h1", "step", { tally: [4, 0, 2] }),
    ...compared("g-2", "h1", "step", { tally: [4, 0, 2], valid: { old: HALF, fresh }, budgets }),
    event("harness.promoted", { harness: "h1" }),
  ];

  it("sets the budget again from the promoted harness's own solves: the longest at which it fails half", () => {
    const log = promotedOn([row(20, NONE, [1, 2, 3]), row(10, NONE, [3, 3, 0])], ALL);
    expect(move(log, plan)).toMatchObject({ move: "budget", modelTurns: 10 });
    // Once that setting is recorded, the Builder builds against the new reference.
    expect(move([...log, setting(10)], plan)).toMatchObject({ move: "build" });
    // Valid on at most half at the limit it ran under, the budget stands.
    const stays = promotedOn([row(20, NONE, NONE)], [2, 2, 2]);
    expect(move(stays, plan)).toMatchObject({ move: "build" });
  });

  it("has the tasks changed, once, where no budget leaves the promoted harness failing half", () => {
    const log = promotedOn([row(20, NONE, ALL), row(10, NONE, [0, 1, 5])], ALL);
    expect(move(log, plan)).toMatchObject({ move: "examine", room: true });
    const written = event("exam.finished", { session: "x-1", held: ["v7"], refused: [], proposed: 1 });
    expect(move([...log, written, ...heldOut("v7")], plan)).toMatchObject({ move: "build" });
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

  it("sets the budget again where the reference left no room, and has the tasks changed where no budget does", () => {
    const plan = { ...PLAN, limit: 40, ladder: [20, 10] };
    const full = { old: ALL, fresh: ALL };
    const tied = (budgets: readonly JsonObject[]) => [
      setting(40),
      ...first,
      ...compared("g-1", "h1", "no-step", { tally: [0, 0, 6], valid: full, budgets }),
    ];
    // Valid on every solve at 40 and at 20 turns, and on half at 10.
    expect(move(tied([row(20, ALL, ALL), row(10, HALF, ALL)]), plan)).toMatchObject({
      move: "budget",
      modelTurns: 10,
    });
    const none = tied([row(20, ALL, ALL), row(10, [0, 1, 5], ALL)]);
    expect(move(none, plan)).toMatchObject({ move: "examine", room: true });
    // With tasks written since, the same two are compared on them.
    const more = ["v7", "v8", "v9", "v10"].flatMap(heldOut);
    expect(move([...none, ...more], plan)).toMatchObject({ move: "compare", noise: false });
  });

  it("reads no room in the tasks neither harness answered", () => {
    // Four tasks answered by both on every solve, and two by nobody: two solves in three were
    // valid, and on the tasks anyone answered, all of them.
    const mixed = { old: [2, 0, 4], fresh: [2, 0, 4] } as const;
    const read = (unsolved: number) =>
      compared("g-1", "h1", "no-step", {
        tally: [0, 0, 6],
        valid: mixed,
        extra: { scored: { wins: 0, losses: 0, ties: 6, unsolved } },
      });
    expect(move([...first, ...read(2)])).toMatchObject({ move: "examine", room: true });
    // Where each of those tasks was answered by one of the two harnesses, they are room.
    expect(move([...first, ...read(0)])).toMatchObject({ move: "build" });
  });

  it("ends the campaign where the tasks could not be made to leave room", () => {
    const full = { tally: [0, 0, 6], valid: { old: ALL, fresh: ALL } } as const;
    const tries = ["g-1", "g-2", "g-3", "g-4"].flatMap((id) => compared(id, "h1", "no-step", full));
    expect(move([...first, ...tries.slice(0, 6)])).toMatchObject({ move: "examine", room: true });
    expect(move([...first, ...tries])).toMatchObject({ move: "end", ending: "no-room" });
  });

  it("lengthens the budget where neither harness answered, and has other tasks written at the full limit", () => {
    const plan = { ...PLAN, limit: 40, ladder: [20, 10] };
    const empty = { tally: [0, 0, 6], valid: { old: NONE, fresh: NONE } } as const;
    const at10 = [setting(10), ...first, ...compared("g-1", "h1", "no-step", empty)];
    expect(move(at10, plan)).toMatchObject({ move: "budget", modelTurns: 20 });
    const at40 = [setting(40), ...first, ...compared("g-1", "h1", "no-step", empty)];
    expect(move(at40, plan)).toMatchObject({ move: "examine", room: false });
  });

  it("stands at the next longer budget, for other tasks, where an earlier reading showed it to leave no room", () => {
    const plan = { ...PLAN, limit: 40, ladder: [20, 10] };
    const empty = { tally: [0, 0, 6], valid: { old: NONE, fresh: NONE } } as const;
    // Under 40 turns the reference answered everything, and read at 20 it still did: the rule took 10.
    const read = (at20: Valid) =>
      compared("g-1", "h1", "no-step", {
        tally: [0, 0, 6],
        valid: { old: ALL, fresh: ALL },
        budgets: [row(20, at20, at20), row(10, NONE, NONE)],
      });
    const under10 = [setting(10), ...compared("g-2", "h1", "no-step", empty)];
    expect(move([setting(40), ...first, ...read(ALL), ...under10], plan)).toEqual({
      move: "budget",
      modelTurns: 20,
      why: "comparison g-2 read no step, and neither harness was valid on one solve in four. At 20 turns the reference harness left no room, so no budget of the ladder leaves room: the campaign stands at 20 turns, and the tasks have to change",
    });
    // Read at 20 with room, that budget is the one to try.
    expect(move([setting(40), ...first, ...read(HALF), ...under10], plan)).toEqual({
      move: "budget",
      modelTurns: 20,
      why: "comparison g-2 read no step, and neither harness was valid on one solve in four: the budget is lengthened",
    });
  });

  it("does not hold a comparison under a new budget to the share the last one left untied", () => {
    const plan = { ...PLAN, limit: 40, ladder: [20] };
    // Every task tied under 40 turns, so a comparison there would untie none: the budget was set again.
    const tiedAll = compared("g-1", "h1", "no-step", {
      tally: [0, 0, 6],
      valid: { old: ALL, fresh: ALL },
      budgets: [row(20, HALF, HALF)],
      extra: { untied: 0 },
    });
    expect(move([setting(40), ...first, ...tiedAll], plan)).toMatchObject({ move: "budget", modelTurns: 20 });
    expect(move([setting(40), ...first, ...tiedAll, setting(20)], plan)).toMatchObject({
      move: "compare",
      why: "harness h1 has not been compared under the campaign's setting",
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

  it("compares the new harness with the starter where a step was not read against it", () => {
    const unread = compared("g-1", "h2", "starter-unread", { old: "h1", tally: [4, 0, 2] });
    const log = [
      ...SET_UP,
      built("b-1", "h1"),
      event("harness.promoted", { harness: "h1" }),
      setting(null),
      built("b-2", "h2"),
      ...unread,
    ];
    expect(move(log)).toMatchObject({ move: "compare", fresh: "latest", reference: "starter" });
  });
});

describe("the stop", () => {
  const flat = ["h1", "h2", "h3"].flatMap((harness, nth) => [
    built(`b-${String(nth + 1)}`, harness),
    ...compared(`g-${String(nth + 1)}`, harness, "no-step"),
  ]);

  it("ends the campaign after three moves that could have shown a gain, unless the operator says to go on", () => {
    expect(move([...SET_UP, ...flat.slice(0, 6)])).toMatchObject({ move: "build" });
    expect(move([...SET_UP, ...flat])).toEqual({
      move: "end",
      ending: "stop",
      why: "3 moves in a row could have shown a gain and showed none: the plan stops the campaign at three",
    });
    expect(move([...SET_UP, ...flat], { ...PLAN, pastStop: "new tasks since" })).toMatchObject({
      move: "build",
    });
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
    // reads the reference against itself as well, three sides, and would bill about 1.50.
    const solve = (id: string, billed: number) => [
      event("solve.started", { solve: id, comparison: "g-1" }),
      event("solve.finished", { solve: id, billed, ending: { outcome: "pass" } }),
    ];
    const [start, report] = compared("g-1", "h1", "step", { tally: [5, 0, 1] });
    const log = [
      ...SET_UP,
      built("b-1", "h1"),
      ...(start === undefined ? [] : [start]),
      ...solve("s-1", 0.6),
      ...solve("s-2", 0.4),
      ...(report === undefined ? [] : [report]),
    ];
    const left = (dollars: number) => ({ ...PLAN, left: { dollars, reserve: 0.4 } });
    expect(move(log, left(1.45))).toEqual({
      move: "end",
      ending: "budget",
      why: "$1.45 of the campaign's budget are left, and comparison g-1 billed $1.00 for 2 sides under this setting: the next solves 3 and would bill about $1.50, so it would be cut before it reports",
    });
    expect(move(log, left(1.5))).toMatchObject({ move: "compare", noise: true });
    // A campaign with no total, as a rehearsal's, is held to none.
    expect(move(log)).toMatchObject({ move: "compare", noise: true });
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

  it("goes back to no budget the two harnesses were already read at", () => {
    const plan = { ...PLAN, limit: 40, ladder: [20, 10] };
    const empty = { tally: [0, 0, 6], valid: { old: NONE, fresh: NONE } } as const;
    const full = { tally: [0, 0, 6], valid: { old: ALL, fresh: ALL } } as const;
    // Too hard at 10 turns, so 20; at 20 the reference answers everything, and at 10 it had failed
    // half: the rule would go back to 10, where the pair was read already. The tasks change.
    const log = [
      setting(10),
      ...SET_UP,
      built("b-1", "h1"),
      ...compared("g-1", "h1", "no-step", empty),
      setting(20),
      ...compared("g-2", "h1", "no-step", { ...full, budgets: [row(10, HALF, HALF)] }),
    ];
    expect(move(log, plan)).toMatchObject({ move: "examine", room: true });
  });
});

describe("what a campaign runs by", () => {
  const opened = event("campaign.opened", {
    budget: { dollars: 400, reserve: 10 },
    limit: 40,
    ladder: [20, 10, 5],
    sessions: 2,
    seats: { builder: { model: "claude/claude-opus-5-5", effort: "high" }, examiner: null, reviewer: null },
  });
  const billed = (dollars: number) => event("solve.finished", { solve: "s-1", billed: dollars });

  it("is its opening: the limit, the ladder, the sessions, and what is left of its total", () => {
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
    expect(planOf([prompted], { unprepared: false, level: 0.1, admits: ["check-a"] })).toMatchObject({
      prompted: true,
      admits: ["check-a"],
    });
    expect(planOf([opened, billed(31.5), billed(8.5)], { unprepared: false, level: 0.1 })).toEqual({
      limit: 40,
      ladder: [20, 10, 5],
      sessions: 2,
      unprepared: false,
      wanted: { target: 12, level: 0.1, restarted: [] },
      left: { dollars: 360, reserve: 10 },
      prompted: false,
    });
  });

  it("is the defaults for a campaign opened before there was a record: its first setting's limit, and no total", () => {
    const plan = planOf([setting(15), setting(8)], {
      unprepared: true,
      level: 0.2,
      target: 9,
      pastStop: "why",
    });
    expect(plan).toEqual({
      limit: 15,
      ladder: [],
      sessions: 3,
      unprepared: true,
      // The setting on record names twelve tasks to score, which stands over the caller's nine.
      wanted: { target: 12, level: 0.2, restarted: [] },
      left: null,
      prompted: false,
      pastStop: "why",
    });
  });
});

describe("a promotion by hand", () => {
  it("is the plan's where the harness read a step twice and did not lose at the full limit, and says why where not", () => {
    const stepped = [...SET_UP, built("b-1", "h1"), ...compared("g-1", "h1", "step", { tally: [4, 0, 2] })];
    expect(unpromoted(stepped, PLAN, "h1")).toBe(
      "harness h1 has not read a step twice against the reference harness under the campaign's setting",
    );
    const again = [...stepped, ...compared("g-2", "h1", "step", { tally: [5, 0, 1] })];
    expect(unpromoted(again, PLAN, "h1")).toBeNull();
    // Another harness of the campaign rests on nothing.
    expect(unpromoted(again, PLAN, "h9")).toContain("harness h9 has not read a step twice");
    // Read twice under a shorter budget, it is first read at the full limit.
    const short = [setting(10), ...again];
    expect(unpromoted(short, { ...PLAN, limit: 40 }, "h1")).toBe(
      "harness h1 read a step twice: before a promotion it is read once at the full limit",
    );
  });
});
