// The limits as a compartment that can move: when one set leaves more room than another, the task
// fold letting a wall-bound task back into the pool under roomier limits and under nothing else,
// what a log's readers say of the wall, and whose wall-bound words still count.
import { describe, expect, it } from "bun:test";
import { measured } from "../src/examiner/record.ts";
import { binding } from "../src/kernel/binding.ts";
import { type Condition, conditionId, type Limits, settingId } from "../src/kernel/condition.ts";
import type { Stand } from "../src/kernel/ladder.ts";
import { limitsIn, roomier } from "../src/kernel/limits.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { Counted } from "../src/kernel/solve.ts";
import { taskSets, taskStates } from "../src/kernel/task.ts";
import { limitsLast, outgrown, returning, wallLine, wallReading, wallShare } from "../src/kernel/wall.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";

const at = "2026-10-08T00:00:00.000Z";
const RULE = { solves: 3, fails: 2 };
const SHORT: Limits = {
  wallSeconds: 600,
  turns: 12,
  shellDefaultSeconds: 30,
  shellMaxSeconds: 60,
  concurrency: 2,
  diskBytes: 1024,
};
const LONG: Limits = { ...SHORT, wallSeconds: 1200 };
const P: Counted = { outcome: "pass" };
const F: Counted = { outcome: "fail", kind: "rejected" };
const W: Counted = { outcome: "fail", kind: "wall-ended" };
const STATE = "task.state";
const event = (kind: EventKind, data: JsonObject): LogEvent => ({ at, kind, data });

