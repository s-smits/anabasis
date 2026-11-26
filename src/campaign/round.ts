import { draw, type JudgeWeights, type ObjectiveRule } from "../kernel/compare.ts";
import { familiesOf } from "../kernel/history.ts";
import { append, isReferenceChange, type LogEvent, read } from "../kernel/log.ts";
import { type Cap, capHolds, lastReports, poolOf } from "../kernel/reports.ts";
import { billedFor } from "../kernel/meter.ts";
import { checkCouldNotRun, type Ending, nonRetryableProvider } from "../kernel/solve.ts";
import { ranUnder, refereeErrorOf, rejected, solvesIn } from "../kernel/solves.ts";
import { taskSets, taskStates } from "../kernel/task.ts";
import { asRecord, isString, type JsonObject } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { asError, errorMessage } from "../meta/runtime-values.ts";
import { sameJsonValue } from "../meta/stable-json.ts";
import { plural } from "../meta/text.ts";
import type { Asked } from "../audit/judge.ts";
import type { AuditFinding } from "../audit/auditor.ts";
import { JUDGED_TASK_DOLLARS } from "./admission.ts";
import { tasksByEpoch } from "./climb.ts";
import { budgetLeft } from "./opening.ts";
import {
  compared,
  coverageOf,
  DEFECT,
  type Fixed,
  fixedIn,
  judgingLeft,
  NO_LABELS,
  NOTHING,
  rejections,
  type Report,
  REPORTED,
  reported,
  solvesUnder,
  STARTED,
  startOf,
  UNSETTLED,
} from "./comparison.ts";
import type { Practised } from "../builder/session.ts";

interface Kept {
  readonly dir: string;
  readonly digest: string;
}

interface Terms {
  readonly starter: Kept;
  readonly tasks: readonly string[];
  readonly retained: readonly string[];
  readonly solves: number;
  readonly level: number;
  readonly objective?: ObjectiveRule | undefined;
  readonly defects: number;
  readonly concurrency: number;
  readonly solve: (
    version: string,
    harness: Kept,
    comparison: string,
    kill: AbortSignal,
  ) => Promise<Practised>;
  readonly setting: string;
  readonly cap?: Cap | undefined;
  readonly prediction?: string | undefined;
  readonly referee?:
    | ((solve: string, version: string, kill: AbortSignal) => Promise<AuditFinding>)
    | undefined;
  readonly judge?: Judging | undefined;
}

export interface Judging {
  readonly weights: JudgeWeights;
  readonly reviewer: string;
  readonly pair: (version: string, asked: Asked, kill: AbortSignal) => Promise<void>;
}

export interface CheckpointRequest extends Terms {
  readonly log: string;
  readonly id: string;
  readonly old: Kept;
  readonly fresh: Kept;
  readonly kill?: AbortSignal | undefined;
}

interface Job {
  readonly task: string;
  readonly under: Kept;
  readonly again: boolean;
}
const SILENT = 3;
const FAMILY_SHARE = 0.4;
export const OVERLAP_LIMIT = 0.8;
const TASK_STATE = "task.state";
const DISPUTABLE: ReadonlySet<string> = new Set(["held", "released"]);
const UNCOMPARED: ReadonlySet<string> = new Set(["session", "tasks", "retained"]);

