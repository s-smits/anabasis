/**
 * Harbor trial score reader and paired arm comparison (`trials.py`, `flipP`, `readsStep`).
 * Non-results (`null` scores, provider/crash endings, non-timeout Harbor exceptions) are excluded
 * from denominators; paired comparisons require complete `streams` on both sides and report mean
 * percentage-point gaps, 95% seeded bootstrap intervals, and exact paired sign-flip p-values.
 */
import { flipP, readsStep, readsStepEitherWay } from "#src/kernel/compare.ts";
import { CALL_KINDS, read } from "#src/kernel/log.ts";
import { existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { asRecord, isNumber, isString, type JsonObject } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";
import { mean } from "#src/meta/tally.ts";
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
   *  trials; null where it recorded none, which puts it after those that have one. */
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

/** Harbor's exception for an agent that ran out of its time (`harbor/models/trial/result.py`). */
const AGENT_TIMEOUT = "AgentTimeoutError";

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
  const ending = isString(result?.ending) ? result.ending : null;
  const harbor = jsonAt(join(path, "result.json"));
  const trace = join(path, "agent", TRACE_FILE);
  let calls: number | null = null;
  if (existsSync(trace)) {
    calls = 0;
    for (const { kind } of read(trace)) {
      if (CALL_KINDS.has(kind)) calls += 1;
    }
  }
  // Harbor records an agent or a verifier that threw; only the agent's own timeout is the side's
  // fail, as `wall-ended` is in a campaign. This holds for an agent that writes no result of ours.
  const thrown = asRecord(harbor?.exception_info)?.exception_type;
  const lost = (ending !== null && NON_RESULT.has(ending)) || (isString(thrown) && thrown !== AGENT_TIMEOUT);
  return {
    task,
    trial,
    score: lost ? null : counted(score),
    ending,
    billed: counted(result?.billed),
    turns: counted(result?.turns),
    calls,
    seconds: counted(result?.seconds),
    started: isString(harbor?.started_at) ? harbor.started_at : null,
  };
}

/** The trials `trials.py` printed, one JSON line each, in the order they started. */
export function trialsOf(printed: string): Trial[] {
  // A trial with no start time goes last; ties keep the printed order, which is Harness²'s run
  // folders in name order (`_run_dirs`), since Harbor's trial names are random.
  return printed
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const parsed = asRecord(capturedJsonParse(line));
      if (parsed === null) throw new Error(`trials.py printed a line that is no object: ${line}`);
      return trialOf(parsed);
    })
    .toSorted((one, other) => (one.started ?? "\uFFFF").localeCompare(other.started ?? "\uFFFF"));
}

/** Each task's scores, in the order its trials started, of the trials the reader scored. */
function scoresByTask(trials: readonly Trial[]): Map<string, number[]> {
  const by = new Map<string, number[]>();
  for (const { task, score } of scored(trials)) {
    const list = by.get(task);
    if (list === undefined) by.set(task, [score]);
    else list.push(score);
  }
  return by;
}

/** The trials the reader scored, in their order: what every reading counts, so a non-result
 *  retried later takes no stream's or half's place. */
function scored(trials: readonly Trial[]): (Trial & { readonly score: number })[] {
  return trials.filter((each): each is Trial & { readonly score: number } => each.score !== null);
}

/** How many more scored trials each of `tasks` needs to reach `streams`; a task at its streams is
 *  left out. */
export function shortfall(
  trials: readonly Trial[],
  tasks: readonly string[],
  streams: number,
): Map<string, number> {
  const byTask = scoresByTask(trials);
  return new Map(
    tasks.flatMap((task) => {
      const missing = streams - (byTask.get(task)?.length ?? 0);
      return missing > 0 ? [[task, missing] as const] : [];
    }),
  );
}

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
  const all = [...new Set([...scoredA.keys(), ...scoredB.keys()])].toSorted();
  const full = (by: Map<string, number[]>, task: string) => (by.get(task)?.length ?? 0) >= streams;
  const tasks = all.filter((task) => full(scoredA, task) && full(scoredB, task));
  const cut = (by: Map<string, number[]>, task: string) => (by.get(task) ?? []).slice(0, streams);
  const meansA = tasks.map((task) => mean(cut(scoredA, task)) ?? 0);
  const meansB = tasks.map((task) => mean(cut(scoredB, task)) ?? 0);
  const gaps = tasks.map((_, at) => (meansB[at] ?? 0) - (meansA[at] ?? 0));
  const units = gaps.map((gap) => Math.round(gap * 100 * streams));
  const draw = seeded(seed);
  const count = gaps.length;
  const resampled = new Float64Array(10_000);
  if (count > 0) {
    for (let sample = 0; sample < 10_000; sample += 1) {
      let sum = 0;
      for (let i = 0; i < count; i += 1) sum += gaps[Math.floor(draw() * count)] ?? 0;
      resampled[sample] = sum / count;
    }
    resampled.sort();
  }
  const at = (share: number) => (resampled[Math.floor(share * (resampled.length - 1))] ?? 0) * 100;
  const none = tasks.length === 0;
  return {
    tasks: tasks.length,
    short: all.filter((task) => !tasks.includes(task)),
    streams,
    level,
    meanA: (mean(meansA) ?? 0) * 100,
    meanB: (mean(meansB) ?? 0) * 100,
    difference: (mean(gaps) ?? 0) * 100,
    interval: none ? [0, 0] : [at(0.025), at(0.975)],
    won: units.filter((each) => each > 0).length,
    lost: units.filter((each) => each < 0).length,
    tied: units.filter((each) => each === 0).length,
    p: flipP(units),
    step: readsStep(units, level),
    eitherWay: readsStepEitherWay(units, level),
  };
}

/** One arm's scored trials split in two by the campaign's mirrored halves (`pairsOf`): within
 *  each task, in the order they started, the first and last of each four against the two between. */
export function halves(trials: readonly Trial[]): [Trial[], Trial[]] {
  const seen = new Map<string, number>();
  const first: Trial[] = [];
  const last: Trial[] = [];
  for (const trial of scored(trials)) {
    const at = seen.get(trial.task) ?? 0;
    seen.set(trial.task, at + 1);
    (at % 4 === 0 || at % 4 === 3 ? first : last).push(trial);
  }
  return [first, last];
}

/** The `stream`th scored trial of each task, counted from 0 in the order they started: one stream of an
 *  arm whose harness changes between attempts, as Harness²'s improver's does, read alone. */
export function streamOf(trials: readonly Trial[], stream: number): Trial[] {
  return [...Map.groupBy(scored(trials), ({ task }) => task).values()].flatMap((own) =>
    own.slice(stream, stream + 1),
  );
}
