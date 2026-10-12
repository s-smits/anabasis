// The size of a comparison: the plan's (`docs/plan.md`, "Statistical power and cost"), the smallest
// results that clear a level, and what a comparison of a given size says it can show before it runs.
// The power itself is the test's own arithmetic (`test/compare.test.ts`).
import { describe, expect, it } from "bun:test";
import { planOf } from "../src/builder/opening.ts";
import { flipP, sweepOf } from "../src/kernel/compare.ts";
import { clearing, FALSE_CAP, openingLines, SIZE, sizeLines, upperBound } from "../src/kernel/size.ts";
import { COMPARISON_OPTIONS, ROUND_OPTIONS } from "../tools/d2/round.ts";

const LEVEL = 0.1;
const ASKED = { level: LEVEL, trigger: 0.25 };
/** `wins` tasks won and `losses` lost by one pair each. */
const units = (wins: number, losses: number) => [
  ...Array.from({ length: wins }, () => 1),
  ...Array.from({ length: losses }, () => -1),
];

describe("a comparison's size", () => {
  it("is 24 tasks at four solves a side where nothing names another", () => {
    // Solves come before tasks: at four a side a task the two harnesses split is won or lost by
    // as many pairs as its valid answers part them, which the test reads, and a set short of
    // tasks still reads each of them closely.
    expect(SIZE).toEqual({ tasks: 24, solves: 4 });
    expect(COMPARISON_OPTIONS.solves.default).toBe(String(SIZE.solves));
    const plan = planOf([], { unprepared: false, level: LEVEL, trigger: 0.25 }, null);
    expect(plan.wanted.target).toBe(SIZE.tasks);
    // The level and the trigger are the opening's, and the A/A control moves neither.
    expect(ROUND_OPTIONS.level.default).toBe("0.1");
    expect(ROUND_OPTIONS.trigger.default).toBe("0.25");
  });
});

