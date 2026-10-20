/**
 * A checkpoint: one comparison of a new harness with the reference harness, on held-out tasks. And
 * a round: a Builder session, then the checkpoint of the harness it left.
 *
 * A checkpoint is three steps over one log.
 * 1. Solving. Each task of the scored set is solved `solves` times under each of the two
 *    harnesses, all of it afresh. The scored set is the caller's, fixed before any solve
 *    (`scoredSet`), so no result of this comparison chooses it, though the reference harness's
 *    results in earlier ones do (`poolOf`, `reports.ts`); so are its two sets, retained and
 *    frontier. A task's solves run together, the tasks in an order a hash of each draws, and
 *    within a task the harness that goes first is mirrored (`unsolvedJobs`): what drifts over the
 *    hours falls between tasks, which the test does not read, and neither harness has the quieter
 *    hours or the warmer cache.
 * 2. The comparison (`src/kernel/compare.ts`): every solve of the new harness paired with every
 *    solve of the reference one, a valid answer over one that is not, each task counted once, and
 *    the paired sign-flip test over the frontier's differences in pair wins.
 * 3. The reading, logged as `comparison.reported`.
 *
 * What is fixed before the first solve. A comparison writes `comparison.started` with its
 * harnesses, its setting, its scored tasks, its solves a side, its level and its dollar cap, so
 * that what it compares is on record before any result is. One gone on from its log goes on with
 * the same tasks, and one asked for again on other terms is refused.
 * Every solve the comparison starts names it at its start, and a solve counts when it names the
 * comparison and ran under one of its harnesses and its setting. No other solve is counted, made
 * before it or beside it by another comparison: a condition names the host's code, which changes
 * between comparisons, and one frozen draw of the reference harness's solves would bias every
 * later comparison read against it (`docs/plan.md`, What we will not do).
 *
 * The Starter Built Harness is the reference harness until a step is promoted
 * (`src/solve/starter.ts`). Once the operator has promoted another reference, the starter is the
 * control the table reads the tasks with after a promotion (`decide.ts`), and no side of a
 * comparison between two others.
 *
 * How each harness did by itself is in the report beside the test (`valid`): on how many tasks it
 * gave a valid answer in every solve, in some and in none. For the starter this is what the
 * plan's first gate reads: where it is valid on nearly every solve, the tasks leave a harness
 * nothing to add (`docs/plan.md`, G0).
 *
 * The reference is read against itself as the test is (the plan's A/A): its solves of a task
 * split into two halves mirrored in time, read as two harnesses are, with how often two of them
 * disagree (`flips`, `comparison.ts`).
 * At four solves a side the test's own solves hold it, two against two, and at fewer there is none.
 * It should read no step, and decides nothing here. Until 12 October its later solves ran after
 * the test's own were done, so a drift read as a difference, and until 13 October `--noise` read
 * one at fewer by solving the reference twice as often.
 *
 * A comparison is read at the one budget its solves were told: a reading of the same solves at a
 * shorter budget would read a solver told the longer one.
 *
 * `cap` is the comparison's dollar cap. Before each solve the dollars the log holds as billed for
 * the comparison are summed (`billedFor`): its own solves and their rulings, and in a round the
 * session's spend as well; a solve of the comparison with no end on record, killed in an earlier
 * run or still running, by what its turns and compactions have metered. The solve is not started
 * when a reserve for it and for each solve still running would take the sum past the cap. A lane
 * that cannot start a solve while others are in flight steps aside, since what they bill may be
 * under their reserve; when none is in flight and the next solve still cannot start, the cap is
 * reached. A comparison the cap cuts short of its test reads `not-scored` and is finished: its
 * tally would be of the tasks that happened to come first. The round's session is held to the same
 * cap by its own part of the sum, its practice solves before each starts (`practiceLeft`,
 * `tools.ts`) and its own turns before each request (`halted`, `session.ts`).
 *
 * Rejections. A rejected answer counts as not valid only once the rejection is ruled a true fail
 * (`earned`), by the Referee where the caller seats one. One ruled a check defect or unclear, and
 * one no ruling was made on, sets its task aside: the task is left out of every tally of the
 * comparison, for both harnesses, and named in `aside` (the plan's table, `compare.ts`). The
 * report also holds `counted`, the tally were every such rejection to stand, so a person sees what
 * the labels can move. A person's labels settle it (`settleReading`): a task whose set-aside
 * rejections are all labelled earned is restored, one labelled a check defect is disputed for
 * good, and one labelled unclear stays out. A solve that ended at its limits or gave no answer has
 * nothing to recompute and needs no ruling. A check that could not run disputes its task at once.
 * Past `defects` tasks with a check that could not run or a rejection the Referee ruled a check
 * defect, the checkpoint stops, since the check program then needs its owner before more is spent.
 * A task a person released or refused while the comparison ran is left out and named
 * (`withdrawn`), and no further solve of it is started. A rejection left unruled, by an earlier
 * run killed before its ruling or by a reader that failed or gave no answer, is put to the Referee
 * again before the report, and one still unruled stops the comparison, to go on from its log.
 *
 * A checkpoint that wrote its report is finished, and run again it returns that report and does
 * nothing: topping up a set a dispute thinned, after the tallies could be seen, would be a second
 * look at the data. It also stops, to go on the same way, when the provider has stopped answering:
 * `SILENT` tasks in a row whose solve ended, after its reruns, with nothing written for it. A login
 * at its session limit does that to every solve in seconds. A limit that names when it resets
 * stops it at the first solve it ends, which is not run again: every solve until then would meet it.
 *
 * A round's session starts from the harness the caller names, which need not be the reference
 * harness: a Builder goes on from its latest harness, and the comparison is against the reference
 * one. The session is run once and read from the log whether it ran now or in an earlier run
 * (`sessionOnce`, `session.ts`), which is also how a session runs with no comparison after it. A
 * session cut at its wall or its turns is a whole session and is compared. One that left the
 * harness it started from, the reference harness itself, or one no solve can open, is reported as
 * no change.
 *
 * A held-out task's trace is never shown: it would carry the task to the Builder.
 *
 * Nothing here decides what happens next. `reading` (`compared`, `comparison.ts`) says how the
 * plan's rules read the tallies; the stop rule reads the reports (`src/kernel/reports.ts`), and
 * promotion and a next session are the operator's.
 *
 * What the log holds of a comparison, and how it is read back, is `comparison.ts`: its start, its
 * counted solves, its rejections, its tallies and its report. This file keeps what runs one and
 * what it writes.
 */
