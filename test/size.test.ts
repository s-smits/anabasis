// The size of a comparison: the plan's (`7f0add79:docs/plan.md`, "Statistical power and cost"), and what a
// comparison of a given size says it can show and risks before it runs. The lines are the whole
// surface: the results that clear a level are read off them. The power itself is the test's own
// arithmetic (`test/compare.test.ts`).
import { describe, expect, it } from "bun:test";
import { planOf } from "../src/builder/opening.ts";
import { sweepOf } from "../src/kernel/compare.ts";
import { SIZE, sizeLines } from "../src/kernel/size.ts";
import { COMPARISON_OPTIONS, ROUND_OPTIONS } from "../tools/d2/round.ts";

const LEVEL = 0.1;
const ASKED = { level: LEVEL };
/** The line of one reading's rate between equal harnesses. */
const rate = (percent: string) =>
  `one reading at these margins reads a step between equal harnesses ${percent} of the time where no task ties: the level is a per-comparison level`;

describe("a comparison's size", () => {
  it("is 24 tasks at four solves a side, read at 0.02, where nothing names another", () => {
    // Solves come before tasks: at four a side a task the two harnesses split is won or lost by
    // as many pairs as its valid answers part them, which the test reads.
    expect(SIZE).toEqual({ tasks: 24, solves: 4 });
    expect(COMPARISON_OPTIONS.solves.default).toBe(String(SIZE.solves));
    expect(planOf([], { unprepared: false, level: LEVEL }, null).wanted.target).toBe(SIZE.tasks);
    expect(ROUND_OPTIONS.level.default).toBe("0.02");
    expect(sweepOf(Number(ROUND_OPTIONS.level.default))).toBe(6);
    // One reading of the default size at the default level reads a step between equal harnesses
    // 1.1% of the time. Until 20 October an opening summed that over the patience, 6.8% over six,
    // and refused one past 10%.
    expect(sizeLines(SIZE.tasks, { level: Number(ROUND_OPTIONS.level.default) }).at(-1)).toBe(rate("1.1%"));
  });
});

describe("what a comparison of a given size can show, said before it runs", () => {
  it("is nothing on fewer tasks than a step takes", () => {
    expect(sizeLines(1, ASKED)).toEqual([
      "1 held-out task can be scored, and at --level 0.1 a step takes 4, all won: this comparison cannot read a step",
    ]);
    expect(sizeLines(0, ASKED).at(0)).toBe(
      "no held-out task can be scored, and at --level 0.1 a step takes 4, all won: this comparison cannot read a step",
    );
    // Three tasks clear nothing at 0.10, and five at 0.02.
    expect(sizeLines(3, ASKED)).toHaveLength(1);
    expect(sizeLines(5, { ...ASKED, level: 0.02 }).at(0)).toContain("a step takes 6, all won");
  });

  it("names the smallest results that read a step, the share one reading detects and its rate between equal harnesses", () => {
    expect(sizeLines(12, ASKED)).toEqual([
      // The plan's results at 0.10 are 4-0, 6-1, 7-2 and 9-3: a line names the three smallest,
      // each the fewest wins beside its losses.
      "12 held-out tasks can be scored; at --level 0.1 the smallest results that read a step are 4-0, 6-1, 7-2, each task won or lost by as many pairs",
      // A comparison buys tasks, not untied tasks: the share is the best case, where none ties.
      "were no task to tie, one reading at --level 0.1 would detect four times in five a harness that wins 81% of the tasks, and fewer untied tasks need a larger share",
      rate("7.3%"),
    ]);
    // Three campaigns of 9 and 10 October stopped on 3-0, one win short of the sweep at 0.10. At
    // 0.20 a 3-0 clears, and neither 2-0 nor 3-1 does.
    expect(sizeLines(12, { ...ASKED, level: 0.2 }).at(0)).toContain("read a step are 3-0, 4-1, 6-2,");
    expect(sizeLines(24, { ...ASKED, level: 0.02 }).at(0)).toContain("read a step are 6-0, 8-1, 10-2,");
    // A rate too small for a tenth of a percent is said as under it, never as none.
    expect(sizeLines(24, { level: 0.0001 }).at(2)).toContain("under 0.1% of the time");
  });
});
