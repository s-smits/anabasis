// The size of a comparison: the plan's (`7f0add79:docs/plan.md`, "Statistical power and cost"), and what a
// comparison of a given size says it can show and risks before it runs. The lines are the whole
// surface: the results that clear a level are read off them. The power itself is the test's own
// arithmetic (`test/compare.test.ts`).
import { describe, expect, it } from "bun:test";
import { sizeLines } from "../src/kernel/size.ts";

describe("what a comparison of a given size can show, said before it runs", () => {
  it("names the smallest results that read a step, the share one reading detects and its rate between equal harnesses", () => {
    const [results, share, rate] = sizeLines(12, { level: 0.1 });
    // The plan's results at 0.10 are 4-0, 6-1, 7-2 and 9-3: a line names the three smallest,
    // each the fewest wins beside its losses.
    expect(results).toMatch(/^12 held-out tasks\b.*--level 0\.1\b.*\b4-0, 6-1, 7-2,/u);
    // A comparison buys tasks, not untied tasks: the share is the best case, where none ties.
    for (const fact of ["no task to tie", "81%"]) expect(share).toContain(fact);
    for (const fact of ["7.3%", "no task ties", "per-comparison"]) expect(rate).toContain(fact);
    // Three campaigns of 9 and 10 October stopped on 3-0, one win short of the sweep at 0.10. At
    // 0.20 a 3-0 clears, and neither 2-0 nor 3-1 does.
    expect(sizeLines(12, { level: 0.2 }).at(0)).toContain("3-0, 4-1, 6-2");
    expect(sizeLines(24, { level: 0.02 }).at(0)).toContain("6-0, 8-1, 10-2");
    // A rate too small for a tenth of a percent is said as under it, never as none.
    expect(sizeLines(24, { level: 0.0001 }).at(2)).toContain("under 0.1%");
  });
});
