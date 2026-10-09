/**
 * The size of a comparison: what one of so many tasks can show, said before it runs.
 *
 * The plan fixes the sample size before each round and never changes it once results are visible
 * (`docs/plan.md`, principle 7), so the size is a choice made on arithmetic. This is that
 * arithmetic: the plan's table of statistical power is `power`, row by row
 * (`test/size.test.ts`), and a launch says with `sizeLines` what the comparison it is about to buy
 * can read. v1 had no such reading: 11 of 322 batteries held a fail nobody contested, and showing
 * a doubled rate would have taken about 650 batteries an arm.
 *
 * Everything here is exact, on the comparison's own test (`signP`, `compare.ts`): binomial sums by
 * the recurrence `signP` uses, with no normal approximation, since the sizes in question are the
 * ones where an approximation is worst. Nothing here decides.
 *
 * The model, wherever a chance is given: tasks are independent, and each scored task is a win
 * with one chance, a loss with another and a tie otherwise. The untied count is then binomial in
 * the tasks, the wins binomial in the untied, and the test clears when the wins reach the fewest
 * that `signP` passes at that untied count. Real tasks are not alike, and a set that is a mixture
 * reads as its mean only in this model.
 *
 * A comparison buys tasks, and the plan's table is in untied ones. What lies between is the tie
 * share: with so many solves a side, a task ties when both harnesses give as many valid answers
 * (`compare.ts`). `taskChances` gives one task's chances of a win and of a loss from each harness's
 * chance of a valid answer, taken as the same on every task, which real tasks are not. With two
 * solves a side and no true difference, 38% of tasks tie when a solve is valid half the time, 51%
 * at four times in five and 69% at nine in ten, so a budget is set where the reference harness is
 * valid about half the time (`docs/plan.md`, Statistical power and cost).
 *
 * Until 2026-10-09 this file also read a pool by how each task stood against the parent and summed
 * the rounds that fell short of a step. A comparison now scores every held-out task, so there is
 * no standing to read a pool by.
 */
import { plural } from "../meta/text.ts";
import { signP, sweepOf } from "./compare.ts";

/** One scored task's chances in the model: of a win and of a loss. The rest is a tie. */
export interface Each {
  readonly win: number;
  readonly loss: number;
}

/** A scored set's result: so many wins beside so many losses. */
export interface Result {
  readonly wins: number;
  readonly losses: number;
}

/** How a comparison is sized: the solves of a task under each harness, and the sign test's level. */
export interface Asked {
  readonly solves: number;
  readonly level: number;
}

/** The true shares of untied tasks won that a size's power is stated for: the plan's three. */
const SHARES = [0.65, 0.75, 0.85] as const;
/** How many of the smallest clearing results a line names. */
const NAMED = 3;
/** The plan's worked case: the reference harness valid half the time, as its budget is set to make
 *  it, and a new harness valid three times in four. */
const WORKED = { old: 0.5, fresh: 0.75 } as const;

/** The chance of each count of successes among `trials` independent ones, from none to all: the
 *  recurrence `signP` runs, started from the likelier end so that the first term does not vanish. */
export function binomial(trials: number, chance: number): number[] {
  if (chance > 0.5) return binomial(trials, 1 - chance).toReversed();
  const terms: number[] = [];
  let term = (1 - chance) ** trials;
  for (let count = 0; count <= trials; count += 1) {
    terms.push(term);
    term = (term * (trials - count) * chance) / ((count + 1) * (1 - chance));
  }
  return terms;
}

/**
 * The chance that a comparison reads a step at `level` on `tasks` scored tasks, in the model: each
 * task independently a win with chance `each.win` and a loss with `each.loss`, a tie otherwise. No
 * untied task, or fewer tasks than the least sweep, is a chance of none.
 */
export function chanceOfStep(tasks: number, each: Each, level: number): number {
  const untied = each.win + each.loss;
  if (tasks < 1 || untied <= 0) return 0;
  const share = each.win / untied;
  // The fewest wins that clear never fall as the untied count grows, so they are found in one pass.
  let wins = 0;
  const byUntied = Array.from({ length: tasks + 1 }, (_, count) => {
    while (wins <= count && signP(wins, count - wins) > level) wins += 1;
    return binomial(count, share)
      .slice(wins)
      .reduce((sum, term) => sum + term, 0);
  });
  const chance = binomial(tasks, Math.min(1, untied)).reduce(
    (sum, term, count) => sum + term * (byUntied[count] ?? 0),
    0,
  );
  return Math.min(1, chance);
}

