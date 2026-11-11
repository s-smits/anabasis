/**
 * One count over a starter read that lane 30 made by hand, read by the comparison's own test: of
 * every way the signs of the tasks written after the promotion could fall, with every other task as
 * scored, how many read a step (`stepCount`). All 4 lane 30 sessions between 3 and 10 November
 * counted it by hand, three of them with the test written again in Python. It is a fact about a read
 * and decides nothing.
 *
 * No test of whether the slices the writing sessions left differ stands beside it. 4 of 5 lane 31
 * sessions ran one in scratch, as a chi-square or Fisher test, but the slices are batches of one
 * continuing Examiner conversation, and whether they are independent draws is lane 31's own
 * question: a p printed here would assume the answer. `starter-reads.ts` prints each slice's tally.
 */
import { readsStep } from "#src/kernel/compare.ts";

/** Of `draws` sign assignments to the untied `free` tasks, `confirm` read a step at the level. */
export interface StepCount {
  readonly free: number;
  readonly draws: bigint;
  readonly confirm: bigint;
}

/** For each plus-total of `sizes`, how many sign assignments reach it, exactly. */
function waysTo(sizes: readonly number[]): bigint[] {
  let ways = [1n];
  for (const size of sizes) {
    const next = Array.from({ length: ways.length + size }, () => 0n);
    for (const [at, count] of ways.entries()) {
      next[at] = (next[at] ?? 0n) + count;
      next[at + size] = (next[at + size] ?? 0n) + count;
    }
    ways = next;
  }
  return ways;
}

/** One sign assignment of `sizes` whose plus-total is `goal`, which `ways` says is reachable. */
function signsFor(sizes: readonly number[], goal: number): number[] {
  // reach[i] holds the plus-totals the first i sizes can make.
  const reach = [new Set([0])];
  for (const size of sizes) {
    const last = reach.at(-1) ?? new Set<number>();
    reach.push(new Set([...last, ...[...last].map((one) => one + size)]));
  }
  const signs: number[] = [];
  let left = goal;
  for (let at = sizes.length - 1; at >= 0; at -= 1) {
    const size = sizes[at] ?? 0;
    const plus = left >= size && (reach[at]?.has(left - size) ?? false);
    signs.unshift(plus ? size : -size);
    if (plus) left -= size;
  }
  return signs;
}

/**
 * How many of the sign assignments to the untied `free` margins read a step at `level` with `fixed`
 * as scored, under `readsStep` itself. The test reads a task's size whatever its sign, so the sizes
 * are fixed and a step depends on the plus-total alone, and rises with it: the count is the number of
 * draws at or above the least reachable plus-total that reads a step, found by asking `readsStep` of
 * one draw a total. A tie stays a tie in every draw. Margins are whole points, as task scores are.
 */
export function stepCount(fixed: readonly number[], free: readonly number[], level: number): StepCount {
  const sizes = free.filter((one) => one !== 0).map(Math.abs);
  const ways = waysTo(sizes);
  const totals = ways.flatMap((count, total) => (count > 0n ? [total] : []));
  const steps = (total: number) => readsStep([...fixed, ...signsFor(sizes, total)], level);
  let [low, high] = [0, totals.length];
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (steps(totals[middle] ?? 0)) high = middle;
    else low = middle + 1;
  }
  const from = totals[low] ?? ways.length;
  const confirm = ways.slice(from).reduce((sum, count) => sum + count, 0n);
  return { free: sizes.length, draws: 2n ** BigInt(sizes.length), confirm };
}
