/**
 * The size of a comparison: how many tasks and how many solves a side it buys where nothing names
 * another (`SIZE`), and what one of so many tasks can show and risks, said before it runs
 * (`sizeLines`), which a campaign's opening holds to a cap (`openingLines`).
 *
 * The plan fixes the sample size before each round and never changes it once results are visible
 * (`docs/plan.md`, principle 7), so the size is a choice made on arithmetic, and the arithmetic is
 * the comparison's own test (`flipP`, `power` and `detectable`, `compare.ts`): exact, with no
 * normal approximation, since the sizes in question are the ones where an approximation is worst.
 * Nothing here decides.
 *
 * Solves come before tasks (12 October). At four solves a side a task the two harnesses split is
 * won or lost by four pairs for each valid answer that parts them, which the test reads, and a
 * task ties only where both gave as many; a campaign short of tasks still reads each one closely.
 * Twenty-four untied tasks detect a harness that wins 73% of them four times in five, where twelve
 * need 81%. A comparison buys tasks and the power is in untied ones: the tie share between them is
 * what the reference read against itself measures (`comparison.ts`, `noise`), and until it has been
 * read the size is said as if no task tied, which is the best case.
 *
 * Until 12 October this file also held a model of tasks alike, each a win, a loss or a tie by fixed
 * chances (`chanceOfStep`, `taskChances`, `chanceOfPromotion`), which printed a worked case at a
 * launch; the measured tie share replaces the modelled one, and the two-stage rule's chances are
 * enumerated in its tests (`test/compare.test.ts`).
 */
import { plural } from "../meta/text.ts";
import { detectable, falseRate, flipP, sweepOf } from "./compare.ts";

/** A scored set's result: so many tasks won beside so many lost. */
interface Result {
  readonly wins: number;
  readonly losses: number;
}

/** What a comparison is read by: the level the step and its repeat clear together, the trigger a
 *  first reading clears to buy the repeat (`src/builder/move.ts`), and the patience, the moves with
 *  no gain a campaign ends after. */
interface Asked {
  readonly level: number;
  readonly trigger: number;
  readonly patience: number;
}

/** A comparison's size where nothing names another: the scored tasks and the solves a side. */
export const SIZE = { tasks: 24, solves: 4 } as const;
/** The chance of a false promotion over a campaign's attempts under one reference, the rule's rate
 *  summed over them, past which its opening is refused (`opening`; 12 October). */
const FALSE_CAP = 0.1;
/** How many of the smallest clearing results a line names. */
const NAMED = 3;

/** `wins` tasks won and `losses` lost, each by one pair. */
function units(wins: number, losses: number): number[] {
  return [...Array.from({ length: wins }, () => 1), ...Array.from({ length: losses }, () => -1)];
}

/** The smallest results that clear `level` on at most `tasks` scored tasks, each won or lost by as
 *  many pairs: at 0.25, 2-0, 4-1, 5-2 and 7-3 as far as they fit; at 0.10, 4-0, 6-1, 7-2 and 9-3. */
function clearing(tasks: number, level: number): Result[] {
  const results: Result[] = [];
  let wins = 0;
  for (let losses = 0; wins + losses <= tasks; losses += 1) {
    while (wins + losses <= tasks && flipP(units(wins, losses)) > level) wins += 1;
    if (wins + losses <= tasks) results.push({ wins, losses });
  }
  return results;
}

/** The chance of a false promotion over the patience's attempts on `tasks` tasks under one
 *  reference: the rule's rate summed over them, the union bound's form, which assumes nothing of
 *  their independence. The rate is the design's estimate (`falseRate`), so the sum is an estimate
 *  and no bound. */
function risked(tasks: number, { level, trigger, patience }: Asked): number {
  return Math.min(1, patience * falseRate(units(tasks, 0), level, trigger));
}

/**
 * What a comparison of `tasks` scored tasks can show and risks, in lines for a launch's notes and
 * `prepare.ts`'s output: the smallest results that buy the repeat and that promote, the least
 * share of the tasks won that one reading detects four times in five, were none to tie, the
 * rule's rate an attempt, and last its sum over the patience (`risked`). A campaign whose
 * comparisons buy repeats makes more attempts than its patience, which the climb reads as they
 * come (`climb.ts`, `falsePromotion`).
 */
export function sizeLines(tasks: number, asked: Asked): string[] {
  const { level, trigger, patience } = asked;
  const first = clearing(tasks, trigger);
  const scored = `${tasks === 0 ? "no held-out task" : plural(tasks, "held-out task")} can be scored`;
  const summed = `over the patience's ${plural(patience, "attempt")} under one reference a false promotion comes about ${percent(risked(tasks, asked))} of the time by the rule's design`;
  if (first.length === 0) {
    return [
      `${scored}, and at --trigger ${String(trigger)} a first reading takes ${String(sweepOf(trigger))}, all won: this comparison cannot buy a repeat`,
      summed,
    ];
  }
  const said = (results: readonly Result[]) =>
    results
      .slice(0, NAMED)
      .map(({ wins, losses }) => `${String(wins)}-${String(losses)}`)
      .join(", ");
  const share = detectable(units(tasks, 0), level);
  const rate = falseRate(units(tasks, 0), level, trigger);
  // Until 14 October a pair that no result clears read "clear at , each task".
  const both = clearing(2 * tasks, level);
  const clear = both.length === 0 ? "cannot clear it, all won" : `clear at ${said(both)}`;
  return [
    `${scored}; at --trigger ${String(trigger)} the smallest results that buy the repeat are ${said(first)}, and at --level ${String(level)} the step and its repeat together ${clear}, each task won or lost by as many pairs`,
    share === null
      ? `were no task to tie, one reading at --level ${String(level)} would detect no share of ${plural(tasks, "task")}: it takes ${String(sweepOf(level))}, all won`
      : `were no task to tie, one reading at --level ${String(level)} would detect four times in five a harness that wins ${String(Math.round(100 * share))}% of the tasks, and fewer untied tasks need a larger share`,
    `an attempt, a step and its repeat on as many tasks, promotes between equal harnesses ${percent(rate)} of the time where no task ties: the level is one reading's, and this the rule's`,
    summed,
  ];
}

/**
 * What a campaign that scores `target` tasks says at its opening: what a comparison of so many
 * says (`sizeLines`). An opening whose sum passes `FALSE_CAP` is refused, with the patience and
 * the level that hold it; the campaign command only calls this.
 */
export function openingLines(wanted: Asked & { readonly target: number }): string[] {
  const { target, level, patience } = wanted;
  const lines = sizeLines(target, wanted);
  const union = risked(target, wanted);
  if (union <= FALSE_CAP) return lines;
  // The most attempts the cap holds at this level, and the highest level in hundredths at this patience.
  const most = Math.floor((FALSE_CAP * patience) / union);
  const lower = Array.from({ length: Math.round(100 * level) }, (_, at) => (at + 1) / 100).findLast(
    (at) => risked(target, { ...wanted, level: at }) <= FALSE_CAP,
  );
  throw new Error(
    `${lines.at(-1) ?? ""}, past the ${percent(FALSE_CAP)} a campaign may open on: ${most < 1 ? "no patience holds it at this --level" : `--patience ${String(most)} or less holds it`}, and ${lower === undefined ? "no --level in hundredths does at this patience" : `so does --level ${String(lower)} or lower`}`,
  );
}

/** A chance in percent, to a tenth, and one under that said as under it, never as none. */
function percent(chance: number): string {
  return chance > 0 && chance < 0.0005 ? "under 0.1%" : `${String(Math.round(1000 * chance) / 10)}%`;
}
