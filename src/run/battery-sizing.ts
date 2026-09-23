/**
 * How many tasks a battery has: the one owner of the requested size and of each round's choice.
 *
 * A round's size is a `TaskCount`, the same shape whether it is exact (`min === max`, the operator's
 * 25) or a range the Builder picks inside (the probe's 5 to 10). Validation, the authoring prompt and
 * the census evidence all read that one pair, so a probe battery is the ordinary battery with
 * different bounds rather than a second sizing system.
 *
 * `batterySize` bounds every size the controller asks for, on the operator's directive of
 * 2026-07-28: "one climbing system right between 5-60 queries each iteration". An out-of-range size
 * fails rather than being clamped, because the size is part of the measurement condition, so a
 * request quietly rounded into range would be measured under a condition nobody chose and read back
 * as though it had been.
 *
 * `batterySizingGate` picks the round's count (operator decision 2026-09-17). A product measures
 * probe batteries until one passes some but not all of its scored cases, and only then the requested
 * size, because eight or so tasks already say as much about a battery that is far too easy or far
 * too hard as twenty-five do: truss e6e332 spent two hours of solves on a first battery heading for
 * 25 of 25. The probe leaves its own size to the Builder, so the tasks rather than a count decide
 * what the probe measures.
 *
 * Past the probe the round is sized to the smallest battery that still carries the last reading
 * (`smallestSizeHoldingTooEasy`). Until 2026-09-19 the adopted size was the state and no later
 * landing was read at all, so one probe fixed the cost of every round after it: truss de8b40
 * graduated on a 3-of-6 whose interval spanned [0.188, 0.812], and then paid 25 solves a round to
 * re-read "significantly too easy". The reading is never traded for the saving, and the size stays a
 * condition code owns, which is why the count reaches the author through `taskCountSentence` alone
 * and nothing here tells a Builder what its next battery is expected to score. The gate returns a
 * count and nothing else: it used to return a note beside it restating the landing — "the last probe
 * battery passed 6 of 6" — while the measurement note placed that same battery in the same prompt.
 * The climb readout owns the landing now, and `renderProbeSizing` is the one sentence a probe-sized
 * round adds.
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
 * measured, or `requested` when no smaller one does. A battery read significantly too easy spends
 * its whole size to say one thing, and past the probe the old gate never read a landing again: the
 * adopted size was the state, so one weak probe committed the product to the requested size for
 * every later round. Truss de8b40 graduated on a 3-of-6 probe whose interval was [0.188, 0.812] and
 * then measured 22 of 25, after which every later round cost 25 solves to re-read "too easy".
 *
 * The saving never buys the reading, so the rate is realised with `Math.floor`, the least
 * favourable count at each size, and a size is never chosen because rounding flattered it. Truss's
 * 0.88 carries at eleven tasks, where 9 of 11 still reads too easy (lower bound 0.523), for 44% of
 * the solves. Six does not: six reads too easy only at 6 of 6, and 0.88 of six floors to 5, whose
 * interval overlaps the band and so says nothing. That arithmetic is why the loop starts above the
 * probe ceiling and loses nothing by it. A battery near the band keeps the requested size — 15 of
 * 25 holds at no size below it.
 *
 * This predicts nothing about the next battery. It states the size at which the last reading would
 * have survived, so a Builder that succeeds in making the tasks harder lands lower, and
 * `placeOnBand` refuses a placement it cannot make rather than misplacing it.
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
 *  battery and is called only when that decides the size. `band` is the run's band, which the
 *  caller reads from the manifest through `climbThresholds`: this gate used to read
 *  `POLICY.climb.band` directly, so a manifest override moved the placement while the size that
 *  would have held it stayed on the code-owned ceiling. The default is that code-owned row, for a
 *  caller with no manifest. */
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
