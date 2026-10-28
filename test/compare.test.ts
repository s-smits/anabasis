// The comparison's arithmetic against the plan's own figures, and its view over the log: the test
// a reading is made by and what it can detect, one reading's step, which solves count for a
// held-out task under a harness, symmetric score quantisation, and what it refuses to compare.
// Unequal margins can support a step containing losses. The retained-loss cases answer
// buffer-pr197-opus-m1's single flagged solve blocking a promotion (18 October 2026).
import { describe, expect, it } from "bun:test";
import {
  closedTo,
  carriedBy,
  differenceOf,
  flipP,
  informative,
  type Paired,
  pairsOf,
  pointsOf,
  readsStepEitherWay,
  scored,
  stepOf,
  sweepOf,
  tally,
} from "../src/kernel/compare.ts";
import { type Condition, conditionId, settingId } from "../src/kernel/condition.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";

/** A drawing of `tasks` tasks, as one multiset of differences and the chance of drawing it in any order. */
interface Outcome {
  readonly differences: readonly number[];
  readonly chance: number;
}

const AT = "2026-10-09T00:00:00.000Z";
const base: Condition = {
  contract: "c1",
  harness: "old",
  task: "v1",
  model: "claude/claude-sonnet-5-5",
  effort: "high",
  prices: { "claude/claude-sonnet-5-5": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  runtime: {},
  compaction: "off",
  solverTools: "old",
  verifierTools: "t1",
  sandbox: "p1",
  limits: {
    wallSeconds: 7_200,
    turns: 60,
    shellDefaultSeconds: 300,
    shellMaxSeconds: 900,
    concurrency: 4,
  },
  host: "h1",
  side: "test",
};
const [P, F] = [true, false];
const [LEVEL, WIDE] = [0.1, 0.25];
const lowerRule = { direction: "lower" } as const;
const event = (kind: EventKind, data: JsonObject): LogEvent => ({ at: AT, kind, data });
/** A task the new harness wins, loses or ties, on three solves a harness. */
const pairs = (wins: number, losses: number, ties: number) => [
  ...Array.from({ length: wins }, (_, i) => ({ task: `w${String(i)}`, old: [F, F, P], fresh: [P, P, F] })),
  ...Array.from({ length: losses }, (_, i) => ({ task: `l${String(i)}`, old: [P, P, P], fresh: [P, F, P] })),
  ...Array.from({ length: ties }, (_, i) => ({ task: `t${String(i)}`, old: [P, F, P], fresh: [F, P, P] })),
];
/** Each task's difference in pair wins: `wins` tasks won and `losses` lost by `by` pairs, and `ties` tied. */
const units = (wins: number, losses: number, by = 1, ties = 0): number[] => [
  ...Array.from({ length: wins }, () => by),
  ...Array.from({ length: losses }, () => -by),
  ...Array.from({ length: ties }, () => 0),
];
/** A comparison's report as the log holds what its step reads: each frontier task's difference, and
 *  the retained tasks', or `unmeasured` where none was tallied. Each task's score without the bill
 *  is its score, as where no bill differed. */
const report = (frontier: readonly number[], retained: readonly number[] | null = null): JsonObject => ({
  frontier: { differences: [...frontier], unbilled: [...frontier] },
  retained: retained === null ? "unmeasured" : { differences: [...retained], unbilled: [...retained] },
});
/** Every multiset of `tasks` draws from `each`, a task's difference in pair wins beside its chance. */
function outcomes(tasks: number, each: readonly (readonly [number, number])[]): Outcome[] {
  const found: Outcome[] = [];
  const walk = (at: number, left: number, differences: readonly number[], chance: number): void => {
    const here = each[at];
    if (here === undefined) {
      if (left === 0) found.push({ differences, chance });
      return;
    }
    const [difference, odds] = here;
    let ways = 1;
    for (let taken = 0; taken <= left; taken += 1) {
      walk(
        at + 1,
        left - taken,
        [...differences, ...units(taken, 0, difference)],
        chance * ways * odds ** taken,
      );
      ways = (ways * (left - taken)) / (taken + 1);
    }
  };
  walk(0, tasks, [], 1);
  return found;
}
/** One task's chance of each difference in pair wins at `solves` a side, where each solve under
 *  either harness is valid with the task's chance `rate`: the new harness wins `solves` pairs for
 *  each valid answer it has more (`pairings`). */
function byDifference(rate: number, solves: number): [number, number][] {
  const valid = Array.from({ length: solves + 1 }, (_, count) => {
    let ways = 1;
    for (let k = 0; k < count; k += 1) ways = (ways * (solves - k)) / (k + 1);
    return ways * rate ** count * (1 - rate) ** (solves - count);
  });
  const found = new Map<number, number>();
  valid.forEach((fresh, f) => {
    valid.forEach((old, o) => {
      found.set(solves * (f - o), (found.get(solves * (f - o)) ?? 0) + fresh * old);
    });
  });
  return [...found];
}
describe("the paired sign-flip test", () => {
  it("reads a step between two harnesses alike no more often than its level, by enumeration: over every sign of every set of up to six untied tasks, and where each solve is valid by its task's own chance", () => {
    // Where the two sides are interchangeable each untied task is as likely won as lost by its
    // margin, whatever the margin: the test is exact given the margins, so its false-positive rate
    // holds at every level by enumeration. Four, eight, twelve and sixteen are the margins a task
    // read by validity takes at four solves a side.
    /** The share of the signs of `sizes` that read a step at `level`. */
    const falsely = (sizes: readonly number[], level: number) => {
      const signs = Array.from({ length: 2 ** sizes.length }, (_, pattern) =>
        sizes.map((size, at) => ((pattern >> at) & 1 ? size : -size)),
      );
      return signs.filter((flipped) => flipP(flipped) <= level).length / signs.length;
    };
    const sets = Array.from({ length: 6 }, (_, at) =>
      outcomes(
        at + 1,
        [4, 8, 12, 16].map((size) => [size, 1]),
      ),
    ).flat();
    for (const level of [LEVEL, WIDE]) {
      const rates = sets.map(({ differences }) => falsely(differences, level));
      expect(Math.max(...rates)).toBeLessThanOrEqual(level);
      expect(Math.max(...rates)).toBeGreaterThan(level / 2);
    }
    // The same where validity is by a chance of the task's own, the same under both harnesses:
    // six tasks from nearly never valid to always, two solves a side, every outcome of all six.
    const tasks = [0.1, 0.3, 0.5, 0.7, 0.9, 1].map((rate) => byDifference(rate, 2));
    const read = new Map([
      [LEVEL, 0],
      [WIDE, 0],
    ]);
    const walk = (at: number, differences: readonly number[], chance: number): void => {
      const task = tasks[at];
      if (task === undefined) {
        for (const [level, sum] of read) if (flipP(differences) <= level) read.set(level, sum + chance);
        return;
      }
      for (const [difference, odds] of task) walk(at + 1, [...differences, difference], chance * odds);
    };
    walk(0, [], 1);
    expect(read.get(LEVEL)).toBeLessThanOrEqual(LEVEL);
    expect(read.get(WIDE)).toBeLessThanOrEqual(WIDE);
    expect(read.get(LEVEL)).toBeGreaterThan(0);
  });

  it("counts a task once by how often each harness was valid, and takes it into the test by its score", () => {
    expect(tally(pairs(6, 1, 17))).toEqual({ wins: 6, losses: 1, ties: 17 });
    // Each task here is won or lost by three pairs of nine on validity, four to one or three to
    // none: a third of validity's 600 points.
    expect(scored(pairs(6, 1, 17))).toEqual({
      wins: 6,
      losses: 1,
      ties: 17,
      p: 0.0625,
      differences: units(6, 1, 200, 17),
      unbilled: units(6, 1, 200, 17),
    });
    expect(scored(pairs(5, 1, 18)).p).toBe(0.109375);
    expect(() => tally([{ task: "t", old: [P, P, P], fresh: [P, P] }])).toThrow(
      "task t has 3 solve(s) under the old harness and 2 under the new",
    );
  });
});

describe("one reading", () => {
  const STRICT = 0.02;

  it("promotes on its own reading at the level, and reads a 5-0 at 0.02 as no step", () => {
    // Since 19 October one reading is the whole rule: 6-0 clears 0.02 (p 1/64) and 5-0 (p 1/32)
    // reads no step and buys nothing, where it bought a repeat at the trigger before.
    expect(flipP(units(6, 0))).toBe(1 / 64);
    expect(flipP(units(5, 0))).toBe(1 / 32);
    expect(stepOf(report(units(6, 0, 4, 9)), STRICT)).toBe("step");
    expect(stepOf(report(units(5, 0, 4, 9)), STRICT)).toBe("no-step");
    expect(stepOf(report(units(8, 1)), STRICT)).toBe("step");
    expect(stepOf(report(units(7, 1)), STRICT)).toBe("no-step");
    expect(sweepOf(STRICT)).toBe(6);
  });

  it("reads losses by their margins rather than requiring every task to be won", () => {
    const buffer = [-16, -9, 2, -9, 150, 119, 0, 19];
    // The six largest absolute margins won and the smallest lost: 6-1 clears the level.
    expect(flipP(buffer.map((margin) => (margin === 2 ? -2 : Math.abs(margin))))).toBe(0.015625);
    expect(flipP(buffer)).toBe(0.1640625);
    expect(flipP([20, -16, 37, 33, 91, 44, 158, 87, 13, 70, -70])).toBe(0.0205078125);
    for (const margins of [units(6, 0), [1, 2, 3, 4, 5, 600]]) {
      expect(flipP(margins)).toBe(0.015625);
    }
  });

  it("reads the frontier and the retained tasks in one test, an empty retained set being unmeasured and never no loss", () => {
    const fixes = [16, 16, 16, 16];
    // Since 20 October the retained tasks enter the frontier's test. Four won and three lost by as
    // many pairs is p 0.5 and no step; until then it read `regressed`, the same in what it promoted.
    expect(stepOf(report(fixes, [-16, -16, -16]), LEVEL)).toBe("no-step");
    expect(stepOf(report(units(6, 0, 4), [-4, -4]), STRICT)).toBe("no-step");
    // One retained task lost by a small margin leaves a wide frontier's step standing (p 0.0625),
    // and at 0.02 sinks a 6-0 one (p 0.0625), which the second test let through.
    expect(stepOf(report(fixes, [-4]), LEVEL)).toBe("step");
    expect(stepOf(report(units(6, 0, 4), [-4]), STRICT)).toBe("no-step");
    // What it gives up: a retained win counts as a frontier one, so it lifts a 5-0 frontier to a
    // step at 0.02 (p 1/64), which the frontier alone does not clear (p 1/32).
    expect(stepOf(report(units(5, 0, 4), [4]), STRICT)).toBe("step");
    expect(stepOf(report(units(5, 0, 4)), STRICT)).toBe("no-step");
    expect(stepOf(report(units(0, 0, 1, 4), [-4]), LEVEL)).toBe("no-step");
    // Against the provisioned starter nothing is exhausted yet: the first promotion's reading
    // holds no retained task, and promotes on the frontier alone.
    expect(stepOf(report(units(4, 0, 16)), LEVEL)).toBe("step");
    // One comparison's own reading is of a report it has just tallied: one with no retained
    // reading is a fault of the caller's, and is refused rather than read as no step.
    const bare = { frontier: { differences: units(2, 0, 16) }, families: {} };
    expect(() => stepOf(bare, LEVEL)).toThrow("a reading needs a frontier and a retained set");
  });

  it("reads no step where the bill alone carries the test, and a step where validity and the objective clear it too", () => {
    const billed = (...each: number[]) => each.map((one) => ({ billed: one }));
    const lower = { direction: "lower" } as const;
    // Six tasks every solve of both sides answers alike, the new harness at half the bill: as
    // scored each is won by the bill's whole 100 points, 6-0 at p 1/64; without the bill all six
    // tie, and nothing is tested. v065-a's aecc1c92 was promoted so, 25-3 as scored and 0-10
    // without the bill (25 October).
    const cheaper = Array.from({ length: 6 }, (_, at) => ({
      task: `c${String(at)}`,
      old: [P, P],
      fresh: [P, P],
      objective: { ...lower, old: [10, 10], fresh: [10, 10] },
      used: { old: billed(0.2, 0.2), fresh: billed(0.1, 0.1) },
    }));
    const onCost = scored(cheaper);
    expect(onCost.differences).toEqual(units(6, 0, 100));
    expect(onCost.unbilled).toEqual(units(0, 0, 0, 6));
    expect(onCost.p).toBeLessThanOrEqual(STRICT);
    expect(stepOf({ frontier: onCost, retained: "unmeasured" }, STRICT)).toBe("no-step");
    // The same six a fifth better by the objective as well: both tests clear, and the bill adds
    // its points to a step the other measures carry.
    const better = cheaper.map((pair) => ({
      ...pair,
      objective: { ...lower, old: [10, 10], fresh: [8, 8] },
    }));
    const both = scored(better);
    expect(both.differences).toEqual(units(6, 0, 400));
    expect(both.unbilled).toEqual(units(6, 0, 300));
    expect(stepOf({ frontier: both, retained: "unmeasured" }, STRICT)).toBe("step");
    expect(better.map((pair) => differenceOf(pair, "validity"))).toEqual(units(0, 0, 0, 6));
    // A retained loss by the objective that the bill outweighs as scored still counts against the
    // step without the bill: 7-0 as scored at p 1/128, 6-1 without the bill at p 1/16.
    expect(
      stepOf(
        {
          frontier: { differences: units(6, 0, 4), unbilled: units(6, 0, 4) },
          retained: { differences: [4], unbilled: [-4] },
        },
        STRICT,
      ),
    ).toBe("no-step");
    // A report written before 26 October holds no score without the bill, and is refused.
    expect(() => stepOf({ frontier: { differences: units(6, 0) }, retained: "unmeasured" }, STRICT)).toThrow(
      "each with its unbilled",
    );
  });

  it("requires scored and unbilled A/A tests to clear in the same direction, retaining old scored-only reports", () => {
    const wins = units(6, 0);
    const losses = units(0, 6);
    expect(flipP(wins)).toBe(1 / 64);
    expect(readsStepEitherWay(wins, STRICT, units(0, 0, 0, 6))).toBe(false);
    expect(readsStepEitherWay(wins, STRICT, units(5, 1))).toBe(false);
    expect(readsStepEitherWay(wins, STRICT, losses)).toBe(false);
    expect(readsStepEitherWay(losses, STRICT, wins)).toBe(false);
    expect(readsStepEitherWay(wins, STRICT, wins)).toBe(true);
    expect(readsStepEitherWay(losses, STRICT, losses)).toBe(true);
    expect(readsStepEitherWay(wins, STRICT)).toBe(true);
    expect(readsStepEitherWay(losses, STRICT)).toBe(true);
  });
});

describe("a task's pairings", () => {
  it("names the measure that carried a result: the bill where the score without it ties or loses, which no step reads", () => {
    const even = { task: "carried", old: [P], fresh: [P] };
    const cheaper = { used: { old: [{ billed: 0.4 }], fresh: [{ billed: 0.1 }] } };
    const cases: { pair: Paired; by: ReturnType<typeof carriedBy> }[] = [
      { pair: { ...even, old: [F] }, by: "validity" },
      { pair: { ...even, objective: { ...lowerRule, old: [1200], fresh: [1000] } }, by: "objective" },
      { pair: { ...even, ...cheaper }, by: "bill" },
      // Cheaper by half and worse by 2% on the objective: a win only as scored.
      { pair: { ...even, ...cheaper, objective: { ...lowerRule, old: [1000], fresh: [1020] } }, by: "bill" },
      { pair: even, by: null },
    ];
    for (const { pair, by } of cases) expect(carriedBy(pair)).toBe(by);
    // Exchanged, the same measure carries the other side's win.
    expect(carriedBy({ ...even, fresh: [F] })).toBe("validity");
  });

  it("negates validity and bill scores when exchanged and normalises rounded zeros", () => {
    const even = { task: "exchange", old: [P], fresh: [P] };
    const cases: { pair: Paired; expected: number }[] = [
      { pair: { ...even, old: [F] }, expected: 600 },
      { pair: { ...even, used: { old: [{ billed: 0.2 }], fresh: [{ billed: 0.1 }] } }, expected: 100 },
      { pair: even, expected: 0 },
      {
        pair: {
          ...even,
          objective: { ...lowerRule, old: [1200], fresh: [1187] },
          used: { old: [{ billed: 0.4 }], fresh: [{ billed: 0.5 }] },
        },
        expected: 0,
      },
    ];
    for (const { pair, expected } of cases) {
      const swapped: Paired = {
        task: pair.task,
        old: pair.fresh,
        fresh: pair.old,
        ...keyIfDefined(
          "objective",
          pair.objective === undefined
            ? undefined
            : {
                direction: pair.objective.direction,
                old: pair.objective.fresh,
                fresh: pair.objective.old,
              },
        ),
        ...keyIfDefined(
          "used",
          pair.used === undefined
            ? undefined
            : {
                old: pair.used.fresh,
                fresh: pair.used.old,
              },
        ),
      };
      expect(differenceOf(pair)).toBe(expected);
      expect(differenceOf(swapped)).toBe(expected === 0 ? 0 : -expected);
    }
  });
});

describe("a task's measures", () => {
  it("reads objective direction, the room floor and missing measures only between valid answers", () => {
    const even = { task: "t", old: [P, P], fresh: [P, P] };
    for (const [direction, old, fresh, expected] of [
      ["lower", [10, 11], [8, 9], 300],
      ["higher", [10, 11], [8, 9], -300],
      ["lower", [10.05, 10], [10, 8], 150],
      ["lower", [10.05, 10], [10, null], 0],
    ] as const) {
      expect(differenceOf({ ...even, objective: { direction, old, fresh } })).toBe(expected);
    }
    expect(
      pointsOf({
        ...even,
        old: [P, F],
        fresh: [F, P],
        objective: { ...lowerRule, old: [1, 1], fresh: [1, 100] },
      }),
    ).toEqual({ validity: 0, objective: -75, bill: 0 });
  });

  it("weighs validity, objective and bill from their floors to saturation", () => {
    const billed = (...each: number[]) => each.map((one) => ({ billed: one }));
    const even = { task: "c", old: [P, P], fresh: [P, P] };
    const cheap = { ...even, used: { old: billed(0.2, 0.2), fresh: billed(0.1, 0.1) } };
    expect(pointsOf(cheap)).toEqual({ validity: 0, objective: 0, bill: 100 });
    for (const [old, fresh, expected] of [
      [0.4, 0.1, 100],
      [0.5, 0.4, 32],
      [0.115, 0.1, 0],
    ] as const) {
      expect(differenceOf({ ...cheap, used: { old: billed(old, old), fresh: billed(fresh, fresh) } })).toBe(
        expected,
      );
    }
    const measured = (old: number, fresh: number): Paired => ({
      ...even,
      objective: { ...lowerRule, old: [old, old], fresh: [fresh, fresh] },
    });
    for (const [old, fresh, expected] of [
      [100, 95, 150],
      [100, 50, 300],
      [100, 99.5, 0],
      [95, 100, -150],
    ] as const) {
      expect(differenceOf(measured(old, fresh))).toBe(expected);
    }
    expect(
      pointsOf({ ...measured(10, 8), used: { old: billed(0.1, 0.1), fresh: billed(0.2, 0.2) } }),
    ).toEqual({ validity: 0, objective: 300, bill: -100 });
    const failed = { ...cheap, fresh: [F, F] };
    expect(pointsOf(failed)).toEqual({ validity: -600, objective: 0, bill: 0 });
    expect(differenceOf({ ...failed, old: [F, F] })).toBe(0);
    const lapsed: Paired = {
      task: "l",
      old: [P, P, P, P],
      fresh: [P, P, P, F],
      objective: { ...lowerRule, old: [10, 10, 10, 10], fresh: [8, 8, 8, null] },
      used: { old: billed(0.2, 0.2, 0.2, 0.2), fresh: billed(0.1, 0.1, 0.1, 0.1) },
    };
    const measuredPoints = pointsOf(lapsed);
    expect(measuredPoints.validity).toBe(-150);
    expect(measuredPoints.objective).toBeCloseTo(225, 10);
    expect(measuredPoints.bill).toBeCloseTo(75, 10);
    expect(differenceOf(lapsed)).toBe(150);
  });
});

describe("a task's room", () => {
  it("requires mixed validity or a valid answer on record that leaves room", () => {
    const nobody = new Set<string>();
    for (const [old, known, expected] of [
      [[P, F], [], true],
      [[F, F], [], false],
      [[P, P], [], false],
      [[P, P], ["t"], false],
      [[F, F], ["t"], true],
      [[F, F], ["u"], false],
    ] as const) {
      expect(informative({ task: "t", old, fresh: [F, F] }, "old", new Set(known))).toBe(expected);
    }
    for (const [old, expected] of [
      [[100, 100], false],
      [[100, 100 + 1e-8], false],
      [[100, 102], true],
      [[100, 101], false],
    ] as const) {
      expect(
        informative(
          { task: "t", old: [P, P], fresh: [F, F], objective: { ...lowerRule, old, fresh: [null, null] } },
          "old",
          nobody,
        ),
      ).toBe(expected);
    }
    // An author's proof can improve an existing measure, in either direction, including below zero.
    for (const [direction, old, version, author, expected] of [
      ["lower", [100, 100], "t", 99, true],
      ["lower", [100, 100], "t", 99.5, false],
      ["lower", [100, 100], "t", 100, false],
      ["lower", [100, 100], "t", 120, false],
      ["lower", [100, 100], "u", 90, false],
      ["lower", [null, null], "t", 90, false],
      ["lower", [100, null], "t", 90, true],
      ["lower", [100, null], "t", 100, false],
      ["higher", [100, 100], "t", 120, true],
      ["higher", [100, 100], "t", 90, false],
      ["higher", [-10, -10], "t", 0, true],
    ] as const) {
      expect(
        informative(
          { task: "t", old: [P, P], fresh: [F, F], objective: { direction, old, fresh: [null, null] } },
          "old",
          nobody,
          new Map([[version, author]]),
        ),
      ).toBe(expected);
    }
    expect(informative({ task: "t", old: [P, P], fresh: [F, F] }, "old", nobody, new Map([["t", 90]]))).toBe(
      false,
    );
    for (const [fresh, expected] of [
      [[90, 100], true],
      [[99.9, 99.9], false],
      [[120, 120], false],
      [[100, 100], false],
    ] as const) {
      expect(
        informative(
          { task: "t", old: [P, P], fresh: [P, P], objective: { ...lowerRule, old: [100, 100], fresh } },
          "old",
          nobody,
        ),
      ).toBe(expected);
    }
  });

  it("closes only a side whose every answer is valid and nothing on record betters", () => {
    for (const [old, fresh, side, expected] of [
      [[12, 12], [10, 10], "fresh", true],
      [[12, 12], [10, 10], "old", false],
      [[12, 12], [10, 11], "fresh", false],
      [[12, 12], [10, 10.05], "fresh", true],
      [[12, 9], [10, 10], "fresh", false],
      [[10 - 1e-9, 10 - 1e-9], [10, 10], "fresh", true],
    ] as const) {
      expect(
        closedTo({ task: "t", old: [P, P], fresh: [P, P], objective: { ...lowerRule, old, fresh } }, side),
      ).toBe(expected);
    }
    expect(
      closedTo(
        {
          task: "t",
          old: [P, P],
          fresh: [P, F],
          objective: { ...lowerRule, old: [12, 12], fresh: [10, 10] },
        },
        "fresh",
      ),
    ).toBe(false);
  });
});

const heldOut = (version: string) => [
  event("task.proposed", { version }),
  event("task.gate", { version, gate: 1, outcome: "passed" }),
];
let solves = 0;
/** One solve of `condition`'s task, recorded as the runner records one, for comparison `c-1`
 *  unless `spent` names another. */
const solve = (condition: Condition, outcome: "pass" | "fail" | "non-result", spent: JsonObject = {}) => {
  solves += 1;
  const [id, name] = [conditionId(condition), `s-${String(solves)}`];
  const { comparison = "c-1", ...end } = spent;
  return [
    event("condition.recorded", { id, condition: requireJsonValue(condition) }),
    event("solve.started", { solve: name, condition: id, task: "t", comparison }),
    event("solve.finished", { solve: name, ending: { outcome }, ...end }),
  ];
};
const fresh: Condition = { ...base, harness: "new", solverTools: "new" };
const sides = { old: "old", fresh: "new", setting: settingId(base), comparison: "c-1" };
const held = [...heldOut("v0"), ...heldOut("v1")];

describe("the pairs a comparison reads from the log", () => {
  it("counts every pass and fail of a held-out task under either harness, cut to the solves a side it asked, with what each cost", () => {
    const log = [
      ...held,
      // An end of 9 October, with the figures a solve reported then; what a pair keeps of it is the cost.
      ...solve(base, "pass", {
        turns: 20,
        prompts: 2,
        seconds: 600,
        cpu: { seconds: 90, unmeasured: 0 },
        billed: 6.5,
      }),
      ...solve(fresh, "non-result", { seconds: 60 }),
      ...solve(fresh, "pass", { turns: 9, seconds: 300 }),
      ...solve({ ...fresh, side: "strong" }, "pass"),
      ...solve(base, "fail", { seconds: 900 }),
      ...solve(fresh, "pass"),
      ...solve({ ...base, task: "v0" }, "pass"),
      ...solve({ ...fresh, task: "v0" }, "fail"),
      // A third harness's solve of the task is no side of this comparison.
      ...solve({ ...base, harness: "starter", solverTools: "starter" }, "fail"),
    ];
    const none = { billed: null };
    const other = {
      task: "v0",
      old: [P],
      fresh: [F],
      solves: { old: ["s-7"], fresh: ["s-8"] },
      used: { old: [none], fresh: [none] },
    };
    // Each counted solve is named: the non-result and the stronger side's solve, s-2 and s-4, are
    // not among them, and neither is the starter's. A task with fewer solves than asked on a side
    // is named short and is in no pair, as a resume may leave one.
    expect(pairsOf(log, ["v1", "v0"], sides, 2)).toEqual({
      pairs: [
        {
          task: "v1",
          old: [P, F],
          fresh: [P, P],
          solves: { old: ["s-1", "s-5"], fresh: ["s-3", "s-6"] },
          // What each solve cost; its turns, prompts, CPU and seconds stay in the log's events
          // for the investigation and are no part of a pair since 2026-10-11.
          used: { old: [{ billed: 6.5 }, none], fresh: [none, none] },
        },
      ],
      short: ["v0"],
      disputed: [],
    });
    // A side with more is cut to its first solves, in every list alike.
    const first = {
      task: "v1",
      old: [P],
      fresh: [P],
      solves: { old: ["s-1"], fresh: ["s-3"] },
      used: { old: [{ billed: 6.5 }], fresh: [none] },
    };
    expect(pairsOf(log, ["v1", "v0"], sides, 1)).toEqual({ pairs: [first, other], short: [], disputed: [] });
    // The same log read against the starter pairs the same new solves with that harness's.
    expect(pairsOf(log, ["v1"], { ...sides, old: "starter" }, 1).pairs[0]).toMatchObject({
      old: [F],
      fresh: [P],
    });
    // A disputed task is out on both sides, and it is named.
    const disputed = [...log, event("task.state", { version: "v1", state: "disputed" })];
    expect(pairsOf(disputed, ["v1", "v0"], sides, 1)).toEqual({
      pairs: [other],
      short: [],
      disputed: ["v1"],
    });
  });

  it("refuses a practice task, a refused one, one never proposed, and a harness set against itself", () => {
    for (const [events, version, harnesses, reason] of [
      [[...held, event("task.state", { version: "v1", state: "released" })], "v1", sides, /v1.*released/],
      [[...held, event("task.state", { version: "v1", state: "refused" })], "v1", sides, /v1.*refused/],
      [[event("task.proposed", { version: "v2" })], "v2", sides, /v2.*gate/],
      [held, "v9", sides, /v9.*not proposed/],
      [held, "v1", { ...sides, fresh: "old" }, /both sides are old/],
    ] as const) {
      expect(() => pairsOf(events, [version], harnesses, 1)).toThrow(reason);
    }
  });
});

describe("the identity of a counted solve", () => {
  it("counts no solve that is not the comparison's own: one that opened another harness than its condition names, another solver's, another comparison's or none's", () => {
    const read = (log: readonly LogEvent[], as: Partial<typeof sides> = {}) => {
      const paired = pairsOf([...held, ...log], ["v1"], { ...sides, ...as }, 1);
      const [pair] = paired.pairs;
      return pair === undefined ? { short: paired.short } : { old: pair.old, fresh: pair.fresh };
    };
    // The runner stops a comparison on a solve that opened another harness, and the comparison
    // goes on from this log: a kept harness once opened without its tool tree (2026-10-09), and
    // its answer stayed in the log under the condition that names the whole harness.
    const opened = [
      ...solve(base, "pass", { harness: "old" }),
      ...solve(fresh, "fail", { harness: "other" }),
      ...solve(fresh, "pass", { harness: "new" }),
    ];
    expect(read(opened)).toEqual({ old: [P], fresh: [P] });
    // A setting is the solver, its limits and the host: a solve made on another host is another
    // setting's, and a task or a harness moves no setting.
    const moved = { ...fresh, host: "h2" };
    const hosts = [...solve(base, "pass"), ...solve(moved, "pass"), ...solve(fresh, "fail")];
    expect(read(hosts)).toEqual({ old: [P], fresh: [F] });
    expect(read(hosts, { setting: settingId(moved) })).toEqual({ short: ["v1"] });
    expect(settingId({ ...base, limits: { ...base.limits, wallSeconds: 14_400 } })).not.toBe(settingId(base));
    const elsewhere: Condition = { ...base, task: "v0", harness: "new", solverTools: "new" };
    expect(settingId(elsewhere)).toBe(settingId(base));
    // An earlier comparison, a practice solve that names none, and a later comparison's solves
    // made while this one was stopped: none of them is a solve of `c-1`. Both sides are solved
    // afresh at every comparison.
    const others = [
      ...solve(base, "fail", { comparison: "c-0" }),
      ...solve(fresh, "pass", { comparison: "c-0" }),
      ...solve(base, "pass"),
      ...solve(fresh, "pass", { comparison: null }),
      ...solve(base, "fail", { comparison: "c-2" }),
      ...solve(fresh, "fail"),
    ];
    expect(read(others)).toEqual({ old: [P], fresh: [F] });
    expect(read(others, { comparison: "c-0" })).toEqual({ old: [F], fresh: [P] });
    expect(read(others, { comparison: "c-2" })).toEqual({ short: ["v1"] });
  });
});

describe("the order of counted solves", () => {
  it("orders a side's solves by when they started, so the first taken are not the quick ones", () => {
    // Two solves in flight at once: the one started second ends first, with a valid answer, as a
    // quick solve under a budget does. The first started is still the first of its side.
    const [slow, quick] = [solve(base, "fail"), solve(base, "pass")];
    const [slowEnd, quickEnd] = [slow.at(-1), quick.at(-1)];
    if (slowEnd === undefined || quickEnd === undefined) throw new Error("a solve has an ending");
    const log = [
      ...held,
      ...slow.slice(0, 2),
      ...quick.slice(0, 2),
      quickEnd,
      slowEnd,
      ...solve(fresh, "pass"),
      ...solve(fresh, "pass"),
    ];
    expect(pairsOf(log, ["v1"], sides, 2).pairs[0]).toMatchObject({ old: [F, P] });
    expect(pairsOf(log, ["v1"], sides, 1).pairs[0]).toMatchObject({ old: [F] });
  });

  it("sets a harness against itself by mirrored halves, the first and last of each four against the two between", () => {
    // The reference's four solves of a task, in the order they started: valid, not, not, valid.
    const log = [
      ...held,
      ...solve(base, "pass"),
      ...solve(base, "fail"),
      ...solve(base, "fail"),
      ...solve(base, "pass"),
      ...solve(fresh, "pass"),
      ...solve(fresh, "fail"),
    ];
    const halves = (as: Partial<Parameters<typeof pairsOf>[2]>) =>
      pairsOf(log, ["v1"], { ...sides, ...as }, 2).pairs[0];
    // The A/A is read as the A/B is: on halves mirrored in time, so that a drift across the
    // task's solves falls on both alike.
    expect(halves({ fresh: "old", halves: "mirrored" })).toMatchObject({ old: [P, P], fresh: [F, F] });
    // Beside it the new harness is paired with the reference's first mirrored half, which is the
    // half its own solves were mirrored around.
    expect(halves({ halves: "mirrored" })).toMatchObject({ old: [P, P], fresh: [P, F] });
  });
});
