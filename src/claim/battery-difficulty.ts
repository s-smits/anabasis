/**
 * How hard a measured battery was, read from one statistic.
 *
 * - `placeOnBand` says where k passes of n sit against the target band. It is the one owner of
 *   "too easy", "too hard" and "on aim": the selector acts on its zone, the evidence note words
 *   it, and the per-family rows read it rather than re-deriving the comparison.
 * - `bandLandmarks` reads the same placements back as pass counts for a battery size, so a prompt
 *   that says "18 of 25 or more found no limit" follows the band instead of repeating it.
 * - `measureDifficulty` tallies the verified cases per item into the recorded battery.
 *
 * Sample size has a single owner, the interval. A thin sample widens it until neither outer zone
 * can be reached, which is what a confidence interval is for. A second case-count floor beside it
 * only discards placements the interval would have made honestly, and the round then reaches the
 * author with no measurement note at all. A sample that was never
 * measured, or whose counts are malformed, has no placement: `placeOnBand` returns the same null
 * `wilsonInterval` does, and the selector turns that one null into its one "no difficulty
 * evidence" answer.
 */
import { wilsonInterval } from "./estimation.ts";

export interface Observation {
  /** Item identity: task family (pooled) or task id (fine-grained), the caller's choice. */
  item: string;
  pass: boolean;
}

type ItemDifficulty = {
  item: string;
  attempts: number;
  passes: number;
};

export type MeasuredDifficulty = {
  items: ItemDifficulty[];
  /** The task-only changed public-input subset, when the host identified one — counts alone, so a
   *  recorded rate can never disagree with them. Present even at zero attempts. */
  changedSubset?: { attempts: number; passes: number };
};

export type BandZone = "too-hard" | "under-aim" | "on-aim" | "over-aim" | "too-easy";

export type BandPlacement = {
  passes: number;
  n: number;
  lo: number;
  hi: number;
  zone: BandZone;
  /** The pass counts whose point rate lies inside the band. */
  aim: [number, number];
  /** Passes to gain (positive) or lose (negative) to land on the aim; zero on it. */
  toAim: number;
};

/** A first battery's aim, about 3 of 25 verified passes (operator decision). */
const FIRST_BATTERY_RATE = 0.12;

/** Scale a rate to n, rounded first so 0.2 × 15 = 3.0000000000000004 reads as 3. */
const scaled = (rate: number, n: number) => Number((rate * n).toFixed(9));

/** The pass counts of a battery of n whose point rate lies inside the band. */
export function aimCounts(n: number, [floor, ceiling]: readonly [number, number]): [number, number] {
  return [Math.ceil(scaled(floor, n)), Math.floor(scaled(ceiling, n))];
}

/**
 * Place k of n on the band, or null when there is no sample to place. The interval alone decides
 * the outer zones, so a battery is called too easy or too hard only when it is significantly so.
 * Between them the point count decides: 16 of 25 is not significantly too easy, yet sits above the
 * 5 to 12 aim, and the note says so.
 */
export function placeOnBand(
  passes: number,
  n: number,
  band: readonly [number, number],
): BandPlacement | null {
  const interval = wilsonInterval(passes, n);
  if (interval === null) return null;
  const aim = aimCounts(n, band);
  // A battery so small that no whole pass count lands inside the band has no aim to be measured
  // against. aimCounts(1, [0.2, 0.5]) is [1, 0], an empty range that read 0 of 1 as under-aim by
  // one and 1 of 1 as over-aim by one: every count of a one-case battery was off the aim in both
  // directions and none could be on it. Campaign 3fd52f9e-28's last round measured one case.
  if (aim[1] < aim[0]) return null;
  const toAim = passes < aim[0] ? aim[0] - passes : passes > aim[1] ? aim[1] - passes : 0;
  const zone = bandZone(interval, band, toAim);
  return { passes, n, lo: interval.lower, hi: interval.upper, zone, aim, toAim };
}

/** Where a placed count sits. The interval decides the outer zones, so a battery is called too
 *  easy or too hard only when it is significantly so; inside them the point count decides. */
function bandZone(
  interval: NonNullable<ReturnType<typeof wilsonInterval>>,
  band: readonly [number, number],
  toAim: number,
): BandZone {
  const [floor, ceiling] = band;
  if (interval.upper < floor) return "too-hard";
  if (interval.lower > ceiling) return "too-easy";
  if (toAim > 0) return "under-aim";
  if (toAim < 0) return "over-aim";
  return "on-aim";
}

/** The pass counts a battery of n cases reads as under the band: too hard at or below
 *  `tooHardUpTo`, too easy from `tooEasyFrom` (null when no count qualifies), the aim, and the
 *  first battery's overshoot. Derived by placing every count, so sentences and decisions agree. */
export function bandLandmarks(n: number, band: readonly [number, number]) {
  const placed = Array.from({ length: n + 1 }, (_, k) => placeOnBand(k, n, band)).filter((p) => p !== null);
  return {
    tooHardUpTo: placed.findLast((p) => p.zone === "too-hard")?.passes ?? null,
    aim: aimCounts(n, band),
    tooEasyFrom: placed.find((p) => p.zone === "too-easy")?.passes ?? null,
    first: Math.max(1, Math.round(scaled(FIRST_BATTERY_RATE, n))),
  };
}

/** Tally verified cases per item, hardest first by measured pass rate, then by name so that two
 *  items at the same rate keep a stable order. The rows carry counts alone; every rate and
 *  interval downstream is read back through `placeOnBand`. */
export function measureDifficulty(observations: readonly Observation[]): MeasuredDifficulty {
  const byItem = new Map<string, ItemDifficulty>();
  for (const { item, pass } of observations) {
    const tally = byItem.get(item) ?? { item, attempts: 0, passes: 0 };
    tally.attempts += 1;
    if (pass) tally.passes += 1;
    byItem.set(item, tally);
  }
  const rate = ({ passes, attempts }: ItemDifficulty) => passes / attempts;
  return { items: [...byItem.values()].sort((a, b) => rate(a) - rate(b) || a.item.localeCompare(b.item)) };
}
