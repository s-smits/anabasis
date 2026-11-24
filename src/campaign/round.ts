/**
 * Paired comparison execution (`src/campaign/round.ts`): pre-registers experimental terms in
 * `comparison.started` (`begin`, `refuseTerms`), samples frontier and retained tasks (`scoredSet`),
 * runs time-mirrored fresh solves for both harnesses under the dollar cap and check-defect ceiling
 * (`floor`, `unsolvedJobs`), puts reproducible rejections to the Referee (`ruleLeft`), and writes
 * `comparison.reported` (`checkpoint`).
 */
import { draw, type ObjectiveRule } from "../kernel/compare.ts";
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
import type { RefereeFinding } from "../referee/referee.ts";
import { tasksByEpoch } from "./climb.ts";
import { budgetLeft } from "./opening.ts";
import {
  compared,
  coverageOf,
  DEFECT,
  type Fixed,
  fixedIn,
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

/** A harness as a solve is handed it. */
interface Kept {
  readonly dir: string;
  readonly digest: string;
}

/** What a comparison is made on, whoever asks for it. */
interface Terms {
  /** The Starter Built Harness, the fixed lower reference, as the comparison's start records it. */
  readonly starter: Kept;
  /** The scored set: held-out task versions, fixed before any solve (`scoredSet`). */
  readonly tasks: readonly string[];
  /** The scored tasks that are its retained set, as the same draw gave them; the others are the
   *  frontier the step is read on (`compare.ts`). */
  readonly retained: readonly string[];
  /** Counted solves of each task under each harness. */
  readonly solves: number;
  /** The level a reading's step clears (`stepOf`, `compare.ts`). */
  readonly level: number;
  /** The objective two valid answers are compared by, where the check program declares one: the
   *  brief's direction. */
  readonly objective?: ObjectiveRule | undefined;
  /** Tasks with a check defect past which the comparison stops. */
  readonly defects: number;
  /** Solves in flight at once. */
  readonly concurrency: number;
  /** One solve of a task version under the test condition and under `harness`, made for the
   *  comparison named. The caller builds the condition and records it, names the solve so that no
   *  two share an id, has its start name the comparison (`SolveRequest.comparison`), and hands
   *  `kill` to the solve. A throw stops the comparison. */
  readonly solve: (
    version: string,
    harness: Kept,
    comparison: string,
    kill: AbortSignal,
  ) => Promise<Practised>;
  /** The setting `solve` records in each condition (`settingId`): the solver, its limits and the
   *  host. Only solves made under it are counted. */
  readonly setting: string;
  /** The dollar cap, where the solves are paid for. */
  readonly cap?: Cap | undefined;
  /** What the operator expects the comparison to read, in their own words, written with its terms
   *  before the first solve, so the prediction cannot move after a result. It decides nothing. A comparison gone on
   *  from its log keeps the one it began with: begun on another, or on none, it is refused with
   *  one, as it is on any other term that moved. */
  readonly prediction?: string | undefined;
  /** The Referee, when the caller has a reader for it. */
  readonly referee?:
    | ((solve: string, version: string, kill: AbortSignal) => Promise<RefereeFinding>)
    | undefined;
}

export interface CheckpointRequest extends Terms {
  readonly log: string;
  /** Names the comparison in the log. */
  readonly id: string;
  /** The reference harness. */
  readonly old: Kept;
  readonly fresh: Kept;
  /** Aborts when the run is killed. */
  readonly kill?: AbortSignal | undefined;
}

/** One solve still to run: a task version under one of the harnesses, and whether it is asked for
 *  again after a non-result (`drain`). */
interface Job {
  readonly task: string;
  readonly under: Kept;
  readonly again: boolean;
}
/** Tasks in a row the provider wrote nothing for, at which the comparison stops and waits to be
 *  run again. Tasks and not solves: one task its provider refuses at the first turn is that task's
 *  fault, and is reported short. */
const SILENT = 3;
/** The most of a scored set one family takes where the frontier holds three or more (`scoredSet`). */
const FAMILY_SHARE = 0.4;
/** Maximum projected frontier overlap allowed between consecutive scored candidate comparisons on
 *  the same reference after a `no-step` reading (`frontierOverlap`). */
export const OVERLAP_LIMIT = 0.8;
const TASK_STATE = "task.state";
/** The states a comparison's finding may dispute a task from. */
const DISPUTABLE: ReadonlySet<string> = new Set(["held", "released"]);
/** What a start holds that is no term a continuation may move: its id, and the sets it goes on with. */
const UNCOMPARED: ReadonlySet<string> = new Set(["session", "tasks", "retained"]);

/**
 * The tasks a comparison scores, and the retained ones among them: `target` of the frontier
 * (`poolOf`, `reports.ts`), or all of it where it holds fewer, then one retained task for each
 * three, which the step's one test reads with the frontier (`stepOf`, `compare.ts`). The newest
 * epoch comes first, and within each epoch the tasks held out since the last comparison began; the
 * epoch chooses the set and no result does, since the hash (`draw`) is fixed before any task exists.
 * A draw over every epoch at once could fill a small target with tasks the reference already
 * fails, and a draw by the hash alone could miss most of the tasks written for this comparison.
 * Within a tier the families take turns, and where the frontier holds three or more one takes at
 * most `FAMILY_SHARE` of the set unless the others cannot fill it; where the whole frontier is
 * scored, no draw can change which tasks enter.
 */
export function scoredSet(events: readonly LogEvent[], target: number, contract: string) {
  const pool = poolOf(events);
  const began = events.findLastIndex(({ kind }) => kind === STARTED);
  const since = new Set(tasksByEpoch(events.slice(began + 1)).flat());
  const held = new Set(pool.frontier);
  const count = Math.min(target, held.size);
  const picked = draw(
    pool.retained,
    Math.min(pool.retained.length, Math.ceil(count / 3)),
    // Rotated by comparison, so the same retained tasks are not drawn into every comparison.
    `${contract}:retained:${String(events.filter(({ kind }) => kind === STARTED).length)}`,
  );
  // The newest epoch first, and of each the tasks held out since the last comparison began first.
  const tiers = tasksByEpoch(events)
    .toReversed()
    .flatMap((epoch) => {
      const own = epoch.filter((version) => held.has(version));
      return [own.filter((version) => since.has(version)), own.filter((version) => !since.has(version))];
    });
  // Within a tier one task a family a pass, the families in the order of their first task by the
  // hash; a task its author put in no family is a family of its own.
  const families = familiesOf(events);
  const familyOf = (version: string) => families.get(version) ?? version;
  const cap = new Set(pool.frontier.map(familyOf)).size >= 3 ? Math.ceil(count * FAMILY_SHARE) : count;
  const order = tiers.flatMap((tier) => {
    const byFamily = Map.groupBy(draw(tier, tier.length, contract), familyOf);
    const most = Math.max(0, ...[...byFamily.values()].map((group) => group.length));
    return Array.from({ length: most }, (_, pass) =>
      [...byFamily.values()].flatMap((group) => group.slice(pass, pass + 1)),
    ).flat();
  });
  const tasks: string[] = [];
  const taken = new Map<string, number>();
  // The cap gives way only where the held tasks of other families cannot fill the set.
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

/**
 * Projected frontier overlap between the next candidate comparison (`scoredSet`) and the
 * immediately preceding scored candidate `no-step` comparison on `reference` in the current epoch.
 * Reads pre-registered `comparison.started` task sets alone so candidate outcomes never cross the
 * wall (rule 3). Returns null when no qualifying prior `no-step` comparison exists or the projected
 * frontier is empty.
 */
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
    ({ kind, data }) => kind === STARTED && data.session === prior.session && data.ladder !== true,
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

/**
 * Each task's ordered solves still to run, with tasks drawn by their hash and the comparison
 * (`draw`). A worker owns a whole sequence, including retries, before taking another task.
 * Within it the harness that goes first is mirrored, slot by slot and from one task to the next:
 * the reference then the new harness, the new then the reference, so that no side runs later than
 * the other, and a drift over time cannot read as a difference. `had` counts a task's completed
 * solves under each harness, so continuation omits the counted prefix and runs what it lacks.
 */
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

/** A whole number of at least `least`, which a count read from a command line may not be. */
function counts(value: number, least: number): boolean {
  return Number.isInteger(value) && value >= least;
}

/** Refuse, before a session or a solve is spent, tasks that could not be scored. A comparison gone
 *  on from its log is not asked again: its tasks were fixed at its start, and a person may have
 *  released or refused one since, which then leaves it (`withdrawn`). */
function refuseUnscorable({ tasks, retained }: Terms, log: string): void {
  if (tasks.length === 0) {
    throw new Error(
      "no task to score: a comparison is asked for with at least one held-out task that waits for no label (tools/d2/prepare.ts)",
    );
  }
  const twice = tasks.find((version, index) => tasks.indexOf(version) !== index);
  if (twice !== undefined) throw new Error(`task ${twice} is listed twice among the tasks to score`);
  const stray = retained.find((version) => !tasks.includes(version));
  if (stray !== undefined) throw new Error(`retained task ${stray} is not among the tasks to score`);
  const events = read(log);
  // The draw leaves such a task out (`scoredSet`), and a name was the one way past that.
  const waiting = poolOf(events).awaiting.find((version) => tasks.includes(version));
  if (waiting !== undefined) {
    throw new Error(
      `task ${waiting} waits for a person's label, and is not scored until it has one: tools/d2/prepare.ts --keep or --infeasible`,
    );
  }
  const sets = taskSets(events);
  // A task this comparison disputed in an earlier run of it is where that run left it.
  const unfit = tasks.find(
    (version) => !sets.held.includes(version) && sets.states.get(version) !== "disputed",
  );
  if (unfit !== undefined) {
    const state = sets.states.get(unfit);
    const why = state === undefined ? "not proposed" : state === "held" ? "short of its gate" : state;
    throw new Error(`task ${unfit} is ${why}, and only a held-out task is scored`);
  }
}

/** Refuse terms no comparison could be read on, whatever its tasks. */
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

/**
 * Refuse the terms a comparison is asked for on: terms no comparison could be read on, and, for
 * one that has not begun, tasks that could not be scored. A comparison that reported is asked nothing.
 */
export function refuseTerms(terms: Terms, of: { readonly log: string; readonly id: string }): void {
  const events = read(of.log);
  if (reported(events, of.id) !== null) return;
  refuseUnreadable(terms);
  if (startOf(events, of.id) === undefined) refuseUnscorable(terms, of.log);
}

/**
 * Dispute task `version` under comparison `id`, where its state allows it, and say whether it was
 * done. A task a person refused since stays refused, and one disputed already stays so: the log
 * refuses a move from either (`src/kernel/task.ts`).
 */
export function dispute(log: string, id: string, version: string, found: { solve: string; reason: string }) {
  const state = taskStates(read(log)).get(version);
  if (state === undefined || !DISPUTABLE.has(state)) return false;
  append(log, TASK_STATE, { version, state: "disputed", session: id, ...found });
  return true;
}

/** What the environment said of a solve that never ran, or null: the provider wrote no output
 *  token in the solve's last attempt's record, or the wall did not hold on the host, so the solve
 *  was not started. A solve the provider cut after real work holds output tokens, and is a
 *  non-result the comparison solves on from. A wall that refuses every solve would otherwise run
 *  the whole comparison to `sandbox-crash`, so a dead wall is a dead provider's case (AGENTS.md,
 *  rule 14). A solve whose start does not name the comparison is
 *  refused: no fold would count it, and the comparison would buy it again at every pass. */
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

/** The rejections of the comparison that hold no ruling, on tasks still held out, by an earlier run
 *  killed before its ruling or by a reader that failed or gave no answer: each is put to the
 *  Referee again before the report (`ruleLeft`). A report that set such a rejection's task aside
 *  would keep it aside for good, so one Referee call cut by a session limit could cost a step. */
function unruledOf(events: readonly LogEvent[], fixed: Fixed) {
  const held = new Set(taskSets(events).held);
  return rejections(events, fixed, NO_LABELS).filter(({ task, ruling }) => ruling === null && held.has(task));
}

/** The provider's silence over one run of a comparison: `SILENT` tasks in a row stop it, and so do
 *  last solves written nothing for after an answer, though a crash is noted after one. A run with
 *  no answer, or a wall that refused the last task alone, reports that task short. A resumed run
 *  stops too where an earlier run of the comparison was answered and a silent task was never silent
 *  in it, so a run killed after its answers loses no task; silent again, the task is reported short.
 *  `from` is where this run's events begin. */
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

/** Tasks already known to hold a check defect before `floor` starts its workers. */
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

/** Whether starting one more solve would exceed either the comparison's cap or the campaign's total budget. */
function capReached(events: readonly LogEvent[], id: string, cap: Cap | undefined, running: number): boolean {
  const overCap = cap !== undefined && billedFor(events, id) + (running + 1) * cap.reserve > cap.dollars;
  const left = budgetLeft(events);
  return overCap || (left !== null && left.dollars < (running + 1) * left.reserve);
}

/**
 * What runs a comparison's solves: the jobs' pool, the Referee's part, and the reasons it stops
 * taking jobs. A solve that throws ends the pool and is thrown again by `settle` once every solve
 * in flight has returned; the kill's own reason, from a solve in the solve queue, is said as
 * the kill.
 */
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
  /** Put one rejected answer to the Referee where one is seated, and again by `ruleLeft` if unruled. */
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
    // The task's defect on either side, and solved no further here (`sequence`). Only the
    // reference's answer disputes it: a candidate's may move no count its Builder reads (rule 3).
    if (checkCouldNotRun(ending)) {
      defects.add(task);
      const reason = "its own check could not run on an answer";
      if (under.digest === fixed.old) dispute(log, id, task, { solve, reason });
    }
    // Only a rejected answer has anything to recompute: a solve its limits ended, or one that gave
    // no answer, is not valid with no ruling (`src/kernel/compare.ts`).
    if (rejected(ending)) await rule(solve, task);
    return ending;
  };
  /** Run whole task sequences concurrently, holding each through every wait and retry.
   *  Reserve unavailable while another solve runs returns the remaining sequence to the pool. */
  const drain = async (tasks: Job[][]): Promise<void> => {
    const sequence = async (jobs: Job[]): Promise<"reserve" | void> => {
      for (let job = jobs[0]; job !== undefined && going(); job = jobs[0]) {
        const events = read(log);
        // A task this comparison disputed, or a person released or refused since, is solved no more.
        if (!taskSets(events).held.includes(job.task)) return;
        if (capReached(events, id, cap, running)) {
          // The task is left for a lane that can afford it. With solves in flight the reserve held
          // for each may come back in part, so this lane steps aside; with none in flight nothing
          // more will, and the cap is reached.
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
  /** Put to the Referee the rejections left unruled, and stop before the report while one has none. */
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
  /** Solve `tasks` until each has its solves, and say whether the comparison goes on. It throws
   *  what stopped the solves, if a solve or a kill did. */
  const solveAll = async (tasks: readonly string[]): Promise<boolean> => {
    const had = Map.groupBy(
      solvesUnder(read(log), fixed).filter(({ counts: own }) => own),
      ({ under }) => `${under.task} ${under.harness}`,
    );
    await drain(unsolvedJobs(request, tasks, (task, digest) => had.get(`${task} ${digest}`)?.length ?? 0));
    if (thrown !== null) throw thrown;
    if (kill.aborted) throw new Error("the comparison was killed; run it again and it goes on from its log");
    quiet.tail();
    await ruleLeft();
    return going();
  };
  return { solveAll, ruleLeft, faults, capped: () => capped };
}

/**
 * What comparison `id` fixed, from its `comparison.started` event, which is written here the first
 * time. A comparison gone on from its log goes on with the tasks and the terms it began with: one
 * asked for again on other terms is refused, since its solves so far were made for the first.
 */
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
  };
  const was = startOf(read(log), id);
  if (was === undefined) {
    // The two sets are fixed with the tasks, before any result, as the draw gave them (`scoredSet`).
    const sets = { tasks: [...request.tasks], retained: [...request.retained] };
    append(log, STARTED, { session: id, ...terms, ...sets });
  } else {
    // Over the names of both: a continuation that drops a term the start recorded moved it too.
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

/** Write a comparison's report under its id, with the terms it was made on, and return it. */
function write(
  request: Pick<CheckpointRequest, "log" | "id" | "tasks" | "solves" | "level" | "setting">,
  told: Report,
  beside: { readonly broken: string | null; readonly reviewFaults: readonly string[] },
): Report {
  append(request.log, REPORTED, {
    session: request.id,
    // Recorded so that a round that asked for no scored task says so.
    tasks: request.tasks.length,
    solves: request.solves,
    level: request.level,
    setting: request.setting,
    broken: beside.broken,
    reviewFaults: [...beside.reviewFaults],
    // A report is strings, numbers and lists and records of them.
    ...asRecord(told),
  });
  return told;
}

/**
 * One standalone comparison of `fresh` with the reference harness `old`, after several sessions.
 * It also reads the A/A control on mirrored halves of the reference solves.
 */
export async function checkpoint(request: CheckpointRequest): Promise<Report> {
  const { log, id, old, fresh } = request;
  // A comparison that reported is finished, and run again it says what it said.
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

/** A stop records completion and review facts, without testing the completed prefix. */
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
