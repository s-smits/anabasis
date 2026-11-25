// A mechanism tried on the record reads as production does at today's values, and each form of a
// resource does what its reading claims, on the cases that would make the claim false.
import { describe, expect, it } from "bun:test";
import { knobbed, type Mechanism, TODAY } from "#skills/promotion-tuner/scripts/mechanisms.ts";
import { paired, type Solve, type Task } from "#skills/promotion-tuner/scripts/record.ts";
import { differenceOf, flipP } from "../src/kernel/compare.ts";

const LEVEL = 0.02;
const solve = (billed: number, measure: number | null = null, valid = true): Solve => ({
  valid,
  measure,
  billed,
  turns: billed,
  seconds: billed,
});
const task = (old: readonly Solve[], fresh: readonly Solve[], direction: Task["direction"] = null): Task => ({
  task: "t",
  family: null,
  direction,
  retained: false,
  old,
  fresh,
});
const validOnlyNew = (billed: number) =>
  task([solve(1, null, false), solve(1, null, false)], [solve(billed), solve(billed)]);
const steps = (one: Mechanism, tasks: readonly Task[]) =>
  (one.test?.(tasks.map(one.score), LEVEL, tasks) ?? false) && (one.guard?.(tasks) ?? true);

describe("knobs at today's values", () => {
  it("score every shape of task as production does", () => {
    const today = knobbed(TODAY, "today");
    const values = [null, -10, -1, 0, 1, 9.95, 10, 10.05, 100];
    const flags = [
      [true, true],
      [true, false],
      [false, false],
    ];
    const side = (valid: readonly boolean[], measure: number | null) =>
      valid.map((is) => solve(1, measure, is));
    const measures = values.flatMap((one) => values.map((other) => [one, other] as const));
    const validities = flags.flatMap((old) => flags.map((fresh) => [old, fresh] as const));
    const votes = [
      { fresh: 0, old: 0, judge: 1, holistic: 0.5 },
      { fresh: 1, old: 1, judge: -1, holistic: 0 },
    ];
    const readings = (plain: Task): Task[] => [
      plain,
      { ...plain, scale: "unit" },
      { ...plain, judged: { weights: { code: 1, judge: 1 }, votes } },
    ];
    const grid = (["lower", "higher", null] as const).flatMap((direction) =>
      measures.flatMap(([one, other]) =>
        validities.flatMap(([old, fresh]) => readings(task(side(old, one), side(fresh, other), direction))),
      ),
    );
    for (const each of grid) expect(today.score(each)).toBe(differenceOf(paired(each)));
    expect(grid.length).toBe(3 * 9 * 9 * 3 * 3 * 3);
    expect(new Set(grid.map((each) => differenceOf(paired(each)))).size).toBeGreaterThan(9);
  });

  it("round a half point as production does", () => {
    // Validity in two of the four pairings and a quarter's gain in the other two: 300 and 37.5 points.
    const half = task([solve(1, 75), solve(1, null, false)], [solve(1, 100), solve(1, 100)], "higher");
    expect(differenceOf(paired(half))).toBe(338);
    expect(knobbed(TODAY, "today").score(half)).toBe(338);
  });

  it("read a step where the sign-flip test does, and nowhere else", () => {
    const today = knobbed(TODAY, "today");
    const won = Array.from({ length: 6 }, () => validOnlyNew(1));
    expect(steps(today, won)).toBe(flipP(won.map(today.score)) <= LEVEL);
    expect(steps(today, won)).toBe(true);
    expect(steps(today, won.slice(1))).toBe(false);
  });
});
