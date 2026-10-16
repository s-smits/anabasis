// Move 7 of a campaign over hand-built logs (`src/builder/decide.ts`): one case a row of the table,
// one a hold, the order the rows are asked in, the one count that ends a campaign for want of room
// or of tasks, and the rule a promotion by hand is held to.

import { describe, expect, it } from "bun:test";
import { decide, epochReleased, practiceRoom, unpromoted } from "../src/builder/decide.ts";
import type { Plan } from "../src/builder/ground.ts";
import { pendingWords } from "../src/builder/word.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import { taskSets } from "../src/kernel/task.ts";
import { isString, type JsonObject } from "../src/meta/json-shape.ts";
import { tallied } from "./helpers/tally.ts";
import { roundSolves } from "./helpers/logged-round.ts";

/** Tasks by how many of their two solves were valid: none, one, both. */
type Valid = readonly [number, number, number];

const at = "2026-10-09T00:00:00.000Z";
const HELD = ["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8", "v9", "v10", "v11", "v12"];
const HALF: Valid = [4, 4, 4];
const ALL: Valid = [0, 0, 12];
const NONE: Valid = [12, 0, 0];
const SHORT_WHY =
  "the campaign holds fewer tasks a step can be read on than a step takes: those the reference harness answered in every solve, and those held out before its promotion that it has stood in no comparison of, are read apart";
const PLAN: Plan = {
  sessions: 1,
  // The plan's three, which these rows were written against; the default is six (`PATIENCE`).
  patience: 3,
  unprepared: false,
  practice: null,
  wanted: { target: 12, level: 0.1, trigger: 0.25 },
  pastStop: null,
  prompted: false,
  admits: [],
  left: null,
};
const event = (kind: EventKind, data: JsonObject): LogEvent => ({ at, kind, data });
const EXAM_FINISHED = "exam.finished" as const;
const heldOut = (version: string) => [
  event("task.proposed", { version, taskId: version }),
  event("task.gate", { version, gate: 1, outcome: "passed" }),
];
const READ = event("checker.read", { contract: "c", checks: "k", faults: [] });
/** A second target's worth, which a repeat draws first. */
const REPEAT = HELD.map((version) => `r${version}`);
const RELEASED = [...heldOut("p1"), event("task.state", { version: "p1", state: "released" })];
/** A campaign set up: its checker read with no fault, a comparison's tasks and a repeat's held
 *  out, and one released. */
const SET_UP = [READ, ...HELD.flatMap(heldOut), ...REPEAT.flatMap(heldOut), ...RELEASED];
/** The same with one target's worth held out, and with six of the twelve a comparison scores. */
const ONE = SET_UP.filter(({ data }) => !(isString(data.version) && REPEAT.includes(data.version)));
const SIX = [READ, ...HELD.slice(0, 6).flatMap(heldOut), ...RELEASED];
/** A Builder session that left `harness`, changed unless `more` says otherwise. */
const built = (id: string, harness: string, more: JsonObject = {}) =>
  event("build.finished", { session: id, harness, changed: true, ended: "finished", ...more });
const FIRST = [...SET_UP, built("b-1", "h1")];
const setting = (modelTurns: number | null) =>
  event("campaign.setting", { solver: null, minutes: 120, turns: 24, modelTurns, tasks: null, target: 12 });
/** An Examiner session that ended whole and held out `held`, each put to its gate. */
const examined = (id: string, held: readonly string[] = [], more: JsonObject = {}) => [
  event(EXAM_FINISHED, { session: id, held: [...held], refused: [], proposed: held.length, ...more }),
  ...held.flatMap(heldOut),
];
const idle = (count: number) =>
  Array.from({ length: count }, (_, nth) => examined(`x-${String(nth + 1)}`)).flat();
/** A comparison of `fresh` with the reference `old`, begun and reported as `more` says. */
function compared(
  id: string,
  fresh: string,
  reading: string,
  more: {
    readonly old?: string;
    readonly tally?: readonly [number, number, number];
    readonly valid?: { readonly old: Valid; readonly fresh: Valid };
    readonly extra?: JsonObject;
    /** Each task's solves, as `roundSolves` spells them, where a reader takes them from the solves:
     *  the report's tasks, census and setting are then theirs. */
    readonly solved?: Readonly<Record<string, string>>;
  } = {},
): LogEvent[] {
  const sides = { old: more.old ?? "start", fresh, starter: "start" };
  // The tally decides since 10 October, not the word: a step's default tally clears the trigger
  // alone and the level with its repeat (`readTwice`), and any other reading's clears neither.
  const [wins, losses, ties] = more.tally ?? (reading === "step" ? [5, 0, 7] : [4, 4, 4]);
  const solved = more.solved === undefined ? null : roundSolves(id, [sides.old, fresh], more.solved);
  return [
    event("comparison.started", { session: id, ...sides }),
    ...(solved?.events ?? []),
    event("comparison.reported", {
      session: id,
      ...sides,
      reading,
      ...tallied(wins, losses, ties),
      versions: HELD,
      valid: {
        old: [...(more.valid?.old ?? HALF)],
        fresh: [...(more.valid?.fresh ?? HALF)],
        // Informative: valid on some of a task's solves and not all (`informative`).
        informative: { old: (more.valid?.old ?? HALF)[1], fresh: (more.valid?.fresh ?? HALF)[1] },
      },
      setting: null,
      ...solved?.terms,
      ...more.extra,
    }),
  ];
}
/** A comparison in which both harnesses answered every task in every solve: no room. */
const FULL = { tally: [0, 0, 12], valid: { old: ALL, fresh: ALL } } as const;
const full = (id: string) => compared(id, "h1", "no-step", FULL);
/** Every held task, the repeat's worth too, answered by both in every solve: none is left unread. */
const EVERY = Object.fromEntries([...HELD, ...REPEAT].map((version) => [version, "PP PP"]));
/** The decided move without the row that chose it, and that row's code. */
const move = (events: readonly LogEvent[], plan: Plan = PLAN) => {
  const { code: _code, ...decided } = decide(events, plan);
  return decided;
};
const code = (events: readonly LogEvent[], plan: Plan = PLAN) => decide(events, plan).code;
const NO_ROOM = (id: string) =>
  `comparison ${id} read no step, and no task was informative for the reference harness: the tasks have to change`;
const promotion = (harness: string, more: JsonObject = {}) => event("harness.promoted", { harness, ...more });
/** A harness that read a step and its repeat against `old`, as two comparisons. */
const steppedTwice = (id: string, fresh: string, old: string) => [
  ...compared(`${id}a`, fresh, "step", { old }),
  ...compared(`${id}b`, fresh, "step", { old }),
];
/** h1 stepped twice against the starter and was promoted: an epoch's first reference after set-up. */
const PROMOTED = [...FIRST, ...steppedTwice("g-1", "h1", "start"), promotion("h1", { from: "start" })];
/** h1 stepped twice and was promoted, valid in its last comparison as `fresh` says. */
const promotedOn = (fresh: Valid) => [
  setting(40),
  ...FIRST,
  ...compared("g-1", "h1", "step", { tally: [8, 0, 4] }),
  ...compared("g-2", "h1", "step", { tally: [8, 0, 4], valid: { old: HALF, fresh } }),
  promotion("h1"),
];

