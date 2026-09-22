/**
 * How many tasks a battery has: the one owner of the requested size and of each round's choice.
 *
 * A round's size is a `TaskCount`, the same shape whether it is exact (`min === max`, the operator's
 * 25) or a range the Builder picks inside (the probe's 5 to 10). Validation, the authoring prompt and
 * the census evidence all read that one pair, so a probe battery is the ordinary battery with
 * different bounds rather than a second sizing system.
 *
 * `batterySize` bounds every size the controller asks for. An out-of-range size fails rather than
 * being clamped, because a silently changed size is a changed measurement condition.
 *
 * `batterySizingGate` picks the round's count. A product measures probe batteries until one passes
 * some but not all of its scored cases, and only then the requested size: a handful of tasks
 * already shows a battery far too easy or far too hard. The probe size is the Builder's.
 *
 * Past the probe the round is sized to the smallest battery that still carries the last reading
 * (`smallestSizeHoldingTooEasy`). The count reaches the author through `taskCountSentence` alone;
 * the gate returns a count and nothing else, and the climb readout owns the landing.
 */
import { existsSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { POLICY } from "../critic/policy.ts";
import { wilsonInterval } from "../claim/estimation.ts";
import { TASKS_FILE } from "../meta/bundle-layout.ts";
import { readJsonFile } from "../meta/completed-json.ts";

export const BATTERY_SIZE = POLICY.battery;

/** A round's accepted task counts. `min === max` is the exact size the operator asked for. */
interface TaskCount {
  min: number;
  max: number;
}

/** The latest admitted battery of the selected product, as all its scored cases. The difficulty
 *  selector may decide from a changed subset; sizing reads the whole probe. */
export interface ProbeLanding {
  passes: number;
  n: number;
}

/** The one sentence every authoring session opens with, so the count is stated once. `minTasks` is
 *  absent whenever the size is exact. */
export function taskCountSentence(sized: { expectedTasks: number; minTasks?: number }): string {
  const min = sized.minTasks ?? sized.expectedTasks;
  return min === sized.expectedTasks
    ? `Task count: exactly ${sized.expectedTasks} tasks.`
    : `Task count: between ${min} and ${sized.expectedTasks} tasks — choose the size in that range yourself.`;
}

export function batterySize(requested: number | undefined): number {
  const { floor, ceiling } = BATTERY_SIZE;
  if (requested !== undefined && (!Number.isInteger(requested) || requested < floor || requested > ceiling)) {
    throw new Error(
      `--expected-tasks ${requested} is outside [${floor}, ${ceiling}] — under ${floor} a battery buys too few cases to read, and more than ${ceiling} spends money without helping the decision`,
    );
  }
  return requested ?? BATTERY_SIZE.default;
}

/**
 * The smallest battery whose interval still excludes the band on the easy side at the rate just
 * measured, or `requested` when no smaller one does.
 *
 * The rate is realised with `Math.floor`, the least favourable count at each size, so rounding
 * never flatters the reading; this is also why small probe sizes rarely qualify. A battery near the
 * band keeps the requested size.
 *
 * This predicts nothing about the next battery; `placeOnBand` refuses a placement it cannot make.
 */
function smallestSizeHoldingTooEasy(landed: ProbeLanding, requested: number, band: [number, number]): number {
  if (landed.n === 0) return requested;
  const rate = landed.passes / landed.n;
  for (let n = BATTERY_SIZE.probe.max + 1; n < requested; n += 1) {
    const interval = wilsonInterval(Math.floor(rate * n), n);
    if (interval !== null && interval.lower > band[1]) return n;
  }
  return requested;
}

/** `requested` is a `batterySize` result; `landing` reads the selected product's latest admitted
 *  battery and is called only when that decides the size. `band` is the run's band, so sizing and
 *  placement read the same one; the default serves a caller with no manifest. */
export function batterySizingGate(
  requested: number,
  adoptedTasks: number | null,
  landing: () => ProbeLanding | null,
  band: [number, number] = POLICY.climb.band,
): TaskCount {
  const exact = (size: number): TaskCount => ({ min: size, max: size });
  const probeMax = BATTERY_SIZE.probe.max;
  if (requested <= probeMax) return exact(requested);
  if (adoptedTasks !== null && adoptedTasks > probeMax) {
    const landed = landing();
    return exact(landed === null ? requested : smallestSizeHoldingTooEasy(landed, requested, band));
  }
  if (adoptedTasks === null) return { ...BATTERY_SIZE.probe };
  // A probe graduates once it passes some but not all of its scored cases; nothing scored, nothing
  // passed and everything passed each leave the product on probes.
  const landed = landing();
  const graduated = landed !== null && landed.passes > 0 && landed.passes < landed.n;
  return graduated ? exact(requested) : { ...BATTERY_SIZE.probe };
}

/** The adopted battery's task count, or null before a product is adopted. Measurement validates the
 *  rows; sizing needs only their number. */
export function adoptedTaskCount(domainDir: string): number | null {
  const file = join(domainDir, TASKS_FILE);
  if (!existsSync(file)) return null;
  const tasks: unknown = readJsonFile(file);
  return Array.isArray(tasks) ? tasks.length : null;
}