const condition = (task: string, limits: Limits, side: Condition["side"] = "test"): Condition => ({
  contract: "c1",
  harness: "h",
  task,
  model: "faux/solver",
  effort: "medium",
  prices: { "faux/solver": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  runtime: {},
  compaction: "off",
  solverTools: "h",
  verifierTools: "t1",
  sandbox: "p1",
  limits,
  host: "h",
  side,
});
/** Where the fixture's solver stands under `limits`. */
const on = (limits: Limits): Stand => ({ harness: "h", setting: settingId(condition("any", limits)) });

let solves = 0;
/** Solves of `task` under `limits`, one an ending, each `seconds` long. */
function solved(task: string, limits: Limits, endings: readonly Counted[], seconds = 60) {
  const ran = condition(task, limits);
  const id = conditionId(ran);
  return [
    event("condition.recorded", { id, condition: requireJsonValue(ran) }),
    ...endings.flatMap((ending) => {
      solves += 1;
      const solve = `s-${String(solves)}`;
      return [
        event("solve.started", { solve, condition: id }),
        event("solve.finished", { solve, ending: { ...ending }, seconds }),
      ];
    }),
  ];
}
/** A task through its four gates. `session` makes it one an Examiner session wrote. */
function feasible(version: string, session?: string) {
  const written = { session: session ?? "", task: { taskId: version, family: "fixture" } };
  return [
    event(
      "task.proposed",
      session === undefined ? { version, taskId: version } : { version, taskId: version, ...written },
    ),
    ...[1, 2, 3, 4].map((gate) => event("task.gate", { version, gate, outcome: "passed", controls: "d" })),
  ];
}
const state = (version: string, to: string, more: JsonObject = {}) =>
  event(STATE, { version, state: to, ...more });

describe("limits that leave a solve more room", () => {
  it("have a longer wall and nothing tighter", () => {
    expect(roomier(LONG, SHORT)).toBe(true);
    expect(roomier(SHORT, SHORT)).toBe(false);
    expect(roomier(SHORT, LONG)).toBe(false);
    // More turns alone answer no wall: a solve ends at the wall by its seconds and nothing else.
    expect(roomier({ ...SHORT, turns: 24 }, SHORT)).toBe(false);
    expect(roomier({ ...LONG, turns: 24 }, SHORT)).toBe(true);
    // A longer wall beside a tighter limit, or beside more solves at once, is not known to be more.
    for (const tighter of [
      { turns: 11 },
      { shellDefaultSeconds: 29 },
      { shellMaxSeconds: 59 },
      { diskBytes: 1023 },
      { concurrency: 3 },
    ]) {
      expect(roomier({ ...LONG, ...tighter }, SHORT)).toBe(false);
    }
    expect(roomier({ ...LONG, concurrency: 1 }, SHORT)).toBe(true);
  });

  it("are read whole from a log event, or not at all", () => {
    expect(limitsIn(requireJsonValue(SHORT))).toEqual(SHORT);
    // A round's limits carry the Builder's own beside them, which are no limit of a solve.
    expect(limitsIn({ ...SHORT, practiceSolves: 3 })).toEqual(SHORT);
    expect(limitsIn({ wallSeconds: 600 })).toBeNull();
    expect(limitsIn(undefined)).toBeNull();
    expect(limitsIn(null)).toBeNull();
  });
});

describe("a wall-bound task in the fold", () => {
  const anchored = [...feasible("a1"), event("anchor.drawn", { tasks: ["a1"] })];
  const bound = [...anchored, ...feasible("v1"), state("v1", "wall-bound", { limits: SHORT })];
  const refusal = "task v1 leaves wall-bound only under limits the log names, with a longer wall";

  it("returns to the pool under limits with a longer wall, and is screened again", () => {
    expect(taskSets(bound).bound).toEqual(new Map([["v1", SHORT]]));
    const back = [...bound, state("v1", "held", { limits: LONG })];
    expect(taskStates(back).get("v1")).toBe("held");
    expect(taskSets(back).bound.size).toBe(0);
    expect(taskSets(back).feasible.has("v1")).toBe(true);
    // Back in the pool it is any held task: a round admits it, retires it, or binds it again.
    expect(taskStates([...back, state("v1", "admitted")]).get("v1")).toBe("admitted");
    expect(taskStates([...back, state("v1", "too-easy")]).get("v1")).toBe("too-easy");
    const again = [...back, state("v1", "wall-bound", { limits: LONG })];
    expect(taskSets(again).bound).toEqual(new Map([["v1", LONG]]));
    // Bound under the longer wall, the wall that returned it once returns it no more.
    expect(() => taskStates([...again, state("v1", "held", { limits: LONG })])).toThrow(refusal);
    const longer = { ...LONG, wallSeconds: 2400 };
    expect(taskStates([...again, state("v1", "held", { limits: longer })]).get("v1")).toBe("held");
  });

  it("stays where it is under the same limits, tighter ones, more turns alone, or none named", () => {
    for (const named of [
      SHORT,
      { ...SHORT, turns: 24 },
      { ...LONG, turns: 6 },
      { ...SHORT, wallSeconds: 300 },
    ]) {
      expect(() => taskStates([...bound, state("v1", "held", { limits: named })])).toThrow(refusal);
    }
    expect(() => taskStates([...bound, state("v1", "held")])).toThrow(refusal);
    // Held is the one way out: no round admits or retires a task from where it was set aside.
    for (const to of ["admitted", "too-easy", "released", "disputed", "stale", "wall-bound"]) {
      expect(() => taskStates([...bound, state("v1", to, { limits: LONG })])).toThrow(
        `task v1 cannot go from wall-bound to ${to}`,
      );
    }
  });

  it("is bound under the campaign's first limits where its event names none, as an older log has it", () => {
    // The stronger solver's condition comes first in the log and is no setting of the measured one.
    const [strong] = [condition("v1", { ...SHORT, wallSeconds: 60 }, "strong")].map((ran) =>
      event("condition.recorded", { id: conditionId(ran), condition: requireJsonValue(ran) }),
    );
    const old = [
      ...anchored,
      ...feasible("v1"),
      ...(strong === undefined ? [] : [strong]),
      ...solved("v1", SHORT, [W, W]),
      ...solved("v1", LONG, [P]),
      state("v1", "wall-bound"),
    ];
    // An old log folds as it did: the state stands, and its limits are the first test-side ones.
    expect(taskStates(old).get("v1")).toBe("wall-bound");
    expect(taskSets(old).bound).toEqual(new Map([["v1", SHORT]]));
    expect(() => taskStates([...old, state("v1", "held", { limits: SHORT })])).toThrow(refusal);
    expect(taskStates([...old, state("v1", "held", { limits: LONG })]).get("v1")).toBe("held");
    // With no condition on record nothing says what bound it, and nothing returns it.
    const bare = [...anchored, ...feasible("v1"), state("v1", "wall-bound")];
    expect(taskSets(bare).bound).toEqual(new Map([["v1", null]]));
    expect(() => taskStates([...bare, state("v1", "held", { limits: LONG })])).toThrow(refusal);
    expect(returning(bare, LONG)).toEqual([]);
  });

  it("is named as returning by the limits a campaign's solver would run under", () => {
    const two = [...bound, ...feasible("v2"), state("v2", "wall-bound", { limits: LONG })];
    expect(returning(two, SHORT)).toEqual([]);
    expect(returning(two, LONG)).toEqual(["v1"]);
    expect(returning(two, { ...LONG, wallSeconds: 2400 })).toEqual(["v1", "v2"]);
  });
});

describe("whether the wall binds", () => {
  it("takes the median share of its wall a set of solves used", () => {
    expect(wallShare([])).toBeNull();
    expect(wallShare([{ seconds: 50, wallSeconds: 100 }])).toBe(0.5);
    const timed = [10, 30, 90].map((seconds) => ({ seconds, wallSeconds: 100 }));
    expect(wallShare(timed)).toBe(0.3);
    // A solve with no wall on record has no share.
    expect(wallShare([...timed, { seconds: 5, wallSeconds: 0 }])).toBe(0.3);
  });

  /** t1 the solver passes, t2 it fails at a check, t3 ran to the wall twice, t4 nobody placed; w1
   *  is wall-bound under the short wall and x1, a session's, under the long one. */
  const log = [
    ...["t1", "t2", "t4", "w1", "a1"].flatMap((version) => feasible(version)),
    ...["t3", "x1"].flatMap((version) => feasible(version, "x-1")),
    event("anchor.drawn", { tasks: ["a1"] }),
    ...solved("t1", SHORT, [P, P, P], 120),
    ...solved("t2", SHORT, [F, F], 300),
    ...solved("t3", SHORT, [W, W], 600),
    // The anchor's solves are the solver's too, and under the long wall they are another solver's.
    ...solved("a1", SHORT, [P], 60),
    ...solved("t4", LONG, [P, P, P], 700),
    state("w1", "wall-bound", { limits: SHORT }),
    state("x1", "wall-bound", { limits: LONG }),
  ];

  it("counts what the wall has marked and how much of it passes and fails used", () => {
    const read = wallReading(log, on(SHORT), { rule: RULE, limits: SHORT });
    expect(read).toEqual({
      pool: 4,
      walled: 1,
      bound: 2,
      returning: 0,
      written: { pool: 1, walled: 1, bound: 1 },
      // Four passes at 120, 120, 120 and 60 of 600 seconds; four fails at 300, 300, 600 and 600.
      passes: { solves: 4, share: 0.2 },
      fails: { solves: 4, share: 0.75, atWall: 2 },
    });
    expect(wallLine(read, SHORT)).toBe(
      "against a wall of 10 minutes: 1 of 4 pool tasks walled, 2 tasks set aside as wall-bound outside the pool (Examiner sessions wrote 1 of the pool, 1 of the walled and 1 of the wall-bound); its 4 passing solves here used a median 20.0% of the wall and its 4 failed solves 75.0%, 2 ended by it",
    );
  });

  it("restarts under other limits, where the solver is another one", () => {
    const read = wallReading(log, on(LONG), { rule: RULE, limits: LONG });
    // Nothing the short wall placed is placed here, and the one task it bound would return.
    expect(read).toMatchObject({
      pool: 4,
      walled: 0,
      bound: 2,
      returning: 1,
      passes: { solves: 3, share: 700 / 1200 },
      fails: { solves: 0, share: null, atWall: 0 },
    });
    const none = wallReading(log, on({ ...LONG, wallSeconds: 2400 }), { rule: RULE, limits: LONG });
    expect(wallLine(none, LONG)).toEndWith("no solve under these limits is on record against this harness");
  });

  it("names the limits a log's last test-side solves ran under", () => {
    expect(limitsLast([])).toBeNull();
    expect(limitsLast(log)).toEqual(LONG);
    const strong = condition("t1", { ...SHORT, wallSeconds: 60 }, "strong");
    const after = [
      ...solved("t1", SHORT, [P]),
      event("condition.recorded", { id: conditionId(strong), condition: requireJsonValue(strong) }),
    ];
    expect(limitsLast(after)).toEqual(SHORT);
  });
});

describe("a wall-bound word under a wall the campaign has outgrown", () => {
  const exam = (session: string, limits?: Limits) =>
    event(
      "exam.started",
      limits === undefined
        ? { session, standsOn: "h" }
        : { session, standsOn: "h", setting: on(limits).setting },
    );
  const word = (session: string, version: string, told: string) =>
    event("exam.word", { session, version, word: told });
  const log = [
    ...feasible("a1"),
    event("anchor.drawn", { tasks: ["a1"] }),
    ...solved("a1", SHORT, [P]),
    ...solved("a1", LONG, [P]),
    exam("x-1", SHORT),
    word("x-1", "n1", "wall-bound"),
    word("x-1", "n2", "wall-bound"),
    word("x-1", "n3", "too hard"),
    exam("x-2", LONG),
    word("x-2", "n4", "too hard"),
    // A session logged before sessions named their setting: its limits are not on record.
    exam("x-0"),
    word("x-0", "n5", "wall-bound"),
  ];
  const given = { rule: RULE, least: 4 };

  it("is a session's whose solver ran under a shorter wall", () => {
    expect(outgrown(log, SHORT)).toEqual(new Set());
    expect(outgrown(log, LONG)).toEqual(new Set(["x-1"]));
    expect(outgrown(log, { ...LONG, wallSeconds: 2400 })).toEqual(new Set(["x-1", "x-2"]));
  });

  it("no longer names the limits as what binds", () => {
    // Under the short wall the three wall-bound words outnumber the two too-hard ones.
    expect(binding(log, on(SHORT), { ...given, limits: SHORT })).toMatchObject({
      binds: "limits",
      words: { "wall-bound": 3, "too hard": 2 },
    });
    // A caller that names no limits reads every word, as before the limits could move.
    expect(binding(log, on(SHORT), given).binds).toBe("limits");
    // Under the long wall x-1's two say nothing of this solver, and the witness is what is short.
    expect(binding(log, on(LONG), { ...given, limits: LONG })).toMatchObject({
      binds: "witness",
      words: { "wall-bound": 1, "too hard": 2 },
    });
  });
});

describe("what an Examiner is told of a wall-bound task", () => {
  it("is that it was so at the time limit it was measured under, and after a longer wall that it is unmeasured", () => {
    const log = [
      ...feasible("a1"),
      event("anchor.drawn", { tasks: ["a1"] }),
      ...feasible("w1", "x-1"),
      ...solved("w1", SHORT, [W, W]),
      state("w1", "wall-bound", { limits: SHORT }),
    ];
    const line =
      "w1 (family fixture): wall-bound: the solver only ran out of time on it, at the time limit it was measured under";
    expect(measured(log, on(SHORT), RULE)).toEqual([line]);
    // The line is a measurement: it gives no limit as a number and no distance from one.
    expect(line).not.toMatch(/\d+ (seconds|minutes)|%/);
    const back = [...log, state("w1", "held", { limits: LONG })];
    expect(measured(back, on(LONG), RULE)).toEqual(["w1 (family fixture): not yet measured"]);
  });
});