export function scoredSet(
  events: readonly LogEvent[],
  target: number,
  contract: string,
  leftOut: ReadonlySet<string> = new Set(),
) {
  const pool = poolOf(events);
  const began = events.findLastIndex(({ kind }) => kind === STARTED);
  const since = new Set(tasksByEpoch(events.slice(began + 1)).flat());
  const held = new Set(pool.frontier.filter((task) => !leftOut.has(task)));
  const retained = pool.retained.filter((task) => !leftOut.has(task));
  const count = Math.min(target, held.size);
  const picked = draw(
    retained,
    Math.min(retained.length, Math.ceil(count / 3)),
    `${contract}:retained:${String(events.filter(({ kind }) => kind === STARTED).length)}`,
  );
  const tiers = tasksByEpoch(events)
    .toReversed()
    .flatMap((epoch) => {
      const own = epoch.filter((version) => held.has(version));
      return [own.filter((version) => since.has(version)), own.filter((version) => !since.has(version))];
    });
  const families = familiesOf(events);
  const familyOf = (version: string) => families.get(version) ?? version;
  const cap = new Set([...held].map(familyOf)).size >= 3 ? Math.ceil(count * FAMILY_SHARE) : count;
  const order = tiers.flatMap((tier) => {
    const byFamily = Map.groupBy(draw(tier, tier.length, contract), familyOf);
    const most = Math.max(0, ...[...byFamily.values()].map((group) => group.length));
    return Array.from({ length: most }, (_, pass) =>
      [...byFamily.values()].flatMap((group) => group.slice(pass, pass + 1)),
    ).flat();
  });
  const tasks: string[] = [];
  const taken = new Map<string, number>();
  for (const capped of [true, false]) {
    for (const version of order) {
      const family = familyOf(version);
      const had = taken.get(family) ?? 0;
      if (tasks.length < count && !tasks.includes(version) && (!capped || had < cap)) {
        tasks.push(version);
        taken.set(family, had + 1);
      }
    }
  }
  return { tasks: [...tasks, ...picked], retained: picked };
}

export function frontierOverlap(
  events: readonly LogEvent[],
  target: number,
  contract: string,
  reference: string,
): {
  readonly ratio: number;
  readonly overlap: number;
  readonly total: number;
  readonly priorSession: string;
} | null {
  const promotedAt = events.findLastIndex(({ kind }) => isReferenceChange(kind));
  const prior = lastReports(events).findLast(
    ({ index, data }) =>
      index > promotedAt &&
      data.old === reference &&
      data.fresh !== data.starter &&
      data.reading !== "not-scored",
  );
  if (prior?.data.reading !== "no-step") return null;
  const priorStart = events.findLast(
    ({ kind, data }) => kind === STARTED && data.session === prior.session,
  )?.data;
  const priorTasks = Array.isArray(priorStart?.tasks) ? priorStart.tasks.filter(isString) : [];
  const priorRetained = new Set(
    Array.isArray(priorStart?.retained) ? priorStart.retained.filter(isString) : [],
  );
  const priorFrontier = new Set(priorTasks.filter((task) => !priorRetained.has(task)));
  if (priorFrontier.size === 0) return null;
  const projected = scoredSet(events, target, contract);
  const projectedRetained = new Set(projected.retained);
  const frontier = projected.tasks.filter((task) => !projectedRetained.has(task));
  if (frontier.length === 0) return null;
  const overlap = frontier.filter((task) => priorFrontier.has(task)).length;
  return { ratio: overlap / frontier.length, overlap, total: frontier.length, priorSession: prior.session };
}

function unsolvedJobs(
  request: Pick<CheckpointRequest, "id" | "old" | "fresh" | "solves">,
  tasks: readonly string[],
  had: (task: string, digest: string) => number,
): Job[][] {
  const { old, fresh, solves } = request;
  return draw(tasks, new Set(tasks).size, request.id).map((task, index) => {
    const left = new Map([old, fresh].map(({ digest }) => [digest, had(task, digest)]));
    return Array.from({ length: solves }, (_, at) => ((index + at) % 2 === 0 ? [old, fresh] : [fresh, old]))
      .flat()
      .flatMap((under) => {
        const skipped = left.get(under.digest) ?? 0;
        left.set(under.digest, skipped - 1);
        return skipped > 0 ? [] : [{ task, under, again: false }];
      });
  });
}

function counts(value: number, least: number): boolean {
  return Number.isInteger(value) && value >= least;
}

