import { describe, expect, it } from "bun:test";
import { decide, practiceRoom, shortOf, unpromoted } from "../src/campaign/decide.ts";
import type { Plan } from "../src/campaign/ground.ts";
import { pendingWords } from "../src/campaign/word.ts";
import { tally as tallyPairs } from "../src/kernel/compare.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import { pairsReported, lastReports, poolOf, releaseOrder, stopRule } from "../src/kernel/reports.ts";
import { conditionId } from "../src/kernel/condition.ts";
import { taskSets } from "../src/kernel/task.ts";
import { isString, type JsonObject } from "../src/meta/json-shape.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { tallied } from "./helpers/tally.ts";
import { conditionOf, roundSolves } from "./helpers/logged-round.ts";

/** Tasks by how many of their two solves were valid: none, one, both. */
type Valid = readonly [number, number, number];

const at = "2026-10-09T00:00:00.000Z";
const HELD = ["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8", "v9", "v10", "v11", "v12"];
const HALF: Valid = [4, 4, 4];
const ALL: Valid = [0, 0, 12];
const NONE: Valid = [12, 0, 0];
const PLAN: Plan = {
  sessions: 1,
  patience: 3,
  unprepared: false,
  practice: null,
  wanted: { target: 12, level: 0.1 },
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
/** A second target's worth of held-out tasks. */
const REPEAT = HELD.map((version) => `r${version}`);
const RELEASED = [...heldOut("p1"), event("task.state", { version: "p1", state: "released" })];
/** Two targets of held-out tasks and one practice task. */
const SET_UP = [READ, ...HELD.flatMap(heldOut), ...REPEAT.flatMap(heldOut), ...RELEASED];
/** The same with one target's worth held out, and with six of the twelve a comparison scores. */
const ONE = SET_UP.filter(({ data }) => !(isString(data.version) && REPEAT.includes(data.version)));
const SIX = [READ, ...HELD.slice(0, 6).flatMap(heldOut), ...RELEASED];
/** One short of the admission floor at the plan's level, six. */
const FIVE = SIX.filter(({ data }) => data.version !== HELD[5]);
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
    /** Actual solve events and their terms, when a reader needs them. */
    readonly solved?: Readonly<Record<string, string>>;
  } = {},
): LogEvent[] {
  const sides = { old: more.old ?? "start", fresh, starter: "start" };
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
/** Every held task, both targets' worth, answered by both in every solve: none is left unread. */
const EVERY = Object.fromEntries([...HELD, ...REPEAT].map((version) => [version, "PP PP"]));
/** Decision fields; message facts are checked separately where they carry ids or limits. */
const move = (events: readonly LogEvent[], plan: Plan = PLAN) => {
  const { code: _code, why: _why, ...decided } = decide(events, plan);
  return decided;
};
const promotion = (harness: string, more: JsonObject = {}) => event("harness.promoted", { harness, ...more });
/** A harness that read a step against `old` twice, as two comparisons, as until 19 October. */
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

const promotedAll = promotedOn(ALL);
const promotedHalf = promotedOn(HALF);

describe("a row of the table", () => {
  it("stop: a stop the operator left ends the campaign, once", () => {
    const word = (data: JsonObject) => event("campaign.word", data);
    const stopped = [...FIRST, word({ word: "tasks" }), word({ word: "stop", why: "the host is needed" })];
    expect(decide(stopped, PLAN)).toMatchObject({
      move: "end",
      ending: "operator",
      code: "stop",

      answers: [FIRST.length, FIRST.length + 1],
    });
    expect(decide(stopped, PLAN).why).toContain("the host is needed");
    const ended = event("campaign.ended", { ending: "operator", answers: [FIRST.length, FIRST.length + 1] });
    expect(move([...stopped, ended])).toMatchObject({ move: "compare" });
    expect(pendingWords([...stopped, ended])).toEqual([]);
    expect(move([word({ word: "stop" })])).toMatchObject({ ending: "operator" });
  });

  it("reads a stop before the exam, the exam before the total, and the provider before a want of tasks", () => {
    const spent = { ...PLAN, left: { dollars: 4.5, reserve: 10 } };
    expect(decide([event("campaign.word", { word: "stop" })], spent).code).toBe("stop");
    expect(decide([], spent)).toMatchObject({ move: "accept", code: "exam" });
    const crashed = (id: string) =>
      event(EXAM_FINISHED, { session: id, held: [], refused: [], proposed: 0, ended: "crashed", crash: "x" });
    expect(decide([READ, crashed("x-1"), crashed("x-2"), crashed("x-3")], PLAN)).toMatchObject({
      ending: "environment",
      code: "bound",
    });
  });
});

describe("the exam", () => {
  it("exam: an exam that does not stand is drafted, read, or ends the campaign", () => {
    const held = HELD.flatMap(heldOut);
    expect(decide([], PLAN)).toMatchObject({ move: "accept", code: "exam" });
    const faulty = event("checker.read", { contract: "c", checks: "k", faults: ["check-a: authored"] });
    expect(decide([faulty, ...held], PLAN)).toMatchObject({ move: "end", ending: "exam", code: "exam" });
    const rows = ["check-a", "check-b", "check-c"].map((id) => ({ id, instrument: "author" }));
    const drafted = event("checker.read", { faults: ["two"], rows, admitted: ["check-b"] });
    expect(decide([drafted, ...held], PLAN).why).toContain("--admit check-a,check-c");
    const frozen = event("contract.frozen", { contract: "c", checks: "k", admitted: ["check-a"] });
    expect(move([faulty, frozen, ...SET_UP.slice(1)])).toMatchObject({ move: "build" });
    const reading = (admitted: readonly string[], faults: readonly string[]) =>
      event("checker.read", { contract: "c", checks: "k", faults: [...faults], admitted: [...admitted] });
    const admits = { ...PLAN, admits: ["check-a"] };
    const unadmitted = [reading([], ["check-a stands on the operator's word alone"]), ...held];
    expect(move(unadmitted)).toMatchObject({ move: "end", ending: "exam" });
    expect(move(unadmitted, admits)).toEqual({ move: "accept" });
    expect(decide(unadmitted, admits).why).toContain("check-a");
    const left = [reading(["check-a"], ["check-b has refused nothing"]), ...held];
    expect(move(left, admits)).toMatchObject({ move: "end", ending: "exam" });

    const plan = { ...PLAN, prompted: true };
    expect(decide([], plan)).toMatchObject({
      move: "draft",
      code: "exam",
    });
    const fell = (tries: number) => event("draft.finished", { session: "d-1", stands: false, tries });
    expect(move([fell(2)], plan)).toEqual({ move: "draft" });
    expect(decide([fell(2)], plan).why.match(/\d+/g)).toEqual(["2", "1"]);
    expect(decide([fell(2), fell(1)], plan).why.match(/\d+/g)).toEqual(["3", "2"]);
    expect(move([fell(2), fell(1)], plan)).toEqual({
      move: "end",
      ending: "exam",
    });
    expect(move([fell(0), fell(0), fell(0)], plan)).toMatchObject({ move: "end", ending: "exam" });
    const crashed = event("draft.finished", {
      session: "d-1",
      stands: false,
      tries: 0,
      ended: "crashed",
      crash: "exited 1",
    });
    expect(move([crashed, crashed, crashed], plan)).toEqual({ move: "end", ending: "environment" });
    expect(decide([crashed, crashed, crashed], plan).why).toContain("exited 1");
    expect(move([crashed, fell(1), crashed], plan)).toMatchObject({ move: "draft" });
    expect(move([crashed, crashed], plan)).toMatchObject({ move: "draft" });
    const ended = event("campaign.ended", { ending: "environment", why: "no draft was put" });
    expect(move([crashed, crashed, crashed, ended], plan)).toMatchObject({ move: "draft" });
    expect(move([crashed, crashed, crashed, ended, crashed, crashed, crashed], plan)).toMatchObject({
      ending: "environment",
    });
    expect(move([fell(2), crashed, crashed, ended], plan)).toEqual({ move: "draft" });
    expect(decide([fell(2), crashed, crashed, ended], plan).why.match(/\d+/g)).toEqual(["2", "1"]);
    expect(move([fell(2), ended, fell(1)], plan)).toMatchObject({ ending: "exam" });
    const stood = event("exam.drafted", { session: "d-1", draft: { domain: "a field" } });
    expect(move([fell(1), stood], plan)).toMatchObject({ move: "accept" });
  });
});

describe("the campaign bounds", () => {
  it("ends on spent bounds, counts crashes and patience, and keeps A/A beside promotions", () => {
    const spent = { ...PLAN, left: { dollars: 4.5, reserve: 10 } };
    expect(decide(FIRST, spent)).toMatchObject({
      move: "end",
      ending: "budget",
      code: "bound",
    });
    expect(decide(FIRST, spent).why.match(/\d+(?:\.\d+)?/g)).toEqual(["4.50", "10"]);
    expect(move(FIRST, { ...PLAN, left: { dollars: 10, reserve: 10 } })).toMatchObject({ move: "compare" });

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
    expect(decide(dead, PLAN)).toMatchObject({
      move: "end",
      ending: "environment",
      code: "bound",
    });
    expect(decide(dead, PLAN).why).toContain("limit reached");
    expect(decide(dead, PLAN).why.match(/\d+/g)).toEqual(["3"]);
    const moved = crashed(EXAM_FINISHED, "x-8", ["v9"]);
    expect(move([READ, x1, moved, x2, x3])).toMatchObject({ move: "examine" });
    expect(move([READ, x1, x2, ...whole, x3])).toMatchObject({ move: "examine" });
    const edited = (id: string) => event("build.finished", { session: id, ended: "crashed", changed: true });
    expect(decide([READ, ...whole, edited("b-1"), edited("b-2"), edited("b-3")], PLAN)).toMatchObject({
      move: "end",
      ending: "environment",
    });
    const kept = event("build.checkpoint", { session: "b-2", harness: "h-kept" });
    expect(
      decide([READ, ...whole, edited("b-1"), kept, edited("b-2"), edited("b-3")], PLAN),
    ).not.toMatchObject({ ending: "environment" });
    const halted = event("build.finished", { session: "b-2", ended: "stopped", changed: false });
    expect(decide([...dead, halted], PLAN)).toMatchObject({ move: "end", ending: "environment" });
    const ended = event("campaign.ended", { ending: "environment", why: "3 sessions in a row crashed" });
    expect(move([...dead, ended])).toMatchObject({ move: "examine" });
    expect(move([...dead, ended, x1, x2])).toMatchObject({ move: "examine" });

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
    expect(decide([opened, ...SET_UP, ...flat], PLAN)).toMatchObject({
      move: "end",
      ending: "stop",
      code: "bound",
    });
    expect(decide([opened, ...SET_UP, ...flat], PLAN).why.match(/\d+/g)).toEqual(["3", "3"]);
    expect(move([opened, ...SET_UP, ...flat], { ...PLAN, pastStop: "new tasks since" })).toMatchObject({
      move: "build",
    });
    expect(move([...SET_UP, ...flat])).toMatchObject({ move: "build" });

    const aa = (apart: readonly number[]) =>
      compared("g-1", "h1", "step", {
        tally: [8, 0, 4],
        extra: { level: 0.1, noise: { wins: 0, losses: 0, ties: 4, differences: [...apart] } },
      });
    const epoch = (apart: readonly number[]) => [...FIRST, ...aa(apart)];
    for (const apart of [[2, 2, 2, 2, 2], [-2, -2, -2, -2, -2], [2, -2, 0, 0], []]) {
      expect(move(epoch(apart))).toMatchObject({ move: "promote", harness: "h1" });
    }
    const cause = event("campaign.word", { word: "cause", why: "the host was loaded while g-1 ran" });
    expect(decide([...epoch([2, 2, 2, 2, 2]), cause], PLAN)).toEqual(decide(epoch([2, 2, 2, 2, 2]), PLAN));

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
});

describe("task supply", () => {
  it("tasks: tasks not set up are taken in, written or released before anything is built", () => {
    expect(decide([READ], { ...PLAN, unprepared: true })).toMatchObject({ move: "prepare", code: "tasks" });
    expect(decide([READ], PLAN)).toMatchObject({
      move: "examine",
      code: "tasks",
    });
    expect(move([READ, ...HELD.flatMap(heldOut)])).toEqual({
      move: "prepare",
    });
    expect(move([READ, ...HELD.flatMap(heldOut)], { ...PLAN, practice: 0 })).not.toMatchObject({
      move: "prepare",
    });
    const word = (data: JsonObject) => event("campaign.word", data);
    expect(decide([...FIRST, word({ word: "tasks", why: "three batches tied" })], PLAN)).toMatchObject({
      move: "examine",
      code: "tasks",

      answers: [FIRST.length],
    });
    expect(decide([...FIRST, word({ word: "tasks", why: "three batches tied" })], PLAN).why).toContain(
      "three batches tied",
    );
    expect(move([word({ word: "tasks" })])).toMatchObject({ move: "accept" });
    expect(move([...FIRST, word({ word: "budget", dollars: 50 })])).toMatchObject({ move: "compare" });
    expect(pendingWords([...FIRST, word({ word: "budget", dollars: 50 })])).toMatchObject([
      { at: FIRST.length, word: "budget", dollars: 50 },
    ]);
    expect(move([...ONE, built("b-1", "h1")])).toMatchObject({ move: "compare" });
    expect(move(SIX, { ...PLAN, practice: 3 })).toEqual({
      move: "examine",
    });
    expect(decide(FIVE, PLAN)).toMatchObject({
      move: "examine",
      code: "tasks",
    });
    expect(move([...FIVE, built("b-1", "h1")])).toEqual({ move: "examine" });
    expect(decide([...FIVE, built("b-1", "h1")], PLAN).why.match(/\d+/g)).toEqual(["1", "1"]);
    expect(decide(SIX, { ...PLAN, practice: 3 }).why.match(/\d+/g)).toEqual(["2"]);
    expect(decide(FIVE, PLAN).why.match(/\d+/g)).toEqual(["1"]);
    expect(decide([...FIVE, built("b-1", "h1")], PLAN).why).toContain("h1");
    // The first comparison waits for the floor alone; the target of twelve binds after it.
    expect(move([...SIX, built("b-1", "h1")])).toMatchObject({ move: "compare" });
    expect([shortOf(FIVE, PLAN), shortOf(SIX, PLAN)]).toEqual([1, 0]);
    expect(shortOf([...SIX, ...compared("g-1", "h1", "no-step")], PLAN)).toBe(6);
    expect(move([...SIX, built("b-1", "h1"), ...HELD.slice(6).flatMap(heldOut)])).toMatchObject({
      move: "compare",
    });
    expect(move([...SIX, built("b-1", "h1"), ...compared("g-1", "h1", "no-step")])).toMatchObject({
      move: "build",
    });
  });
});

describe("comparison readings", () => {
  it("unfinished: a comparison that began goes on, and a reading short of the level buys nothing", () => {
    const begun = event("comparison.started", { session: "g-1", old: "start", fresh: "h1" });
    expect(decide([...FIRST, begun, built("b-2", "h2")], PLAN)).toMatchObject({
      move: "compare",
      code: "unfinished",
      id: "g-1",
      fresh: "h1",
      reference: "start",
    });
    expect(move([...FIRST, begun], { ...PLAN, left: { dollars: 0.5, reserve: 0.4 } })).toMatchObject({
      id: "g-1",
    });
    const strict = { ...PLAN, wanted: { ...PLAN.wanted, level: 0.02 } };
    const near = (wins: number, losses: number) =>
      compared("g-1", "h1", "no-step", { tally: [wins, losses, 12 - wins - losses] });
    expect(move([...FIRST, ...near(5, 0)], strict)).toMatchObject({ move: "build" });
    expect(move([...FIRST, ...near(6, 2)])).toMatchObject({ move: "build" });
  });

  it("step: a harness that read a step against the reference is promoted on that reading", () => {
    const stepped = [...FIRST, ...compared("g-1", "h1", "step", { tally: [8, 0, 4] })];
    expect(decide(stepped, PLAN)).toMatchObject({
      move: "promote",
      code: "step",
      harness: "h1",
    });
    const aa = { noise: { wins: 0, losses: 0, ties: 4, differences: [0, 0, 0, 0] } };
    expect(move([...FIRST, ...compared("g-1", "h1", "step", { tally: [8, 0, 4], extra: aa })])).toEqual(
      move(stepped),
    );
    expect(move([...FIRST, ...compared("g-1", "h1", "regressed", { tally: [8, 0, 4] })])).not.toMatchObject({
      move: "promote",
    });
    const after = HELD.map((version) => `e${version}`);
    const epoch = [...PROMOTED, setting(null), ...examined("x-2", after), built("b-2", "h2")];
    expect(move([...epoch, ...compared("g-3", "h2", "step", { old: "h1", tally: [8, 0, 4] })])).toEqual({
      move: "promote",
      harness: "h2",
    });
    const control = compared("g-3", "start", "step", { old: "h1", tally: [8, 0, 4] });
    expect(move([...epoch, ...control])).not.toMatchObject({ move: "promote", harness: "start" });
    const unread = compared("g-3", "h2", "starter-unread", { old: "h1", tally: [8, 0, 4] });
    expect(move([...epoch, ...unread])).not.toMatchObject({ move: "promote" });
    const later = [built("b-2", "h2"), ...compared("b-2", "h2", "no-step", { old: "h1", tally: [4, 4, 4] })];
    expect(decide([...stepped, ...later], PLAN)).toMatchObject({
      move: "promote",
      code: "step",
      harness: "h1",
    });
    const readLater = decide([...stepped, ...later, promotion("h1"), ...examined("x-2")], PLAN);
    expect(readLater).toMatchObject({ move: "build" });
    expect(readLater.why.match(/\b(?:b|h)-?\d+\b/g)).toEqual(["b-2", "h2"]);
  });
});

describe("room for the reference", () => {
  it("no-room: the tasks change where the reference's last reading left it nothing to gain", () => {
    const first = [setting(40), ...FIRST];
    const tied = [...first, ...compared("g-1", "h1", "no-step", { tally: [0, 0, 24], solved: EVERY })];
    const noRoom = decide(tied, PLAN);
    expect(noRoom).toMatchObject({ move: "examine", code: "no-room" });
    expect(noRoom.why).toContain("g-1");
    const read = (old: Valid, extra: JsonObject = {}) =>
      compared("g-1", "h1", "no-step", { tally: [0, 0, 12], valid: { old, fresh: [4, 0, 8] }, extra });
    expect(
      move([...first, ...read([4, 0, 8], { scored: { wins: 0, losses: 0, ties: 12, unsolved: 4 } })]),
    ).toEqual({
      move: "examine",
    });
    expect(move([...first, ...read([4, 1, 7])])).toMatchObject({ move: "build" });
    const nobody = [
      ...first,
      ...compared("g-1", "h1", "no-step", { tally: [0, 0, 12], valid: { old: NONE, fresh: NONE } }),
    ];
    expect(decide(nobody, PLAN)).toMatchObject({
      move: "examine",
      code: "no-room",
    });
    expect(move([...tied, ...examined("x-1", ["v13"])])).toMatchObject({ move: "examine" });
    const closedReference = decide(promotedAll, PLAN);
    expect(closedReference).toMatchObject({ move: "examine", code: "no-room" });
    expect(closedReference.why.match(/\b(?:g-\d+|h\d+)\b/g)).toEqual(["h1", "g-2"]);
    const newReference = decide(promotedHalf, PLAN);
    expect(newReference).toMatchObject({ move: "examine", code: "no-room" });
    expect(newReference.why).toContain("h1");
    expect(move([...promotedHalf, ...examined("x-1")])).toMatchObject({ move: "build" });
    const crashed = { ended: "crashed", crash: "x" };
    expect(move([...promotedHalf, ...examined("x-1", [], crashed)])).toMatchObject({ move: "examine" });
    expect(move([...promotedHalf, ...examined("x-1", ["v13"], crashed)])).toMatchObject({
      move: "compare",
    });
    const stepped = [
      ...FIRST,
      ...compared("g-1", "h1", "step", { tally: [8, 0, 4] }),
      ...compared("g-2", "h1", "step", { tally: [4, 0, 3] }),
      built("b-2", "h2"),
    ];
    const named = compared("b-3", "h2", "no-step", { old: "h1", ...FULL });
    const namedReading = decide([...stepped, ...named, promotion("h1")], PLAN);
    expect(namedReading).toMatchObject({ move: "examine" });
    expect(namedReading.why).toContain("b-3");
  });

  it("short: tasks are written where the gate would refuse the next comparison for want of them", () => {
    const small = { ...PLAN, wanted: { ...PLAN.wanted, target: 6 } };
    const tied = [
      READ,
      ...HELD.slice(0, 4).flatMap(heldOut),
      ...RELEASED,
      built("b-1", "h1"),
      ...compared("g-1", "h1", "no-step", {
        tally: [1, 0, 3],
        solved: { v1: "PF PP", v2: "PP PP", v3: "PP PP", v4: "PP PP" },
      }),
    ];
    expect(decide(tied, small)).toMatchObject({
      move: "examine",
      code: "short",
    });
    expect(move([...tied, built("b-2", "h2")], small)).toEqual({ move: "examine" });
    const more = ["v13", "v14", "v15", "v16", "v17"].flatMap(heldOut);
    expect(move([...tied, built("b-2", "h2"), ...more], small)).toMatchObject({ move: "compare" });
    const aside = compared("g-1", "h1", "not-scored", { extra: { versions: [], aside: HELD } });
    expect(decide([...FIRST, ...aside], PLAN)).toMatchObject({
      move: "examine",
      code: "short",
    });
  });
});

describe("unread harnesses and tasks", () => {
  it("unread: what no comparison has read is compared before anything is built", () => {
    const three = { ...PLAN, sessions: 3 };
    expect(decide(FIRST, PLAN)).toMatchObject({
      move: "compare",
      code: "unread",
      fresh: "latest",
      reference: "promoted",
    });
    const lost = [...FIRST, ...compared("g-1", "h1", "no-step")];
    expect(move([...lost, built("b-2", "h2")], three)).toMatchObject({ move: "compare", fresh: "latest" });
    const after = [...PROMOTED, ...examined("x-1")];
    for (const [builds, expected, counts] of [
      [[built("b-2", "h2")], { move: "build" }, ["1", "3"]],
      [
        [built("b-2", "h2"), built("b-3", "h3"), built("b-4", "h4")],
        { move: "compare", fresh: "latest", reference: "promoted" },
        ["3", "4"],
      ],
    ] as const) {
      const chosen = decide([...after, ...builds], three);
      expect(chosen).toMatchObject(expected);
      expect(chosen.why.match(/\d+/g)).toEqual([...counts]);
    }
    const six = ["v13", "v14", "v15", "v16", "v17", "v18"].flatMap(heldOut);
    for (const reading of [
      compared("g-1", "h1", "no-step"),
      full("g-1"),
      compared("g-1", "h1", "no-step", { tally: [0, 0, 12], valid: { old: NONE, fresh: NONE } }),
      compared("g-1", "h1", "not-scored", { extra: { versions: [], aside: HELD } }),
    ]) {
      expect(decide([...FIRST, ...reading, ...six], PLAN)).toMatchObject({
        move: "compare",
        code: "unread",
        fresh: "latest",
      });
    }

    const written = [...promotedAll, ...examined("x-1", ["v13"])];
    expect(decide(written, PLAN)).toMatchObject({
      move: "compare",
      code: "unread",
      fresh: "starter",
      reference: "promoted",
    });
    expect(decide(written, PLAN).why).toContain("h1");
    expect(decide(written, PLAN).why.match(/\b1\b/g)).toHaveLength(1);
    const control = (reading: string, old: Valid, tally: [number, number, number]) => [
      ...written,
      ...compared("g-3", "start", reading, { old: "h1", tally, valid: { old, fresh: HALF } }),
    ];
    expect(move(control("no-step", HALF, [2, 2, 8]))).toEqual({
      move: "build",
    });
    expect(move(control("step", [8, 2, 2], [6, 0, 6]))).toMatchObject({ move: "build" });
    expect(move(control("no-step", ALL, [0, 0, 12]))).toMatchObject({ move: "examine" });

    expect(move(PROMOTED)).toMatchObject({ move: "examine" });
    expect(move([...PROMOTED, ...examined("x-9")])).toMatchObject({ move: "build" });
    const second = [
      ...PROMOTED,
      built("b-2", "h2"),
      ...steppedTwice("g-2", "h2", "h1"),
      promotion("h2", { from: "h1" }),
    ];
    expect(move(second)).not.toMatchObject({ fresh: "starter" });
  });
});

describe("a hold on the move a row named", () => {
  it("begins a comparison or an Examiner session while what is left holds a solve's reserve, whatever the last one billed", () => {
    const solve = (id: string, billed: number) => [
      event("solve.started", { solve: id, comparison: "g-1" }),
      event("solve.finished", { solve: id, billed, ending: { outcome: "pass" } }),
    ];
    const [start, report] = compared("g-1", "h1", "no-step", { tally: [4, 4, 4] });
    const log = [
      ...FIRST,
      ...(start === undefined ? [] : [start]),
      ...solve("s-1", 0.6),
      ...solve("s-2", 0.4),
      ...(report === undefined ? [] : [report]),
      built("b-2", "h2"),
    ];
    const left = (dollars: number) => ({ ...PLAN, left: { dollars, reserve: 0.4 } });
    expect(move(log, left(0.95))).toMatchObject({ move: "compare" });
    expect(decide(log, left(0.3))).toMatchObject({ move: "end", ending: "budget" });
    const dear = [...FIRST, ...full("g-1"), ...examined("x-1", ["v13"], { billed: 6 }), ...full("g-2")];
    expect(move(dear, { ...PLAN, left: { dollars: 10, reserve: 0.5 } })).toMatchObject({ move: "examine" });
  });

  it("practice: the allowance and released tasks stay the same whichever objective task the new harness won", () => {
    const tasks = ["a", "b", ...HELD.slice(0, 7)];
    const won = (task: string) => {
      const round = roundSolves("g-room", ["start", "h1"], { a: "PP PP", b: "PP PP" });
      const starts = round.events.filter(({ kind }) => kind === "solve.started");
      // A already has room between the reference's own answers; B has none. The fresh
      // answers either win A and lose B, or lose A and win B, preserving the tally.
      const measures = task === "a" ? [10, 5, 1, 1, 10, 10, 20, 20] : [10, 5, 20, 20, 10, 10, 1, 1];
      return [
        ...RELEASED,
        ...tasks.flatMap(heldOut),
        ...round.events,
        ...starts.map(({ data }, index) =>
          event("verdict", {
            solve: data.solve ?? "",
            kind: "pass",
            answer: {},
            objective: measures[index] ?? 0,
          }),
        ),
        event("comparison.reported", {
          session: "g-room",
          old: "start",
          fresh: "h1",
          starter: "start",
          reading: "no-step",
          scored: { wins: 1, losses: 1, ties: 0 },
          ...round.terms,
          objective: { direction: "lower", margin: 0.01 },
        }),
      ];
    };
    for (const extra of [0, 1]) {
      const logs = [won("a"), won("b")].map((events) => [
        ...events,
        ...HELD.slice(7, 7 + extra).flatMap(heldOut),
      ]);
      const released = logs.map((events) =>
        releaseOrder(events, taskSets(events).held, practiceRoom(events, 0.02), "seed"),
      );
      const tallies = logs.map((events) =>
        tallyPairs(lastReports(events).flatMap((report) => pairsReported(events, report))),
      );
      expect(tallies[0]).toEqual(tallies[1]);
      expect(logs.map((events) => poolOf(events).frontier.length)).toEqual([8 + extra, 9 + extra]);
      expect(logs.map((events) => practiceRoom(events, 0.02))).toEqual([extra, extra]);
      expect(released[0]).toEqual(released[1]);
      expect(released[0]?.map(([version]) => version)).toEqual(extra === 0 ? [] : ["a"]);
    }
  });

  it("practice: an answer from the other harness alone cannot increase the feasibility allowance", () => {
    const log = (fresh: string) => [
      ...RELEASED,
      ...["u", ...HELD.slice(0, 8)].flatMap(heldOut),
      ...["g-1", "g-2"].flatMap((session) =>
        compared(session, "h1", "no-step", {
          solved: { u: `FF ${fresh}` },
        }),
      ),
    ];
    expect(["PP", "FF"].map((fresh) => practiceRoom(log(fresh), 0.02))).toEqual([0, 0]);
    for (const proof of [
      event("task.feasible", { version: "u" }),
      event("task.gate", { version: "u", reference: { valid: 1 } }),
    ]) {
      expect(practiceRoom([...log("FF"), proof], 0.02)).toBe(1);
    }
  });

  it("unshown and the stop rule agree that only an established practice failure was shown", () => {
    const condition = conditionOf("p1", "start");
    for (const ruling of [null, "unclear", "check-defect", "earned"]) {
      const log = [
        ...SET_UP,
        event("build.started", { session: "b-1" }),
        event("condition.recorded", { id: conditionId(condition), condition: requireJsonValue(condition) }),
        event("solve.started", { solve: "practice", condition: conditionId(condition) }),
        event("solve.finished", { solve: "practice", ending: { outcome: "fail", kind: "rejected" } }),
        event("referee.finding", { solve: "practice", ruling }),
        built("b-1", "start", { changed: false }),
      ];
      expect(stopRule(log).checkpoints).toBe(ruling === "earned" ? 1 : 0);
      expect(decide(log, PLAN).code).toBe(ruling === "earned" ? "build" : "unshown");
    }
  });
});

describe("the one count", () => {
  it("ends the campaign where as many readings in a row as its patience left nothing to gain", () => {
    expect(move([READ, ...idle(2)])).toMatchObject({ move: "examine" });
    expect(decide([READ, ...idle(3)], PLAN).why.match(/\d+/g)).toEqual(["3"]);
    expect(decide([READ, ...idle(3)], PLAN)).toMatchObject({
      move: "end",
      ending: "exam",
      code: "tasks",
    });
    expect(move([...FIVE, built("b-1", "h1"), ...idle(3)])).toMatchObject({ move: "end", ending: "exam" });
    const tied = [...FIRST, ...full("g-1")];
    expect(move([...tied, ...idle(2)])).toMatchObject({ move: "examine" });
    expect(decide([...tied, ...idle(3)], PLAN).why.match(/\d+/g)).toEqual(["4", "1", "3", "1"]);
    expect(decide([...tied, ...idle(3)], PLAN)).toMatchObject({
      move: "end",
      ending: "no-room",
      code: "no-room",
    });
    expect(move([...tied, ...full("g-2"), ...full("g-3")])).toMatchObject({ move: "examine" });
    expect(move([...tied, ...full("g-2"), ...full("g-3"), ...full("g-4")])).toMatchObject({
      move: "end",
      ending: "no-room",
    });
    expect(move([...tied, ...idle(1)], { ...PLAN, patience: 1 })).toMatchObject({ move: "end" });
    expect(move(tied, { ...PLAN, patience: 1 })).toMatchObject({ move: "examine" });
    expect(move([...promotedAll, ...idle(2)])).toMatchObject({ move: "examine" });
    expect(move([...promotedAll, ...idle(3)])).toMatchObject({ move: "end", ending: "no-room" });
  });

  it("passes over a session whose tasks a comparison read, and starts again at room or at tasks nobody has read", () => {
    const round = (nth: number) => [
      ...examined(`x-${String(nth)}`, [`v${String(12 + nth)}`]),
      ...full(`g-${String(nth + 1)}`),
    ];
    const twice = [...FIRST, ...full("g-1"), ...round(1), ...round(2)];
    expect(move(twice)).toMatchObject({ move: "examine" });
    expect(decide([...twice, ...round(3)], PLAN).why.match(/\d+/g)).toEqual(["4", "1", "2", "3", "4", "4"]);
    expect(decide([...twice, ...round(3)], PLAN)).toMatchObject({
      move: "end",
      ending: "no-room",
      code: "no-room",
    });
    const roomy = compared("g-4", "h1", "no-step", { tally: [0, 0, 12] });
    expect(move([...twice, ...examined("x-3", ["v15"]), ...roomy])).toMatchObject({ move: "build" });
    const closed = compared("g-1", "h1", "no-step", { tally: [0, 0, 24], solved: EVERY });
    const few = [...FIRST, ...closed, ...examined("x-1", ["v13"])];
    expect(move([...few, ...idle(2)])).toMatchObject({ move: "examine" });
    expect(move([...few, ...idle(3)])).toMatchObject({ move: "end", ending: "no-room" });
    expect(move([READ, ...idle(2), ...examined("x-8", ["v9"]).slice(0, 1), ...idle(1)])).toMatchObject({
      move: "examine",
    });
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
  it("is the plan's where the harness read a step against the reference, and says why where not", () => {
    const near = [...FIRST, ...compared("g-1", "h1", "no-step", { tally: [3, 0, 9] })];
    expect(unpromoted(near, PLAN, "h1")).toContain("h1");
    const stepped = [...near, ...compared("g-2", "h1", "step", { tally: [10, 0, 2] })];
    expect(unpromoted(stepped, PLAN, "h1")).toBeNull();
    expect(unpromoted(stepped, PLAN, "h9")).toContain("h9");
    expect(unpromoted(stepped, PLAN, "start")).not.toBeNull();
    expect(unpromoted([...stepped, setting(10)], PLAN, "h1")).toBeNull();
  });
});
