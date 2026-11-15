/**
 * Whether two groups differ by more than their units do among themselves, for any statistic over a
 * group: a permutation test. The units of both groups are pooled and dealt out again in every way
 * that keeps the two sizes, and p is the share of deals in which the statistic differs between the
 * groups at least as much as recorded. It assumes no distribution, and takes the campaign as the
 * unit, since tasks and promotions inside one campaign share its exam.
 *
 * Few deals are all counted and p is exact; past `DRAWS` a fixed sequence of shuffles stands in,
 * so a reading repeats to the digit. Beside p stands the smallest p any deal of the same units could
 * have read: where it is above the level, no record of these units could read a difference at it
 * (three against three, twenty deals with the record and its mirror the most extreme, or runs most
 * of which hold no denominator), which a caller says instead of printing a p.
 *
 * It describes the record: no comparison of harnesses (`AGENTS.md`, section 7) and no step.
 */

/** The shuffles drawn where the deals are too many to count. */
const DRAWS = 4000;
/** The Lehmer generator's modulus and multiplier (Park and Miller), exact in a double. */
const MODULUS = 2_147_483_647;
const MULTIPLIER = 48_271;
const SEED = 20_261_111;
/** What two equal statistics may differ by through rounding. */
const SLACK = 1e-12;

/** What a permutation test read. */
export interface Shift {
  /** The share of deals at least as far apart as the record; null where a group's statistic has no
   *  value as recorded. */
  readonly p: number | null;
  /** The share of deals as far apart as the most extreme deal read, the smallest p these units can
   *  give; null where p is. */
  readonly least: number | null;
}

/** The ways to pick `size` of `pool`, `Infinity` once past `DRAWS`. */
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