/**
 * The plan's power: the chance that a comparison of `untied` tasks, none of them tied, reads a step
 * at `level` when the new harness truly wins `share` of them. At a share of one half the two
 * harnesses are equal, and this is the test's false-positive rate, which stays under the level.
 */
export function power(untied: number, share: number, level: number): number {
  return chanceOfStep(untied, { win: share, loss: 1 - share }, level);
}

/**
 * One task's chances of a win and of a loss at `solves` a side, when each solve gives a valid
 * answer independently with chance `rates.old` under the reference harness and `rates.fresh` under
 * the new: a win is more valid answers under the new (`tally`, `compare.ts`). Solves of one task are
 * taken as independent given the task, which a host under load or a provider in a bad hour can
 * break.
 */
export function taskChances(rates: { readonly old: number; readonly fresh: number }, solves: number): Each {
  const [old, fresh] = [binomial(solves, rates.old), binomial(solves, rates.fresh)];
  const below = (valid: number) => old.slice(0, valid).reduce((sum, term) => sum + term, 0);
  const above = (valid: number) => old.slice(valid + 1).reduce((sum, term) => sum + term, 0);
  return {
    win: fresh.reduce((sum, term, valid) => sum + term * below(valid), 0),
    loss: fresh.reduce((sum, term, valid) => sum + term * above(valid), 0),
  };
}

/** The smallest results that clear `level` on at most `tasks` scored tasks: at 0.10, 4-0, 6-1, 7-2
 *  and 9-3 as far as they fit. */
export function clearing(tasks: number, level: number): Result[] {
  const results: Result[] = [];
  let wins = 0;
  for (let losses = 0; wins + losses <= tasks; losses += 1) {
    while (wins + losses <= tasks && signP(wins, losses) > level) wins += 1;
    if (wins + losses <= tasks) results.push({ wins, losses });
  }
  return results;
}

/**
 * What a comparison of `tasks` scored tasks can show, in lines for a launch's notes and
 * `prepare.ts`'s output. The plan's table is in untied tasks, and a comparison buys tasks: so the
 * power is said twice. Once in the plan's worked case, where ties are counted: the reference
 * harness valid half the time and the new one three times in four, at the solves a side asked for.
 * And once as if no task tied, which is the table's reading and the best case. The tie share a
 * campaign really has is what its first comparisons measure (the review of 2026-10-09, finding 5).
 */
export function sizeLines(tasks: number, asked: Asked): string[] {
  const { solves, level } = asked;
  const results = clearing(tasks, level);
  const scored = `${tasks === 0 ? "no held-out task" : plural(tasks, "held-out task")} can be scored`;
  if (results.length === 0) {
    return [
      `${scored}, and at --level ${String(level)} a step takes ${String(sweepOf(level))}, all won: this comparison cannot read a step`,
    ];
  }
  const named = results.slice(0, NAMED).map(({ wins, losses }) => `${String(wins)}-${String(losses)}`);
  const percent = (chance: number) => `${String(Math.round(100 * chance))}%`;
  const [low, mid, high] = SHARES.map((share) => percent(power(tasks, share, level)));
  const equal = taskChances({ old: WORKED.old, fresh: WORKED.old }, solves);
  return [
    `${scored}; at --level ${String(level)} the smallest results that clear are ${named.join(", ")}`,
    `at ${plural(solves, "solve")} a side, with the reference harness valid half the time and the new one three times in four, a step would be read ${percent(chanceOfStep(tasks, taskChances(WORKED, solves), level))} of the time; two equal harnesses valid half the time tie on ${percent(1 - equal.win - equal.loss)} of tasks and read a step ${percent(chanceOfStep(tasks, equal, level))} of the time`,
    `were no task to tie, a harness that truly wins 65% of them would be read a step ${String(low)} of the time, one that wins 75%, ${String(mid)}, and one that wins 85%, ${String(high)}`,
  ];
}
