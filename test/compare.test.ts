// The comparison's arithmetic against the plan's own figures, and its view over the log: the test
// a reading is made by and what it can detect, the step and its repeat, which solves count for a
// held-out task under a harness, and what it refuses to compare.
import { describe, expect, it } from "bun:test";
import {
  decidedByObjective,
  detectable,
  draw,
  falseRate,
  flipP,
  informative,
  marginOf,
  objectiveRuleIn,
  pairings,
  pairsOf,
  power,
  readTwice,
  scored,
  stepOf,
  sweepOf,
  tally,
  triggered,
  unsolved,
} from "../src/kernel/compare.ts";
import { type Condition, conditionId, fieldsApart, settingId } from "../src/kernel/condition.ts";
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
const [LEVEL, TRIGGER] = [0.1, 0.25];
const lowerRule = { direction: "lower", margin: 0.01 } as const;
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
/** A comparison's report as the log holds what a stage reads: each frontier task's difference, where
 *  the step is read; the retained tasks', or `unmeasured` where none was tallied; and each family's
 *  tallies on the two. */
const report = (
  frontier: readonly number[],
  retained: readonly number[] | null = null,
  families: JsonObject = {},
): JsonObject => ({
  frontier: { differences: [...frontier] },
  retained: retained === null ? "unmeasured" : { differences: [...retained] },
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
/** The chance that a step and its repeat promote, over every drawing of each stage, as the log's
 *  reading of two reports reads them (`readTwice`). */
function promoted(first: readonly Outcome[], second: readonly Outcome[], level = LEVEL): number {
  let chance = 0;
  for (const one of first) {
    if (!triggered(report(one.differences), TRIGGER)) continue;
    for (const two of second) {
      if (readTwice([report(one.differences), report(two.differences)], level, TRIGGER)) {
        chance += one.chance * two.chance;
      }
    }
  }
  return chance;
}
/** A task won one time in `win`, lost one time in `loss`, and tied otherwise: one pair either way. */
const signed = (win: number, loss: number): [number, number][] => [
  [1, win],
  [0, 1 - win - loss],
  [-1, loss],
];

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
    expect(sweepOf(TRIGGER)).toBe(2);
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
    for (const level of [LEVEL, TRIGGER]) {
      const rates = sets.map(({ differences }) => falsely(differences, level));
      expect(Math.max(...rates)).toBeLessThanOrEqual(level);
      expect(Math.max(...rates)).toBeGreaterThan(level / 2);
    }
    // The same where validity is by a chance of the task's own, the same under both harnesses:
    // six tasks from nearly never valid to always, two solves a side, every outcome of all six.
    const tasks = [0.1, 0.3, 0.5, 0.7, 0.9, 1].map((rate) => byDifference(rate, 2));
    const read = new Map([
      [LEVEL, 0],
      [TRIGGER, 0],
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
    expect(read.get(TRIGGER)).toBeLessThanOrEqual(TRIGGER);
    expect(read.get(LEVEL)).toBeGreaterThan(0);
  });

  it("counts a task once by how often each harness was valid, and takes it into the test by how many pairs it was won", () => {
    expect(tally(pairs(6, 1, 17))).toEqual({ wins: 6, losses: 1, ties: 17 });
    // Each task here is won or lost by three pairs: four of the nine to one, or three to none.
    expect(scored(pairs(6, 1, 17))).toEqual({
      wins: 6,
      losses: 1,
      ties: 17,
      p: 0.0625,
      differences: units(6, 1, 3, 17),
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

describe("the step and its repeat", () => {
  it("promote a 2-0 read twice, which is one 4-0 at 0.10, and no first reading by itself", () => {
    expect(triggered(report(units(2, 0, 1, 6)), TRIGGER)).toBe(true);
    expect(readTwice([report(units(2, 0, 1, 6)), report(units(2, 0, 1, 6))], LEVEL, TRIGGER)).toBe(true);
    expect(readTwice([report(units(2, 0, 1, 6))], LEVEL, TRIGGER)).toBe(false);
    expect(readTwice([report(units(8, 0))], LEVEL, TRIGGER)).toBe(false);
    // Only the last two count: an older stage that bought nothing is passed over.
    expect(readTwice([report(units(0, 3)), report(units(2, 0)), report(units(2, 0))], LEVEL, TRIGGER)).toBe(
      true,
    );
  });

  it("promote nothing where the first stage bought no repeat, the repeat tied every task or lost, or a report holds no frontier, each stage's tasks read by their margins", () => {
    // 1-0 does not buy the repeat at 0.25 (p 0.5), however strong the repeat.
    expect(triggered(report(units(1, 0)), TRIGGER)).toBe(false);
    expect(readTwice([report(units(1, 0)), report(units(4, 0))], LEVEL, TRIGGER)).toBe(false);
    // A repeat that tied every task is no second draw: 8-0 and 0-0 is one reading.
    expect(readTwice([report(units(8, 0)), report(units(0, 0, 1, 8))], LEVEL, TRIGGER)).toBe(false);
    // A repeat that lost more than it won does not promote, though the sum 7-2 would clear 0.10.
    expect(flipP(units(7, 2))).toBeLessThanOrEqual(LEVEL);
    expect(readTwice([report(units(6, 0)), report(units(1, 2))], LEVEL, TRIGGER)).toBe(false);
    // A report with no frontier reads nothing: one with no tally, and one written before the
    // frontier was read apart, whose pooled tally is not read again.
    expect(readTwice([report(units(2, 0)), {}], LEVEL, TRIGGER)).toBe(false);
    const before = { scored: { wins: 2, losses: 0, ties: 0, p: 0.25, differences: [1, 1] } };
    expect(triggered(before, TRIGGER)).toBe(false);
    expect(readTwice([before, before], LEVEL, TRIGGER)).toBe(false);
    // A 3-1 whose loss was by four pairs of sixteen buys the repeat, where the sign test's 3-1
    // (p 0.3125) did not; with a repeat that won two by sixteen the two clear 0.10 together.
    expect(triggered(report(units(3, 1)), TRIGGER)).toBe(false);
    const margins = [16, 16, 16, -4];
    expect(triggered(report(margins), TRIGGER)).toBe(true);
    expect(readTwice([report(margins), report([16, 16, 0, 0])], LEVEL, TRIGGER)).toBe(true);
    // A repeat that wins a task by four pairs and loses one by sixteen sums below nothing.
    expect(readTwice([report(margins), report([4, -16])], LEVEL, TRIGGER)).toBe(false);
  });

  it("count a task both stages scored once, its differences summed, and old reports as they were", () => {
    // buffer-149's repeat g-2 scored g-1's own tasks. Counted twice, five tasks won by four pairs
    // twice read as ten signs (p 1/1024) and clear 0.02; counted once they are five signs of eight
    // (p 1/32), which do not. On fresh tasks the same differences are ten tasks, and clear it.
    const won = [4, 4, 4, 4, 4, 0, 0];
    const named = (tasks: readonly string[]): JsonObject => {
      const held = report(won);
      return { ...held, frontier: { differences: [...won], of: [...tasks] } };
    };
    const first = ["a", "b", "c", "d", "e", "f", "g"];
    expect(flipP(units(10, 0))).toBeLessThanOrEqual(0.02);
    expect(flipP(units(5, 0))).toBeGreaterThan(0.02);
    expect(readTwice([named(first), named(first)], 0.02, TRIGGER)).toBe(false);
    expect(readTwice([named(first), named(["h", "i", "j", "k", "l", "m", "n"])], 0.02, TRIGGER)).toBe(true);
    // A report from before 14 October names no task, and its differences stand alone.
    expect(readTwice([report(won), report(won)], 0.02, TRIGGER)).toBe(true);
  });

  it("read the step on the frontier and hold the retained tasks to no net loss, an empty retained set being unmeasured and never no loss", () => {
    const fixes = [16, 16, 16];
    const broke = [-16, -16, -16];
    // On the frontier alone, three fixed buy the repeat, and twice they are a 6-0 that clears 0.10.
    expect(triggered(report(fixes), TRIGGER)).toBe(true);
    expect(readTwice([report(fixes), report(fixes)], LEVEL, TRIGGER)).toBe(true);
    // The three it broke are retained tasks, which the reference answered in every solve: no repeat
    // is bought, and two such stages promote nothing.
    expect(triggered(report(fixes, broke), TRIGGER)).toBe(false);
    expect(readTwice([report(fixes, broke), report(fixes, broke)], LEVEL, TRIGGER)).toBe(false);
    // A repeat that regresses promotes nothing either; retained tasks tied, or won and lost alike,
    // hold.
    expect(readTwice([report(fixes), report(fixes, [-4])], LEVEL, TRIGGER)).toBe(false);
    expect(readTwice([report(fixes, [4, -4, 0]), report(fixes, [0])], LEVEL, TRIGGER)).toBe(true);
    // One reading: a step on the frontier with a net loss on the retained tasks reads `regressed`,
    // and with a net gain there a step.
    expect(stepOf(report([16, ...fixes], broke), LEVEL)).toBe("regressed");
    expect(stepOf(report([16, ...fixes], [0, 4]), LEVEL)).toBe("step");
    // A frontier short of the level reads `no-step` whatever the retained tasks lost: `regressed`
    // is said of a step alone, so a recorded comparison settled again reads as it did.
    expect(stepOf(report(fixes, broke), LEVEL)).toBe("no-step");
    expect(stepOf(report(units(0, 0, 1, 4), [-4]), LEVEL)).toBe("no-step");
    // Against the provisioned starter nothing is exhausted yet: the first promotion's two stages
    // hold no retained task, and promote on the frontier alone.
    expect(stepOf(report(units(4, 0, 16)), LEVEL)).toBe("step");
    expect(readTwice([report(units(2, 0, 16)), report(units(2, 0, 16))], LEVEL, TRIGGER)).toBe(true);
    // A stage whose report names no retained reading at all reads nothing.
    const bare = { frontier: { differences: units(2, 0, 16) }, families: {} };
    expect(triggered(bare, TRIGGER)).toBe(false);
    // One comparison's own reading is of a report it has just tallied: one with no retained
    // reading is a fault of the caller's, and is refused rather than read as no step.
    expect(() => stepOf(bare, LEVEL)).toThrow("a reading needs a frontier and a retained set");
  });

  it("promote nothing where every untied frontier task of both stages falls in one family of the two or more the sets hold", () => {
    // A family name can hide tasks that move for one reason: this reads concentration, and it
    // establishes no independence.
    const one = report(units(4, 0, 16), null, spread({ a: [4, 0] }, ["b"]));
    expect(stepOf(one, LEVEL)).toBe("narrow");
    // A narrow first reading still buys the repeat, which draws other families where it can.
    expect(triggered(one, TRIGGER)).toBe(true);
    expect(readTwice([one, one], LEVEL, TRIGGER)).toBe(false);
    expect(readTwice([one, report(units(2, 0, 16), null, spread({ b: [2, 0] }))], LEVEL, TRIGGER)).toBe(true);
    // A loss is an untied task too: a family that only lost spreads the step as much as one that won.
    const lost = report([16, 16, 16, 16, -4], null, spread({ a: [4, 0], b: [0, 1] }));
    expect(readTwice([lost, lost], LEVEL, TRIGGER)).toBe(true);
    // Where the sets hold one family, a step there is no narrower than the exam.
    const alone = report(units(4, 0, 16), null, spread({ a: [4, 0] }));
    expect(readTwice([alone, alone], LEVEL, TRIGGER)).toBe(true);
  });

  it("promote two equal harnesses no more often than the level, at every size from 4 to 24 tasks and every tie share, by one pair a task or by their margins at four solves a side", () => {
    // A promotion needs the two readings' tasks together to clear the level, so it is no likelier
    // than that one exact reading: the enumeration holds it so, and shows that the first stage's
    // gate leaves the rate near the level rather than far under it. It is the rate of one attempt;
    // a campaign that sets several harnesses against one reference multiplies its chances.
    const shares = [0, 0.25, 0.5, 0.75, 0.9];
    let largest = 0;
    for (const tasks of [4, 8, 12, 16, 20, 24]) {
      const drawn = shares.map((tied) => outcomes(tasks, signed((1 - tied) / 2, (1 - tied) / 2)));
      // Every tie share draws the same multisets in the same order: which pairs promote is read
      // once, and each share weighs them.
      const promoting: [number, number][] = [];
      const first = drawn[0] ?? [];
      first.forEach((one, at) => {
        if (!triggered(report(one.differences), TRIGGER)) return;
        first.forEach((two, next) => {
          if (readTwice([report(one.differences), report(two.differences)], LEVEL, TRIGGER)) {
            promoting.push([at, next]);
          }
        });
      });
      for (const each of drawn) {
        const chance = promoting.reduce(
          (sum, [at, next]) => sum + (each[at]?.chance ?? 0) * (each[next]?.chance ?? 0),
          0,
        );
        largest = Math.max(largest, chance);
      }
    }
    expect(largest).toBeLessThanOrEqual(LEVEL);
    expect(largest).toBeGreaterThan(0.05);
    // Each task's solves are valid by a chance of its own, drawn from four, and the same under
    // both harnesses: a task is won or lost by four pairs for each valid answer one side has more.
    const rates = [0.25, 0.5, 0.75, 1].map((rate) => byDifference(rate, 4));
    const mixed = new Map<number, number>();
    for (const rate of rates) {
      for (const [difference, odds] of rate) mixed.set(difference, (mixed.get(difference) ?? 0) + odds / 4);
    }
    const drawn = outcomes(4, [...mixed]);
    const chance = promoted(drawn, drawn);
    expect(chance).toBeLessThanOrEqual(LEVEL);
    expect(chance).toBeGreaterThan(0);
  });

  it("promote at the rates of the enumeration of 10 October, at sixteen tasks of which three in four tie", () => {
    // A harness that wins 96% of the untied is promoted 82% of the time at 0.25 and 0.10 (55% by
    // two readings at 0.20), 31% at a win rate of 0.75 (14%), and two equal harnesses 3.3% (0.9%);
    // the repeat has to untie a task and not lose.
    const at = (win: number) => outcomes(16, signed(0.25 * win, 0.25 * (1 - win)));
    expect(promoted(at(0.96), at(0.96))).toBeCloseTo(0.823, 2);
    expect(promoted(at(0.75), at(0.75))).toBeCloseTo(0.311, 2);
    expect(promoted(at(0.5), at(0.5))).toBeCloseTo(0.033, 2);
    const once = at(0.96).reduce(
      (sum, { differences, chance }) => sum + (flipP(differences) <= 0.2 ? chance : 0),
      0,
    );
    expect(once ** 2).toBeCloseTo(0.545, 2);
  });
});

describe("the rule's false rate an attempt", () => {
  /** Every signing of `margins`, each as likely: the differences a stage reads between equal harnesses. */
  const signings = (margins: readonly number[]) =>
    Array.from({ length: 2 ** margins.length }, (_, mask) =>
      margins.map((margin, at) => (mask & (1 << at) ? margin : -margin)),
    );

  it("is the two-stage rule's own chance of promoting equal harnesses, over every signing of both stages, under the level and away from it: 5.8% on 24 untied tasks", () => {
    // The rule read through `readTwice` on every pair of signings, against the convolution: the
    // number a report carries and an opening says is the rule's, not a model of it.
    for (const margins of [
      [1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1],
      [4, 8, 12],
      [4, 4, 8, 16, 4],
    ]) {
      const all = signings(margins);
      const promoting = all.flatMap((one) =>
        all.filter((two) => readTwice([report(one), report(two)], LEVEL, TRIGGER)),
      ).length;
      expect(falseRate(margins, LEVEL, TRIGGER)).toBeCloseTo(promoting / all.length ** 2, 12);
    }
    // A tie leaves the test, and no untied task promotes nothing.
    expect(falseRate([4, 0, 8, 0, 12], LEVEL, TRIGGER)).toBe(falseRate([4, 8, 12], LEVEL, TRIGGER));
    expect(falseRate([0, 0], LEVEL, TRIGGER)).toBe(0);
    // The plan's section 4b: the nominal level misleads, since an attempt is two readings and the
    // first has to buy the second. At 0.10 the rule promotes equal harnesses 5.8% of the time on
    // 24 untied tasks a stage, each won or lost by a pair; on 24 tasks of which half tie, drawn
    // afresh for each stage, 4.55%.
    const ones = (count: number) => Array.from({ length: count }, () => 1);
    expect(falseRate(ones(24), LEVEL, TRIGGER)).toBeCloseTo(0.058, 3);
    const half = outcomes(24, signed(0.25, 0.25));
    expect(promoted(half, half)).toBeCloseTo(0.0455, 3);
    for (let count = 1; count <= 24; count += 1) {
      expect(falseRate(ones(count), LEVEL, TRIGGER)).toBeLessThanOrEqual(LEVEL);
    }
  });
});

describe("a task's pairings", () => {
  /** The pairs each side won of one task. */
  const won = (pair: Parameters<typeof pairings>[0]) => {
    const { fresh, old } = pairings(pair);
    return { fresh, old };
  };

  it("gives a valid answer the pair over one that is not and leaves two alike even, so a task reads as the harness with more valid answers", () => {
    // Two solves a side: the new harness is valid twice, the reference once.
    expect(won({ task: "t", old: [P, F], fresh: [P, P] })).toEqual({ fresh: 2, old: 0 });
    // Two valid answers are even, however good either is: no objective is read.
    expect(won({ task: "t", old: [P, P], fresh: [P, P] })).toEqual({ fresh: 0, old: 0 });
    expect(won({ task: "t", old: [F, F], fresh: [F, F] })).toEqual({ fresh: 0, old: 0 });
    // One valid answer a side wins a pair each, and the task is a tie.
    expect(won({ task: "t", old: [P, F], fresh: [F, P] })).toEqual({ fresh: 1, old: 1 });
    expect(unsolved({ task: "t", old: [F, F], fresh: [F, F] })).toBe(true);
    expect(unsolved({ task: "t", old: [F, F], fresh: [F, P] })).toBe(false);
    for (let solves = 1; solves <= 4; solves += 1) {
      for (let valid = 0; valid <= solves; valid += 1) {
        for (let other = 0; other <= solves; other += 1) {
          const side = (passes: number) => Array.from({ length: solves }, (_, nth) => nth < passes);
          const each = won({ task: "t", old: side(other), fresh: side(valid) });
          expect(Math.sign(each.fresh - each.old)).toBe(Math.sign(valid - other));
        }
      }
    }
  });

  it("sets two valid answers apart by the objective, by more than the margin, and no invalid one", () => {
    const lower = { direction: "lower", margin: 0.01 } as const;
    // Two valid answers a side, the new harness's lighter: it wins every pairing of the four.
    expect(
      won({
        task: "t",
        old: [P, P],
        fresh: [P, P],
        objective: { ...lower, old: [10, 11], fresh: [8, 9] },
      }),
    ).toEqual({ fresh: 4, old: 0 });
    // The same measures the other way up, where higher is better.
    expect(
      won({
        task: "t",
        old: [P, P],
        fresh: [P, P],
        objective: { ...lower, direction: "higher", old: [10, 11], fresh: [8, 9] },
      }),
    ).toEqual({ fresh: 0, old: 4 });
    // Within the margin of the larger measure two answers are even: 10 against 10.05 at 0.01 is,
    // and 10 against 10.2 is not. A measure missing on one side decides nothing.
    expect(
      won({
        task: "t",
        old: [P, P],
        fresh: [P, P],
        objective: { ...lower, old: [10.05, 10.2], fresh: [10, null] },
      }),
    ).toEqual({ fresh: 1, old: 0 });
    // Validity is read first: a refused answer loses to a valid one whatever either measures, and
    // a measure on a refused answer is never read. Between the two valid answers the objective
    // decides, so the new harness, valid once at 100, loses that pairing too.
    expect(
      won({
        task: "t",
        old: [P, F],
        fresh: [F, P],
        objective: { ...lower, old: [1, 1], fresh: [1, 100] },
      }),
    ).toEqual({ fresh: 1, old: 2 });
    // Each pairing is decided once: by validity where one answer was valid, by the objective between
    // two valid answers it told apart, and the pairings of two valid answers are counted beside.
    expect(
      pairings({
        task: "t",
        old: [P, F],
        fresh: [F, P],
        objective: { ...lower, old: [1, 1], fresh: [1, 100] },
      }),
    ).toEqual({
      fresh: 1,
      old: 2,
      validity: { fresh: 1, old: 1 },
      objective: { fresh: 0, old: 1 },
      valid: 1,
    });
    // How many tasks the objective decided: the ones that validity alone would have tied.
    const even = { task: "e", old: [P, P], fresh: [P, P] };
    expect(
      decidedByObjective([
        { ...even, objective: { ...lower, old: [10, 10], fresh: [8, 8] } },
        { ...even, objective: { ...lower, old: [10, 10], fresh: [10, 10] } },
        { ...even, task: "w", old: [F, F], objective: { ...lower, old: [1, 1], fresh: [100, 100] } },
        even,
      ]),
    ).toBe(1);
  });

  it("calls a task informative for a side valid on some solves and not all, or apart past the margin", () => {
    const pair = (old: boolean[], measured: (number | null)[] = []) => ({
      task: "t",
      old,
      fresh: [P, P],
      objective: { direction: "lower" as const, margin: 0.05, old: measured, fresh: [1, 1] },
    });
    expect(informative(pair([P, F]), "old")).toBe(true);
    // Failed in every solve, or valid in every solve with no objective: nothing to gain on.
    expect(informative(pair([F, F]), "old")).toBe(false);
    expect(informative(pair([P, P]), "old")).toBe(false);
    // Valid in every solve, its own answers apart by the margin or less: no room (#144's hostile case).
    expect(informative(pair([P, P], [100, 104]), "old")).toBe(false);
    // Apart by more than the margin: a better answer is there to find.
    expect(informative(pair([P, P], [100, 110]), "old")).toBe(true);
  });

  it("sets the objective's margin at the 90th percentile of the reference's own spread in its A/A", () => {
    // The reference against itself, two solves a half: ten tasks whose valid answers part by 0% to
    // 9% of the larger measure across the halves, and one invalid answer, which is never measured.
    const aa = Array.from({ length: 10 }, (_, at) => ({
      task: `t${String(at)}`,
      old: [P, P],
      fresh: [P, at === 0 ? F : P],
      objective: { ...lowerRule, old: [100, 100], fresh: [100 - at, at === 0 ? null : 100 - at] },
    }));
    // 38 pairings of two measured valid answers, two at 0% and four at each of 1% to 9%; the 90th
    // percentile is the 35th smallest, the first at 9%.
    const set = marginOf(aa);
    expect(set?.pairings).toBe(38);
    expect(set?.margin).toBeCloseTo(0.09, 9);
    // At that margin the A/A's own pairings are set apart one time in ten at most, and none of
    // its valid pairs reads a gain the reference's noise alone would not: every task ties or loses.
    const read = aa.map((pair) => ({ ...pair, objective: { ...pair.objective, margin: set?.margin ?? 0 } }));
    expect(tally(read).wins).toBe(0);
    // No measured pair, no margin: the default stands, and the comparison says so.
    expect(marginOf([{ task: "t", old: [P], fresh: [P] }])).toBeNull();
    // A start records what set its margin, and the rule read back keeps it.
    expect(objectiveRuleIn({ objective: { ...lowerRule, from: 38 } })).toEqual({ ...lowerRule, from: 38 });
    expect(objectiveRuleIn({ objective: { ...lowerRule, from: null } })).toEqual({
      ...lowerRule,
      from: null,
    });
  });

  it("reads an objective rule off a comparison's start, and none off a malformed one", () => {
    expect(objectiveRuleIn({ objective: { direction: "lower", margin: 0.01, decided: 3 } })).toEqual(
      lowerRule,
    );
    for (const objective of [
      undefined,
      null,
      { direction: "lower" },
      { direction: "best", margin: 0.01 },
      { direction: "higher", margin: -1 },
    ]) {
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
      diskBytes: 2 * 1024 ** 3,
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

  it("names the fields two conditions differ in", () => {
    expect(fieldsApart(base, fresh)).toEqual(["harness", "solverTools"]);
    expect(fieldsApart(base, { ...base, limits: { ...base.limits, turns: 80 } })).toEqual(["limits"]);
  });

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

  it("sets a harness against itself by mirrored halves, the first and last of each four against the two between, and earlier against later apart", () => {
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