import { resetOf } from "../backends/claude.ts";
import { draw, type ObjectiveRule } from "../kernel/compare.ts";
import { append, type LogEvent, read } from "../kernel/log.ts";
import { billedFor, type Cap, capHolds, poolOf } from "../kernel/reports.ts";
import type { Ending } from "../kernel/solve.ts";
import { ranUnder, solvesIn } from "../kernel/solves.ts";
import { taskSets, taskStates } from "../kernel/task.ts";
import { asRecord, isString, type JsonObject } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { asError, errorMessage } from "../meta/runtime-values.ts";
import { sameJsonValue } from "../meta/stable-json.ts";
import type { RefereeFinding, Ruling } from "../review/referee.ts";
import { tasksByEpoch } from "./climb.ts";
import {
  compared,
  DEFECT,
  EARNED,
  type Fixed,
  fixedIn,
  NO_LABELS,
  NOTHING,
  type PassLabel,
  passesIn,
  rejections,
  type Report,
  REPORTED,
  reported,
  solvesUnder,
  STARTED,
  startOf,
  toLabel,
  UNSETTLED,
} from "./comparison.ts";
import { type BuildRequest, type Built, type Practised, sessionOnce } from "./session.ts";

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
   *  before the first solve (`docs/plan.md`, Phase 4). It decides nothing. A comparison gone on
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

