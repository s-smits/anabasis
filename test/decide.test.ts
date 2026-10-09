// Move 7 of a campaign over hand-built logs: each row of the plan's decision table, and the order
// the rows are asked in (`src/builder/decide.ts`).

import { describe, expect, it } from "bun:test";
import { type Decided, decide, openingOf, type Plan, planOf, unpromoted } from "../src/builder/decide.ts";
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

  it("takes a pack's tasks in, has some written where there are none, and releases practice", () => {
    expect(move([READ], { ...PLAN, unprepared: true })).toMatchObject({ move: "prepare" });
    expect(move([READ])).toEqual({ move: "examine", room: false, why: "the campaign holds no task" });
    expect(move([READ, ...HELD.flatMap(heldOut)])).toMatchObject({
      move: "prepare",
      why: "no task is released for practice: the contract's draw releases some",
    });
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

describe("a step", () => {
  const stepped = [...SET_UP, built("b-1", "h1"), ...compared("g-1", "h1", "step", { tally: [4, 0, 2] })];

  it("is one draw when read once: the same two are compared again, with the reference against itself", () => {
    expect(move(stepped)).toMatchObject({
      move: "compare",
      fresh: "latest",
      reference: "promoted",
      noise: true,
    });
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

  it("lengthens to no budget an earlier reading of the two already showed to leave no room", () => {
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
      move: "examine",
      room: true,
      why: "comparison g-2 read no step with neither harness valid on one solve in four, and at 20 turns the reference harness left no room: no budget of the ladder leaves room, and the tasks have to change",
    });
    // Read at 20 with room, that budget is the one to go to.
    expect(move([setting(40), ...first, ...read(HALF), ...under10], plan)).toMatchObject({
      move: "budget",
      modelTurns: 20,
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

  it("ends where three Examiner sessions in a row left the campaign where it stood", () => {
    const session = (id: string) =>
      event("exam.finished", { session: id, held: [], refused: [], proposed: 0 });
    expect(move([READ, session("x-1"), session("x-2")])).toMatchObject({ move: "examine" });
    expect(move([READ, session("x-1"), session("x-2"), session("x-3")])).toEqual({
      move: "end",
      ending: "exam",
      why: "3 Examiner sessions in a row left the campaign where it stood (the campaign holds no task): the tasks could not be written",
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
    expect(openingOf([opened])).toMatchObject({ limit: 40, sessions: 2, seats: { examiner: null } });
    expect(planOf([opened, billed(31.5), billed(8.5)], { unprepared: false, level: 0.1 })).toEqual({
      limit: 40,
      ladder: [20, 10, 5],
      sessions: 2,
      unprepared: false,
      wanted: { target: 12, level: 0.1, restarted: [] },
      left: { dollars: 360, reserve: 10 },
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
