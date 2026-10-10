// The size of a comparison, against the plan's own table (`docs/plan.md`, "Statistical power and
// cost") and cases small enough to work by hand. The arithmetic is exact, so the figures are too.
import { describe, expect, it } from "bun:test";
import { signP, sweepOf } from "../src/kernel/compare.ts";
import {
  binomial,
  chanceOfPromotion,
  chanceOfStep,
  clearing,
  power,
  sizeLines,
  taskChances,
} from "../src/kernel/size.ts";
import { ROUND_OPTIONS } from "../tools/d2/round.ts";

const LEVEL = 0.1;
const ASKED = { solves: 2, level: LEVEL, trigger: 0.25 };

describe("the chance that a comparison reads a step", () => {
  it("is none without a task, under the least sweep, or when every task ties", () => {
    expect(chanceOfStep(0, { win: 1, loss: 0 }, LEVEL)).toBe(0);
    // At 0.10 the least sweep is four, so three tasks all won clear nothing.
    expect(chanceOfStep(3, { win: 1, loss: 0 }, LEVEL)).toBe(0);
    expect(chanceOfStep(24, { win: 0, loss: 0 }, LEVEL)).toBe(0);
    expect(chanceOfStep(4, { win: 1, loss: 0 }, LEVEL)).toBe(1);
  });

  it("is the binomial sum over the untied tasks and the wins among them", () => {
    // Four tasks, each a win one time in two and never a loss: only 4-0 clears, 1 in 16.
    expect(chanceOfStep(4, { win: 0.5, loss: 0 }, LEVEL)).toBe(0.0625);
    // Five such tasks clear on four or five wins: (5 + 1) / 32.
    expect(chanceOfStep(5, { win: 0.5, loss: 0 }, LEVEL)).toBe(6 / 32);
    // No tie and no true difference. Of five only 5-0 clears, and of seven 7-0 and 6-1.
    expect(chanceOfStep(5, { win: 0.5, loss: 0.5 }, LEVEL)).toBe(1 / 32);
    expect(chanceOfStep(7, { win: 0.5, loss: 0.5 }, LEVEL)).toBe(8 / 128);
  });

  it("gives each count of successes the chance of the orders that hold it", () => {
    expect(binomial(3, 0.5)).toEqual([0.125, 0.375, 0.375, 0.125]);
    const lopsided = binomial(4, 0.9);
    expect(lopsided.reduce((sum, term) => sum + term, 0)).toBeCloseTo(1, 12);
    expect(lopsided[4]).toBeCloseTo(0.9 ** 4, 12);
    expect(binomial(0, 0.3)).toEqual([1]);
  });
});

describe("the plan's table of what a round can detect", () => {
  // Untied tasks, the wins a step needs when none of them is lost to a tie, and the power at a
  // true win share of 65%, 75% and 85%, in whole percent as the plan prints them.
  const TABLE = [
    [8, 7, 17, 37, 66],
    [12, 9, 35, 65, 91],
    [16, 12, 29, 63, 92],
    [24, 16, 53, 88, 99],
  ] as const;

  it("is reproduced row by row", () => {
    for (const [untied, needed, ...percents] of TABLE) {
      const fewest = Array.from({ length: untied + 1 }, (_, wins) => wins).find(
        (wins) => signP(wins, untied - wins) <= LEVEL,
      );
      expect(fewest).toBe(needed);
      expect([0.65, 0.75, 0.85].map((share) => Math.round(100 * power(untied, share, LEVEL)))).toEqual([
        ...percents,
      ]);
    }
  });

  it("keeps the chance of a step between equal harnesses between 2% and 8%", () => {
    for (const [untied] of TABLE) {
      const falsely = power(untied, 0.5, LEVEL);
      expect(falsely).toBeGreaterThan(0.02);
      expect(falsely).toBeLessThan(0.08);
    }
    // Sixteen tasks detect no more than twelve, since the wins needed move in whole steps.
    expect(power(16, 0.75, LEVEL)).toBeLessThan(power(12, 0.75, LEVEL));
    // The untied count is not chosen, and over every one from 4 to 24 the range is wider than the
    // table's four rows show: 1.6% at 6 untied to 9.5% at 21, and never over the level.
    const every = Array.from({ length: 21 }, (_, index) => power(index + 4, 0.5, LEVEL));
    expect(Math.min(...every)).toBe(1 / 64);
    expect(Math.max(...every)).toBeCloseTo(0.0946, 4);
    expect(every.indexOf(Math.max(...every)) + 4).toBe(21);
  });
});

describe("a task's chances when a valid answer is what wins it", () => {
  const tied = (rate: number) => {
    const each = taskChances({ old: rate, fresh: rate }, 2);
    return 1 - each.win - each.loss;
  };

  it("ties two equal harnesses on the plan's shares of tasks, at two solves a side", () => {
    // A task ties when both harnesses give as many valid answers: 38%, 51% and 69% of tasks.
    expect(tied(0.5)).toBe(0.375);
    expect(tied(0.8)).toBeCloseTo(0.5136, 10);
    expect(tied(0.9)).toBeCloseTo(0.6886, 10);
    // Equal harnesses win and lose alike, and a harness that is always valid never loses.
    const even = taskChances({ old: 0.5, fresh: 0.5 }, 2);
    expect(even.win).toBe(even.loss);
    expect(taskChances({ old: 0.5, fresh: 1 }, 2)).toEqual({ win: 0.75, loss: 0 });
    expect(taskChances({ old: 0, fresh: 0 }, 2)).toEqual({ win: 0, loss: 0 });
  });

  it("gives the plan's power where the reference harness is valid half the time and the new one three in four", () => {
    const each = taskChances({ old: 0.5, fresh: 0.75 }, 2);
    expect(Math.round(100 * chanceOfStep(12, each, LEVEL))).toBe(51);
    expect(Math.round(100 * chanceOfStep(24, each, LEVEL))).toBe(80);
    // One comparison of equal harnesses on 12 tasks reads a step about 5% of the time, and three
    // in a row at least once about 14%.
    const falsely = chanceOfStep(12, taskChances({ old: 0.5, fresh: 0.5 }, 2), LEVEL);
    expect(Math.round(100 * falsely)).toBe(5);
    expect(Math.round(100 * (1 - (1 - falsely) ** 3))).toBe(14);
  });
});