describe("a row of the table", () => {
  it("stop: a stop the operator left ends the campaign, once", () => {
    const word = (data: JsonObject) => event("campaign.word", data);
    const stopped = [...FIRST, word({ word: "tasks" }), word({ word: "stop", why: "the host is needed" })];
    expect(decide(stopped, PLAN)).toEqual({
      move: "end",
      ending: "operator",
      code: "stop",
      why: "the operator's word: the host is needed",
      // Every word left before the stop is answered by it.
      answers: [FIRST.length, FIRST.length + 1],
    });
    // Named by the ending it caused, the word is heard, and the campaign goes on when run again.
    const ended = event("campaign.ended", { ending: "operator", answers: [FIRST.length, FIRST.length + 1] });
    expect(move([...stopped, ended])).toMatchObject({ move: "compare" });
    expect(pendingWords([...stopped, ended])).toEqual([]);
    expect(move([word({ word: "stop" })])).toMatchObject({ ending: "operator", why: "the operator's word" });
  });

  it("exam: an exam that does not stand is drafted, read, or ends the campaign", () => {
    const held = HELD.flatMap(heldOut);
    // Nobody has read it.
    expect(decide([], PLAN)).toMatchObject({ move: "accept", code: "exam" });
    // A reading with a fault nobody froze ends it, and names the checks no engine decides: a
    // drafted exam stands on the operator's word for each (esp32-141-m3b, 12 October).
    const faulty = event("checker.read", { contract: "c", checks: "k", faults: ["check-a: authored"] });
    expect(decide([faulty, ...held], PLAN)).toMatchObject({ move: "end", ending: "exam", code: "exam" });
    const rows = ["check-a", "check-b", "check-c"].map((id) => ({ id, instrument: "author" }));
    const drafted = event("checker.read", { faults: ["two"], rows, admitted: ["check-b"] });
    expect(move([drafted, ...held]).why).toEndWith(
      ". No engine the host installed decides check-a, check-c, so each stands on the operator's word alone: --admit check-a,check-c",
    );
    // The operator's freeze of that reading lets the campaign go on.
    const frozen = event("contract.frozen", { contract: "c", checks: "k", admitted: ["check-a"] });
    expect(move([faulty, frozen, ...SET_UP.slice(1)])).toMatchObject({ move: "build" });
    // A check the command admits that the last reading did not has the exam read again, once.
    const reading = (admitted: readonly string[], faults: readonly string[]) =>
      event("checker.read", { contract: "c", checks: "k", faults: [...faults], admitted: [...admitted] });
    const admits = { ...PLAN, admits: ["check-a"] };
    const unadmitted = [reading([], ["check-a stands on the operator's word alone"]), ...held];
    expect(move(unadmitted)).toMatchObject({ move: "end", ending: "exam" });
    expect(move(unadmitted, admits)).toEqual({
      move: "accept",
      why: "the operator admits check-a: the exam is read again",
    });
    const left = [reading(["check-a"], ["check-b has refused nothing"]), ...held];
    expect(move(left, admits)).toMatchObject({ move: "end", ending: "exam" });

    // A campaign that opened from a prompt drafts its exam, three drafts at most.
    const plan = { ...PLAN, prompted: true };
    expect(decide([], plan)).toEqual({
      move: "draft",
      code: "exam",
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
    // Run again once the campaign ended on its environment, it drafts again: the crashes count
    // since that ending, and the drafts put before it still count.
    const ended = event("campaign.ended", { ending: "environment", why: "no draft was put" });
    expect(move([crashed, crashed, crashed, ended], plan)).toMatchObject({ move: "draft" });
    expect(move([crashed, crashed, crashed, ended, crashed, crashed, crashed], plan)).toMatchObject({
      ending: "environment",
    });
    expect(move([fell(2), crashed, crashed, ended], plan)).toEqual({
      move: "draft",
      why: "2 drafts did not stand at the host's reading, and 1 more may be put",
    });
    expect(move([fell(2), ended, fell(1)], plan)).toMatchObject({ ending: "exam" });
    // A draft that stood is the exam, and it is read like any other.
    const stood = event("exam.drafted", { session: "d-1", draft: { domain: "a field" } });
    expect(move([fell(1), stood], plan)).toMatchObject({ move: "accept" });
  });

  it("bound: a spent bound ends the campaign: the total, the provider, the patience, the control, a cut comparison", () => {
    // The total: less left than one solve is held at, strictly.
    const spent = { ...PLAN, left: { dollars: 4.5, reserve: 10 } };
    expect(decide(FIRST, spent)).toEqual({
      move: "end",
      ending: "budget",
      code: "bound",
      why: "$4.50 of the campaign's budget are left, and one solve is held at $10",
    });
    expect(move(FIRST, { ...PLAN, left: { dollars: 10, reserve: 10 } })).toMatchObject({ move: "compare" });

    // The provider: three sessions in a row that crashed. On 11 October six Examiner sessions of one
    // campaign crashed on the provider's session limit, and the campaign ended `no-room`.
    const crashed = (kind: typeof EXAM_FINISHED | "build.finished", id: string, held: string[] = []) =>
      event(kind, {
        session: id,
        held,
        refused: [],
        proposed: held.length,
        ended: "crashed",
        crash: "limit reached",
      });
    const [x1, x2, x3] = [
      crashed(EXAM_FINISHED, "x-1"),
      crashed(EXAM_FINISHED, "x-2"),
      crashed(EXAM_FINISHED, "x-3"),
    ];
    const whole = examined("x-9");
    const dead = [
      READ,
      ...whole,
      crashed(EXAM_FINISHED, "x-2"),
      crashed("build.finished", "b-1"),
      crashed(EXAM_FINISHED, "x-3"),
    ];
    expect(decide(dead, PLAN)).toEqual({
      move: "end",
      ending: "environment",
      code: "bound",
      why: "3 sessions in a row crashed (limit reached): none held out a task or changed a harness. Run the command again by the campaign's name once the provider is back",
    });
    // A session that held a task out and then lost a turn to the provider moved the campaign, and
    // one that ended whole between crashes breaks the run.
    const moved = crashed(EXAM_FINISHED, "x-8", ["v9"]);
    expect(move([READ, x1, moved, x2, x3])).toMatchObject({ move: "examine" });
    expect(move([READ, x1, x2, ...whole, x3])).toMatchObject({ move: "examine" });
    // A Builder that edited and then crashed left no harness the campaign goes on from, so it
    // counts: until 13 October it broke the run, and such sessions repeated from one parent without
    // bound. One whose harness was checkpointed did move the campaign.
    const edited = (id: string) => event("build.finished", { session: id, ended: "crashed", changed: true });
    expect(decide([READ, ...whole, edited("b-1"), edited("b-2"), edited("b-3")], PLAN)).toMatchObject({
      move: "end",
      ending: "environment",
    });
    const kept = event("build.checkpoint", { session: "b-2", harness: "h-kept" });
    expect(
      decide([READ, ...whole, edited("b-1"), kept, edited("b-2"), edited("b-3")], PLAN),
    ).not.toMatchObject({ ending: "environment" });
    // A Builder the host stopped as the third crash ended the campaign says nothing of the
    // provider: until 14 October it read as whole, the count went back to nought, and the command
    // exited with no ending on record.
    const halted = event("build.finished", { session: "b-2", ended: "stopped", changed: false });
    expect(decide([...dead, halted], PLAN)).toMatchObject({ move: "end", ending: "environment" });
    // Run again after that ending, the count starts afresh.
    const ended = event("campaign.ended", { ending: "environment", why: "3 sessions in a row crashed" });
    expect(move([...dead, ended])).toMatchObject({ move: "examine" });
    expect(move([...dead, ended, x1, x2])).toMatchObject({ move: "examine" });

    // The patience: as many moves without a gain as the opening names (`--patience`), read by the
    // stop rule from the log, unless the operator says to go on.
    const opened = event("campaign.opened", {
      budget: null,
      limit: null,
      ladder: [],
      sessions: 1,
      patience: 3,
    });
    const flat = ["h1", "h2", "h3"].flatMap((harness, nth) => [
      built(`b-${String(nth + 1)}`, harness),
      ...compared(`g-${String(nth + 1)}`, harness, "no-step"),
    ]);
    expect(move([opened, ...SET_UP, ...flat.slice(0, 6)])).toMatchObject({ move: "build" });
    expect(decide([opened, ...SET_UP, ...flat], PLAN)).toEqual({
      move: "end",
      ending: "stop",
      code: "bound",
      why: "3 moves in a row could have shown a gain and showed none: the campaign's patience is 3",
    });
    expect(move([opened, ...SET_UP, ...flat], { ...PLAN, pastStop: "new tasks since" })).toMatchObject({
      move: "build",
    });
    // The stop reads the patience the opening records, and six where there is none (`patienceOf`);
    // the plan's patience only words the reason.
    expect(move([...SET_UP, ...flat])).toMatchObject({ move: "build" });

    // The control: the epoch's first A/A read as a step either way, until the cause is on record.
    // Two-sided at the level: 5 tasks all one way is p 1/32 a side, 1/16 both; 4 is 1/8.
    const aa = (id: string, apart: readonly number[]) =>
      compared(id, "h1", "step", {
        tally: [8, 0, 4],
        extra: { level: 0.1, noise: { wins: 0, losses: 0, ties: 4, differences: [...apart] } },
      });
    const epoch = (apart: readonly number[]) => [...FIRST, ...aa("g-1", apart)];
    for (const apart of [
      [2, 2, 2, 2, 2],
      [-2, -2, -2, -2, -2],
    ]) {
      expect(decide(epoch(apart), PLAN)).toEqual({
        move: "end",
        ending: "control",
        code: "bound",
        why: 'comparison g-1 read the reference against itself as a step, so its two sides are not interchangeable and no comparison against it reads anything until the cause is on record: leave it with tools/d2/word.ts --cause "<the cause>", and the campaign goes on when run again',
      });
    }
    for (const apart of [[2, 2, 2, 2], [2, -2, 0, 0], []]) {
      expect(move(epoch(apart))).toMatchObject({ move: "compare", fresh: "h1", repeats: "g-1" });
    }
    const cause = event("campaign.word", { word: "cause", why: "the host was loaded while g-1 ran" });
    expect(move([...epoch([2, 2, 2, 2, 2]), cause])).toEqual(move(epoch([2, -2, 0, 0])));
    // It is the epoch's first A/A: those after it stand as readings.
    expect(move([...epoch([2, -2, 0, 0]), ...aa("g-2", [2, 2, 2, 2, 2])])).not.toMatchObject({ move: "end" });

    // A comparison stopped on its check defects, and one its cap cut before it tallied a task.
    const defects = compared("g-1", "h1", "check-defects", { extra: { scored: null } });
    expect(decide([...FIRST, ...defects], PLAN)).toMatchObject({
      move: "end",
      ending: "exam",
      code: "bound",
    });
    const capped = compared("g-1", "h1", "not-scored", { extra: { scored: null, capped: true } });
    expect(decide([...FIRST, ...capped], PLAN)).toMatchObject({
      move: "end",
      ending: "budget",
      code: "bound",
    });
  });

  it("an old ladder: its task is held out, and its reading is read by no row", () => {
    // A log of 14 to 16 October may hold a task held for the ladder and the starter's reading on
    // it after a promotion. The ladder was retired on 16 October: the task is held out, as a task
    // its gate passed is, and the reading moves nothing the table reads.
    const proposed = event("task.proposed", { version: "l1", taskId: "l1" });
    const ladder = [
      proposed,
      event("task.gate", { version: "l1", gate: 1, outcome: "ladder" }),
      event("task.state", { version: "l1", state: "ladder" }),
    ];
    const reading = [
      event("comparison.started", { session: "g-2", old: "h1", fresh: "start", ladder: true, tasks: ["l1"] }),
      event("comparison.reported", {
        session: "g-2",
        old: "h1",
        fresh: "start",
        reading: "no-step",
        ladder: true,
      }),
    ];
    const passed = [proposed, event("task.gate", { version: "l1", gate: 1, outcome: "passed" })];
    expect(taskSets(ladder).held).toEqual(["l1"]);
    expect(move([...ladder, ...PROMOTED, ...reading])).toEqual(move([...passed, ...PROMOTED]));
  });

  it("tasks: tasks not set up are taken in, written or released before anything is built", () => {
    expect(decide([READ], { ...PLAN, unprepared: true })).toMatchObject({ move: "prepare", code: "tasks" });
    expect(decide([READ], PLAN)).toEqual({
      move: "examine",
      code: "tasks",
      why: "the campaign holds no task",
    });
    expect(move([READ, ...HELD.flatMap(heldOut)])).toEqual({
      move: "prepare",
      why: "no task is released for practice: the contract's draw releases some",
    });
    // A word for other tasks has them written, and the event that acts on it names it.
    const word = (data: JsonObject) => event("campaign.word", data);
    expect(decide([...FIRST, word({ word: "tasks", why: "three batches tied" })], PLAN)).toEqual({
      move: "examine",
      code: "tasks",
      why: "the operator asked for other tasks: three batches tied",
      answers: [FIRST.length],
    });
    // Before the exam was read the exam comes first, and a word for another total moves nothing.
    expect(move([word({ word: "tasks" })])).toMatchObject({ move: "accept" });
    expect(move([...FIRST, word({ word: "budget", dollars: 50 })])).toMatchObject({ move: "compare" });
    expect(pendingWords([...FIRST, word({ word: "budget", dollars: 50 })])).toMatchObject([
      { at: FIRST.length, word: "budget", dollars: 50 },
    ]);
    // Before the first comparison the campaign holds the tasks a comparison scores and the practice
    // its release still draws: until 13 October it held a repeat's as well, and the two host-run
    // campaigns of 12 October examined towards 48 tasks for 16 hours and never compared.
    const short = (missing: number, before: string) =>
      `the campaign is ${String(missing)} held-out tasks short of a comparison's target and the practice its release draws, and ${before}: the Examiner writes more first`;
    expect(move([...ONE, built("b-1", "h1")])).toMatchObject({ move: "compare" });
    expect(move(ONE, { ...PLAN, practice: 3 })).toEqual({
      move: "examine",
      why: short(2, "no comparison has run yet"),
    });
    expect(decide(SIX, PLAN)).toEqual({
      move: "examine",
      code: "tasks",
      why: short(6, "no comparison has run yet"),
    });
    // With a harness waiting as much: the two campaigns on the operator's host (9 and 10 October)
    // compared on 6 where the setting asked for 12, and came one win short three times.
    expect(move([...SIX, built("b-1", "h1")])).toEqual({
      move: "examine",
      why: short(6, "harness h1 has not been compared under the campaign's setting"),
    });
    expect(move([...SIX, built("b-1", "h1"), ...HELD.slice(6).flatMap(heldOut)])).toMatchObject({
      move: "compare",
    });
    // Once a comparison has run, the rows that read it decide, whatever is held.
    expect(move([...SIX, built("b-1", "h1"), ...compared("g-1", "h1", "no-step")])).toMatchObject({
      move: "build",
    });
  });

  it("unfinished: a comparison that began goes on, and a reading that cleared the trigger is repeated", () => {
    const begun = event("comparison.started", { session: "g-1", old: "start", fresh: "h1" });
    expect(decide([...FIRST, begun, built("b-2", "h2")], PLAN)).toEqual({
      move: "compare",
      code: "unfinished",
      id: "g-1",
      fresh: "h1",
      reference: "start",
      why: "comparison g-1 began and has not reported: it goes on from its log",
    });
    // It goes on under whatever is left: its solves so far stand in the log.
    expect(move([...FIRST, begun], { ...PLAN, left: { dollars: 0.5, reserve: 0.4 } })).toMatchObject({
      id: "g-1",
    });
    // A step read once is one draw.
    const stepped = [...FIRST, ...compared("g-1", "h1", "step", { tally: [8, 0, 4] })];
    const again = {
      move: "compare",
      fresh: "h1",
      reference: "promoted",
      why: "comparison g-1 cleared the trigger, which is one draw: the same two harnesses are compared again on fresh solves, and the two are read together",
      // The repeat names the reading it repeats, and the harness that reading froze.
      repeats: "g-1",
    } as const;
    expect(decide(stepped, PLAN)).toEqual({ ...again, code: "unfinished" });
    // A session that leaves another harness takes nothing from it: until 15 October the repeat
    // followed the latest harness's reading, and recode-pr169-sonnet's g-1 lost its repeat once b-3
    // left another.
    expect(move([...stepped, built("b-2", "h2")])).toEqual(again);
    expect(move([...stepped, built("b-2", "h2"), ...compared("g-2", "h2", "no-step")])).toMatchObject({
      move: "build",
    });
    // A 4-3 clears no trigger; a 6-2 (p 0.14) buys the repeat, whatever its word.
    const tally = (wins: number, losses: number) =>
      compared("g-1", "h1", "no-step", { tally: [wins, losses, 12 - wins - losses] });
    expect(move([...FIRST, ...tally(4, 3)])).toMatchObject({ move: "build" });
    expect(move([...FIRST, ...tally(6, 2)])).toMatchObject({ move: "compare" });
    // The repeat scores the first stage's untied tasks again and the held tasks it did not score:
    // where those are fewer than a sweep at the level takes (four at 0.1) the Examiner writes
    // more, however many sessions that takes, and sessions that hold out none end the campaign at
    // its patience. A report that names no task of its differences offers none to score again.
    const scoredAll = [...ONE, built("b-1", "h1"), ...compared("g-1", "h1", "step", { tally: [8, 0, 4] })];
    expect(decide(scoredAll, PLAN)).toEqual({
      move: "examine",
      code: "unfinished",
      why: "comparison g-1 cleared the trigger, and the campaign is 4 held-out tasks short of a repeat that could read a step: the Examiner writes more first",
      repeats: "g-1",
    });
    const two = [...scoredAll, ...examined("x-1", ["n1", "n2"])];
    expect(decide(two, PLAN)).toMatchObject({
      move: "examine",
      why: expect.stringContaining("2 held-out tasks short"),
      repeats: "g-1",
    });
    expect(move([...two, ...examined("x-2", ["m1", "m2"])])).toEqual(again);
    // Until 16 October the repeat waited for a target of fresh tasks, about 300 gate solves after
    // a promotion: the eight tasks the step untied are scored again, and nothing waits.
    const named = { frontier: { ...tallied(8, 0, 4).frontier, of: HELD } };
    expect(
      move([
        ...ONE,
        built("b-1", "h1"),
        ...compared("g-1", "h1", "step", { tally: [8, 0, 4], extra: named }),
      ]),
    ).toEqual(again);
    const idled = [...two, ...examined("x-2"), ...examined("x-3"), ...examined("x-4")];
    expect(decide(idled, PLAN)).toMatchObject({ move: "end", ending: "exam" });
    // The A/A a comparison of four solves a side carries beside it changes no move while it reads
    // no step.
    const aa = { noise: { wins: 0, losses: 0, ties: 4, differences: [0, 0, 0, 0] } };
    expect(move([...FIRST, ...compared("g-1", "h1", "step", { tally: [8, 0, 4], extra: aa })])).toEqual(
      again,
    );
    // Against a promoted reference a step is one as against the starter. A log of before
    // 2026-10-11 may hold `starter-unread`, which reads as no step.
    // Its tasks held out after the promotion: one held before, that h1 never stood in, is retained.
    const after = HELD.map((version) => `e${version}`);
    const epoch = [...FIRST, promotion("h1"), setting(null), ...examined("x-2", after), built("b-2", "h2")];
    const unread = compared("g-1", "h2", "starter-unread", { old: "h1", tally: [8, 0, 4] });
    expect(move([...epoch, ...unread])).not.toMatchObject({ reference: "starter" });
    expect(move([...epoch, ...compared("g-1", "h2", "step", { old: "h1", tally: [8, 0, 4] })])).toEqual({
      ...again,
      fresh: "h2",
    });
  });

  it("twice: a harness that read a step and its repeat is promoted", () => {
    const stepped = [...FIRST, ...compared("g-1", "h1", "step", { tally: [8, 0, 4] })];
    const repeat = (tally: readonly [number, number, number]) => [
      ...stepped,
      ...compared("g-2", "h1", "no-step", { tally }),
    ];
    expect(decide([...stepped, ...compared("g-2", "h1", "step", { tally: [10, 0, 2] })], PLAN)).toEqual({
      move: "promote",
      code: "twice",
      harness: "h1",
      why: "harness h1 read a step and its repeat",
    });
    // The two tallies summed decide, never the repeat's word: 8-0 and 4-4 are 12-4 (p 0.01), a
    // promotion; 8-0 and 1-4 are 9-4 (p 0.13), none, and with room the Builder builds again.
    expect(move(repeat([4, 4, 4]))).toMatchObject({ move: "promote" });
    expect(move(repeat([1, 4, 7]))).toMatchObject({ move: "build" });
    // A repeat that tied every task, or lost more than it won, is no repeat: summed alone an 8-0
    // and a 0-0-12 promoted on one draw (found by review, 11 October).
    expect(move(repeat([0, 0, 12]))).not.toMatchObject({ move: "promote" });
    expect(move(repeat([3, 4, 5]))).not.toMatchObject({ move: "promote" });
    // A repeat buys no repeat. A 2-0 and a 2-0 each clear the trigger and together not the level
    // of 0.02 (4-0, p 0.06); until 15 October the second bought a third reading no bound counted.
    const strict = { ...PLAN, wanted: { ...PLAN.wanted, level: 0.02 } };
    const weak = (id: string) => compared(id, "h1", "no-step", { tally: [2, 0, 10] });
    expect(move([...FIRST, ...weak("g-1")], strict)).toMatchObject({ move: "compare", repeats: "g-1" });
    expect(move([...FIRST, ...weak("g-1"), ...weak("g-2")], strict)).toMatchObject({ move: "build" });
    // A later reading of the candidate that is no repeat is an attempt of its own, and its repeat is
    // due: from 15 October to 16 October none was, and it could promote only with the repeat before
    // it, which buffer-159-opus's second promotion did.
    const third = [...FIRST, ...weak("g-1"), ...weak("g-2"), ...weak("g-3")];
    expect(move(third, strict)).toMatchObject({ move: "compare", repeats: "g-3" });
    // A campaign of 9 October: two steps against the starter, then sessions and comparisons went
    // on by hand against that harness, which nobody had promoted. It is named all the same.
    const later = [built("b-2", "h2"), ...compared("b-2", "h2", "no-step", { old: "h1", tally: [4, 4, 4] })];
    const twice = [...stepped, ...compared("g1", "h1", "step", { tally: [4, 0, 3] }), ...later];
    expect(decide(twice, PLAN)).toEqual({
      move: "promote",
      code: "twice",
      harness: "h1",
      why: "harness h1 read a step and its repeat, and was not promoted: what later sessions left is read against it once it is the reference",
    });
    // Promoted, the comparison made against it by name is the campaign's, and the table reads it.
    expect(move([...twice, promotion("h1")])).toEqual({
      move: "build",
      why: "comparison b-2 read no step with room to gain: harness h2 did not help",
    });
    // One step is one draw, whatever came after it, and its repeat is owed while no later harness
    // has been read against the reference.
    expect(move([...stepped, ...later])).toMatchObject({ move: "compare", fresh: "h1", repeats: "g-1" });
  });

  it("no-room: the tasks change where the reference's last reading left it nothing to gain", () => {
    const first = [setting(40), ...FIRST];
    const tied = [...first, ...compared("g-1", "h1", "no-step", { tally: [0, 0, 24], solved: EVERY })];
    // Until 10 October a shorter budget came first, and t-10 climbed in turns where it should have
    // climbed in tasks.
    expect(decide(tied, PLAN)).toEqual({ move: "examine", code: "no-room", why: NO_ROOM("g-1") });
    // Room is a task informative for the reference: valid on some solves and not all (12 October,
    // one definition for `try_task` and the table). Eight answered on every solve and four by
    // nobody tell it nothing; until then that was room, read as a share of valid solves.
    const read = (old: Valid, extra: JsonObject = {}) =>
      compared("g-1", "h1", "no-step", { tally: [0, 0, 12], valid: { old, fresh: [4, 0, 8] }, extra });
    expect(
      move([...first, ...read([4, 0, 8], { scored: { wins: 0, losses: 0, ties: 12, unsolved: 4 } })]),
    ).toEqual({
      move: "examine",
      why: NO_ROOM("g-1"),
    });
    expect(move([...first, ...read([4, 1, 7])])).toMatchObject({ move: "build" });
    // Neither harness answered: other tasks, at the one budget the campaign runs at. Until 11
    // October the next longer budget of a ladder came first here.
    const nobody = [
      ...first,
      ...compared("g-1", "h1", "no-step", { tally: [0, 0, 12], valid: { old: NONE, fresh: NONE } }),
    ];
    expect(decide(nobody, PLAN)).toEqual({
      move: "examine",
      code: "no-room",
      why: "comparison g-1 read no step, and neither harness gave a valid answer: other tasks are written",
    });
    // One task written since is too few for the next comparison (a first reading takes two untied).
    expect(move([...tied, ...examined("x-1", ["v13"])])).toMatchObject({ move: "examine" });
    // The harness now the reference is read from the last comparison it was in, whichever side it
    // took: one promoted on tasks it answered in every solve has them changed, and one valid on
    // half is built against on the same tasks. No Examiner session is a promotion's own.
    expect(decide(promotedOn(ALL), PLAN)).toEqual({
      move: "examine",
      code: "no-room",
      why: "harness h1 is the reference, and comparison g-2 found no task informative for it: the tasks have to change, to ones it fails on some solves",
    });
    expect(move(promotedOn(HALF))).toMatchObject({ move: "build" });
    // A comparison made against it by name before the promotion has read the tasks.
    const stepped = [
      ...FIRST,
      ...compared("g-1", "h1", "step", { tally: [8, 0, 4] }),
      ...compared("g-2", "h1", "step", { tally: [4, 0, 3] }),
      built("b-2", "h2"),
    ];
    const named = compared("b-3", "h2", "no-step", { old: "h1", ...FULL });
    expect(move([...stepped, ...named, promotion("h1")])).toEqual({ move: "examine", why: NO_ROOM("b-3") });
  });

  it("short: tasks are written where the gate would refuse the next comparison for want of them", () => {
    // A campaign that holds four tasks, three of them closed by the reference, valid in every
    // solve: one to win, where a first reading takes two, and the reference at three solves in
    // four leaves room. At twelve tasks the two cannot both hold since 10 October's trigger: one
    // task to untie means eleven closed, which is no room, and the no-room row answers.
    const small = { ...PLAN, wanted: { ...PLAN.wanted, target: 4 } };
    const tied = [
      READ,
      ...HELD.slice(0, 4).flatMap(heldOut),
      ...RELEASED,
      built("b-1", "h1"),
      ...compared("g-1", "h1", "no-step", {
        tally: [1, 0, 3],
        // v1 is informative for the reference, valid on one solve of two: room (`informative`).
        solved: { v1: "PF PP", v2: "PP PP", v3: "PP PP", v4: "PP PP" },
      }),
    ];
    // Before another session as much as after one: t-2 (10 October) got two unchanged sessions and
    // a stop where an Examiner session was the move.
    expect(decide(tied, small)).toEqual({
      move: "examine",
      code: "short",
      why: SHORT_WHY,
    });
    expect(move([...tied, built("b-2", "h2")], small)).toEqual({ move: "examine", why: SHORT_WHY });
    // Tasks held out since count whole, and the comparison is admitted.
    const more = ["v13", "v14", "v15", "v16"].flatMap(heldOut);
    expect(move([...tied, built("b-2", "h2"), ...more], small)).toMatchObject({ move: "compare" });
    // A comparison that tallied no task says nothing of the ones it set aside.
    const aside = compared("g-1", "h1", "not-scored", { extra: { versions: [], aside: HELD } });
    expect(decide([...FIRST, ...aside], PLAN)).toEqual({
      move: "examine",
      code: "short",
      why: "comparison g-1 tallied no task",
    });
  });

  it("unread: what no comparison has read is compared before anything is built", () => {
    // A harness whose sessions have run: one a comparison until set-up stands (epoch 0), since a
    // session's worth is enough to read against the empty Starter, and the plan's after. The
    // reference against itself is read beside a comparison of four solves a side, and no move of
    // the table.
    const three = { ...PLAN, sessions: 3 };
    expect(decide(FIRST, PLAN)).toEqual({
      move: "compare",
      code: "unread",
      fresh: "latest",
      reference: "promoted",
      why: "harness h1 has not been compared under the campaign's setting",
    });
    const lost = [...FIRST, ...compared("g-1", "h1", "no-step")];
    expect(move([...lost, built("b-2", "h2")], three)).toMatchObject({ move: "compare", fresh: "latest" });
    const after = [
      ...FIRST,
      ...compared("g-1", "h1", "step"),
      ...compared("g-2", "h1", "step"),
      promotion("h1", { from: "start" }),
    ];
    expect(move([...after, built("b-2", "h2")], three)).toEqual({
      move: "build",
      why: "1 of 3 Builder sessions before the next comparison have run",
    });
    expect(move([...after, built("b-2", "h2"), built("b-3", "h3"), built("b-4", "h4")], three)).toEqual({
      move: "compare",
      fresh: "latest",
      reference: "promoted",
      why: "3 Builder sessions since the last comparison left harness h4",
    });

    // Tasks held out since the pair's last reading: the same two are compared on them. t-3 (10
    // October) built twice on the tasks its Examiner had just written and stopped before comparing.
    const six = ["v13", "v14", "v15", "v16", "v17", "v18"].flatMap(heldOut);
    const since = (reading: LogEvent[], why: string) => {
      expect(decide([...FIRST, ...reading, ...six], PLAN)).toMatchObject({
        move: "compare",
        code: "unread",
        fresh: "latest",
        why,
      });
    };
    since(
      compared("g-1", "h1", "no-step"),
      "comparison g-1 read no step with room to gain, and tasks were written since: harness h1 is compared on them",
    );
    since(full("g-1"), "comparison g-1 left no room, and tasks were written since");
    since(
      compared("g-1", "h1", "no-step", { tally: [0, 0, 12], valid: { old: NONE, fresh: NONE } }),
      "comparison g-1 left neither harness an answer, and tasks were written since",
    );
    since(
      compared("g-1", "h1", "not-scored", { extra: { versions: [], aside: HELD } }),
      "comparison g-1 tallied no task, and tasks were written since",
    );

    // With no harness but the reference, tasks held out since are read by a control before a
    // Builder session is paid for: t-4, t-9 and t-10 (10 October) built three times here instead.
    const written = [...promotedOn(ALL), ...examined("x-1", ["v13"])];
    expect(decide(written, PLAN)).toEqual({
      move: "compare",
      code: "unread",
      fresh: "starter",
      reference: "promoted",
      why: "harness h1 is the reference, and 1 task was held out since the last comparison: the starter is compared with it on them, to read whether they leave it room before a Builder session is paid for",
    });
    // The control read, its room decides: room, and the Builder builds; none, and the tasks change.
    // The starter winning on the new tasks is room by another name, and no step to repeat.
    const control = (reading: string, old: Valid, tally: [number, number, number]) => [
      ...written,
      ...compared("g-3", "start", reading, { old: "h1", tally, valid: { old, fresh: HALF } }),
    ];
    expect(move(control("no-step", HALF, [2, 2, 8]))).toEqual({
      move: "build",
      why: "comparison g-3 read the starter against harness h1 on the tasks held out since, and they leave it room: the Builder builds",
    });
    expect(move(control("step", [8, 2, 2], [6, 0, 6]))).toMatchObject({ move: "build" });
    expect(move(control("no-step", ALL, [0, 0, 12]))).toMatchObject({ move: "examine" });

    // A promotion owes no reading of its own: until 16 October the starter was read against each
    // later epoch's reference once, a reading no row went on to read.
    expect(move(PROMOTED)).toMatchObject({ move: "build" });
    const second = [
      ...PROMOTED,
      built("b-2", "h2"),
      ...steppedTwice("g-2", "h2", "h1"),
      promotion("h2", { from: "h1" }),
    ];
    expect(move(second)).not.toMatchObject({ fresh: "starter" });
  });

  it("build: with nothing new to read and room to gain, the Builder builds", () => {
    expect(decide(SET_UP, PLAN)).toEqual({
      move: "build",
      code: "build",
      why: "no session has left a harness that is not the reference harness",
    });
    expect(move([...FIRST, ...compared("g-1", "h1", "no-step")])).toEqual({
      move: "build",
      why: "comparison g-1 read no step with room to gain: harness h1 did not help",
    });
    expect(move([...FIRST, ...compared("g-1", "h1", "below-starter")])).toMatchObject({ move: "build" });
  });
});

describe("a hold on the move a row named", () => {
  it("risk: a comparison past a quarter's chance of a false promotion this epoch waits for an A/A or a cause", () => {
    // One attempt read at a level of 0.3, with no A/A on record: its bound is the level.
    const risky = [
      ...FIRST,
      ...compared("g-1", "h1", "no-step", { extra: { frontier: { wins: 4, losses: 4 }, level: 0.3 } }),
      built("b-2", "h2"),
    ];
    expect(decide(risky, PLAN)).toEqual({
      move: "end",
      ending: "control",
      code: "risk",
      why: "a false promotion is at most 30% over 1 attempt under this reference, past a quarter, and comparison g-1 read no A/A: run a comparison of four solves a side (tools/d2/checkpoint.ts --solves 4), or leave the cause with tools/d2/word.ts --cause, and the campaign goes on when run again",
    });
    const cause = event("campaign.word", { word: "cause", why: "the host was loaded" });
    expect(move([...risky, cause])).toMatchObject({ move: "compare", fresh: "latest" });
    const safe = risky.map((each) =>
      each.kind === "comparison.reported" ? { ...each, data: { ...each.data, level: 0.02 } } : each,
    );
    expect(move(safe)).toMatchObject({ move: "compare", fresh: "latest" });
    // The A/A a comparison of four solves a side writes in its report is the one asked for.
    const aa = { noise: { wins: 0, losses: 0, ties: 4, differences: [0, 0, 0, 0] } };
    const read = risky.map((each) =>
      each.kind === "comparison.reported" ? { ...each, data: { ...each.data, ...aa } } : each,
    );
    expect(move(read)).toMatchObject({ move: "compare", fresh: "latest" });
  });

  it("afford: a comparison that what is left would not hold is not begun, by what the last one billed", () => {
    // A step read once, by a comparison of two sides whose solves billed 1.00 in all: the repeat
    // solves two sides again, and would bill about 1.00. On 9 October a campaign with $1.45 left
    // began a comparison after one that had billed $1.00, and was cut after $1.06.
    const solve = (id: string, billed: number) => [
      event("solve.started", { solve: id, comparison: "g-1" }),
      event("solve.finished", { solve: id, billed, ending: { outcome: "pass" } }),
    ];
    const [start, report] = compared("g-1", "h1", "step", { tally: [10, 0, 2] });
    const log = [
      ...FIRST,
      ...(start === undefined ? [] : [start]),
      ...solve("s-1", 0.6),
      ...solve("s-2", 0.4),
      ...(report === undefined ? [] : [report]),
    ];
    const left = (dollars: number) => ({ ...PLAN, left: { dollars, reserve: 0.4 } });
    expect(decide(log, left(0.95))).toEqual({
      move: "end",
      ending: "budget",
      code: "afford",
      why: "$0.95 of the campaign's budget are left, and comparison g-1 billed $1.00: the next would bill about as much, so it would be cut before it reports",
    });
    expect(move(log, left(1))).toMatchObject({ move: "compare" });
    // A campaign with no total is held to none, and before any comparison has reported nothing
    // says what one bills.
    expect(move(log)).toMatchObject({ move: "compare" });
    expect(move(FIRST, left(0.5))).toMatchObject({ move: "compare" });
    // Before one has, the reference harness's solves of draft tasks price the first: until
    // 14 October nothing held it, and buffer-149's gate billed about $0.43 a solve.
    // The price is a solve started: a gate whose third solve gave no reading billed it all the same.
    const tried = { reference: { billed: 0.9, solves: 2 } };
    const gated = FIRST.map((each) =>
      each.kind === "task.gate" ? { ...each, data: { ...each.data, ...tried } } : each,
    );
    expect(decide(gated, left(0.5))).toMatchObject({ move: "end", ending: "budget", code: "afford" });
    expect(decide(gated, left(0.5))).toMatchObject({
      why: expect.stringContaining("the reference harness's solves of draft tasks billed $0.30 a solve"),
    });
    expect(move(gated, left(1000))).toMatchObject({ move: "compare" });
    // The Examiner session a row names is held too: where the last one and the comparison that read
    // its tasks billed more than half of what is left, the campaign ends on its budget before another
    // round.
    const dear = [...FIRST, ...full("g-1"), ...examined("x-1", ["v13"], { billed: 6 }), ...full("g-2")];
    const reserved = (dollars: number) => ({ ...PLAN, left: { dollars, reserve: 0.5 } });
    expect(decide(dear, reserved(10))).toMatchObject({ move: "end", ending: "budget", code: "afford" });
    expect(move(dear, reserved(13))).toMatchObject({ move: "examine" });
  });

  it("practice: practice is brought towards the campaign's count before a Builder session", () => {
    const plan = { ...PLAN, practice: 3 };
    // One task is released of the three named, and nothing was held out since: a release takes
    // half of what is held once, and the Builder builds. On 9 October a campaign released two of
    // its five examples, held out sixteen more, and both its sessions practised on the same two.
    expect(move(SET_UP, plan)).toMatchObject({ move: "build" });
    const more = [...SET_UP, ...heldOut("v13")];
    expect(decide(more, plan)).toEqual({
      move: "prepare",
      code: "practice",
      why: "1 of the 3 practice tasks the campaign names are released, and tasks were held out since the last release: the contract's draw releases more before the Builder builds",
    });
    // The same before a later session, and once it released the campaign builds.
    const lost = compared("g-1", "h1", "no-step", { tally: [2, 6, 4] });
    const later = [...FIRST, ...heldOut("v13"), ...lost];
    expect(move(later, plan)).toMatchObject({ move: "prepare" });
    const released = event("task.state", { version: "v13", state: "released" });
    expect(move([...later, released], plan)).toMatchObject({ move: "build" });
    // Left as it is where the count is reached, where none is held, and where the setting names
    // the tasks to score: all but one are named, and half of the one left is none.
    expect(move(more, { ...PLAN, practice: 1 })).toMatchObject({ move: "build" });
    expect(move(more)).toMatchObject({ move: "build" });
    const named = event("campaign.setting", {
      solver: null,
      minutes: 120,
      turns: 24,
      modelTurns: null,
      tasks: [...HELD, ...REPEAT],
      target: 6,
    });
    expect(move([named, ...more], plan)).toMatchObject({ move: "build" });
    // A comparison is no Builder session: the release waits for one.
    expect(move([...more, built("b-1", "h1")], plan)).toMatchObject({ move: "compare" });
    // After a control that read room, practice is brought up by as many again, the tasks the
    // reference failed first.
    const room = [
      ...promotedOn(ALL),
      ...examined("x-1", ["v13"]),
      ...compared("g-3", "start", "no-step", { old: "h1", tally: [2, 2, 8] }),
    ];
    expect(move(room, plan)).toEqual({
      move: "prepare",
      practice: 4,
      why: "comparison g-3 read room in the tasks held out since the last release: the ones the reference harness failed are released first, up to 3 more practice tasks, before the Builder builds",
    });
  });

  it("practice: the count named is an epoch's, so a promotion has practice released again", () => {
    // Three released before the promotion, as in main0_5_1, buffer-159-opus and recode-151: until
    // 16 October none was released after it, and every practice solve after it passed.
    const releases = ["v1", "v2", "v3"].map((version) => event("task.state", { version, state: "released" }));
    const promoted = [...releases, ...promotedOn(ALL)];
    expect(epochReleased(promoted)).toEqual({ promotedAt: promoted.length - 1, epoch: 0 });
    expect(epochReleased(releases)).toEqual({ promotedAt: -1, epoch: 3 });
    const after = [...promoted, event("task.state", { version: "v13", state: "released" })];
    expect(epochReleased(after).epoch).toBe(1);
  });

  it("practice: an epoch releases at most one in four of its tasks, and leaves a sweep held", () => {
    // Each release is one task fewer to compare. Before a promotion the opening's release governs.
    const eight = HELD.slice(0, 8).flatMap(heldOut);
    expect(practiceRoom(eight, 0.1)).toBe(Infinity);
    // Eight held after a promotion: two may go. One released, one more.
    // Held after it: a task held out before the promotion that the promoted harness has stood in
    // no comparison of is retained, and no room (`poolOf`).
    expect(practiceRoom([...eight, promotion("h1")], 0.1)).toBe(0);
    const promoted = [promotion("h1"), ...eight];
    expect(practiceRoom(promoted, 0.1)).toBe(2);
    const one = [...promoted, event("task.state", { version: "v1", state: "released" })];
    expect(practiceRoom(one, 0.1)).toBe(1);
    // Five held leave one over the four a sweep at 0.1 takes, and four none.
    expect(practiceRoom([promotion("h1"), ...HELD.slice(0, 5).flatMap(heldOut)], 0.1)).toBe(1);
    expect(practiceRoom([promotion("h1"), ...HELD.slice(0, 4).flatMap(heldOut)], 0.1)).toBe(0);
    // Four the promoted harness answered in every solve leave four it may win, and a sweep takes
    // four: a task it closed can only tie, and is no room. buffer-159-opus held 28 after its
    // promotion, 14 of them exhausted and 6 frontier, and counted over the 28 the room was 7.
    const closed = compared("g-3", "start", "no-step", {
      old: "h1",
      tally: [0, 0, 4],
      solved: Object.fromEntries(HELD.slice(0, 4).map((version) => [version, "PP FF"])),
    });
    expect(practiceRoom([...promoted, ...closed], 0.1)).toBe(0);
    // The table asks for no more than the room: after a control that read room, three more named,
    // and nine held leave room for two beside the one released before the promotion.
    const plan = { ...PLAN, practice: 3 };
    const control = compared("g-3", "start", "no-step", { old: "h1", tally: [2, 2, 8] });
    const read = [READ, ...eight, ...RELEASED, promotion("h1"), built("b-1", "h2"), ...heldOut("v13")];
    expect(move([...read, ...control], plan)).toMatchObject({ move: "prepare", practice: 3 });
  });

  it("unshown: a session that changed nothing and was shown no failed practice solve sends for tasks", () => {
    // It had nothing to work on, which is the supply's fault: the tasks change before another
    // session is paid for. Such a session counts nothing towards the stop.
    const unchanged = [...SET_UP, built("b-1", "start", { changed: false })];
    expect(decide(unchanged, PLAN)).toEqual({
      move: "examine",
      code: "unshown",
      why: "Builder session b-1 left its harness as it was, and no practice solve of its failed: it had nothing to work on, so the tasks have to change before another session is paid for",
    });
    // Tasks held out since the session ended are what it lacked, and the Builder builds on them.
    expect(move([...unchanged, ...heldOut("v13")])).toMatchObject({ move: "build" });
  });
});

describe("the order of the rows", () => {
  it("reads a stop before the exam, the exam before the total, and the provider before a want of tasks", () => {
    const spent = { ...PLAN, left: { dollars: 4.5, reserve: 10 } };
    expect(code([event("campaign.word", { word: "stop" })], spent)).toBe("stop");
    // Reading the exam bills nothing, whatever is left.
    expect(decide([], spent)).toMatchObject({ move: "accept", code: "exam" });
    const crashed = (id: string) =>
      event(EXAM_FINISHED, { session: id, held: [], refused: [], proposed: 0, ended: "crashed", crash: "x" });
    expect(decide([READ, crashed("x-1"), crashed("x-2"), crashed("x-3")], PLAN)).toMatchObject({
      ending: "environment",
      code: "bound",
    });
    // A step and its repeat promote though the pair's last reading cleared the trigger again.
    const twice = [...FIRST, ...compared("g-1", "h1", "step"), ...compared("g-2", "h1", "step")];
    expect(code(twice)).toBe("twice");
  });
});

describe("the one count", () => {
  const WRITTEN = "the tasks could not be written";
  const ROOM = "the tasks could not be made to leave room";

  it("ends the campaign where as many readings in a row as its patience left nothing to gain", () => {
    // A reading is a reported comparison that left the reference no room, or a whole Examiner
    // session that held out no task. Asked for tasks, the campaign ends on its exam.
    expect(move([READ, ...idle(2)])).toMatchObject({ move: "examine" });
    expect(decide([READ, ...idle(3)], PLAN)).toEqual({
      move: "end",
      ending: "exam",
      code: "tasks",
      why: `3 Examiner sessions in a row held out no task (the campaign holds no task): ${WRITTEN}`,
    });
    expect(move([...SIX, built("b-1", "h1"), ...idle(3)])).toMatchObject({ move: "end", ending: "exam" });
    // Asked for room, on its room: comparisons and sessions count together. The comparison that
    // raised the want is no answer to it: one on the pack's tasks ends nothing.
    const tied = [...FIRST, ...full("g-1")];
    expect(move([...tied, ...idle(2)])).toMatchObject({ move: "examine" });
    expect(decide([...tied, ...idle(3)], PLAN)).toEqual({
      move: "end",
      ending: "no-room",
      code: "no-room",
      why: `4 readings in a row left nothing to gain: comparison g-1 left the reference no room and 3 Examiner sessions held out no task (${NO_ROOM("g-1")}): ${ROOM}`,
    });
    expect(move([...tied, ...full("g-2"), ...full("g-3")])).toMatchObject({ move: "examine" });
    expect(move([...tied, ...full("g-2"), ...full("g-3"), ...full("g-4")])).toMatchObject({
      move: "end",
      ending: "no-room",
    });
    expect(move([...tied, ...idle(1)], { ...PLAN, patience: 1 })).toMatchObject({ move: "end" });
    expect(move(tied, { ...PLAN, patience: 1 })).toMatchObject({ move: "examine" });
    // A promotion starts the count again: the step and its repeat a harness was promoted on, in
    // which it answered every task, are no answer to a want of room.
    expect(move([...promotedOn(ALL), ...idle(2)])).toMatchObject({ move: "examine" });
    expect(move([...promotedOn(ALL), ...idle(3)])).toMatchObject({ move: "end", ending: "no-room" });
  });

  it("passes over a session whose tasks a comparison read, and starts again at room or at tasks nobody has read", () => {
    // esp32-141-m3b (12 October): every Examiner session held out tasks, which reset a count of
    // idle sessions, and every comparison on them left the reference none, five times over.
    const round = (nth: number) => [
      ...examined(`x-${String(nth)}`, [`v${String(12 + nth)}`]),
      ...full(`g-${String(nth + 1)}`),
    ];
    const twice = [...FIRST, ...full("g-1"), ...round(1), ...round(2)];
    expect(move(twice)).toMatchObject({ move: "examine" });
    expect(decide([...twice, ...round(3)], PLAN)).toEqual({
      move: "end",
      ending: "no-room",
      code: "no-room",
      why: `4 readings in a row left nothing to gain: comparisons g-1, g-2, g-3, g-4 left the reference no room (${NO_ROOM("g-4")}): ${ROOM}`,
    });
    // Room in between starts the count again.
    const roomy = compared("g-4", "h1", "no-step", { tally: [0, 0, 12] });
    expect(move([...twice, ...examined("x-3", ["v15"]), ...roomy])).toMatchObject({ move: "build" });
    // A session that held a task out which no comparison has read moved the campaign, however few
    // it wrote: on 9 October a campaign ended on three sessions that had written four tasks
    // between them. The count starts after it.
    const closed = compared("g-1", "h1", "no-step", { tally: [0, 0, 24], solved: EVERY });
    const few = [...FIRST, ...closed, ...examined("x-1", ["v13"])];
    expect(move([...few, ...idle(2)])).toMatchObject({ move: "examine" });
    expect(move([...few, ...idle(3)])).toMatchObject({ move: "end", ending: "no-room" });
    expect(move([READ, ...idle(2), ...examined("x-8", ["v9"]).slice(0, 1), ...idle(1)])).toMatchObject({
      move: "examine",
    });
    // A session the provider failed is no reading: it was given no chance to write.
    const crashed = event(EXAM_FINISHED, {
      session: "x-7",
      held: [],
      refused: [],
      proposed: 0,
      ended: "crashed",
    });
    expect(move([READ, ...idle(2), crashed])).toMatchObject({ move: "examine" });
    expect(move([READ, ...idle(2), crashed, ...idle(1)])).toMatchObject({ move: "end", ending: "exam" });
  });
});

describe("a promotion by hand", () => {
  it("is the plan's where the harness read a step and its repeat, and says why where not", () => {
    const stepped = [...FIRST, ...compared("g-1", "h1", "step", { tally: [8, 0, 4] })];
    expect(unpromoted(stepped, PLAN, "h1")).toBe(
      "harness h1 has no comparison and repeat that, read together, clear the level against the reference harness",
    );
    const again = [...stepped, ...compared("g-2", "h1", "step", { tally: [10, 0, 2] })];
    expect(unpromoted(again, PLAN, "h1")).toBeNull();
    // Another harness of the campaign rests on nothing.
    expect(unpromoted(again, PLAN, "h9")).toContain(
      "harness h9 has no comparison and repeat that, read together, clear the level",
    );
    // A record of the setting after the step changes nothing: a campaign runs at one setting, and
    // until 2026-10-11 a step read before a second record was none under the campaign's.
    expect(unpromoted([...again, setting(10)], PLAN, "h1")).toBeNull();
  });
});