function refuseUnscorable({ tasks, retained }: Terms, log: string): void {
  if (tasks.length === 0) {
    throw new Error(
      "no task to score: a comparison is asked for with at least one held-out task that waits for no label (tools/campaign/prepare.ts)",
    );
  }
  const twice = tasks.find((version, index) => tasks.indexOf(version) !== index);
  if (twice !== undefined) throw new Error(`task ${twice} is listed twice among the tasks to score`);
  const stray = retained.find((version) => !tasks.includes(version));
  if (stray !== undefined) throw new Error(`retained task ${stray} is not among the tasks to score`);
  const events = read(log);
  const waiting = poolOf(events).awaiting.find((version) => tasks.includes(version));
  if (waiting !== undefined) {
    throw new Error(
      `task ${waiting} waits for a person's label, and is not scored until it has one: tools/campaign/prepare.ts --keep or --infeasible`,
    );
  }
  const sets = taskSets(events);
  const unfit = tasks.find(
    (version) => !sets.held.includes(version) && sets.states.get(version) !== "disputed",
  );
  if (unfit !== undefined) {
    const state = sets.states.get(unfit);
    const why = state === undefined ? "not proposed" : state === "held" ? "short of its gate" : state;
    throw new Error(`task ${unfit} is ${why}, and only a held-out task is scored`);
  }
}

function refuseUnreadable(terms: Terms): void {
  if (!counts(terms.solves, 1) || !counts(terms.concurrency, 1) || !counts(terms.defects, 0)) {
    throw new Error(
      "a comparison needs whole numbers: at least one solve a harness, one solve at a time, and no fewer than no check defects",
    );
  }
  if (!(terms.level > 0 && terms.level < 1)) throw new Error("a sign test's level lies between 0 and 1");
  if (terms.cap !== undefined && !capHolds(terms.cap)) {
    throw new Error("a cap and its reserve are dollars, and both are more than nothing");
  }
}

export function refuseTerms(terms: Terms, of: { readonly log: string; readonly id: string }): void {
  const events = read(of.log);
  if (reported(events, of.id) !== null) return;
  refuseUnreadable(terms);
  if (startOf(events, of.id) === undefined) refuseUnscorable(terms, of.log);
}

export function dispute(log: string, id: string, version: string, found: { solve: string; reason: string }) {
  const state = taskStates(read(log)).get(version);
  if (state === undefined || !DISPUTABLE.has(state)) return false;
  append(log, TASK_STATE, { version, state: "disputed", session: id, ...found });
  return true;
}

function unanswered(log: string, id: string, { solve, ending }: Practised): string | null {
  const ran = solvesIn(read(log)).find((each) => each.id === solve);
  if (ran?.start.comparison !== id) {
    throw new Error(
      `solve ${solve} does not name comparison ${id} at its start, so no reading would count it: the caller's solve hands the comparison on to its solve request`,
    );
  }
  if (ending.outcome !== "non-result") return null;
  if (ending.kind === "sandbox-crash") return ending.reason;
  if (ending.kind !== "provider") return null;
  if (nonRetryableProvider(ending.reason)) {
    throw new Error(
      `the provider refused in a way no retry clears (${ending.reason}), so the comparison stops. Run it again once the login works and it goes on from its log`,
    );
  }
  return asRecord(ran.end?.tokens)?.output === 0 ? ending.reason : null;
}

function unruledOf(events: readonly LogEvent[], fixed: Fixed) {
  const held = new Set(taskSets(events).held);
  return rejections(events, fixed, NO_LABELS).filter(({ task, ruling }) => ruling === null && held.has(task));
}

