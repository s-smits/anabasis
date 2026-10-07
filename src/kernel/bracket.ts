/**
 * The bracket: which tasks a pair scores. A task is admitted when a solve under the stronger
 * condition passes it and at least one of the two harnesses fails it under the test condition.
 * Screening only chooses what is scored, so its solves are never counted in a score.
 *
 * Under the budget pair the one thing changed is the allowance: a solve passes the test condition
 * when its answer is right within one budget, and the stronger one within four. Under the model pair
 * it is the solver, and a fail that ran to the wall does not admit a task, since it says nothing
 * about how far the harness carried the weaker solver.
 */
import { median } from "../meta/tally.ts";
import type { Condition } from "./condition.ts";

export type Budget = Condition["budget"];

/** A verified, metered solve. A non-result never reaches the bracket: it is run once more, then dropped. */
export interface Solve {
  readonly passed: boolean;
  readonly dollars: number;
  readonly cpuSeconds: number;
  readonly wallSeconds: number;
}

/** Budgets the stronger condition allows, and where the host cuts every solve. */
export const STRONGER_BUDGETS = 4;

/** The share of the wall at which a solve counts as wall-bound: v1's own threshold. */
export const WALL_BOUND_SHARE = 0.95;

/** The pair a domain runs, with what its test turns on. */
export type Pair =
  | { readonly kind: "budget"; readonly budget: Budget }
  | { readonly kind: "model"; readonly wallSeconds: number };

/** Gate 5's outcome. A task the stronger condition failed never reaches it: gate 2 marks it too hard. */
export type Screening = "admitted" | "too-easy" | "wall-bound";

/** B and C: half the medians of the passes' dollars and CPU seconds, set once in round 0. */
export function calibrate(solves: readonly Solve[]): Budget {
  const passes = solves.filter((solve) => solve.passed);
  const dollars = median(passes.map((solve) => solve.dollars));
  const cpuSeconds = median(passes.map((solve) => solve.cpuSeconds));
  if (dollars === null || cpuSeconds === null) throw new Error("a budget needs at least one pass");
  return { dollars: dollars / 2, cpuSeconds: cpuSeconds / 2 };
}

/** A solve's cost in budgets: the larger of its dollar share and its CPU share. */
export function budgetsSpent(solve: Solve, budget: Budget): number {
  return Math.max(solve.dollars / budget.dollars, solve.cpuSeconds / budget.cpuSeconds);
}

/** A right answer within `allowance` budgets. A stored solve ran uncut, so one past four is a cut. */
export function passesWithin(solve: Solve, budget: Budget, allowance: number): boolean {
  return solve.passed && budgetsSpent(solve, budget) <= allowance;
}

/** What the budget pair scores: a pass's cost, and four for a wrong answer or a solve the host cut. */
export function cappedCost(solve: Solve, budget: Budget): number {
  return passesWithin(solve, budget, STRONGER_BUDGETS) ? budgetsSpent(solve, budget) : STRONGER_BUDGETS;
}

/** Gate 2: the stronger condition's solve passes, within four budgets under the budget pair. */
export function strongerPasses(pair: Pair, solve: Solve): boolean {
  return pair.kind === "budget" ? passesWithin(solve, pair.budget, STRONGER_BUDGETS) : solve.passed;
}

/**
 * Gate 5: each harness's solve under the test condition. A task is admitted when at least one fails.
 * Under the budget pair a fail is a wrong answer or a cost above one budget. Under the model pair a
 * fail that ran to within `WALL_BOUND_SHARE` of the wall does not admit, and when it is the only
 * fail the task is wall-bound rather than admitted.
 */
export function screen(pair: Pair, tests: readonly [Solve, Solve]): Screening {
  if (pair.kind === "budget") {
    return tests.every((solve) => passesWithin(solve, pair.budget, 1)) ? "too-easy" : "admitted";
  }
  const fails = tests.filter((solve) => !solve.passed);
  if (fails.length === 0) return "too-easy";
  const bound = (solve: Solve) => solve.wallSeconds >= WALL_BOUND_SHARE * pair.wallSeconds;
  return fails.every(bound) ? "wall-bound" : "admitted";
}