export interface RoundRequest extends Terms {
  /** The session, as `build` takes it. Its id names the round in the log, and its parent is the
   *  harness the Builder starts from. */
  readonly session: BuildRequest;
  /** The harness the one the session leaves is compared with. */
  readonly reference: Kept;
  /** Runs the session: `build`, unless a caller without a command wall stands in for it. */
  readonly builder?: ((request: BuildRequest) => Promise<Built>) | undefined;
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
const TASK_STATE = "task.state";
/** The states a comparison's finding may dispute a task from. */
const DISPUTABLE: ReadonlySet<string> = new Set(["held", "released"]);
/** What a start holds that is no term a continuation may move: its id, and the sets it goes on with. */
const UNCOMPARED: ReadonlySet<string> = new Set(["session", "tasks", "retained"]);

/**
 * The tasks a comparison scores, and the retained ones among them: `target` of the scorable tasks
 * a log holds (`poolOf`, `reports.ts`), or all of them where it holds fewer, taken from the newest
 * epoch down and within an epoch drawn by the contract's hash and nothing else (`draw`). The tasks
 * written since the last promotion are the exam the reference harness has not answered, so they
 * come first; what room is left is filled from the epoch before, by the same hash, and so on down.
 * The retained set, read in the step's one test and reported apart, since 16 October holds every task of the epochs
 * before that the reference has stood in no comparison of (`poolOf`): until then one task in four
 * of the set was kept for those epochs as frontier, and after each promotion they tied (the plan's
 * climb section, C2; `regressionOf` reads the same gap after the fact). The epoch chooses the set and no result does: the hash is fixed before any task
 * exists, and which epoch a task is in is where it passed its gate (`tasksByEpoch`). A draw over
 * every epoch at once, in a simulated climb after two promotions, drew for a target of 8 over 19
 * held tasks two or three the reference failed, so three comparisons read one win short and the
 * campaign stopped (`docs/plan.md`, B14). A task that waits for a person's label is left out, and
 * an exhausted one, which can only tie again, is retained (`poolOf`). Of the retained, one for
 * each three frontier tasks is scored beside the target, where a step may not lose more pairs than
 * it wins (`compare.ts`). Until 16 October it was what the frontier left of the target: 16 of 94
 * starts on record drew fewer than one for each three, 12 of them where the frontier filled it.
 *
 * Within each epoch the tasks held out since the last comparison began come first, by the hash:
 * a draw by the hash alone took a task written after a comparison that left no room no earlier
 * than one it had scored, and one campaign's next comparison scored 4 of the 7 written for it.
 *
 * Until 19 October a repeat, the comparison that read a step again before it promoted, scored its
 * first stage's untied tasks again first and that stage's other tasks last; one reading promotes
 * since, and every comparison draws alike.
 */
export function scoredSet(events: readonly LogEvent[], target: number, contract: string) {
  const pool = poolOf(events);
  const kept = pool.retained.filter((task) => pool.scorable.includes(task));
  const held = new Set(pool.frontier);
  const count = Math.min(target, held.size);
  const picked = draw(kept, Math.min(kept.length, Math.ceil(count / 3)), `${contract}:retained`);
  const began = events.findLastIndex(({ kind }) => kind === STARTED);
  const since = new Set(tasksByEpoch(events.slice(began + 1)).flat());
  // The newest epoch first, and of each the tasks held out since the last comparison began first.
  const tiers = tasksByEpoch(events)
    .toReversed()
    .flatMap((epoch) => {
      const own = epoch.filter((version) => held.has(version));
      return [own.filter((version) => since.has(version)), own.filter((version) => !since.has(version))];
    });
  const tasks: string[] = [];
  for (const tier of tiers) tasks.push(...draw(tier, Math.min(count - tasks.length, tier.length), contract));
  return { tasks: [...tasks, ...picked], retained: picked };
}

/**
 * The solves still to run, task by task in an order drawn by a hash of each task and the comparison
 * (`draw`), so that what drifts over the comparison's hours falls between tasks, which the test
 * does not read, and no slot's solves gather at one end. Within a task its slots run in turn and
 * the harness that goes first is mirrored, slot by slot and from one task to the next: the
 * reference then the new harness, the new then the reference. `had` says how many counted solves
 * a task has under a harness; a comparison gone on from its log runs the slots' solves it lacks.
 */
function unsolvedJobs(
  request: Pick<CheckpointRequest, "id" | "old" | "fresh" | "solves">,
  tasks: readonly string[],
  had: (task: string, digest: string) => number,
): Job[] {
  const { old, fresh, solves } = request;
  return draw(tasks, new Set(tasks).size, request.id).flatMap((task, index) => {
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
function refuseUnscorable({ tasks, retained }: Terms, log: string, practised: ReadonlySet<string>): void {
  if (tasks.length === 0) {
    throw new Error(
      "no task to score: a comparison is asked for with at least one held-out task that waits for no label (tools/d2/prepare.ts)",
    );
  }
  const twice = tasks.find((version, index) => tasks.indexOf(version) !== index);
  if (twice !== undefined) throw new Error(`task ${twice} is listed twice among the tasks to score`);
  const stray = retained.find((version) => !tasks.includes(version));
  if (stray !== undefined) throw new Error(`retained task ${stray} is not among the tasks to score`);
  const seen = tasks.find((version) => practised.has(version));
  if (seen !== undefined) {
    throw new Error(`task ${seen} is a practice task, and a round scores no task its session saw`);
  }
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
 * one that has not begun, tasks that could not be scored. `practised` is what its session may
 * practise on, and empty for a checkpoint. A comparison that reported is asked nothing.
 *
 * A comparison asks this of itself before its first event. A command asks it before it records
 * anything, so that a refused command leaves the log as it was: a round refused for a mistyped
 * task after it had recorded the campaign's setting would have the corrected command refused as
 * another setting.
 */
export function refuseTerms(
  terms: Terms,
  of: { readonly log: string; readonly id: string; readonly practised: ReadonlySet<string> },
): void {
  const events = read(of.log);
  if (reported(events, of.id) !== null) return;
  refuseUnreadable(terms);
  if (startOf(events, of.id) === undefined) refuseUnscorable(terms, of.log, of.practised);
}

/**
 * Dispute task `version` under comparison `id`, where its state allows it, and say whether it was
 * done. A task a person refused since stays refused, and one disputed already stays so: the log
 * refuses a move from either (`src/kernel/task.ts`).
 */
function dispute(log: string, id: string, version: string, found: { solve: string; reason: string }) {
  const state = taskStates(read(log)).get(version);
  if (state === undefined || !DISPUTABLE.has(state)) return false;
  append(log, TASK_STATE, { version, state: "disputed", session: id, ...found });
  return true;
}

/** What the environment said of a solve that never ran, or null: the provider wrote no output
 *  token in the solve's last attempt's record, or the wall did not hold on the host, so the solve
 *  was not started. A solve the provider cut after an hour's work holds thousands (8 October),
 *  and is a non-result the comparison solves on from. On 10 October a rehearsal whose wall
 *  refused every solve ran 56 of them to `sandbox-crash` before it was killed: a dead wall is a
 *  dead provider's case (AGENTS.md, rule 14). A solve whose start does
 *  not name the comparison is refused: no fold would count it, and the comparison would buy it
 *  again at every pass. */
function unanswered(log: string, id: string, { solve, ending }: Practised): string | null {
  const events = read(log);
  if (!solvesIn(events).some((each) => each.id === solve && each.start.comparison === id)) {
    throw new Error(
      `solve ${solve} does not name comparison ${id} at its start, so no reading would count it: the caller's solve hands the comparison on to its solve request`,
    );
  }
  if (ending.outcome !== "non-result") return null;
  if (ending.kind === "sandbox-crash") return ending.reason;
  if (ending.kind !== "provider") return null;
  const record = events.findLast(({ kind, data }) => kind === "solve.finished" && data.solve === solve);
  return asRecord(record?.data.tokens)?.output === 0 ? ending.reason : null;
}

/** The rejections of the comparison that hold no ruling, on tasks still held out, by an earlier run
 *  killed before its ruling or by a reader that failed or gave no answer: each is put to the
 *  Referee again before the report (`ruleLeft`). A report that set such a rejection's task aside
 *  would keep it aside for good: one Referee call cut by the provider's session limit cost a step
 *  that way on 12 October. */
function unruledOf(events: readonly LogEvent[], fixed: Fixed) {
  const held = new Set(taskSets(events).held);
  return rejections(events, fixed, NO_LABELS).filter(({ task, ruling }) => ruling === null && held.has(task));
}

/**
 * What runs a comparison's solves: the jobs' pool, the Referee's part, and the reasons it stops
 * taking jobs. A solve that throws ends the pool and is thrown again by `settle` once every solve
 * in flight has returned.
 */
function floor(request: CheckpointRequest, fixed: Fixed) {
  const { log, id, cap } = request;
  const halt = new AbortController();
  const kill = AbortSignal.any([halt.signal, ...(request.kill ? [request.kill] : [])]);
  const faults: string[] = [];
  let thrown: Error | null = null;
  let [running, capped] = [0, false];
  const before = read(log);
  // The tasks with a check defect, kept beside the log so that a job does not fold the whole of
  // it: those this comparison disputed, and those a Referee's ruling found one on.
  const defects = new Set([
    ...before.flatMap(({ kind, data }) =>
      kind === TASK_STATE && data.session === id && data.state === "disputed" && isString(data.version)
        ? [data.version]
        : [],
    ),
    ...rejections(before, fixed, NO_LABELS).flatMap(({ task, ruling }) => (ruling === DEFECT ? [task] : [])),
  ]);
  const going = () => thrown === null && !kill.aborted && !capped && defects.size <= request.defects;
  const silent = new Set<string>();
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
    const why = unanswered(log, id, solved);
    // Whatever the solve wrote first: on 13 October a weekly limit ended 14 solves of one task in
    // three minutes, four of them after some output, and the task read short. The campaign waits the
    // reset out (`waitOut`, `tools/d2/host.ts`).
    if (
      ending.outcome === "non-result" &&
      ending.kind === "provider" &&
      resetOf(ending.reason, new Date()) !== null
    ) {
      throw new Error(
        `the provider's limit ended a solve, so the comparison stops: ${ending.reason}. Run it again and it goes on from its log`,
      );
    }
    if (why === null) silent.clear();
    else if (silent.add(task).size >= SILENT) {
      throw new Error(
        `no solve of ${String(SILENT)} tasks in a row ran, so the comparison stops: ${why}. Run it again and it goes on from its log`,
      );
    }
    // A second such solve of the task disputes nothing: the log holds the task disputed (`dispute`).
    if (ending.outcome === "non-result" && ending.kind === "check") {
      defects.add(task);
      dispute(log, id, task, { solve, reason: "its own check could not run on an answer" });
    }
    // Only a rejected answer has anything to recompute: a solve its limits ended, or one that gave
    // no answer, is not valid with no ruling (`src/kernel/compare.ts`).
    if (ending.outcome === "fail" && ending.kind === "rejected") await rule(solve, task);
    return ending;
  };
  /** Run `jobs`, `concurrency` at a time, until they are done or the comparison is no longer going.
   *  A non-result that outlasts its re-runs inside `solve` is asked for once more, in its place. */
  const drain = async (jobs: Job[]): Promise<void> => {
    const worker = async (): Promise<void> => {
      for (let job = jobs.shift(); job !== undefined && going(); job = jobs.shift()) {
        const events = read(log);
        // A task this comparison disputed, or a person released or refused since, is solved no more.
        if (!taskSets(events).held.includes(job.task)) continue;
        if (cap !== undefined && billedFor(events, id) + (running + 1) * cap.reserve > cap.dollars) {
          // The job is left for a lane that can afford it. With solves in flight the reserve held
          // for each may come back in part, so this lane steps aside; with none in flight nothing
          // more will, and the cap is reached.
          jobs.unshift(job);
          capped = running === 0;
          return;
        }
        running += 1;
        try {
          const { outcome } = await run(job);
          if (outcome === "non-result" && !job.again) jobs.unshift({ ...job, again: true });
        } catch (error) {
          thrown ??= asError(error);
          halt.abort();
        } finally {
          running -= 1;
        }
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
    const still = request.referee === undefined || !going() ? [] : unruledOf(read(log), fixed);
    if (still.length > 0) {
      throw new Error(
        `the Referee gave no ruling on ${still.map(({ solve }) => solve).join(", ")}, so the comparison stops before its report: run it again and it goes on from its log, where they are put to the Referee again`,
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
    // Eight rounds of 8 October asked for no scored task, and their logs could not say so.
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
 * One comparison of `fresh` with the reference harness `old`, with no session: the plan's
 * checkpoint after several sessions, and at four solves a side its gate G2.
 */
export async function checkpoint(request: CheckpointRequest): Promise<Report> {
  const { log, id, old, fresh } = request;
  // A comparison that reported is finished, and run again it says what it said.
  const before = reported(read(log), id);
  if (before !== null) return before;
  if (old.digest === fresh.digest) {
    throw new Error(
      `a comparison sets two harnesses against each other, and both sides are ${old.digest}; the reference harness is read against itself beside a comparison of four solves a side`,
    );
  }
  refuseTerms(request, { log, id, practised: new Set() });
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

/** What a comparison that stopped before its test could be read reports, on its cap or its
 *  defects: nothing compared, and the tasks a rejection had set aside by then, the check defects
 *  among them. */
function stopped(events: readonly LogEvent[], fixed: Fixed, reading: "not-scored" | "check-defects") {
  const open = new Set(
    rejections(events, fixed, NO_LABELS).flatMap(({ task, ruling }) => (ruling === EARNED ? [] : [task])),
  );
  return {
    ...NOTHING,
    objective: fixed.objective === undefined ? null : { ...fixed.objective, decided: 0 },
    aside: fixed.tasks.filter((task) => open.has(task)),
    reading,
  };
}

/**
 * A Builder session, then the comparison of the harness it left with the reference harness. The
 * plan's first round is one, from the Starter Built Harness and against it.
 */
export async function round(request: RoundRequest): Promise<Report> {
  const { session, builder, reference, ...terms } = request;
  const { log, id } = session;
  // A round that reported is finished, and run again it says what it said: a second pass over a
  // finished comparison, topping up a set a dispute thinned, would be a second look at its data.
  const before = reported(read(log), id);
  if (before !== null) return before;
  refuseTerms(terms, { log, id, practised: new Set(session.tasks.map(({ version }) => version)) });
  // The session is read from the log whether it ran now or in an earlier run of this round.
  const built = await sessionOnce({ ...session, cap: request.cap }, builder);
  const asked = { ...terms, log, id, kill: session.kill };
  if (built.kept === null || built.kept.digest === reference.digest) {
    const unchanged: Report = {
      old: reference.digest,
      fresh: null,
      starter: terms.starter.digest,
      ...NOTHING,
      reading: "no-change",
    };
    return write(asked, unchanged, { broken: built.broken, reviewFaults: [] });
  }
  return await checkpoint({ ...asked, old: reference, fresh: built.kept });
}

/**
 * Settle a comparison's reading on a person's answer to its packet (`settle.ts`), and report again.
 *
 * `labels` holds a ruling a rejected answer, and a person's label stands over the Referee's ruling
 * of the same rejection. A task whose rejections then all stand as earned is restored to the tally.
 * One labelled a check defect disputes its task, which leaves every comparison from then on. One
 * labelled unclear, and one set aside on a rejection the packet did not draw, stays out of this
 * comparison. `passes` holds a person's word a drawn answer that passed, which changes no tally.
 * The tests are read again from the same solves and logged as the comparison's last report, with
 * what was settled and the labels themselves. Run again with the same labels it returns that
 * report. A comparison is settled once: other labels for one already settled are refused.
 *
 * A settling makes no solve.
 *
 * The comparison is read as its own report found it (`asReported`), so the labels settle the same
 * reading whether they come at once or after later comparisons have solved the same tasks.
 */
export function settleReading(
  log: string,
  id: string,
  labels: ReadonlyMap<string, Ruling>,
  passes: ReadonlyMap<string, PassLabel> = new Map(),
): Report {
  const before = read(log);
  const last = before.findLast((event) => event.kind === REPORTED && event.data.session === id)?.data;
  const report = reported(before, id);
  const fixed = fixedIn(before, id);
  if (last === undefined || report === null) throw new Error(`comparison ${id} has no report to settle`);
  if (report.settled !== null && report.settled !== UNSETTLED) {
    const was = { ...report.settled.labels, ...report.settled.passes };
    const given = new Map<string, string>([...labels, ...passes]);
    const other = [...new Set([...given.keys(), ...Object.keys(was)])].filter(
      (solve) => given.get(solve) !== was[solve],
    );
    if (other.length > 0) {
      throw new Error(
        `comparison ${id} is settled already, and these labels are not the ones it was settled on (${other.join(", ")}): a comparison is settled once`,
      );
    }
    return report;
  }
  if (report.scored === null || fixed === null) {
    throw new Error(
      `comparison ${id} reads ${report.reading} and compared nothing, so there is nothing to settle`,
    );
  }
  // A comparison that began with shorter budgets, as one begun before 11 October may have, reported
  // rows this source reads no longer, and the settled report would drop them in place of the report
  // the comparison began with.
  const began = startOf(before, id)?.budgets;
  if (Array.isArray(began) && began.length > 0) {
    throw new Error(
      `comparison ${id} began with ${String(began.length)} shorter budgets, which this source reads no longer: its report stands as it was written. Settle it from the commit it was made at`,
    );
  }
  const { aside, others } = toLabel(before, id);
  const known = new Set([...aside, ...others]);
  const stray = [...labels.keys()].find((solve) => !known.has(solve));
  if (stray !== undefined) throw new Error(`${stray} is no rejected answer of comparison ${id}`);
  const valid = new Set(passesIn(before, id));
  const unpassed = [...passes.keys()].find((solve) => !valid.has(solve));
  if (unpassed !== undefined) throw new Error(`${unpassed} is no answer that passed in comparison ${id}`);
  const versionOf = new Map(ranUnder(before).map((solve) => [solve.id, solve.under.task] as const));
  const defects = [...labels].flatMap(([solve, label]) => (label === DEFECT ? [solve] : []));
  const reason = "a person labelled the rejection a check defect";
  // A task a person refused since stays refused: its rejection keeps its label, and the task is
  // left out of this comparison as one set aside.
  const disputed = defects.flatMap((solve) => {
    const version = versionOf.get(solve) ?? "";
    return dispute(log, id, version, { solve, reason }) ? [version] : [];
  });
  const found = compared(read(log), fixed, labels);
  const settled: Report = {
    old: report.old,
    fresh: report.fresh,
    starter: report.starter,
    ...found,
    disputed: [...new Set([...report.disputed, ...disputed])],
    capped: report.capped,
    settled: {
      labelled: labels.size,
      defects: defects.length,
      disputed,
      restored: found.versions.filter((version) => report.aside.includes(version)),
      labels: Object.fromEntries(labels),
      passes: Object.fromEntries(passes),
    },
  };
  // The comparison's own terms are carried, so the settled report reads alone as the first one did.
  append(log, REPORTED, { ...last, ...asRecord(settled) });
  return settled;
}