describe("the smallest results that clear a level", () => {
  it("are the plan's at 0.10, as far as they fit in the set, each task won or lost by as many pairs", () => {
    expect(clearing(24, LEVEL).slice(0, 4)).toEqual([
      { wins: 4, losses: 0 },
      { wins: 6, losses: 1 },
      { wins: 7, losses: 2 },
      { wins: 9, losses: 3 },
    ]);
    // Each is the fewest wins beside its losses, by the comparison's own test.
    for (const { wins, losses } of clearing(24, LEVEL)) {
      expect(flipP(units(wins, losses))).toBeLessThanOrEqual(LEVEL);
      expect(flipP(units(wins - 1, losses))).toBeGreaterThan(LEVEL);
      expect(wins + losses).toBeLessThanOrEqual(24);
    }
    expect(clearing(6, LEVEL)).toEqual([{ wins: 4, losses: 0 }]);
    expect(clearing(7, LEVEL)).toHaveLength(2);
    expect(clearing(3, LEVEL)).toEqual([]);
    expect(clearing(0, LEVEL)).toEqual([]);
  });

  it("are 3-0, 4-1, 6-2 and 7-3 at 0.20, and never 2-0 or 3-1", () => {
    // Three campaigns of 9 and 10 October stopped on 3-0-3, 3-0-5 and 3-0-7, one win short of the
    // sweep at 0.10. At 0.20 a 3-0 clears (p = 0.125); 2-0 (p = 0.25) and 3-1 (p = 0.3125) do not.
    expect(sweepOf(0.2)).toBe(3);
    expect(clearing(12, 0.2)).toEqual([
      { wins: 3, losses: 0 },
      { wins: 4, losses: 1 },
      { wins: 6, losses: 2 },
      { wins: 7, losses: 3 },
      { wins: 8, losses: 4 },
    ]);
    expect(flipP(units(2, 0))).toBeGreaterThan(0.2);
    expect(flipP(units(3, 1))).toBeGreaterThan(0.2);
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

  it("names the results that buy the repeat and that promote, and the least share of untied tasks one reading detects", () => {
    expect(sizeLines(12, ASKED)).toEqual([
      "12 held-out tasks can be scored; at --trigger 0.25 the smallest results that buy the repeat are 2-0, 4-1, 5-2, and at --level 0.1 the step and its repeat together clear at 4-0, 6-1, 7-2, each task won or lost by as many pairs",
      // A comparison buys tasks, not untied tasks: the share is the best case, where none ties.
      "were no task to tie, one reading at --level 0.1 would detect four times in five a harness that wins 81% of the tasks, and fewer untied tasks need a larger share",
      // The rule's own false rate an attempt beside the level, by the function a report uses.
      "an attempt, a step and its repeat on as many tasks, promotes between equal harnesses 5.6% of the time where no task ties: the level is one reading's, and this the rule's",
    ]);
    // Three tasks clear nothing at 0.10 in one reading, though they buy a repeat at 0.25 and two
    // readings of them can promote.
    expect(sizeLines(3, ASKED).slice(1)).toEqual([
      "were no task to tie, one reading at --level 0.1 would detect no share of 3 tasks: it takes 4, all won",
      "an attempt, a step and its repeat on as many tasks, promotes between equal harnesses 1.6% of the time where no task ties: the level is one reading's, and this the rule's",
    ]);
  });
});

describe("what a campaign's opening risks", () => {
  const wanted = { target: SIZE.tasks, ...ASKED };

  it("is the union bound over its patience's attempts, and an opening past 10% is refused with what holds it", () => {
    // At the size and the patience nothing names another, six attempts at 5.8% each: 34.8%.
    expect(() => openingLines(wanted, 6)).toThrow(
      "over the patience's 6 attempts under one reference a false promotion comes at most 34.8% of the time, past the 10% a campaign may open on: --patience 1 or less holds it, and so does --level 0.02 or lower",
    );
    expect(FALSE_CAP).toBe(0.1);
    // One attempt holds it, and so does a lower level at the same patience: 1.3% an attempt at 0.02.
    expect(openingLines(wanted, 1)).toEqual([
      ...sizeLines(SIZE.tasks, ASKED),
      "over the patience's 1 attempt under one reference a false promotion comes at most 5.8% of the time",
    ]);
    expect(openingLines({ ...wanted, level: 0.02 }, 6).at(-1)).toBe(
      "over the patience's 6 attempts under one reference a false promotion comes at most 7.6% of the time",
    );
    // A rate too small for a tenth of a percent is said as under it, never as none.
    expect(openingLines({ ...wanted, level: 0.001 }, 6).at(2)).toContain("under 0.1% of the time");
    // A set no two readings can promote on risks nothing.
    expect(openingLines({ ...wanted, target: 1 }, 6).at(-1)).toContain("at most 0% of the time");
    // Where a patience of one is past the cap, no patience holds it.
    expect(() => openingLines({ ...wanted, level: 0.3, trigger: 0.5 }, 1)).toThrow(
      "no patience holds it at this --level",
    );
  });
});

describe("a rate read off so many trials", () => {
  /** The chance of `errors` or fewer in `trials` at `rate`. */
  const atMost = (errors: number, trials: number, rate: number) =>
    Array.from({ length: errors + 1 }, (_, k) => {
      let ways = 1;
      for (let at = 0; at < k; at += 1) ways = (ways * (trials - at)) / (at + 1);
      return ways * rate ** k * (1 - rate) ** (trials - k);
    }).reduce((sum, term) => sum + term, 0);

  it("is bounded above with no error seen, never read as none: about three in so many at 95%", () => {
    for (const trials of [1, 5, 10, 30, 100]) {
      const bound = upperBound(0, trials, 0.95);
      expect(bound).toBeGreaterThan(0);
      expect(bound).toBeCloseTo(1 - 0.05 ** (1 / trials), 9);
      expect(bound).toBeLessThanOrEqual(3 / trials);
    }
    // No trial says nothing: the bound is the whole range.
    expect(upperBound(0, 0, 0.95)).toBe(1);
  });

  it("is the rate at which so few errors or fewer come one time in twenty, exactly", () => {
    for (const [errors, trials] of [
      [1, 10],
      [2, 20],
      [3, 8],
    ] as const) {
      const bound = upperBound(errors, trials, 0.95);
      expect(atMost(errors, trials, bound)).toBeCloseTo(0.05, 6);
      expect(bound).toBeGreaterThan(errors / trials);
    }
    expect(upperBound(1, 10, 0.95)).toBeCloseTo(0.3942, 3);
    expect(upperBound(4, 4, 0.95)).toBe(1);
  });
});
