/**
 * The size of a comparison: how many tasks and how many solves a side it buys where nothing names
 * another (`SIZE`), and what one of so many tasks can show, said before it runs (`sizeLines`).
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
 * what the reference read against itself measures (`round.ts`, `noise`), and until it has been
 * read the size is said as if no task tied, which is the best case.
 *
 * A rate read off so many trials is bounded above (`upperBound`), which is how the climb reads the
 * chance of a false promotion off pairs of A/A controls (`climb.ts`).
 *
 * Until 12 October this file also held a model of tasks alike, each a win, a loss or a tie by fixed
 * chances (`chanceOfStep`, `taskChances`, `chanceOfPromotion`), which printed a worked case at a
 * launch; the measured tie share replaces the modelled one, and the two-stage rule's chances are
 * enumerated in its tests (`test/compare.test.ts`).
 */
import { plural } from "../meta/text.ts";
import { detectable, falseRate, flipP, sweepOf } from "./compare.ts";

/** A scored set's result: so many tasks won beside so many lost. */
export interface Result {
  readonly wins: number;
  readonly losses: number;
}

/** The levels a comparison reads at: the one the step and its repeat clear together, and the one a
 *  first reading clears to buy the repeat (`src/builder/move.ts`). */
export interface Asked {
  readonly level: number;
  readonly trigger: number;
}

/** A comparison's size where nothing names another: the scored tasks and the solves a side. */
export const SIZE = { tasks: 24, solves: 4 } as const;
/** The chance of a false promotion over a campaign's attempts under one reference, by the union
 *  bound, past which its opening is refused (`opening`; 12 October). */
export const FALSE_CAP = 0.1;
/** How many of the smallest clearing results a line names. */
const NAMED = 3;

/** `wins` tasks won and `losses` lost, each by one pair. */
function units(wins: number, losses: number): number[] {
  return [...Array.from({ length: wins }, () => 1), ...Array.from({ length: losses }, () => -1)];
}

/** The smallest results that clear `level` on at most `tasks` scored tasks, each won or lost by as
 *  many pairs: at 0.25, 2-0, 4-1, 5-2 and 7-3 as far as they fit; at 0.10, 4-0, 6-1, 7-2 and 9-3. */
export function clearing(tasks: number, level: number): Result[] {
  const results: Result[] = [];
  let wins = 0;
  for (let losses = 0; wins + losses <= tasks; losses += 1) {
    while (wins + losses <= tasks && flipP(units(wins, losses)) > level) wins += 1;
    if (wins + losses <= tasks) results.push({ wins, losses });
  }
  return results;
}

/**
 * What a comparison of `tasks` scored tasks can show, in lines for a launch's notes and
 * `prepare.ts`'s output: the smallest results that buy the repeat and that promote, and the least
 * share of the tasks won that one reading detects four times in five, were none to tie.
 */
export function sizeLines(tasks: number, asked: Asked): string[] {
  const { level, trigger } = asked;
  const first = clearing(tasks, trigger);
  const scored = `${tasks === 0 ? "no held-out task" : plural(tasks, "held-out task")} can be scored`;
  if (first.length === 0) {
    return [
      `${scored}, and at --trigger ${String(trigger)} a first reading takes ${String(sweepOf(trigger))}, all won: this comparison cannot buy a repeat`,
    ];
  }
  const said = (results: readonly Result[]) =>
    results
      .slice(0, NAMED)
      .map(({ wins, losses }) => `${String(wins)}-${String(losses)}`)
      .join(", ");
  const share = detectable(units(tasks, 0), level);
  const rate = falseRate(units(tasks, 0), level, trigger);
  return [
    `${scored}; at --trigger ${String(trigger)} the smallest results that buy the repeat are ${said(first)}, and at --level ${String(level)} the step and its repeat together clear at ${said(clearing(2 * tasks, level))}, each task won or lost by as many pairs`,
    share === null
      ? `were no task to tie, one reading at --level ${String(level)} would detect no share of ${plural(tasks, "task")}: it takes ${String(sweepOf(level))}, all won`
      : `were no task to tie, one reading at --level ${String(level)} would detect four times in five a harness that wins ${String(Math.round(100 * share))}% of the tasks, and fewer untied tasks need a larger share`,
    `an attempt, a step and its repeat on as many tasks, promotes between equal harnesses ${percent(rate)} of the time where no task ties: the level is one reading's, and this the rule's`,
  ];
}

/**
 * What a campaign that scores `target` tasks, read at its level and trigger and ending after
 * `patience` moves with no gain, can show and risks, said at its opening: `sizeLines`, and the
 * chance of a false promotion over `patience` attempts under one reference by the union bound,
 * which assumes nothing of their independence. An opening whose bound passes `FALSE_CAP` is
 * refused, with the patience and the level that hold it; the campaign command only calls this. A
 * campaign whose comparisons buy repeats makes more attempts than its patience, which the climb
 * reads as they come (`climb.ts`, `falsePromotion`).
 */
export function openingLines(wanted: Asked & { readonly target: number }, patience: number): string[] {
  const { target, level, trigger } = wanted;
  const risked = (at: number) => Math.min(1, patience * falseRate(units(target, 0), at, trigger));
  const union = risked(level);
  const bound = `over the patience's ${plural(patience, "attempt")} under one reference a false promotion comes at most ${percent(union)} of the time`;
  if (union <= FALSE_CAP) return [...sizeLines(target, wanted), bound];
  // The most attempts the cap holds at this level, and the highest level in hundredths at this patience.
  const most = Math.floor((FALSE_CAP * patience) / union);
  const lower = Array.from({ length: Math.round(100 * level) }, (_, at) => (at + 1) / 100).findLast(
    (at) => risked(at) <= FALSE_CAP,
  );
  throw new Error(
    `${bound}, past the ${percent(FALSE_CAP)} a campaign may open on: ${most < 1 ? "no patience holds it at this --level" : `--patience ${String(most)} or less holds it`}, and ${lower === undefined ? "no --level in hundredths does at this patience" : `so does --level ${String(lower)} or lower`}`,
  );
}

/** A chance in percent, to a tenth, and one under that said as under it, never as none. */
function percent(chance: number): string {
  return chance > 0 && chance < 0.0005 ? "under 0.1%" : `${String(Math.round(1000 * chance) / 10)}%`;
}

/**
 * The one-sided upper bound at `confidence` on a rate of which `errors` came in `trials`: the rate
 * at which so few errors or fewer would come with chance 1 - `confidence` (Clopper and Pearson).
 * No error is never a rate of none: none in n gives 1 - (1 - confidence)^(1/n), about 3/n at 95%.
 * No trial bounds nothing, and reads 1.
 */
export function upperBound(errors: number, trials: number, confidence: number): number {
  if (errors >= trials) return 1;
  /** The chance of `errors` or fewer at `rate`. */
  const atMost = (rate: number) => {
    let [ways, sum] = [1, 0];
    for (let k = 0; k <= errors; k += 1) {
      sum += ways * rate ** k * (1 - rate) ** (trials - k);
      ways = (ways * (trials - k)) / (k + 1);
    }
    return sum;
  };
  let [low, high] = [errors / trials, 1];
  // The chance falls as the rate rises, so halving the range sixty times finds it to the bit.
  for (let step = 0; step < 60; step += 1) {
    const middle = (low + high) / 2;
    if (atMost(middle) > 1 - confidence) low = middle;
    else high = middle;
  }
  return high;
}
