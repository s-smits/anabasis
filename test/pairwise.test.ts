// Phase 0's rehearsal of the pairwise comparison on stored answers: two cycles of a sweep set
// against each other as a round sets two harnesses, and how far a value moves between repeated
// solves of one task. The reading of a stored sweep on disk is not under test here.
import { describe, expect, it } from "bun:test";
import { pairings, scored } from "../src/kernel/compare.ts";
import type { Objective } from "../src/kernel/contract.ts";
import { cyclePairs, repeatSpread, type StoredSolve } from "../tools/m0/pairwise.ts";

const MASS: Objective = {
  quantity: "mass",
  direction: "minimise",
  path: "$.mass",
  verifiedBy: "check-mass",
  margin: { absolute: 0, relative: 0.01 },
};
let made = 0;
/** One stored solve of `taskId` in `cycle`: valid with the mass it reports, or rejected. */
const stored = (cycle: string, taskId: string, mass: number | "rejected" | "unreported"): StoredSolve => {
  made += 1;
  return {
    cycle,
    taskId,
    solve: `runs/${String(made)}`,
    valid: mass !== "rejected",
    answer: mass === "rejected" || mass === "unreported" ? { members: 3 } : { mass, members: 3 },
  };
};
const SOLVES = [
  // Both cycles always pass t-1, and the last cycle's designs are lighter past the margin.
  stored("c01", "t-1", 100),
  stored("c01", "t-1", 104),
  stored("c08", "t-1", 90),
  stored("c08", "t-1", 92),
  // t-2: the first cycle is rejected once; the valid answers are equal within the margin.
  stored("c01", "t-2", "rejected"),
  stored("c01", "t-2", 50),
  stored("c08", "t-2", 50.2),
  stored("c08", "t-2", 49.9),
  // t-3 was solved three times in the first cycle and once in the last: one of each is compared.
  stored("c01", "t-3", 70),
  stored("c01", "t-3", 10),
  stored("c01", "t-3", 10),
  stored("c08", "t-3", 80),
  // t-4 has no decided solve in the last cycle, and c05 is no part of the comparison.
  stored("c01", "t-4", 30),
  stored("c05", "t-1", 1),
];

describe("the pairwise comparison of two stored cycles", () => {
  const { pairs, unpaired } = cyclePairs(SOLVES, { old: "c01", fresh: "c08" }, MASS);

  it("pairs each task both cycles solved, on as many solves of each as the lesser side has", () => {
    expect(pairs.map(({ task, old, fresh }) => [task, old.length, fresh.length])).toEqual([
      ["t-1", 2, 2],
      ["t-2", 2, 2],
      ["t-3", 1, 1],
    ]);
    expect(unpaired).toEqual(["t-4"]);
    expect(pairs[0]?.values).toEqual({ old: [100, 104], fresh: [90, 92] });
    expect(pairs[1]?.values).toEqual({ old: [null, 50], fresh: [50.2, 49.9] });
    expect(pairs[2]?.solves?.old).toHaveLength(1);
  });

  it("separates by the objective two cycles that validity alone ties", () => {
    const [light, mixed, heavy] = pairs;
    if (light === undefined || mixed === undefined || heavy === undefined) throw new Error("three pairs");
    expect(pairings(light, MASS)).toEqual({ fresh: 4, old: 0 });
    // Two pairings against the rejected answer; the valid ones are within the margin of each other.
    expect(pairings(mixed, MASS)).toEqual({ fresh: 2, old: 0 });
    expect(pairings(heavy, MASS)).toEqual({ fresh: 0, old: 1 });
    expect(scored(pairs, MASS)).toMatchObject({ wins: 2, losses: 1, ties: 0 });
    expect(scored(pairs)).toMatchObject({ wins: 1, losses: 0, ties: 2 });
  });

  it("says how far a value moves between repeated valid solves of one task under one cycle", () => {
    // c01: t-1 moves 4 in 104, t-3 moves 60 in 70; t-2 has one valid solve and t-4 one solve.
    const first = repeatSpread(SOLVES, "c01", MASS);
    expect(first.tasks).toBe(2);
    expect(first.most).toBeCloseTo(60 / 70, 10);
    expect(first.median).toBeCloseTo((4 / 104 + 60 / 70) / 2, 10);
    // An answer that reports no value is no repeat of one.
    const unreported = [stored("c02", "t-9", 40), stored("c02", "t-9", "unreported")];
    expect(repeatSpread(unreported, "c02", MASS)).toEqual({ tasks: 0, median: null, most: null });
  });
});
