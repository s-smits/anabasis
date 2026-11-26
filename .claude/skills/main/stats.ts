/** Two-sample permutation test over campaign-level units, and the honesty bar's exact bound. */
import { upperBound } from "#src/kernel/compare.ts";

/** Maximum combinations for exact enumeration before falling back to deterministic shuffles. */
const DRAWS = 4000;
/** Park-Miller Lehmer PRNG modulus, multiplier and fixed seed. */
const MODULUS = 2_147_483_647;
const MULTIPLIER = 48_271;
const SEED = 20_261_111;
/** Floating-point tolerance when comparing permutation differences against the observed one. */
const SLACK = 1e-12;

export interface Shift {
  /** Two-sided permutation p-value, or null if either group's statistic is undefined. */
  readonly p: number | null;
  /** Smallest achievable p across all valid partitions of the pooled units. */
  readonly least: number | null;
}

/** `Infinity` when it exceeds `DRAWS`. */
function dealsOf(pool: number, size: number): number {
  let ways = 1;
  for (let picked = 1; picked <= Math.min(size, pool - size); picked += 1) {
    ways = (ways * (pool - picked + 1)) / picked;
    if (ways > DRAWS) return Infinity;
  }
  return Math.round(ways);
}

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

/** The same on every call. */
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

/** How often dealing the units out again moves `statistic` at least as far apart as it stands. A
 *  deal that leaves a group without a value is counted on neither side. */
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
  const mark = new Uint16Array(pool.length);
  let gen = 0;
  for (const chosen of dealt) {
    gen += 1;
    if (gen === 65_535) {
      mark.fill(0);
      gen = 1;
    }
    for (const at of chosen) mark[at] = gen;
    const [left, right]: [Unit[], Unit[]] = [[], []];
    for (const [at, unit] of pool.entries()) (mark[at] === gen ? left : right).push(unit);
    const [one, other] = [statistic(left), statistic(right)];
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

export function falseSteps(steps: number, powered: number, levels: readonly number[]): string {
  const bound = upperBound(steps, powered);
  const level = levels.length === 0 ? null : Math.min(...levels);
  const bar =
    level === null
      ? "no level"
      : `bar ${(200 * level).toFixed(1)}% at level ${String(level)}${levels.length > 1 ? " (the least)" : ""}: ${bound <= 2 * level ? "met" : "open"}`;
  return `${String(steps)}/${String(powered)} one-sided, 95% bound ${(100 * bound).toFixed(1)}%, ${bar}`;
}
