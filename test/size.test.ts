// The size of a comparison: the plan's (`docs/plan.md`, "Statistical power and cost"), and what a
// comparison of a given size says it can show and risks before it runs. The lines are the whole
// surface: the results that clear a level are read off them. The power itself is the test's own
// arithmetic (`test/compare.test.ts`).
import { describe, expect, it } from "bun:test";
import { upperBound } from "../src/builder/climb.ts";
import { planOf } from "../src/builder/opening.ts";
import { sweepOf, TRIGGER } from "../src/kernel/compare.ts";
import { PATIENCE } from "../src/kernel/reports.ts";
import { openingLines, SIZE, sizeLines } from "../src/kernel/size.ts";
import { COMPARISON_OPTIONS, ROUND_OPTIONS } from "../tools/d2/round.ts";

const LEVEL = 0.1;
const ASKED = { level: LEVEL, trigger: 0.25, patience: 1 };
const RATE =
  "an attempt, a step and its repeat on as many tasks, promotes between equal harnesses 5.6% of the time where no task ties: the level is one reading's, and this the rule's";

/** The union bound's line over so many attempts. */
const bound = (attempts: string, percent: string) =>
  `over the patience's ${attempts} under one reference a false promotion comes at most ${percent} of the time`;

describe("a comparison's size", () => {
  it("is 24 tasks at four solves a side, read at 0.02 with a repeat bought at 0.25, where nothing names another", () => {
    // Solves come before tasks: at four a side a task the two harnesses split is won or lost by
    // as many pairs as its valid answers part them, which the test reads.
    expect(SIZE).toEqual({ tasks: 24, solves: 4 });
    expect(COMPARISON_OPTIONS.solves.default).toBe(String(SIZE.solves));
    expect(planOf([], { unprepared: false, level: LEVEL, trigger: 0.25 }, null).wanted.target).toBe(
      SIZE.tasks,
    );
    expect(ROUND_OPTIONS.level.default).toBe("0.02");
    expect(ROUND_OPTIONS.trigger.default).toBe(String(TRIGGER));
    expect(sweepOf(Number(ROUND_OPTIONS.level.default))).toBe(6);
    // The defaults agree with each other: over the default patience the default level risks 7.6%,
    // under the tenth an opening holds.
    const defaults = { level: Number(ROUND_OPTIONS.level.default), trigger: TRIGGER, patience: PATIENCE };
    expect(openingLines({ target: SIZE.tasks, ...defaults }).at(-1)).toBe(bound("6 attempts", "7.6%"));
  });
});

