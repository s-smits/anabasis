/**
 * Two-sample permutation test over campaign-level units.
 *
 * Pools the units of two groups and evaluates the absolute difference in a group statistic across
 * all ways of partitioning the pool into the original group sizes. Assumes no parametric
 * distribution and treats the campaign as the independent unit (since tasks and promotions within a
 * campaign share one exam).
 *
 * When the number of combinations is at most `DRAWS`, all partitions are enumerated exactly;
 * otherwise `DRAWS` deterministic Lehmer shuffles are sampled. Also reports `least`, the minimum
 * achievable p-value for the given sample sizes and non-empty denominators.
 *
 * Used strictly for retrospective archive summaries (`trend.ts`), never for in-campaign harness
 * comparisons (`AGENTS.md`, section 7).
 */

/** Maximum combinations for exact enumeration before falling back to deterministic shuffles. */
const DRAWS = 4000;
/** Park-Miller Lehmer PRNG modulus, multiplier, and fixed seed. */
const MODULUS = 2_147_483_647;
const MULTIPLIER = 48_271;
const SEED = 20_261_111;
/** Floating-point tolerance when comparing permutation differences against the observed difference. */
const SLACK = 1e-12;

/** Result of a two-group permutation test. */
export interface Shift {
  /** Two-sided permutation p-value, or `null` if either group's statistic is undefined. */
  readonly p: number | null;
  /** Smallest achievable p-value across all valid partitions of the pooled units, or `null` when `p` is `null`. */
  readonly least: number | null;
}

/** Number of ways to choose `size` items from `pool`, or `Infinity` when exceeding `DRAWS`. */
function dealsOf(pool: number, size: number): number {
  let ways = 1;
  for (let picked = 1; picked <= Math.min(size, pool - size); picked += 1) {
    ways = (ways * (pool - picked + 1)) / picked;
    if (ways > DRAWS) return Infinity;
  }
  return Math.round(ways);
}

/** Every choice of `size` positions out of `pool`, in order. */
function* choicesOf(pool: number, size: number): Generator<number[]> {
  const chosen = Array.from({ length: size }, (_, at) => at);
  for (;;) {
    yield [...chosen];
    let at = size - 1;
    while (at >= 0 && chosen[at] === pool - size + at) at -= 1;
    if (at < 0) return;
    const next = (chosen[at] ?? 0) + 1;
    for (let rest = at; rest < size; rest += 1) chosen[rest] = next + rest - at;
  }
}

/** `DRAWS` shuffles of the positions below `pool`, each cut to its first `size`, the same on every
 *  call. */
function* shufflesOf(pool: number, size: number): Generator<number[]> {
  let state = SEED;
  for (let draw = 0; draw < DRAWS; draw += 1) {
    const order = Array.from({ length: pool }, (_, at) => at);
    for (let at = 0; at < size; at += 1) {
      state = (state * MULTIPLIER) % MODULUS;
      const from = at + (state % (pool - at));
      [order[at], order[from]] = [order[from] ?? 0, order[at] ?? 0];
    }
    yield order.slice(0, size);
  }
}

/** How often dealing the units of `then` and `now` out again moves `statistic` at least as far
 *  apart between the two groups as it stands. A deal that leaves a group without a value (an empty
 *  denominator) is counted on neither side. */
export function shiftOf<Unit>(
  then: readonly Unit[],
  now: readonly Unit[],
  statistic: (units: readonly Unit[]) => number | null,
): Shift {
  const pool = [...then, ...now];
  const deals = dealsOf(pool.length, then.length);
  const [before, after] = [statistic(then), statistic(now)];
  if (before === null || after === null) return { p: null, least: null };
  const exact = Number.isFinite(deals);
  const dealt = exact ? choicesOf(pool.length, then.length) : shufflesOf(pool.length, then.length);
  const read: number[] = [];
  for (const chosen of dealt) {
    const picked = new Set(chosen);
    const [one, other] = [
      statistic(pool.filter((_, at) => picked.has(at))),
      statistic(pool.filter((_, at) => !picked.has(at))),
    ];
    if (one !== null && other !== null) read.push(Math.abs(one - other));
  }
  // A sampled p counts the record itself among the deals, so it is never zero.
  const share = (apart: number) => {
    const far = read.filter((one) => one >= apart - SLACK).length;
    return exact ? far / read.length : (far + 1) / (read.length + 1);
  };
  const recorded = Math.abs(after - before);
  return { p: share(recorded), least: share(Math.max(recorded, ...read)) };
}