function silence(log: string, id: string, from: number) {
  const [silent, provider] = [new Set<string>(), new Set<string>()];
  let answered = false;
  const resumedAnswered = () => {
    const earlier = ranUnder(read(log)).filter(
      ({ start, started }) => start.comparison === id && started < from,
    );
    const lastByCondition = new Map<string, { readonly task: string; readonly kind: unknown }>();
    for (const { condition, under, ending } of earlier) {
      lastByCondition.set(condition, { task: under.task, kind: ending?.kind });
    }
    const silentBefore = new Set(
      [...lastByCondition.values()].flatMap(({ task, kind }) => (kind === "provider" ? [task] : [])),
    );
    return (
      earlier.some(({ ending }) => ending !== null && ending.outcome !== "non-result") &&
      [...provider].some((task) => !silentBefore.has(task))
    );
  };
  return {
    note(task: string, why: string | null, ending: Ending): void {
      answered ||= why === null;
      if (ending.outcome === "non-result" && ending.kind === "provider") provider.add(task);
      if (why === null) {
        silent.clear();
        provider.clear();
      } else if (silent.add(task).size >= SILENT) {
        throw new Error(
          `no solve of ${String(SILENT)} tasks in a row ran, so the comparison stops: ${why}. Run it again and it goes on from its log`,
        );
      }
    },
    tail(): void {
      if (provider.size === 0 || !(answered || resumedAnswered())) return;
      throw new Error(
        `the provider answered this run, then wrote nothing for its last ${plural(silent.size, "task")}, so the comparison stops before its report. Run it again and it goes on from its log`,
      );
    },
  };
}

function knownDefects(before: readonly LogEvent[], id: string, fixed: Fixed): Set<string> {
  return new Set([
    ...before.flatMap(({ kind, data }) =>
      kind === TASK_STATE && data.session === id && data.state === "disputed" && isString(data.version)
        ? [data.version]
        : [],
    ),
    ...rejections(before, fixed, NO_LABELS).flatMap(({ task, ruling }) => (ruling === DEFECT ? [task] : [])),
  ]);
}

function capReached(
  events: readonly LogEvent[],
  id: string,
  cap: Cap | undefined,
  running: number,
  reserveCap?: number,
): boolean {
  const unit = (reserve: number) => (reserveCap === undefined ? reserve : Math.min(reserve, reserveCap));
  const overCap =
    cap !== undefined && billedFor(events, id) + (running + 1) * unit(cap.reserve) > cap.dollars;
  const left = budgetLeft(events);
  return overCap || (left !== null && left.dollars < (running + 1) * unit(left.reserve));
}

async function judgeAll(
  request: CheckpointRequest,
  fixed: Fixed,
  within: {
    readonly kill: AbortSignal;
    readonly faults: string[];
    readonly open: (laneSize: number) => boolean;
    readonly going: () => boolean;
  },
): Promise<void> {
  const { judge, log, id, concurrency } = request;
  if (judge === undefined) return;
  const { kill, faults, open, going } = within;
  const width = Math.max(1, Math.min(concurrency, 2));
  let silent = 0;
  let fatal: string | null = null;
  const ask = async (what: string, asked: () => Promise<void>): Promise<boolean> => {
    try {
      await asked();
      silent = 0;
      return true;
    } catch (error) {
      const message = errorMessage(error);
      faults.push(`${what}: ${message}`);
      silent += 1;
      if (nonRetryableProvider(message)) fatal ??= message;
      return false;
    }
  };
  const active = (laneSize: number) => open(laneSize) && fatal === null && silent < SILENT;
  const left = judgingLeft(read(log), fixed);
  for (let at = 0; at < left.length; at += width) {
    const lane = left.slice(at, at + width);
    if (!active(lane.length)) break;
    await Promise.all(
      lane.map(({ task, first, second }) =>
        ask(`${first} against ${second}`, () => judge.pair(task, { comparison: id, first, second }, kill)),
      ),
    );
  }
  const still = going() ? judgingLeft(read(log), fixed) : [];
  if (still.length > 0) {
    throw new Error(
      `the judge gave no vote on ${plural(still.length, "pair")}, so the comparison stops before its report: run it again and it goes on from its log (${faults.at(-1) ?? "no fault recorded"})`,
    );
  }
}

