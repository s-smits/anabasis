/**
 * Exact sign-draw enumeration for starter-read confirmation analysis (WRI lane 12). It omits
 * homogeneity tests across Examiner writing sessions (lane 19): those sessions are sequential wakes
 * of one conversation, so whether they are independent draws is the question itself;
 * `starter-reads.ts` reports each session slice's tally directly.
 */
import { isSignificant, signedRanks } from "#src/kernel/compare.ts";

/** Sign assignments (`confirm` out of `draws = 2^free`) that register a step at `level`. */
export interface StepCount {
  readonly free: number;
  readonly draws: bigint;
  readonly confirm: bigint;
}

/** Each achievable positive sum over `sizes` mapped to its number of sign assignments. */
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

/** One signed margin vector from `sizes` whose positive entries sum to `goal`. */
function signsFor(sizes: readonly number[], goal: number): number[] {
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
 * How many sign assignments to the untied `free` margins register a step at `level` beside `fixed`.
 * Flipping the signs of `free` leaves every unsigned rank in `[...fixed, ...free]` unchanged, so
 * `isSignificant` depends on those signs only through their positive rank sum, and is monotone in it.
 */
export function stepCount(fixed: readonly number[], free: readonly number[], level: number): StepCount {
  const fixedCount = fixed.filter((one) => one !== 0).length;
  const sizes = free.filter((one) => one !== 0).map(Math.abs);
  const freeRanks = signedRanks([...fixed, ...sizes])
    .slice(fixedCount)
    .map(Math.abs);
  const ways = waysTo(freeRanks);
  const totals = ways.flatMap((count, total) => (count > 0n ? [total] : []));
  const steps = (total: number) => {
    const signed = signsFor(freeRanks, total).map((rank, at) => Math.sign(rank) * (sizes[at] ?? 0));
    return isSignificant([...fixed, ...signed], level);
  };
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
