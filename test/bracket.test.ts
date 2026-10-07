import { describe, expect, it } from "bun:test";
import {
  type Pair,
  type Solve,
  calibrate,
  cappedCost,
  passesWithin,
  screen,
  strongerPasses,
} from "../src/kernel/bracket.ts";

const budget = { dollars: 2, cpuSeconds: 100 };
const BUDGET: Pair = { kind: "budget", budget };
const MODEL: Pair = { kind: "model", wallSeconds: 1_000 };

function solve(passed: boolean, dollars = 1, cpuSeconds = 50, wallSeconds = 100): Solve {
  return { passed, dollars, cpuSeconds, wallSeconds };
}

describe("the budget pair", () => {
  it("sets B and C at half the medians of the passes alone", () => {
    const solves = [solve(true, 4, 100), solve(true, 6, 300), solve(true, 8, 200), solve(false, 100, 9_000)];
    expect(calibrate(solves)).toEqual({ dollars: 3, cpuSeconds: 100 });
    expect(() => calibrate([solve(false)])).toThrow("at least one pass");
  });

  it("costs a pass by its larger share, and a wrong or cut solve at four", () => {
    expect(cappedCost(solve(true, 3, 50), budget)).toBe(1.5);
    expect(cappedCost(solve(true, 1, 250), budget)).toBe(2.5);
    expect(cappedCost(solve(false, 1, 50), budget)).toBe(4);
    // Stored solves ran uncut: one past four budgets is the cut the host would have made.
    expect(cappedCost(solve(true, 9, 50), budget)).toBe(4);
    expect(passesWithin(solve(true, 9, 50), budget, 4)).toBe(false);
  });

  it("passes gate 2 within four budgets, and admits a task a harness fails within one", () => {
    const cheap = solve(true, 2, 100);
    const costly = solve(true, 3, 100);
    expect(strongerPasses(BUDGET, solve(true, 8, 400))).toBe(true);
    expect(strongerPasses(BUDGET, solve(true, 8.5, 100))).toBe(false);
    expect(screen(BUDGET, [cheap, costly])).toBe("admitted");
    expect(screen(BUDGET, [cheap, solve(false)])).toBe("admitted");
    expect(screen(BUDGET, [cheap, cheap])).toBe("too-easy");
  });
});

describe("the model pair", () => {
  it("admits a task the weaker solver fails short of the wall on either harness", () => {
    expect(strongerPasses(MODEL, solve(false))).toBe(false);
    expect(strongerPasses(MODEL, solve(true, 99, 99_999))).toBe(true);
    expect(screen(MODEL, [solve(true), solve(true)])).toBe("too-easy");
    expect(screen(MODEL, [solve(true), solve(false)])).toBe("admitted");
  });

  it("does not admit on a fail that ran to the wall", () => {
    const bound = solve(false, 1, 50, 950);
    expect(screen(MODEL, [solve(true), bound])).toBe("wall-bound");
    expect(screen(MODEL, [bound, solve(false, 1, 50, 949)])).toBe("admitted");
  });
});