describe("what a comparison of a given size can show, said before it runs", () => {
  it("is nothing on fewer tasks than a first reading takes, and risks nothing", () => {
    expect(sizeLines(1, ASKED)).toEqual([
      "1 held-out task can be scored, and at --trigger 0.25 a first reading takes 2, all won: this comparison cannot buy a repeat",
      bound("1 attempt", "0%"),
    ]);
    expect(sizeLines(0, ASKED).at(0)).toBe(
      "no held-out task can be scored, and at --trigger 0.25 a first reading takes 2, all won: this comparison cannot buy a repeat",
    );
  });

  it("names the smallest results that buy the repeat and that promote, the share one reading detects, the rule's rate an attempt and its bound over the patience", () => {
    expect(sizeLines(12, ASKED)).toEqual([
      // The plan's results at 0.10 are 4-0, 6-1, 7-2 and 9-3, and at 0.25 2-0, 4-1, 5-2: a line
      // names the three smallest, each the fewest wins beside its losses.
      "12 held-out tasks can be scored; at --trigger 0.25 the smallest results that buy the repeat are 2-0, 4-1, 5-2, and at --level 0.1 the step and its repeat together clear at 4-0, 6-1, 7-2, each task won or lost by as many pairs",
      // A comparison buys tasks, not untied tasks: the share is the best case, where none ties.
      "were no task to tie, one reading at --level 0.1 would detect four times in five a harness that wins 81% of the tasks, and fewer untied tasks need a larger share",
      RATE,
      bound("1 attempt", "5.6%"),
    ]);
    // The bound is the rate times the patience, said with the patience it was counted over.
    expect(sizeLines(12, { ...ASKED, patience: 3 }).at(-1)).toBe(bound("3 attempts", "16.8%"));
    // Three campaigns of 9 and 10 October stopped on 3-0, one win short of the sweep at 0.10. At
    // 0.20 a 3-0 clears, and neither 2-0 nor 3-1 does. A set names only the results that fit it.
    expect(sizeLines(12, { ...ASKED, level: 0.2 }).at(0)).toContain("together clear at 3-0, 4-1, 6-2,");
    expect(sizeLines(3, ASKED).at(0)).toContain("buy the repeat are 2-0, and at --level 0.1");
    expect(sizeLines(3, ASKED).at(0)).toContain("together clear at 4-0, each task");
    // Two tasks at 0.02 can buy the repeat, and no result of both stages clears: until 14 October
    // the line read "clear at , each task".
    expect(sizeLines(2, { ...ASKED, level: 0.02 }).at(0)).toContain(
      "buy the repeat are 2-0, and at --level 0.02 the step and its repeat together cannot clear it, all won, each task",
    );
    // Three tasks clear nothing at 0.10 in one reading, though two readings of them can promote.
    expect(sizeLines(3, ASKED).slice(1, 3)).toEqual([
      "were no task to tie, one reading at --level 0.1 would detect no share of 3 tasks: it takes 4, all won",
      "an attempt, a step and its repeat on as many tasks, promotes between equal harnesses 1.6% of the time where no task ties: the level is one reading's, and this the rule's",
    ]);
  });
});

describe("what a campaign's opening risks", () => {
  const wanted = { target: SIZE.tasks, ...ASKED };

  it("is what its comparisons print, and an opening whose bound passes 10% is refused with what holds it", () => {
    // One attempt holds it: an opening says what a comparison of its target says.
    expect(openingLines(wanted)).toEqual(sizeLines(SIZE.tasks, ASKED));
    expect(openingLines(wanted).at(-1)).toBe(bound("1 attempt", "5.8%"));
    // At the level 0.10 that was the default until 12 October, six attempts at 5.8% each: 34.8%.
    expect(() => openingLines({ ...wanted, patience: 6 })).toThrow(
      `${bound("6 attempts", "34.8%")}, past the 10% a campaign may open on: --patience 1 or less holds it, and so does --level 0.02 or lower`,
    );
    // Where a patience of one is past the cap, no patience holds it.
    expect(() => openingLines({ ...wanted, level: 0.3, trigger: 0.5 })).toThrow(
      "no patience holds it at this --level",
    );
    // A rate too small for a tenth of a percent is said as under it, never as none.
    expect(openingLines({ ...wanted, level: 0.001, patience: 6 }).at(2)).toContain("under 0.1% of the time");
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

  it("is bounded above by the rate at which so few errors come one time in twenty, and no error seen is never a rate of none", () => {
    for (const trials of [1, 5, 10, 30, 100]) {
      const none = upperBound(0, trials, 0.95);
      expect(none).toBeGreaterThan(0);
      expect(none).toBeCloseTo(1 - 0.05 ** (1 / trials), 9);
      expect(none).toBeLessThanOrEqual(3 / trials);
    }
    for (const [errors, trials] of [
      [1, 10],
      [2, 20],
      [3, 8],
    ] as const) {
      const some = upperBound(errors, trials, 0.95);
      expect(atMost(errors, trials, some)).toBeCloseTo(0.05, 6);
      expect(some).toBeGreaterThan(errors / trials);
    }
    expect(upperBound(1, 10, 0.95)).toBeCloseTo(0.3942, 3);
    // No trial says nothing, and as many errors as trials bounds nothing: the whole range.
    expect(upperBound(0, 0, 0.95)).toBe(1);
    expect(upperBound(4, 4, 0.95)).toBe(1);
  });
});