describe("the smallest results that clear a level", () => {
  it("are the plan's at 0.10, as far as they fit in the set", () => {
    expect(clearing(24, LEVEL).slice(0, 4)).toEqual([
      { wins: 4, losses: 0 },
      { wins: 6, losses: 1 },
      { wins: 7, losses: 2 },
      { wins: 9, losses: 3 },
    ]);
    // Each is the fewest wins beside its losses, by the comparison's own test.
    for (const { wins, losses } of clearing(24, LEVEL)) {
      expect(signP(wins, losses)).toBeLessThanOrEqual(LEVEL);
      expect(signP(wins - 1, losses)).toBeGreaterThan(LEVEL);
      expect(wins + losses).toBeLessThanOrEqual(24);
    }
    expect(clearing(6, LEVEL)).toEqual([{ wins: 4, losses: 0 }]);
    expect(clearing(7, LEVEL)).toHaveLength(2);
    expect(clearing(3, LEVEL)).toEqual([]);
    expect(clearing(0, LEVEL)).toEqual([]);
  });

  it("are 3-0, 4-1, 6-2 and 7-3 at 0.20, the default since 10 October, and never 2-0 or 3-1", () => {
    // Three campaigns of 9 and 10 October stopped on 3-0-3, 3-0-5 and 3-0-7, one win short of the
    // sweep at 0.10. At 0.20 a 3-0 clears (p = 0.125); 2-0 (p = 0.25) and 3-1 (p = 0.3125) do not,
    // and 2-0-5 is what the reference harness read against itself.
    expect(sweepOf(0.2)).toBe(3);
    expect(clearing(12, 0.2)).toEqual([
      { wins: 3, losses: 0 },
      { wins: 4, losses: 1 },
      { wins: 6, losses: 2 },
      { wins: 7, losses: 3 },
      { wins: 8, losses: 4 },
    ]);
    expect(signP(2, 0)).toBeGreaterThan(0.2);
    expect(signP(3, 1)).toBeGreaterThan(0.2);
    // The plan's worked case at 0.20: the reference valid half the time and the new harness three
    // times in four read a step 69% of the time on 12 tasks; two equal harnesses 11%.
    expect(Math.round(100 * chanceOfStep(12, taskChances({ old: 0.5, fresh: 0.75 }, 2), 0.2))).toBe(69);
    expect(Math.round(100 * chanceOfStep(12, taskChances({ old: 0.5, fresh: 0.5 }, 2), 0.2))).toBe(11);
    expect(ROUND_OPTIONS.level.default).toBe("0.1");
    expect(ROUND_OPTIONS.trigger.default).toBe("0.25");
  });
});

describe("what a comparison of a given size can show, said before it runs", () => {
  it("is nothing on fewer tasks than a first reading takes", () => {
    expect(sizeLines(1, ASKED)).toEqual([
      "1 held-out task can be scored, and at --trigger 0.25 a first reading takes 2, all won: this comparison cannot buy a repeat",
    ]);
    expect(sizeLines(0, ASKED)).toEqual([
      "no held-out task can be scored, and at --trigger 0.25 a first reading takes 2, all won: this comparison cannot buy a repeat",
    ]);
  });

  it("names the results that buy the repeat and that promote, the plan's worked case with its ties, and the table's best case", () => {
    expect(sizeLines(12, ASKED)).toEqual([
      "12 held-out tasks can be scored; at --trigger 0.25 the smallest results that buy the repeat are 2-0, 4-1, 5-2, and at --level 0.1 the step and its repeat together clear at 4-0, 6-1, 7-2",
      // A comparison buys tasks, not untied tasks. Two equal harnesses are promoted 4% of the time
      // at twelve tasks of which 38% tie, by the two-stage rule of 10 October.
      "at 2 solves a side, with the reference harness valid half the time and the new one three times in four, a first reading would buy the repeat 75% of the time and the two would promote 68%; two equal harnesses valid half the time tie on 38% of tasks and would be promoted 4% of the time",
      "were no task to tie, a harness that truly wins 65% of them would be read a step at --level 0.1 on one comparison 35% of the time, one that wins 75%, 65%, and one that wins 85%, 91%",
    ]);
  });

  it("promotes by the two-stage rule at the rates of the enumeration of 10 October", () => {
    // Sixteen tasks of which three in four tie: a harness that wins 96% of the untied is promoted
    // 82% of the time at 0.25 and 0.10 (55% by two readings at 0.20), 31% at a win rate of 0.75
    // (14%), and two equal harnesses 3.3% (0.9%); the repeat has to untie a task and not lose.
    const each = (win: number) => ({ win: 0.25 * win, loss: 0.25 * (1 - win) });
    expect(chanceOfPromotion(16, each(0.96), 0.25, 0.1)).toBeCloseTo(0.823, 2);
    expect(chanceOfPromotion(16, each(0.75), 0.25, 0.1)).toBeCloseTo(0.311, 2);
    expect(chanceOfPromotion(16, each(0.5), 0.25, 0.1)).toBeCloseTo(0.033, 2);
    expect(chanceOfStep(16, each(0.96), 0.2) ** 2).toBeCloseTo(0.545, 2);
  });
});