function floor(request: CheckpointRequest, fixed: Fixed) {
  const { log, id, cap } = request;
  const halt = new AbortController();
  const kill = AbortSignal.any([halt.signal, ...(request.kill ? [request.kill] : [])]);
  const faults: string[] = [];
  let thrown: Error | null = null;
  let [running, capped] = [0, false];
  const before = read(log);
  const defects = knownDefects(before, id, fixed);
  const going = () => thrown === null && !kill.aborted && !capped && defects.size <= request.defects;
  const quiet = silence(log, id, before.length);
  const rule = async (solve: string, task: string): Promise<void> => {
    if (request.referee === undefined) return;
    try {
      if ((await request.referee(solve, task, kill)).ruling === DEFECT) defects.add(task);
    } catch (error) {
      faults.push(`${solve}: ${errorMessage(error)}`);
    }
  };
  const run = async ({ task, under }: Job): Promise<Ending> => {
    const solved = await request.solve(task, under, id, kill);
    const { solve, ending } = solved;
    quiet.note(task, unanswered(log, id, solved), ending);
    if (checkCouldNotRun(ending)) {
      defects.add(task);
      const reason = "its own check could not run on an answer";
      if (under.digest === fixed.old) dispute(log, id, task, { solve, reason });
    }
    if (rejected(ending)) await rule(solve, task);
    return ending;
  };
  const drain = async (tasks: Job[][]): Promise<void> => {
    const sequence = async (jobs: Job[]): Promise<"reserve" | void> => {
      for (let job = jobs[0]; job !== undefined && going(); job = jobs[0]) {
        const events = read(log);
        if (!taskSets(events).held.includes(job.task)) return;
        if (capReached(events, id, cap, running)) {
          tasks.unshift(jobs);
          capped = running === 0;
          return "reserve";
        }
        running += 1;
        try {
          const ending = await run(job);
          if (ending.outcome !== "non-result") jobs.shift();
          else if (job.again || checkCouldNotRun(ending)) return;
          else jobs[0] = { ...job, again: true };
        } catch (error) {
          if (!kill.aborted || error !== kill.reason) thrown ??= asError(error);
          halt.abort();
        } finally {
          running -= 1;
        }
      }
    };
    const worker = async (): Promise<void> => {
      for (let jobs = tasks.shift(); jobs !== undefined && going(); jobs = tasks.shift()) {
        if ((await sequence(jobs)) === "reserve") return;
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, request.concurrency) }, worker));
  };
  const ruleLeft = async (): Promise<void> => {
    const left = unruledOf(read(log), fixed);
    for (let at = 0; at < left.length && going(); at += request.concurrency) {
      const lane = left.slice(at, at + request.concurrency);
      await Promise.all(lane.map(({ solve, task }) => rule(solve, task)));
    }
    const events = read(log);
    const still = request.referee === undefined || !going() ? [] : unruledOf(events, fixed);
    if (still.length > 0) {
      const silent = still.map(({ solve }) => solve);
      const why = refereeErrorOf(events, silent);
      throw new Error(
        `the Referee gave no ruling on ${silent.join(", ")}, so the comparison stops before its report: run it again and it goes on from its log, where they are put to the Referee again${why === null ? "" : ` (${why})`}`,
      );
    }
  };
  const judgeLeft = () =>
    judgeAll(request, fixed, {
      kill,
      faults,
      open: (laneSize) => {
        capped ||= going() && capReached(read(log), id, cap, Math.max(0, laneSize - 1), JUDGED_TASK_DOLLARS);
        return going();
      },
      going,
    });
  const solveAll = async (tasks: readonly string[]): Promise<boolean> => {
    const had = Map.groupBy(
      solvesUnder(read(log), fixed).filter(({ counts: own }) => own),
      ({ under }) => `${under.task} ${under.harness}`,
    );
    await drain(unsolvedJobs(request, tasks, (task, digest) => had.get(`${task} ${digest}`)?.length ?? 0));
    if (thrown !== null) throw thrown;
    const killed = () => {
      if (kill.aborted) {
        throw new Error("the comparison was killed; run it again and it goes on from its log");
      }
    };
    killed();
    quiet.tail();
    await ruleLeft();
    await judgeLeft();
    killed();
    return going();
  };
  return { solveAll, ruleLeft, faults, capped: () => capped };
}

