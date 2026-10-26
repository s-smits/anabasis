// The comparison's arithmetic against the plan's own figures, and its view over the log: the test
// a reading is made by and what it can detect, one reading's step, which solves count for a
// held-out task under a harness, symmetric score quantisation, and what it refuses to compare.
// Unequal margins can support a step containing losses. The retained-loss cases answer
// buffer-pr197-opus-m1's single flagged solve blocking a promotion (18 October 2026).
import { describe, expect, it } from "bun:test";
import {
  closedTo,
  differenceOf,
  detectable,
  draw,
  flipP,
  informative,
  objectiveRuleIn,
  type Paired,
  pairsOf,
  pointsOf,
  power,
  readsStepEitherWay,
  roomLeft,
  scored,
  stepOf,
  sweepOf,
  tally,
  unsolved,
  wholePoints,
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

const [P, F] = [true, false];
const [LEVEL, WIDE] = [0.1, 0.25];
const lowerRule = { direction: "lower" } as const;
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
/** A comparison's report as the log holds what its step reads: each frontier task's difference; the
 *  retained tasks', or `unmeasured` where none was tallied; and each family's tallies on the two.
 *  Each task's score without the bill is its score, as where no bill differed. */
const report = (
  frontier: readonly number[],
  retained: readonly number[] | null = null,
  families: JsonObject = {},
): JsonObject => ({
  frontier: { differences: [...frontier], unbilled: [...frontier] },
  retained: retained === null ? "unmeasured" : { differences: [...retained], unbilled: [...retained] },
  families,
});
/** Each family's frontier tally, from its wins and losses, as a report holds it: `tied` families
 *  hold one tied task each. */
const spread = (untied: Readonly<Record<string, readonly [number, number]>>, tied: readonly string[] = []) =>
  Object.fromEntries([
    ...Object.entries(untied).map(([name, [wins, losses]]) => [
      name,
      { frontier: { wins, losses, ties: 0 }, retained: { wins: 0, losses: 0, ties: 0 } },
    ]),
    ...tied.map((name) => [
      name,
      { frontier: { wins: 0, losses: 0, ties: 1 }, retained: { wins: 0, losses: 0, ties: 0 } },
    ]),
  ]);
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
  it("reads as the sign test where every untied task is won or lost by as many pairs: the plan's smallest wins pass at 0.10, one win short of them does not", () => {
    const smallest = [
      [4, 0],
      [6, 1],
      [7, 2],
      [9, 3],
    ] as const;
    for (const by of [1, 4, 16]) {
      expect(smallest.map(([wins, losses]) => flipP(units(wins, losses, by)))).toEqual([
        0.0625, 0.0625, 0.08984375, 0.072998046875,
      ]);
      expect(smallest.every(([wins, losses]) => flipP(units(wins - 1, losses, by)) > LEVEL)).toBe(true);
    }
    // Ties leave the test, and no untied task is no evidence.
    expect(flipP(units(4, 0, 2, 9))).toBe(0.0625);
    expect(flipP([])).toBe(1);
    expect(flipP(units(0, 0, 1, 5))).toBe(1);
    expect(sweepOf(LEVEL)).toBe(4);
    expect(sweepOf(WIDE)).toBe(2);
    expect(sweepOf(0.2)).toBe(3);
  });

  it("reads by how many pairs each task was won: a 4-1 lost by one pair in sixteen clears 0.10, and one won by one pair each and lost by sixteen reads no gain", () => {
    // The sign test read every 4-1 at 0.1875, whatever the four solves a side said.
    expect(flipP(units(4, 1))).toBe(0.1875);
    expect(flipP([16, 16, 16, 16, -4])).toBe(0.0625);
    expect(flipP([4, 4, 4, 4, -16])).toBeGreaterThanOrEqual(0.5);
  });

  it("reads a tally of over a thousand untied tasks by its tail, where the first term alone would be 0", () => {
    // Until 11 October the sign test's recurrence started at 0.5 to the untied count, 0 from 1,075
    // on, and every tally there read 0, as certain a step as could be.
    expect(flipP(units(0, 1100))).toBeCloseTo(1, 10);
    expect(flipP(units(1100, 0))).toBeLessThan(1e-300);
    expect(flipP(units(560, 540))).toBeGreaterThan(0.25);
    expect(flipP(units(600, 550))).toBeCloseTo(0.0742, 3);
  });

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

describe("what a reading can detect", () => {
  // Untied tasks, the wins a step needs when none of them is lost to a tie, and the power at a
  // true win share of 65%, 75% and 85%, in whole percent as the plan prints them.
  const TABLE = [
    [8, 7, 17, 37, 66],
    [12, 9, 35, 65, 91],
    [16, 12, 29, 63, 92],
    [24, 16, 53, 88, 99],
  ] as const;

  it("is the plan's table, row by row, where each untied task is won or lost by as many pairs: none under the least sweep, and between equal harnesses never over the level", () => {
    for (const [untied, needed, ...percents] of TABLE) {
      const fewest = Array.from({ length: untied + 1 }, (_, wins) => wins).find(
        (wins) => flipP(units(wins, untied - wins)) <= LEVEL,
      );
      expect(fewest).toBe(needed);
      expect(
        [0.65, 0.75, 0.85].map((share) => Math.round(100 * power(units(untied, 0), share, LEVEL))),
      ).toEqual([...percents]);
    }
    expect(power(units(3, 0), 1, LEVEL)).toBe(0);
    expect(power([], 1, LEVEL)).toBe(0);
    expect(power(units(4, 0), 1, LEVEL)).toBe(1);
    // No true difference. Of five only 5-0 clears, and of seven 7-0 and 6-1; ties are no draw.
    expect(power(units(5, 0), 0.5, LEVEL)).toBe(1 / 32);
    expect(power(units(7, 0), 0.5, LEVEL)).toBe(8 / 128);
    expect(power(units(4, 0, 1, 5), 0.5, LEVEL)).toBe(0.0625);
    // Which sign a task's difference has is the draw's: the power reads its size alone.
    expect(power(units(2, 2), 0.5, LEVEL)).toBe(0.0625);
    for (const [untied] of TABLE) {
      const falsely = power(units(untied, 0), 0.5, LEVEL);
      expect(falsely).toBeGreaterThan(0.02);
      expect(falsely).toBeLessThan(0.08);
    }
    // Sixteen tasks detect no more than twelve, since the wins needed move in whole steps.
    expect(power(units(16, 0), 0.75, LEVEL)).toBeLessThan(power(units(12, 0), 0.75, LEVEL));
    // 1.6% at 6 untied to 9.5% at 21, and never over the level.
    const every = Array.from({ length: 21 }, (_, index) => power(units(index + 4, 0), 0.5, LEVEL));
    expect(Math.min(...every)).toBe(1 / 64);
    expect(Math.max(...every)).toBeCloseTo(0.0946, 4);
    expect(every.indexOf(Math.max(...every)) + 4).toBe(21);
  });

  it("names the least share of its untied tasks won that a reading detects four times in five, and none under the least sweep", () => {
    // Four untied tasks clear 0.10 only all won: s to the fourth reaches 0.8 at 0.95.
    expect(detectable(units(4, 0), LEVEL)).toBe(0.95);
    expect(detectable(units(3, 0), LEVEL)).toBeNull();
    expect(detectable([], LEVEL)).toBeNull();
    // Ties are no evidence and do not move it; the sign of a task's difference does not either.
    expect(detectable(units(2, 2, 1, 9), LEVEL)).toBe(0.95);
    // It is the least share in hundredths at which the power reaches four in five.
    for (const untied of [8, 12, 24]) {
      const least = detectable(units(untied, 0), LEVEL) ?? 1;
      expect(power(units(untied, 0), least, LEVEL)).toBeGreaterThanOrEqual(0.8);
      expect(power(units(untied, 0), least - 0.01, LEVEL)).toBeLessThan(0.8);
    }
    // More untied tasks detect a smaller share: twelve detect no 75%, twenty-four do.
    expect(detectable(units(12, 0), LEVEL)).toBeGreaterThan(0.75);
    expect(detectable(units(24, 0), LEVEL)).toBeLessThan(0.75);
  });
});

describe("one reading", () => {
  const STRICT = 0.02;

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

  it("reads a step whose untied frontier tasks all fall in one family of the two the sets hold as any other", () => {
    // Until 16 October such a step read `narrow` and promoted nothing; it never fired.
    expect(stepOf(report(units(4, 0, 16), null, spread({ a: [4, 0] }, ["b"])), LEVEL)).toBe("step");
  });

  it("reads a step between equal harnesses at the test's own rate: 1.13% on 24 untied tasks at 0.02, 6.8% over a patience of six", () => {
    const rate = power(units(24, 0), 0.5, STRICT);
    expect(rate).toBeCloseTo(0.01133, 5);
    expect(6 * rate).toBeCloseTo(0.068, 3);
    expect(power(units(24, 0), 0.5, LEVEL)).toBeCloseTo(0.0758, 4);
    for (let count = 1; count <= 24; count += 1) {
      expect(power(units(count, 0), 0.5, STRICT)).toBeLessThanOrEqual(STRICT);
    }
  });
});

describe("a task's pairings", () => {
  it("rounds a score half points away from zero, so that a negative half rounds down", () => {
    // The one rounding of a task's difference, a report's measure totals and the tuner's replay.
    expect([32.5, -32.5, 0.5, -0.5, -32.4].map(wholePoints)).toEqual([33, -33, 1, -1, -32]);
    expect(Object.is(wholePoints(-0.4), 0)).toBe(true);
  });

  it.each([
    [1200, 1187, 33],
    [1187, 1200, -33],
  ])("rounds an objective half point away from zero for %s against %s", (old, fresh, expected) => {
    const measured = (one: number, other: number): Paired => ({
      task: "half",
      old: [P],
      fresh: [P],
      objective: { ...lowerRule, old: [one], fresh: [other] },
    });
    expect(pointsOf(measured(old, fresh)).objective).toBe(Math.sign(expected) * 32.5);
    expect(differenceOf(measured(old, fresh))).toBe(expected);
    expect(differenceOf(measured(fresh, old))).toBe(-differenceOf(measured(old, fresh)));
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

  it("gives a valid answer the pair over one that is not and leaves two alike even, so a task reads as the harness with more valid answers", () => {
    // Two solves a side: the new harness is valid twice, the reference once, so it wins two of the
    // four pairings on validity: half of validity's 600 points.
    expect(differenceOf({ task: "t", old: [P, F], fresh: [P, P] })).toBe(300);
    // Two valid answers are even, however good either is: no objective is read.
    expect(differenceOf({ task: "t", old: [P, P], fresh: [P, P] })).toBe(0);
    expect(differenceOf({ task: "t", old: [F, F], fresh: [F, F] })).toBe(0);
    // One valid answer a side wins a pair each, and the task is a tie.
    expect(differenceOf({ task: "t", old: [P, F], fresh: [F, P] })).toBe(0);
    expect(unsolved({ task: "t", old: [F, F], fresh: [F, F] })).toBe(true);
    expect(unsolved({ task: "t", old: [F, F], fresh: [F, P] })).toBe(false);
    for (let solves = 1; solves <= 4; solves += 1) {
      for (let valid = 0; valid <= solves; valid += 1) {
        for (let other = 0; other <= solves; other += 1) {
          const side = (passes: number) => Array.from({ length: solves }, (_, nth) => nth < passes);
          const pair = { task: "t", old: side(other), fresh: side(valid) };
          expect(Math.sign(differenceOf(pair))).toBe(Math.sign(valid - other));
        }
      }
    }
  });

  it("sets two valid answers apart by the objective from the room floor, and no invalid one", () => {
    const lower = { direction: "lower" } as const;
    // Two valid answers a side, the new harness's a tenth or more lighter in every pairing: the
    // objective's whole 300 points.
    expect(
      differenceOf({
        task: "t",
        old: [P, P],
        fresh: [P, P],
        objective: { ...lower, old: [10, 11], fresh: [8, 9] },
      }),
    ).toBe(300);
    // The same measures the other way up, where higher is better.
    expect(
      differenceOf({
        task: "t",
        old: [P, P],
        fresh: [P, P],
        objective: { direction: "higher", old: [10, 11], fresh: [8, 9] },
      }),
    ).toBe(-300);
    // Two valid answers closer than the room floor tie: 10 against 10.05 is half a percent, and a
    // measure missing on one side decides nothing.
    expect(
      differenceOf({
        task: "t",
        old: [P, P],
        fresh: [P, P],
        objective: { ...lower, old: [10.05, 10], fresh: [10, 8] },
      }),
    ).toBe(150);
    expect(
      differenceOf({
        task: "t",
        old: [P, P],
        fresh: [P, P],
        objective: { ...lower, old: [10.05, 10], fresh: [10, null] },
      }),
    ).toBe(0);
    // Validity is read first: a refused answer loses to a valid one whatever either measures, and
    // a measure on a refused answer is never read.
    expect(
      pointsOf({
        task: "t",
        old: [P, F],
        fresh: [F, P],
        objective: { ...lower, old: [1, 1], fresh: [1, 100] },
      }),
    ).toEqual({ validity: 0, objective: -75, bill: 0 });
  });

  it("scores a task by its measures over the pairings, weighed, with the objective full at a tenth better and the bill full at half, each from its floor", () => {
    const billed = (...each: number[]) => each.map((one) => ({ billed: one }));
    const points = (pair: Paired) => {
      const { validity, objective, bill } = pointsOf(pair);
      return [validity, objective, bill].map((one) => Math.round(one));
    };
    const even = { task: "c", old: [P, P], fresh: [P, P] };
    // Half the bill on every solve, with answers alike: the bill's whole weight, 100 points.
    const cheap = { ...even, used: { old: billed(0.2, 0.2), fresh: billed(0.1, 0.1) } };
    expect(points(cheap)).toEqual([0, 0, 100]);
    expect(differenceOf({ ...cheap, used: { old: billed(0.4, 0.4), fresh: billed(0.1, 0.1) } })).toBe(100);
    // A fifth less is at the floor, whatever the float of 0.5 against 0.4 reads; 13% less is under it.
    expect(differenceOf({ ...cheap, used: { old: billed(0.5, 0.5), fresh: billed(0.4, 0.4) } })).toBe(32);
    expect(differenceOf({ ...cheap, used: { old: billed(0.115, 0.115), fresh: billed(0.1, 0.1) } })).toBe(0);
    // The objective: 5% better is half its weight, a tenth or more the whole, under 1% nothing.
    const measured = (old: number, fresh: number): Paired => ({
      ...even,
      objective: { direction: "lower", old: [old, old], fresh: [fresh, fresh] },
    });
    expect(differenceOf(measured(100, 95))).toBe(150);
    expect(differenceOf(measured(100, 50))).toBe(300);
    expect(differenceOf(measured(100, 99.5))).toBe(0);
    expect(differenceOf(measured(95, 100))).toBe(-150);
    // A dearer answer that measures a fifth better wins the task from a cheaper one.
    expect(points({ ...measured(10, 8), used: { old: billed(0.1, 0.1), fresh: billed(0.2, 0.2) } })).toEqual([
      0, 300, -100,
    ]);
    // An answer that fails fast is cheap, and its pairings read no bill; nor do two failed answers.
    const failed = { ...cheap, fresh: [F, F] };
    expect(points(failed)).toEqual([-600, 0, 0]);
    expect(differenceOf({ ...failed, old: [F, F] })).toBe(0);
    // The measures trade: valid in 3 solves of 4 against 4 of 4, the new harness gives up 150 points
    // of validity and gains 225 by measuring a fifth better and 75 by billing half on the twelve
    // pairings of two valid answers, so it wins the task.
    const lapsed: Paired = {
      task: "l",
      old: [P, P, P, P],
      fresh: [P, P, P, F],
      objective: { direction: "lower", old: [10, 10, 10, 10], fresh: [8, 8, 8, null] },
      used: { old: billed(0.2, 0.2, 0.2, 0.2), fresh: billed(0.1, 0.1, 0.1, 0.1) },
    };
    expect(points(lapsed)).toEqual([-150, 225, 75]);
    expect(differenceOf(lapsed)).toBe(150);
  });

  it("counts a gain by the objective in a pair only at the room floor, the one it holds room to", () => {
    // Six tasks with room: the reference measures 100, its author's answer 70, and the new harness
    // 99.99. A 0.01% gain is under the floor, so the six tie, while the room the author's answer
    // leaves stays told. Read at floating-point equality, as comparisons begun before 21 October
    // once were, they read 6-0 and a step at 0.02.
    const one = (n: number): Paired => ({
      task: `t${String(n)}`,
      old: [P, P],
      fresh: [P, P],
      objective: { direction: "lower", old: [100, 100], fresh: [99.99, 99.99] },
    });
    expect(tally([1, 2, 3, 4, 5, 6].map(one))).toEqual({ wins: 0, losses: 0, ties: 6 });
    expect(roomLeft(one(1), "old", [70])).toBeCloseTo(0.3);
    expect(informative(one(1), "old", new Set(), new Map([["t1", 70]]))).toBe(true);
    expect(roomLeft({ task: "t", old: [F], fresh: [P] }, "old", [70])).toBeNull();
  });

  it("calls a task informative for a side valid on some solves and not all, bettered by the objective, or on none where a valid answer is on record", () => {
    const pair = (old: boolean[], measured: (number | null)[] = []) => ({
      task: "t",
      old,
      fresh: [F, F],
      objective: { direction: "lower" as const, old: measured, fresh: [null, null] },
    });
    const nobody = new Set<string>();
    const known = new Set(["t"]);
    expect(informative(pair([P, F]), "old", nobody)).toBe(true);
    // Failed in every solve with no valid answer on record, or valid in every solve with no
    // objective: nothing to gain on.
    expect(informative(pair([F, F]), "old", nobody)).toBe(false);
    expect(informative(pair([P, P]), "old", nobody)).toBe(false);
    expect(informative(pair([P, P]), "old", known)).toBe(false);
    // Failed in every solve where a valid answer is on record, another harness's or its author's
    // (`poolOf`, feasible): the room a promotion leaves (15 October). Until then never informative,
    // so a reference that passed every scored solve had room only on tasks it answered some of the time.
    expect(informative(pair([F, F]), "old", known)).toBe(true);
    expect(informative(pair([F, F]), "old", new Set(["u"]))).toBe(false);
    // Valid in every solve at one measure, or within a billionth of it: no room (#144's hostile case).
    expect(informative(pair([P, P], [100, 100]), "old", nobody)).toBe(false);
    expect(informative(pair([P, P], [100, 100 + 1e-8]), "old", nobody)).toBe(false);
    // Its own answers apart by the room floor or more: its better one is there to find. Closer than
    // that, the task is closed, as r6's g-2 won its tasks by rounding (`ROOM`).
    expect(informative(pair([P, P], [100, 102]), "old", nobody)).toBe(true);
    expect(informative(pair([P, P], [100, 101]), "old", nobody)).toBe(false);
    // Alike, where an author's answer on record is better: a better harness can reach it, and wins
    // the pairs against them (19 October). One that is the same, or worse, leaves none.
    expect(informative(pair([P, P], [100, 100]), "old", nobody, new Map([["t", 99]]))).toBe(true);
    expect(informative(pair([P, P], [100, 100]), "old", nobody, new Map([["t", 99.5]]))).toBe(false);
    expect(informative(pair([P, P], [100, 100]), "old", nobody, new Map([["t", 100]]))).toBe(false);
    expect(informative(pair([P, P], [100, 100]), "old", nobody, new Map([["t", 120]]))).toBe(false);
    expect(informative(pair([P, P], [100, 100]), "old", nobody, new Map([["u", 90]]))).toBe(false);
    // Valid answers with no measure, or a pair with no objective, have nothing to be bettered on.
    expect(informative(pair([P, P], [null, null]), "old", nobody, new Map([["t", 90]]))).toBe(false);
    const { objective: _none, ...unmeasured } = pair([P, P], [100, 100]);
    expect(informative(unmeasured, "old", nobody, new Map([["t", 90]]))).toBe(false);
    // One valid answer measured and one not: the measured one is compared, the other with nothing.
    expect(informative(pair([P, P], [100, null]), "old", nobody, new Map([["t", 90]]))).toBe(true);
    expect(informative(pair([P, P], [100, null]), "old", nobody, new Map([["t", 100]]))).toBe(false);
    // Under a higher objective the author's must be the larger, at zero and below as above.
    const higher = (measured: number[]) => ({
      ...pair([P, P], measured),
      objective: { direction: "higher" as const, old: measured, fresh: [null, null] },
    });
    expect(informative(higher([100, 100]), "old", nobody, new Map([["t", 120]]))).toBe(true);
    expect(informative(higher([100, 100]), "old", nobody, new Map([["t", 90]]))).toBe(false);
    expect(informative(higher([-10, -10]), "old", nobody, new Map([["t", 0]]))).toBe(true);
    // The other side's valid answer better than one of its own: room. One it beat, or one the same
    // as its own, leaves none (19 October).
    const against = (fresh: number[]) => ({
      task: "t",
      old: [P, P],
      fresh: [P, P],
      objective: { direction: "lower" as const, old: [100, 100], fresh },
    });
    expect(informative(against([90, 100]), "old", nobody)).toBe(true);
    expect(informative(against([99.9, 99.9]), "old", nobody)).toBe(false);
    expect(informative(against([120, 120]), "old", nobody)).toBe(false);
    expect(informative(against([100, 100]), "old", nobody)).toBe(false);
  });

  it("closes a task to the side whose answers nothing on record bettered, its wins by the objective among them", () => {
    const pair = (old: number[], fresh: number[]) => ({
      task: "t",
      old: [P, P],
      fresh: [P, P],
      objective: { direction: "lower" as const, old, fresh },
    });
    // The shape of buffer-fresh-opus-forkedPR223_v0_5_4-r2 after its promotion: the promoted
    // harness won every pairing on the objective at one value. Until 19 October the pairings told
    // apart kept the task open to it, and it stood on its frontier at an answer nobody had bettered.
    expect(closedTo(pair([12, 12], [10, 10]), "fresh")).toBe(true);
    // The side that lost them has a better answer to reach.
    expect(closedTo(pair([12, 12], [10, 10]), "old")).toBe(false);
    // Its own answers apart: its better one is there to find every time.
    expect(closedTo(pair([12, 12], [10, 11]), "fresh")).toBe(false);
    // Apart by less than the room floor is closed: the next harness can only win it by rounding.
    expect(closedTo(pair([12, 12], [10, 10.05]), "fresh")).toBe(true);
    // One better answer of the other side's opens it, as many as there are.
    expect(closedTo(pair([12, 9], [10, 10]), "fresh")).toBe(false);
    // Within a billionth is alike.
    expect(closedTo(pair([10 - 1e-9, 10 - 1e-9], [10, 10]), "fresh")).toBe(true);
    // A failed solve of its own leaves it open whatever the objective says.
    expect(closedTo({ ...pair([12, 12], [10, 10]), fresh: [P, F] }, "fresh")).toBe(false);
  });

  it("leaves a task open that an author's answer on record outdoes, so the room it was held for stays on the frontier", () => {
    const pair = {
      task: "t",
      old: [P, P],
      fresh: [P, P],
      objective: { direction: "lower" as const, old: [10, 10], fresh: [10, 10] },
    };
    expect(closedTo(pair, "old")).toBe(true);
    expect(closedTo(pair, "old", 9)).toBe(false);
    // Within a billionth, or no better, it closes as before (19 October).
    expect(closedTo(pair, "old", 10 - 1e-9)).toBe(true);
    expect(closedTo(pair, "old", 11)).toBe(true);
  });

  it("reads an objective rule off a comparison's start, and none off a malformed one", () => {
    expect(objectiveRuleIn({ objective: { direction: "lower", margin: 0.01, decided: 3 } })).toEqual(
      lowerRule,
    );
    // A start of before 19 October also holds its margin, and one of 12 to 18 October what set it:
    // neither is read since, and the direction stands.
    expect(objectiveRuleIn({ objective: { ...lowerRule, margin: 0.2, from: 38 } })).toEqual(lowerRule);
    expect(objectiveRuleIn({ objective: { direction: "higher", margin: -1 } })).toEqual({
      direction: "higher",
    });
    for (const objective of [undefined, null, { margin: 0.01 }, { direction: "best", margin: 0.01 }]) {
      expect(objectiveRuleIn({ objective: objective ?? null })).toBeUndefined();
    }
  });
});

describe("a draw", () => {
  const pool = ["v1", "v2", "v3", "v4", "v5", "v6"];

  it("replays from its seed, moves no rank when the pool grows, and refuses a short pool", () => {
    const first = draw(pool, 3, "seed-a");
    expect(draw(pool.toReversed(), 3, "seed-a")).toEqual(first);
    expect(draw(pool, 3, "seed-b")).not.toEqual(first);
    const grown = draw([...pool, "v7"], 7, "seed-a").filter((version) => version !== "v7");
    expect(grown).toEqual(draw(pool, 6, "seed-a"));
    expect(() => draw(["v1", "v1"], 2, "seed-a")).toThrow("a draw of 2 needs as many task versions; 1 given");
  });
});

describe("the pairs a comparison reads from the log", () => {
  const at = "2026-10-09T00:00:00.000Z";
  const event = (kind: EventKind, data: JsonObject): LogEvent => ({ at, kind, data });
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

  it("reads each counted solve's measure off its verdict where the sides fix an objective", () => {
    /** A solve's events with its verdict after them, measured where a value is given. */
    const measured = (solved: readonly LogEvent[], objective?: number) => [
      ...solved,
      event("verdict", {
        solve: solved[1]?.data.solve ?? "",
        task: "t",
        answer: {},
        kind: "pass",
        ...keyIfDefined("objective", objective),
      }),
    ];
    const log = [
      ...held,
      ...measured(solve(base, "pass"), 12),
      ...measured(solve(fresh, "pass"), 9),
      ...solve(base, "fail"),
      ...measured(solve(fresh, "pass")),
    ];
    const read = pairsOf(log, ["v1"], { ...sides, objective: lowerRule }, 2).pairs[0];
    expect(read).toMatchObject({
      old: [P, F],
      fresh: [P, P],
      objective: { ...lowerRule, old: [12, null], fresh: [9, null] },
    });
    // The measures are cut with the solves they are of.
    expect(pairsOf(log, ["v1"], { ...sides, objective: lowerRule }, 1).pairs[0]?.objective).toEqual({
      ...lowerRule,
      old: [12],
      fresh: [9],
    });
    // Sides that fix no objective read none, whatever the verdicts hold.
    expect(pairsOf(log, ["v1"], sides, 2).pairs[0]).not.toHaveProperty("objective");
  });

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

  it("refuses a practice task, a refused one, one never proposed, and a harness set against itself", () => {
    const released = [...held, event("task.state", { version: "v1", state: "released" })];
    expect(() => pairsOf(released, ["v1"], sides, 1)).toThrow(
      "task v1 is released; only a held-out task is scored",
    );
    const ungated = [event("task.proposed", { version: "v2" })];
    expect(() => pairsOf(ungated, ["v2"], sides, 1)).toThrow(
      "task v2 has not passed its gate; only a held-out task is scored",
    );
    expect(() => pairsOf(held, ["v9"], sides, 1)).toThrow("task v9 is not proposed");
    expect(() => pairsOf(held, ["v1"], { ...sides, fresh: "old" }, 1)).toThrow(
      "a comparison sets two harnesses against each other, and both sides are old",
    );
  });
});
