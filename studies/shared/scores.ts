/**
 * A benchmark's scores as a study reads them: each trial of a Harbor job with the score the
 * benchmark's own reader gave it, and two arms set beside each other over the tasks both scored.
 *
 * The scores are not read here. Harness² reads its own rollouts with `score_from_payload`
 * (`harness2/benchmarks/workbuddy.py`), and a port of that precedence would be a second reader of
 * one file, so the study runs it in Harness²'s venv (`studies/harness2/trials.py`) and parses its
 * JSON lines (`trialsOf`). Both arms are therefore scored by one function. A null score is a
 * non-result and is counted apart, never as a zero; Harbor's own mean counts it as zero, which is
 * a different statistic. Where the container solver ran, its result sits beside the score: the
 * ending, the billed dollars `spentBy` summed, and the calls, read from its trace by the kernel's
 * one reader of model traces (`tracesIn`, `src/kernel/trace.ts`). A trial whose solver ended on its
 * provider or crashed is a non-result too, whatever the verifier then found in the container.
 *
 * Two arms are read as the protocol says (`studies/harness2/README.md`, "Metric and statistics"):
 * the mean difference in percentage points over the tasks both arms scored, with a seeded
 * bootstrap interval over tasks, and the one-sided paired sign-flip test a campaign uses (`flipP`,
 * `src/kernel/compare.ts`) on each task's difference in whole hundredths of a score, summed over
 * the streams the terms fixed, since the test convolves over integer margins. The A/A is the same
 * reading of one arm's streams split in two (`halves`).
 */
import { flipP, readsStepEitherWay } from "#src/kernel/compare.ts";
import { read } from "#src/kernel/log.ts";
import { tracesIn } from "#src/kernel/trace.ts";
import { existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { asRecord, isNumber, isString, type JsonObject } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";
import { RESULT_FILE, TRACE_FILE } from "./pi-solve.ts";

/** One trial of one task, as `trials.py` names it and its folder shows it. */
export interface Trial {
  readonly task: string;
  readonly trial: string;
  /** The benchmark reader's score from 0 to 1, or null for a non-result. */
  readonly score: number | null;
  /** The container solver's ending, or null where another agent ran. */
  readonly ending: string | null;
  readonly billed: number | null;
  readonly turns: number | null;
  readonly calls: number | null;
  readonly seconds: number | null;
}

/** Two arms over the tasks both scored. */
export interface Reading {
  readonly tasks: number;
  /** Tasks one arm scored and the other did not, left out of the reading. */
  readonly unpaired: number;
  readonly meanA: number;
  readonly meanB: number;
  /** B less A, in percentage points, and its 95% bootstrap interval over tasks. */
  readonly difference: number;
  readonly interval: readonly [number, number];
  readonly won: number;
  readonly lost: number;
  readonly tied: number;
  /** The one-sided sign-flip p that B is better, and whether either side reads a step at 0.10. */
  readonly p: number;
  readonly eitherWay: boolean;
}

/** The solver's endings that measured nothing (`src/kernel/solve.ts`, "non-result"). */
const NON_RESULT = new Set(["provider", "crash"]);

/** The JSON object at `path`, or null where it is missing, torn or not an object. */
function jsonAt(path: string): JsonObject | null {
  if (!existsSync(path)) return null;
  try {
    return asRecord(capturedJsonParse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}

function counted(value: unknown): number | null {
  return isNumber(value) && Number.isFinite(value) ? value : null;
}

function trialOf(line: JsonObject): Trial {
  const { task, trial, path, score } = line;
  if (!isString(task) || !isString(trial) || !isString(path)) {
    throw new Error(`trials.py printed a line without its task, trial and path: ${JSON.stringify(line)}`);
  }
  const result = jsonAt(join(path, "agent", RESULT_FILE));
  const ending = isString(result?.["ending"]) ? result["ending"] : null;
  const trace = join(path, "agent", TRACE_FILE);
  const traced = existsSync(trace) ? tracesIn(read(trace)) : null;
  return {
    task,
    trial,
    score: ending !== null && NON_RESULT.has(ending) ? null : counted(score),
    ending,
    billed: counted(result?.["billed"]),
    turns: counted(result?.["turns"]),
    calls: traced === null ? null : traced.filter((each) => each.part === "call").length,
    seconds: counted(result?.["seconds"]),
  };
}

/** The trials `trials.py` printed, one JSON line each, in trial order. */
export function trialsOf(printed: string): Trial[] {
  return printed
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const parsed = asRecord(capturedJsonParse(line));
      if (parsed === null) throw new Error(`trials.py printed a line that is no object: ${line}`);
      return trialOf(parsed);
    })
    .sort((one, other) => one.trial.localeCompare(other.trial));
}

/** Each task's scores, in trial order, of the trials the reader scored. */
function scoresByTask(trials: readonly Trial[]): Map<string, number[]> {
  const by = new Map<string, number[]>();
  for (const { task, score } of trials) if (score !== null) by.set(task, [...(by.get(task) ?? []), score]);
  return by;
}

const mean = (values: readonly number[]) => values.reduce((sum, each) => sum + each, 0) / values.length;

/** A small seeded generator, so that a report read again prints the same interval. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Arm B against arm A, each task's difference in hundredths of a score times `streams`. */
export function readArms(a: readonly Trial[], b: readonly Trial[], streams: number, seed = 1): Reading {
  const scoredA = scoresByTask(a);
  const scoredB = scoresByTask(b);
  const tasks = [...scoredA.keys()].filter((task) => scoredB.has(task)).sort();
  const all = new Set([...scoredA.keys(), ...scoredB.keys()]);
  const gaps = tasks.map((task) => mean(scoredB.get(task) ?? []) - mean(scoredA.get(task) ?? []));
  const units = gaps.map((gap) => Math.round(gap * 100 * streams));
  const draw = seeded(seed);
  const resampled = Array.from({ length: 10_000 }, () =>
    mean(tasks.map(() => gaps[Math.floor(draw() * gaps.length)] ?? 0)),
  ).sort((one, other) => one - other);
  const at = (share: number) => (resampled[Math.floor(share * (resampled.length - 1))] ?? 0) * 100;
  return {
    tasks: tasks.length,
    unpaired: all.size - tasks.length,
    meanA: tasks.length === 0 ? 0 : mean(tasks.map((task) => mean(scoredA.get(task) ?? []))) * 100,
    meanB: tasks.length === 0 ? 0 : mean(tasks.map((task) => mean(scoredB.get(task) ?? []))) * 100,
    difference: tasks.length === 0 ? 0 : mean(gaps) * 100,
    interval: tasks.length === 0 ? [0, 0] : [at(0.025), at(0.975)],
    won: units.filter((each) => each > 0).length,
    lost: units.filter((each) => each < 0).length,
    tied: units.filter((each) => each === 0).length,
    p: flipP(units),
    eitherWay: readsStepEitherWay(units, 0.1),
  };
}

/** One arm's trials split in two by their order within each task: its first trials against its
 *  last, which an A/A reads. */
export function halves(trials: readonly Trial[]): [Trial[], Trial[]] {
  const seen = new Map<string, Trial[]>();
  for (const trial of trials) seen.set(trial.task, [...(seen.get(trial.task) ?? []), trial]);
  const first: Trial[] = [];
  const last: Trial[] = [];
  for (const own of seen.values()) {
    const cut = Math.floor(own.length / 2);
    first.push(...own.slice(0, cut));
    last.push(...own.slice(own.length - cut));
  }
  return [first, last];
}
