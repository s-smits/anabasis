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
 * Two arms are read as a campaign reads a comparison (`pairsOf`, `src/kernel/compare.ts`): a task
 * counts only where each side has the streams the terms fixed, each cut to its first in the order
 * the trials started, and a task short on either side is named and left out, as a non-result is
 * solved again rather than counted (rule 7). `shortfall` says how many more trials each task needs,
 * which `run.ts score` asks for again. The reading is the mean difference in percentage points
 * with a seeded bootstrap interval over tasks, and the one-sided paired sign-flip test a campaign
 * uses (`flipP`) on each task's summed difference in whole hundredths of a score, read at the
 * campaign's level (0.02, `tools/d2/round.ts`). The A/A splits one arm's trials by the campaign's
 * mirrored halves, the first and last of each four against the two between, so a drift over the
 * job's hours falls on both halves (`halves`). Until 2 November tasks short on a side were paired
 * on what they had, the step was read at 0.10, and the halves split first against last in the
 * order of Harbor's random trial names.
 */
import { flipP, readsStep, readsStepEitherWay } from "#src/kernel/compare.ts";
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
  /** When Harbor started the trial (`started_at` in its `result.json`), which orders a task's
   *  trials; null where it recorded none, and the trial's name orders it then. */
  readonly started: string | null;
}

/** Two arms over the tasks each scored in full. */
export interface Reading {
  readonly tasks: number;
  /** Tasks with fewer scored trials than the streams on either side, left out of the reading. */
  readonly short: readonly string[];
  readonly streams: number;
  readonly level: number;
  readonly meanA: number;
  readonly meanB: number;
  /** B less A, in percentage points, and its 95% bootstrap interval over tasks. */
  readonly difference: number;
  readonly interval: readonly [number, number];
  readonly won: number;
  readonly lost: number;
  readonly tied: number;
  /** The one-sided sign-flip p that B is better, whether that clears the level, and whether
   *  either side does, which an A/A reads. */
  readonly p: number;
  readonly step: boolean;
  readonly eitherWay: boolean;
}

/** The campaign's default level (`tools/d2/round.ts`). */
const LEVEL = 0.02;

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
  const harbor = jsonAt(join(path, "result.json"));
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
    started: isString(harbor?.["started_at"]) ? harbor["started_at"] : null,
  };
}

/** The trials `trials.py` printed, one JSON line each, in the order they started. */
export function trialsOf(printed: string): Trial[] {
  return printed
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const parsed = asRecord(capturedJsonParse(line));
      if (parsed === null) throw new Error(`trials.py printed a line that is no object: ${line}`);
      return trialOf(parsed);
    })
    .sort(
      (one, other) =>
        (one.started ?? "").localeCompare(other.started ?? "") || one.trial.localeCompare(other.trial),
    );
}

/** Each task's scores, in the order its trials started, of the trials the reader scored. */
function scoresByTask(trials: readonly Trial[]): Map<string, number[]> {
  const by = new Map<string, number[]>();
  for (const { task, score } of trials) if (score !== null) by.set(task, [...(by.get(task) ?? []), score]);
  return by;
}

/** How many more scored trials each of `tasks` needs to reach `streams`; a task at its streams is
 *  left out. */
export function shortfall(
  trials: readonly Trial[],
  tasks: readonly string[],
  streams: number,
): Map<string, number> {
  const scored = scoresByTask(trials);
  return new Map(
    tasks.flatMap((task) => {
      const missing = streams - (scored.get(task)?.length ?? 0);
      return missing > 0 ? [[task, missing] as const] : [];
    }),
  );
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

/** Arm B against arm A over the tasks each scored `streams` times, each task's difference the
 *  summed scores of B less A's, in hundredths. */
export function readArms(
  a: readonly Trial[],
  b: readonly Trial[],
  streams: number,
  { seed = 1, level = LEVEL }: { readonly seed?: number; readonly level?: number } = {},
): Reading {
  const scoredA = scoresByTask(a);
  const scoredB = scoresByTask(b);
  const all = [...new Set([...scoredA.keys(), ...scoredB.keys()])].sort();
  const full = (by: Map<string, number[]>, task: string) => (by.get(task)?.length ?? 0) >= streams;
  const tasks = all.filter((task) => full(scoredA, task) && full(scoredB, task));
  const cut = (by: Map<string, number[]>, task: string) => (by.get(task) ?? []).slice(0, streams);
  const meansA = tasks.map((task) => mean(cut(scoredA, task)));
  const meansB = tasks.map((task) => mean(cut(scoredB, task)));
  const gaps = tasks.map((_, at) => (meansB[at] ?? 0) - (meansA[at] ?? 0));
  const units = gaps.map((gap) => Math.round(gap * 100 * streams));
  const draw = seeded(seed);
  const resampled = Array.from({ length: 10_000 }, () =>
    mean(tasks.map(() => gaps[Math.floor(draw() * gaps.length)] ?? 0)),
  ).sort((one, other) => one - other);
  const at = (share: number) => (resampled[Math.floor(share * (resampled.length - 1))] ?? 0) * 100;
  const none = tasks.length === 0;
  return {
    tasks: tasks.length,
    short: all.filter((task) => !tasks.includes(task)),
    streams,
    level,
    meanA: none ? 0 : mean(meansA) * 100,
    meanB: none ? 0 : mean(meansB) * 100,
    difference: none ? 0 : mean(gaps) * 100,
    interval: none ? [0, 0] : [at(0.025), at(0.975)],
    won: units.filter((each) => each > 0).length,
    lost: units.filter((each) => each < 0).length,
    tied: units.filter((each) => each === 0).length,
    p: flipP(units),
    step: readsStep(units, level),
    eitherWay: readsStepEitherWay(units, level),
  };
}

/** One arm's trials split in two by the campaign's mirrored halves (`pairsOf`): within each task,
 *  in the order they started, the first and last of each four against the two between. */
export function halves(trials: readonly Trial[]): [Trial[], Trial[]] {
  const seen = new Map<string, number>();
  const first: Trial[] = [];
  const last: Trial[] = [];
  for (const trial of trials) {
    const at = seen.get(trial.task) ?? 0;
    seen.set(trial.task, at + 1);
    (at % 4 === 0 || at % 4 === 3 ? first : last).push(trial);
  }
  return [first, last];
}

/** The `stream`th trial of each task, counted from 0 in the order they started: one stream of an
 *  arm whose harness changes between attempts, as Harness²'s improver's does, read alone. */
export function streamOf(trials: readonly Trial[], stream: number): Trial[] {
  return [...Map.groupBy(trials, ({ task }) => task).values()].flatMap((own) =>
    own.slice(stream, stream + 1),
  );
}
