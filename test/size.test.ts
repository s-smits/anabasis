// The size of a comparison: the plan's (`7f0add79:docs/plan.md`, "Statistical power and cost"), and what a
// comparison of a given size says it can show and risks before it runs. The lines are the whole
// surface: the results that clear a level are read off them. The power itself is the test's own
// arithmetic (`test/compare.test.ts`).
import { describe, expect, it } from "bun:test";
import { planOf } from "../src/campaign/opening.ts";
import { sweepOf } from "../src/kernel/compare.ts";
import { SIZE, sizeLines } from "../src/kernel/size.ts";
import { COMPARISON_OPTIONS, ROUND_OPTIONS } from "../tools/d2/round.ts";

const LEVEL = 0.1;
const ASKED = { level: LEVEL };

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
    const rate = sizeLines(SIZE.tasks, { level: Number(ROUND_OPTIONS.level.default) }).at(-1);
    for (const fact of ["1.1%", "no task ties", "per-comparison"]) expect(rate).toContain(fact);
  });
});

describe("what a comparison of a given size can show, said before it runs", () => {
  it("is nothing on fewer tasks than a step takes", () => {
    const one = sizeLines(1, ASKED);
    expect(one).toHaveLength(1);
    for (const fact of ["1 held-out task", "--level 0.1", "takes 4, all won", "cannot read a step"]) {
      expect(one[0]).toContain(fact);
    }
    expect(sizeLines(0, ASKED)).toEqual([expect.stringMatching(/^no held-out task\b.*cannot read a step/u)]);
    // Three tasks clear nothing at 0.10, and five at 0.02.
    expect(sizeLines(3, ASKED)).toHaveLength(1);
    expect(sizeLines(5, { ...ASKED, level: 0.02 }).at(0)).toContain("a step takes 6, all won");
  });

  it("names the smallest results that read a step, the share one reading detects and its rate between equal harnesses", () => {
    const [results, share, rate] = sizeLines(12, ASKED);
    // The plan's results at 0.10 are 4-0, 6-1, 7-2 and 9-3: a line names the three smallest,
    // each the fewest wins beside its losses.
    expect(results).toMatch(/^12 held-out tasks\b.*--level 0\.1\b.*\b4-0, 6-1, 7-2,/u);
    // A comparison buys tasks, not untied tasks: the share is the best case, where none ties.
    for (const fact of ["no task to tie", "81%"]) expect(share).toContain(fact);
    for (const fact of ["7.3%", "no task ties", "per-comparison"]) expect(rate).toContain(fact);
    // Three campaigns of 9 and 10 October stopped on 3-0, one win short of the sweep at 0.10. At
    // 0.20 a 3-0 clears, and neither 2-0 nor 3-1 does.
    expect(sizeLines(12, { ...ASKED, level: 0.2 }).at(0)).toContain(" 3-0, 4-1, 6-2,");
    expect(sizeLines(24, { ...ASKED, level: 0.02 }).at(0)).toContain(" 6-0, 8-1, 10-2,");
    // A rate too small for a tenth of a percent is said as under it, never as none.
    expect(sizeLines(24, { level: 0.0001 }).at(2)).toContain("under 0.1%");
  });
});
