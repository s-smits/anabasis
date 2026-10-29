/**
 * The size of a comparison: how many tasks and how many solves a side it buys where nothing names
 * another (`SIZE`), and what one of so many tasks can show and risks, said before it runs
 * (`sizeLines`).
 *
 * The plan fixes the sample size before each round and never changes it once results are visible
 * (`7f0add79:docs/plan.md`, principle 7), so the size is a choice made on arithmetic, and the arithmetic is
 * the comparison's own test (`flipP`, `power` and `detectable`, `compare.ts`): exact, with no
 * normal approximation, since the sizes in question are the ones where an approximation is worst.
 * Nothing here decides.
 *
 * Two solves a side, in every domain (operator, 29 October). From 12 October a side had four, so
 * that a task the two harnesses split was won or lost by four pairs for each valid answer that
 * parted them. Four bought about a sixth more of a campaign's dollars and more of its hours, which
 * the Builder spends waiting on comparisons, and one reading of four solves still could not call a
 * task easy without a second (`easyAt`, `reports.ts`). Two keep a split task visible, and the
 * readings pool. At level 0.02, twenty-four untied tasks detect a harness that wins 80% of them
 * four times in five, where twelve need 87%. A comparison buys tasks and the power is in untied ones: the tie share between them is
 * what the reference read against itself measures (`comparison.ts`, `noise`), and until it has been
 * read the size is said as if no task tied, which is the best case.
 *
 * Until 12 October this file also held a model of tasks alike, each a win, a loss or a tie by fixed
 * chances (`chanceOfStep`, `taskChances`, `chanceOfPromotion`), which printed a worked case at a
 * launch; the measured tie share replaces the modelled one.
 *
 * One reading promotes since 19 October, so an attempt is one reading at the level and its rate
 * is the test's own (`power` at a share of a half). Until then a step was read again on fresh
 * solves past a trigger, and this file named the smallest results of both stages.
 *
 * The level is a per-comparison level. Until 20 October an opening was refused where one reading's
 * rate at `target` untied tasks, summed over the improvement patience, passed 10% (`openingLines`).
 * That sum described no campaign: readings run on fewer untied tasks than the target (at 12 of 24 the
 * same sum is 11.6%), tied tasks raised the target and passed comparison admission without
 * strengthening the test, and the improvement patience restarts at a promotion while every repeat is
 * another attempt. What a campaign's attempts risk together is the climb's running sum over the
 * readings made (`falsePromotion`, `climb.ts`).
 */
import { plural } from "../meta/text.ts";
import { detectable, flipP, power, sweepOf } from "./compare.ts";

/** A scored set's result: so many tasks won beside so many lost. */
interface Result {
  readonly wins: number;
  readonly losses: number;
}

/** What a comparison is read by: the level a step clears. */
interface Asked {
  readonly level: number;
}

/** A comparison's size where nothing names another: the scored tasks and the solves a side. */
export const SIZE = { tasks: 24, solves: 2 } as const;
/** How many of the smallest clearing results a line names. */
const NAMED = 3;

/** `wins` tasks won and `losses` lost, each by one pair. */
function units(wins: number, losses: number): number[] {
  return [...Array.from({ length: wins }, () => 1), ...Array.from({ length: losses }, () => -1)];
}

/** The smallest results that clear `level` on at most `tasks` scored tasks, each won or lost by as
 *  many pairs: at 0.02, 6-0, 8-1, 10-2 and 12-3 as far as they fit; at 0.10, 4-0, 6-1, 7-2 and 9-3. */
function clearing(tasks: number, level: number): Result[] {
  const results: Result[] = [];
  let wins = 0;
  for (let losses = 0; wins + losses <= tasks; losses += 1) {
    while (wins + losses <= tasks && flipP(units(wins, losses)) > level) wins += 1;
    if (wins + losses <= tasks) results.push({ wins, losses });
  }
  return results;
}

/**
 * What a comparison of `tasks` scored tasks can show and risks, in lines for a launch's notes and
 * `prepare.ts`'s output: the smallest results that read a step, the least share of the tasks won
 * that one reading detects four times in five, were none to tie, and one reading's rate.
 */
export function sizeLines(tasks: number, { level }: Asked): string[] {
  const results = clearing(tasks, level);
  const scored = `${tasks === 0 ? "no held-out task" : plural(tasks, "held-out task")} can be scored`;
  if (results.length === 0) {
    return [
      `${scored}, and at --level ${String(level)} a step takes ${String(sweepOf(level))}, all won: this comparison cannot read a step`,
    ];
  }
  const said = results
    .slice(0, NAMED)
    .map(({ wins, losses }) => `${String(wins)}-${String(losses)}`)
    .join(", ");
  const share = detectable(units(tasks, 0), level);
  // The test's own rate at these margins, never over the level, to a tenth of a percent, and one
  // under that said as under it, never as none.
  const rate = power(units(tasks, 0), 0.5, level);
  const rated = rate > 0 && rate < 0.0005 ? "under 0.1%" : `${String(Math.round(1000 * rate) / 10)}%`;
  return [
    `${scored}; at --level ${String(level)} the smallest results that read a step are ${said}, each task won or lost by as many pairs`,
    share === null
      ? `were no task to tie, one reading at --level ${String(level)} would detect no share of ${plural(tasks, "task")}: it takes ${String(sweepOf(level))}, all won`
      : `were no task to tie, one reading at --level ${String(level)} would detect four times in five a harness that wins ${String(Math.round(100 * share))}% of the tasks, and fewer untied tasks need a larger share`,
    `one reading at these margins reads a step between equal harnesses ${rated} of the time where no task ties: the level is a per-comparison level`,
  ];
}
