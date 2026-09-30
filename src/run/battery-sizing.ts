/**
 * How many tasks a battery has: the one owner of the requested size and of each round's choice.
 *
 * A round's size is a `TaskCount`, the same shape whether it is exact (`min === max`, the requested
 * size) or a range the Builder picks inside (`POLICY.battery.probe`). Validation, the authoring
 * prompt and the census evidence all read that one pair, so a probe battery is the ordinary battery
 * with different bounds rather than a second sizing system.
 *
 * `batterySize` bounds every size the controller asks for between `POLICY.battery`'s floor and
 * ceiling (operator decision: one climbing system). An out-of-range size fails rather than being
 * clamped, because the size is part of the measurement condition, so a request quietly rounded into
 * range would be measured under a condition nobody chose and read back as though it had been.
 *
 * `batterySizingGate` picks the round's count (operator decision). A product measures probe
 * batteries until one passes at least one scored case and lands at or under the aim, and only then
 * the requested size, because a probe already says as much about a battery that is far too easy or
 * far too hard as a full-size one does, which would otherwise spend hours of solves to say it. The
 * probe leaves its own size to the Builder, so the tasks rather than a count decide what the probe
 * measures.
 *
 * A probe that passes some but not all of its cases while still reading above the aim is not
 * enough: one failed case among six says the probe held one hard task, and the requested-size
 * battery the Builder writes next is mostly new tasks (AGENTS.md "Goals and the climb").
 *
 * Past the probe the round is sized to the smallest battery that still carries the last reading
 * (`smallestSizeHoldingTooEasy`). Holding the adopted size as the state instead, and reading no
 * later landing, lets one weak probe fix the cost of every round after it: a product that graduates
 * on a 3-of-6 then pays the requested size every round to re-read "significantly too easy". The
 * reading is never traded for the saving, and the size stays a condition code owns, which is why
 * the count reaches the author through `taskCountSentence` alone and nothing here tells a Builder
 * what its next battery is expected to score. The gate returns a count and no note restating the
 * landing. The one sentence a probe-sized or graduating round adds is `renderProbeSizing`, which
 * lives here beside the rule it states.
 */
import { existsSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { POLICY } from "../critic/policy.ts";
import { placeOnBand } from "../claim/battery-difficulty.ts";
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
 * The smallest battery `placeOnBand` still reads as too easy at `rate`, the rate of a landing it
 * already read as too easy, or `requested` when no smaller one does. It preserves a too-easy
 * reading the landing made and never extrapolates one it did not: 5 of 6 is not significantly too
 * easy, though 9 of 11 at its rate is.
 *
 * The saving never buys the reading, so the rate is realised with `Math.floor`, the least
 * favourable count at each size, and a size is never chosen because rounding flattered it. A rate
 * of 0.88 carries at eleven tasks, where 9 of 11 still reads too easy (lower bound 0.523), for 44%
 * of the solves. Six does not: six reads too easy only at 6 of 6, and 0.88 of six floors to 5,
 * whose interval overlaps the band and so says nothing. That arithmetic is why the loop starts
 * above the probe ceiling and loses nothing by it. A battery near the band keeps the requested
 * size — 15 of 25 holds at no size below it.
 *
 * This predicts nothing about the next battery. It states the size at which the last reading would
 * have survived, so a Builder that succeeds in making the tasks harder lands lower, and
 * `placeOnBand` refuses a placement it cannot make rather than misplacing it.
 */
function smallestSizeHoldingTooEasy(rate: number, requested: number, band: [number, number]): number {
  for (let n = BATTERY_SIZE.probe.max + 1; n < requested; n += 1) {
    if (placeOnBand(Math.floor(rate * n), n, band)?.zone === "too-easy") return n;
  }
  return requested;
}

/** `requested` is a `batterySize` result; `landing` reads the selected product's latest admitted
 *  battery and is called only when that decides the size. `band` is the run's band, which the
 *  caller reads through `climbThresholds`; the default is the code-owned row, for a caller with no
 *  manifest, and `POLICY.climb.band` says why no consumer reads that row directly. */
export function batterySizingGate(
  requested: number,
  adoptedTasks: number | null,
  landing: () => ProbeLanding | null,
  band: [number, number] = POLICY.climb.band,
): TaskCount {
  const exact = (size: number): TaskCount => ({ min: size, max: size });
  const probeMax = BATTERY_SIZE.probe.max;
  if (requested <= probeMax) return exact(requested);
  if (adoptedTasks === null) return { ...BATTERY_SIZE.probe };
  const landed = landing();
  const placed = landed === null ? null : placeOnBand(landed.passes, landed.n, band);
  if (adoptedTasks > probeMax) {
    return exact(
      placed?.zone === "too-easy"
        ? smallestSizeHoldingTooEasy(placed.passes / placed.n, requested, band)
        : requested,
    );
  }
  // A probe graduates once it passes at least one scored case and no more than the aim holds;
  // nothing scored, nothing passed and a count above the aim each leave the product on probes.
  return placed !== null && placed.passes > 0 && placed.toAim >= 0
    ? exact(requested)
    : { ...BATTERY_SIZE.probe };
}

/** The probe sentence, when the round's size is a probe range below the requested count, and the
 *  graduation sentence, when a probe-sized adopted battery grows past the probe, which asks for the
 *  added tasks at the demand of the hardest families (AGENTS.md "The three parts of the climb").
 *  Neither names a family, the aim or its share: the aim is the controller's, and a share stated
 *  here was a count to author towards (AGENTS.md prior 10). */
export function renderProbeSizing(
  tasks: TaskCount,
  requested: number,
  adoptedTasks: number | null,
): string | null {
  const probeMax = BATTERY_SIZE.probe.max;
  if (tasks.min < tasks.max) {
    return `Battery sizing: this product's batteries have ${tasks.min} to ${tasks.max} tasks until one passes some of its scored cases and the controller reads it as hard enough, then ${requested}.`;
  }
  if (adoptedTasks === null || adoptedTasks > probeMax || tasks.min <= probeMax) return null;
  return "Battery sizing: this battery is larger than the latest admitted one, so write the tasks you add at the demand of that battery's hardest families rather than that of the families that passed, since tasks at a demand the solver already meets only dilute what this battery can say about where the solver stops.";
}

/** The adopted battery's task count, or null before a product is adopted. Measurement validates the
 *  rows; sizing needs only their number. */
export function adoptedTaskCount(domainDir: string): number | null {
  const file = join(domainDir, TASKS_FILE);
  if (!existsSync(file)) return null;
  const tasks: unknown = readJsonFile(file);
  return Array.isArray(tasks) ? tasks.length : null;
}