function begin(request: CheckpointRequest): Fixed {
  const { log, id } = request;
  const terms: JsonObject = {
    old: request.old.digest,
    fresh: request.fresh.digest,
    starter: request.starter.digest,
    setting: request.setting,
    solves: request.solves,
    level: request.level,
    cap: request.cap === undefined ? null : { ...request.cap },
    ...keyIfDefined("prediction", request.prediction),
    ...keyIfDefined("objective", request.objective === undefined ? undefined : { ...request.objective }),
    ...keyIfDefined(
      "judge",
      request.judge === undefined
        ? undefined
        : { weights: { ...request.judge.weights }, reviewer: request.judge.reviewer },
    ),
  };
  const was = startOf(read(log), id);
  if (was === undefined) {
    const sets = { tasks: [...request.tasks], retained: [...request.retained] };
    append(log, STARTED, { session: id, ...terms, ...sets });
  } else {
    const moved = [...new Set([...Object.keys(terms), ...Object.keys(was)])]
      .filter((name) => !UNCOMPARED.has(name) && !sameJsonValue(was[name], terms[name]))
      .toSorted();
    if (moved.length > 0) {
      throw new Error(
        `comparison ${id} began on other terms (${moved.join(", ")}), and its solves so far were made for those: run it as it began, or under another id`,
      );
    }
  }
  const fixed = fixedIn(read(log), id);
  if (fixed === null) throw new Error(`comparison ${id} wrote no start the log reads back`);
  return fixed;
}

function write(
  request: Pick<CheckpointRequest, "log" | "id" | "tasks" | "solves" | "level" | "setting">,
  told: Report,
  beside: { readonly broken: string | null; readonly reviewFaults: readonly string[] },
): Report {
  append(request.log, REPORTED, {
    session: request.id,
    tasks: request.tasks.length,
    solves: request.solves,
    level: request.level,
    setting: request.setting,
    broken: beside.broken,
    reviewFaults: [...beside.reviewFaults],
    ...asRecord(told),
  });
  return told;
}

export async function checkpoint(request: CheckpointRequest): Promise<Report> {
  const { log, id, old, fresh } = request;
  const before = reported(read(log), id);
  if (before !== null) return before;
  if (old.digest === fresh.digest) {
    throw new Error(
      `a comparison sets two harnesses against each other, and both sides are ${old.digest}; the reference harness is read against itself beside every comparison`,
    );
  }
  refuseTerms(request, { log, id });
  const fixed = begin(request);
  const work = floor(request, fixed);
  await work.ruleLeft();
  const went = await work.solveAll(fixed.tasks);
  const events = read(log);
  const states = taskStates(events);
  const told: Report = {
    old: fixed.old,
    fresh: fixed.fresh,
    starter: fixed.starter,
    ...(went
      ? { ...compared(events, fixed, NO_LABELS), settled: UNSETTLED }
      : stopped(events, fixed, work.capped() ? "not-scored" : "check-defects")),
    disputed: fixed.tasks.filter((task) => states.get(task) === "disputed"),
    capped: work.capped(),
  };
  return write({ ...request, tasks: fixed.tasks }, told, { broken: null, reviewFaults: work.faults });
}

function stopped(events: readonly LogEvent[], fixed: Fixed, reading: "not-scored" | "check-defects") {
  const { short, aside, disputed, withdrawn } = coverageOf(events, fixed);
  return {
    ...NOTHING,
    objective: fixed.objective === undefined ? null : { ...fixed.objective, decided: 0 },
    short,
    aside,
    disputed,
    withdrawn,
    settled: UNSETTLED,
    reading,
  } as const;
}
