// The examiner-complexity readers: an Examiner session's line under the reference in force, a
// campaign's hours to its first comparison and promotion, each draft beside what the gate measured,
// blind grades against outcomes with non-results counted nowhere, and the ladder's rungs re-rated
// blind.
import { describe, expect, it } from "bun:test";
import { compareLines, packetOf } from "#skills/examiner-complexity/scripts/grades.ts";

describe("rungs", () => {
  it("hides each rung's grade from the grader and flags a rung graded below it", () => {
    const packet = packetOf();
    expect(packet).toContain("- 1.1: ");
    expect(packet).not.toMatch(/- \d\.\d: \d: /u);
    const lines = compareLines(
      new Map([
        ["1.1", [{ grade: 1, place: "none" }]],
        [
          "1.2",
          [
            { grade: 2, place: "model" },
            { grade: 1, place: "basin" },
          ],
        ],
      ]),
    );
    expect(lines).toContain("  1.1 stated 1, blind 1 none");
    expect(lines).toContain("  1.2 stated 4, blind 2 model, 1 basin  below, flat");
    expect(lines.at(-1)).toMatch(
      /^1 of 9 rungs at their stated grade, 1 below, 0 above, 1 not above the rung before, 7 not graded$/u,
    );
  });
});
