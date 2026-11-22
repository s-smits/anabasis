/**
 * How big a comparison is: how many held-out tasks it scores and how many times each side solves
 * each one (`SIZE`), and what a comparison of that size can and cannot show, printed before it runs
 * (`sizeLines`). Nothing here decides anything.
 */
import { plural } from "../meta/text.ts";
import { detectable, flipP, power, sweepOf } from "./compare.ts";

/** A comparison's result in tasks: so many won beside so many lost. */
interface Result {
  readonly wins: number;
  readonly losses: number;
}

/** A comparison's size unless the campaign names another: the scored tasks and the solves a side. */
export const SIZE = { tasks: 24, solves: 2 } as const;

/** How many comparisons of one task in a row it takes to call it easy or unsolved (`poolOf`,
 *  `reports.ts`). Easy: the reference was valid in every solve and left no room on the objective.
 *  Unsolved: no solve gave a valid answer, so the task goes to a person as possibly infeasible. Each
 *  comparison is read as every, some or no solve valid (`howOftenValid`), so the counts mean the
 *  same at any number of solves. */
export const READINGS_IN_A_ROW = { easy: 2, unsolved: 2 } as const;

/** How many of the smallest results that read a step a launch's notes show. */
const RESULTS_SHOWN = 3;

/** Whether a side was valid in every solve of a task, in some, or in none. */
export function howOftenValid(valid: readonly boolean[]): "every" | "some" | "none" {
  return valid.every(Boolean) ? "every" : valid.includes(true) ? "some" : "none";
}

/** The task scores of `wins` tasks won and `losses` lost, each by the same margin. */
function equalMargins(wins: number, losses: number): number[] {
  return [...Array.from({ length: wins }, () => 1), ...Array.from({ length: losses }, () => -1)];
}

/** For each number of losses, the fewest wins that read a step at `level` within `tasks` tasks,
 *  every task won or lost by the same margin. At 0.02 that is 6-0, 8-1, 10-2, 12-3; at 0.10, 4-0,
 *  6-1, 7-2, 9-3. `sizeLines` prints the first three, and the comparison-reading size script all. */
export function smallestSteps(tasks: number, level: number): Result[] {
  const results: Result[] = [];
  let wins = 0;
  for (let losses = 0; wins + losses <= tasks; losses += 1) {
    while (wins + losses <= tasks && flipP(equalMargins(wins, losses)) > level) wins += 1;
    if (wins + losses <= tasks) results.push({ wins, losses });
  }
  return results;
}

/**
 * What a comparison of `tasks` scored tasks can show and what it risks, as lines for a launch's
 * notes and `prepare.ts`'s output: the smallest results that read a step, the smallest share of
 * tasks won that one reading detects four times in five if no task ties, and how often one reading
 * finds a step between equal harnesses.
 */
export function sizeLines(tasks: number, level: number): string[] {
  const results = smallestSteps(tasks, level);
  const scored = `${tasks === 0 ? "no held-out task" : plural(tasks, "held-out task")} can be scored`;
  if (results.length === 0) {
    return [
      `${scored}, and at --level ${String(level)} a step takes ${String(sweepOf(level))}, all won: this comparison cannot read a step`,
    ];
  }
  const said = results
    .slice(0, RESULTS_SHOWN)
    .map(({ wins, losses }) => `${String(wins)}-${String(losses)}`)
    .join(", ");
  // A set of tasks that can read a step at all reads one when every task is won, so a share exists.
  const share = detectable(equalMargins(tasks, 0), level) ?? 1;
  // The test's false-step rate at these margins, never above the level, to a tenth of a percent. A
  // rate below that is printed as "under 0.1%", never as none.
  const rate = power(equalMargins(tasks, 0), 0.5, level);
  const rated = rate > 0 && rate < 0.0005 ? "under 0.1%" : `${String(Math.round(1000 * rate) / 10)}%`;
  return [
    `${scored}; at --level ${String(level)} the smallest results that read a step are ${said}, each task won or lost by as many pairs`,
    `were no task to tie, one reading at --level ${String(level)} would detect four times in five a harness that wins ${String(Math.round(100 * share))}% of the tasks, and fewer untied tasks need a larger share`,
    `one reading at these margins reads a step between equal harnesses ${rated} of the time where no task ties: the level is a per-comparison level`,
  ];
}
