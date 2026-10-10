/**
 * A checkpoint: one comparison of a new harness with the reference harness, on held-out tasks. And
 * a round: a Builder session, then the checkpoint of the harness it left.
 *
 * A checkpoint is three steps over one log.
 * 1. Solving. Each task of the scored set is solved `solves` times under each of the two
 *    harnesses, all of it afresh. The scored set is the caller's, fixed before any solve
 *    (`scoredSet`), so no harness's results choose it. The harnesses take the first place in
 *    turn, task by task, so that neither has the quieter hours or the warmer cache.
 * 2. The comparison (`src/kernel/compare.ts`): every solve of the new harness paired with every
 *    solve of the reference one, a valid answer over one that is not, each task counted once, and
 *    the sign test over the tasks.
 * 3. The reading, logged as `comparison.reported`.
 *
 * What is fixed before the first solve. A comparison writes `comparison.started` with its
 * harnesses, its setting, its scored tasks, its solves a side, its level, the budgets it will be
 * read at and its dollar cap, so that what it compares is on record before any result is. One gone
 * on from its log goes on with the same tasks, and one asked for again on other terms is refused.
 * Every solve the comparison starts names it at its start, and a solve counts when it names the
 * comparison and ran under one of its harnesses and its setting. No other solve is counted, made
 * before it or beside it by another comparison: a condition names the host's code, which changes
 * between comparisons, and one frozen draw of the reference harness's solves would bias every
 * later comparison read against it (`docs/plan.md`, What we will not do).
 *
 * The Starter Built Harness is the reference harness until a step is promoted
 * (`src/solve/starter.ts`), and a comparison with it has nothing more to solve. Once the operator
 * has promoted another reference, the starter is a fixed lower reference and no side of the sign
 * test. It is then solved only when the comparison reads a step, to test that the step also holds
 * against it: a step needs at least as many wins as losses against the starter, and one with fewer
 * reads `below-starter`. The test is held to the starter only once every tallied task has its
 * solves under it; until then the reading is `starter-unread`, whether a kill, the cap or a
 * settling left it so.
 *
 * How each harness did by itself is in the report beside the test (`valid`): on how many tasks it
 * gave a valid answer in every solve, in some and in none, at the full limit and at each budget.
 * For the starter this is what the plan's first gate reads: where it is valid on nearly every
 * solve even at a short budget, the tasks leave a harness nothing to add (`docs/plan.md`, G0).
 *
 * `noise` reads the reference harness against itself beside the test (the plan's A/A comparison).
 * The reference harness is then solved twice as often. Its first solves of a task, in the order
 * they started, are the test's, and those against its later ones give a second tally: how often a
 * fixed budget splits two solves of one harness at random, which is the noise every comparison has
 * to exceed. It should read no step, and it decides nothing here. The later solves run after the
 * test's own are done, so that second tally also holds whatever the later hour moved.
 *
 * `budgets` reads the same solves at shorter budgets (`within`, `compare.ts`): a solve that used
 * more than a budget allows counts as no answer at it. The report holds the tally at each, and how
 * far the use of each unit moved between repeated solves of one harness on one task.
 *
 * `cap` is the comparison's dollar cap. Before each solve the dollars the log holds as billed for
 * the comparison are summed (`billedFor`): its own solves and their rulings, and in a round the
 * session's spend as well. The solve is not started when a reserve for it and for each solve still
 * running would take the sum past the cap. A lane that cannot start a solve while others are in
 * flight steps aside, since what they bill may be under their reserve; when none is in flight and
 * the next solve still cannot start, the cap is reached. A comparison the cap cuts short of its
 * test reads `not-scored` and is finished: its tally would be of the tasks that happened to come
 * first. One the cap cuts in the starter's solves has its test whole, and reports it as
 * `starter-unread`. A session is stopped by its own limits and not by the cap, which holds its
 * practice solves alone: none starts that the cap has no reserve for (`practiceLeft`, `tools.ts`).
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
 * (`withdrawn`), and no further solve of it is started. A rejection an earlier run of the
 * comparison left unruled, killed before its ruling or failed by its reader, is put to the Referee
 * when the comparison goes on.
 *
 * A checkpoint that wrote its report is finished, and run again it returns that report and does
 * nothing: topping up a set a dispute thinned, after the tallies could be seen, would be a second
 * look at the data. It also stops, to go on the same way, when the provider has stopped answering:
 * `SILENT` tasks in a row whose solve ended, after its reruns, with nothing written for it. A login
 * at its session limit does that to every solve in seconds.
 *
 * A round's session starts from the harness the caller names, which need not be the reference
 * harness: a Builder goes on from its latest harness, and the comparison is against the reference
 * one. The session is run once and read from the log whether it ran now or in an earlier run
 * (`sessionOnce`, `session.ts`), which is also how a session runs with no comparison after it. A
 * session cut at its wall or its turns is a whole session and is compared. One that left the
 * harness it started from, the reference harness itself, or one no solve can open, is reported as
 * no change.
 *
 * A held-out task is never diagnosed and its trace never shown: the Diagnoser's reading goes to
 * the Builder, and a reading of a scored solve would carry the task to it.
 *
 * Nothing here decides what happens next. `reading` (`compared`, `comparison.ts`) says how the
 * plan's rules read the tallies; the stop rule reads the reports (`src/kernel/reports.ts`), and
 * promotion and a next session are the operator's.
 *
 * What the log holds of a comparison, and how it is read back, is `comparison.ts` since
 * 10 October: its start, its counted solves, its rejections, its tallies and its report. This
 * file keeps what runs one and what it writes.
 */
import { type Budget, draw, UNITS } from "../kernel/compare.ts";
import { append, type LogEvent, read } from "../kernel/log.ts";
import { awaitingLabel, billedFor, type Cap, capHolds, exhausted } from "../kernel/reports.ts";
import { ranUnder, solvesIn } from "../kernel/solves.ts";
import { taskSets, taskStates } from "../kernel/task.ts";
import { asRecord, isString } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { asError, errorMessage } from "../meta/runtime-values.ts";
import { sameJsonValue } from "../meta/stable-json.ts";
import type { RefereeFinding, Ruling } from "../review/referee.ts";
import {
  asBudget,
  compared,
  DEFECT,
  EARNED,
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
  toLabel,
} from "./comparison.ts";
import { type BuildRequest, type Built, type Practised, sessionOnce } from "./session.ts";

/** A harness as a solve is handed it. */
export interface Kept {
  readonly dir: string;
  readonly digest: string;
}

/** What a comparison is made on, whoever asks for it. */
interface Terms {
  /** The Starter Built Harness: the fixed lower reference a step is also read against, once it is
   *  no longer the reference harness itself. */
  readonly starter: Kept;
  /** The scored set: held-out task versions, fixed before any solve (`scoredSet`). */
  readonly tasks: readonly string[];
  /** Counted solves of each task under each harness. */
  readonly solves: number;
  /** The sign test's level. */
  readonly level: number;
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
  /** Whether the reference harness is also read against itself, on solves of its own. */
  readonly noise?: boolean | undefined;
  /** The shorter budgets the comparison is also read at. */
  readonly budgets?: readonly Budget[] | undefined;
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

/** One solve still to run: a task version under one of the harnesses. */
interface Job {
  readonly task: string;
  readonly under: Kept;
}

/** A harness a comparison solves under, with the counted solves of a task it needs under it. */
interface Arm {
  readonly under: Kept;
  readonly needed: number;
}

/** Passes over what is still unsolved. A solve's own non-result is run again inside `solve`, so a
 *  second pass covers what outlasted that, and a task still short after it is reported short. */
const PASSES = 2;
/** Tasks in a row the provider wrote nothing for, at which the comparison stops and waits to be
 *  run again. Tasks and not solves: one task its provider refuses at the first turn is that task's
 *  fault, and is reported short. */
const SILENT = 3;
const TASK_STATE = "task.state";

/**
 * The tasks a comparison scores: `target` of the held-out tasks a log holds, or all of them where
 * it holds fewer, drawn by the contract's hash and nothing else (`draw`). The hash is fixed before
 * any task exists, so no result chooses the set, and a task written since takes a place by its own
 * rank and moves no other's. A task with no valid answer on record, after two comparisons that cut
 * no solve of it at a limit, is left out until a person has labelled it (`awaitingLabel`), and so
 * is one both harnesses answered in every solve of two comparisons under the setting, which can
 * only tie again (`exhausted`).
 */
export function scoredSet(events: readonly LogEvent[], target: number, contract: string): string[] {
  const aside = new Set([...awaitingLabel(events), ...exhausted(events)]);
  const held = taskSets(events).held.filter((version) => !aside.has(version));
  return draw(held, Math.min(target, held.length), contract);
}

/** The solves still to run: slot by slot over the tasks, the harnesses taking the first place in
 *  turn. `had` says how many counted solves a task has under a harness. */
function unsolvedJobs(
  tasks: readonly string[],
  arms: readonly Arm[],
  had: (task: string, digest: string) => number,
): Job[] {
  const jobs: Job[] = [];
  const slots = Math.max(0, ...arms.map(({ needed }) => needed));
  for (let slot = 0; slot < slots; slot += 1) {
    for (const [index, task] of tasks.entries()) {
      const turn = (index + slot) % arms.length;
      const order = [...arms.slice(turn), ...arms.slice(0, turn)];
      jobs.push(
        ...order.flatMap(({ under, needed }) =>
          slot < needed && had(task, under.digest) <= slot ? [{ task, under }] : [],
        ),
      );
    }
  }
  return jobs;
}

/** A whole number of at least `least`, which a count read from a command line may not be. */
function counts(value: number, least: number): boolean {
  return Number.isInteger(value) && value >= least;
}

/** Refuse, before a session or a solve is spent, tasks that could not be scored. A comparison gone
 *  on from its log is not asked again: its tasks were fixed at its start, and a person may have
 *  released or refused one since, which then leaves it (`withdrawn`). */
function refuseUnscorable(terms: Terms, log: string, practised: ReadonlySet<string>): void {
  if (terms.tasks.length === 0) {
    throw new Error(
      "no task to score: a comparison is asked for with at least one held-out task that waits for no label (tools/d2/prepare.ts)",
    );
  }
  const twice = terms.tasks.find((version, index) => terms.tasks.indexOf(version) !== index);
  if (twice !== undefined) throw new Error(`task ${twice} is listed twice among the tasks to score`);
  const seen = terms.tasks.find((version) => practised.has(version));
  if (seen !== undefined) {
    throw new Error(`task ${seen} is a practice task, and a round scores no task its session saw`);
  }
  // The draw leaves such a task out (`scoredSet`), and a name was the one way past that.
  const waiting = awaitingLabel(read(log)).find((version) => terms.tasks.includes(version));
  if (waiting !== undefined) {
    throw new Error(
      `task ${waiting} waits for a person's label, and is not scored until it has one: tools/d2/prepare.ts --keep or --infeasible`,
    );
  }
  const { states, held } = taskSets(read(log));
  // A task this comparison disputed in an earlier run of it is where that run left it.
  const unfit = terms.tasks.find((version) => !held.includes(version) && states.get(version) !== "disputed");
  if (unfit !== undefined) {
    const state = states.get(unfit);
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
  // A budget that names neither unit would read what the full limit reads under another name. One
  // named in prompts or CPU seconds, which were units until 2026-10-09, is such a budget here.
  if ((terms.budgets ?? []).some((budget) => Object.keys(asBudget(budget)).length === 0)) {
    throw new Error("a budget names turns or seconds, or both, each as a number");
  }
}

/**
 * Refuse the terms a comparison is asked for on: terms no comparison could be read on, and, for
 * one that has not begun, tasks that could not be scored. `practised` is what its session may
 * practise on, and empty for a checkpoint. A comparison that reported is asked nothing.
 *
 * A comparison asks this of itself before its first event. A command asks it before it records
 * anything, so that a refused command leaves the log as it was: until 2026-10-09 a round refused
 * for a mistyped task had recorded the campaign's setting first, and the corrected command was
 * then refused as another setting (the third review, row F44).
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
  if (state !== "held" && state !== "released") return false;
  append(log, TASK_STATE, { version, state: "disputed", session: id, ...found });
  return true;
}

/** What the provider said of a solve it wrote nothing for, or null: no output token in the solve's
 *  last attempt's record. A solve the provider cut after an hour's work holds thousands (the Sol
 *  rounds of 2026-10-08), and is a non-result the comparison solves on from. A solve whose start
 *  does not name the comparison is refused: no fold would count it, and the comparison would buy
 *  it again at every pass. */
function unanswered(log: string, id: string, { solve, ending }: Practised): string | null {
  const events = read(log);
  if (!solvesIn(events).some((each) => each.id === solve && each.start.comparison === id)) {
    throw new Error(
      `solve ${solve} does not name comparison ${id} at its start, so no reading would count it: the caller's solve hands the comparison on to its solve request`,
    );
  }
  if (ending.outcome !== "non-result" || ending.kind !== "provider") return null;
  const record = events.findLast(({ kind, data }) => kind === "solve.finished" && data.solve === solve);
  return asRecord(record?.data.tokens)?.output === 0 ? ending.reason : null;
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
  // The tasks this comparison disputed, and those a Referee's ruling found a check defect on, kept
  // beside the log so that a job does not fold the whole of it.
  const dropped = new Set(
    before.flatMap(({ kind, data }) =>
      kind === TASK_STATE && data.session === id && data.state === "disputed" && isString(data.version)
        ? [data.version]
        : [],
    ),
  );
  const defective = new Set(
    rejections(before, fixed, NO_LABELS).flatMap(({ task, ruling }) => (ruling === DEFECT ? [task] : [])),
  );
  const going = () =>
    thrown === null &&
    !kill.aborted &&
    !capped &&
    new Set([...dropped, ...defective]).size <= request.defects;
  const silent = new Set<string>();
  /** Put one rejected answer to the Referee, where one is seated. */
  const rule = async (solve: string, task: string): Promise<void> => {
    if (request.referee === undefined) return;
    try {
      if ((await request.referee(solve, task, kill)).ruling === DEFECT) defective.add(task);
    } catch (error) {
      // A rejection nobody ruled on sets its task aside, as one waiting for a person does.
      faults.push(`${solve}: ${errorMessage(error)}`);
    }
  };
  const run = async ({ task, under }: Job): Promise<void> => {
    const solved = await request.solve(task, under, id, kill);
    const { solve, ending } = solved;
    const why = unanswered(log, id, solved);
    if (why === null) silent.clear();
    else if (silent.add(task).size >= SILENT) {
      throw new Error(
        `the provider answered no solve of ${String(SILENT)} tasks in a row, so the comparison stops: ${why}. Run it again and it goes on from its log`,
      );
    }
    if (ending.outcome === "non-result" && ending.kind === "check" && !dropped.has(task)) {
      dropped.add(task);
      dispute(log, id, task, { solve, reason: "its own check could not run on an answer" });
    }
    // Only a rejected answer has anything to recompute: a solve its limits ended, or one that gave
    // no answer, is not valid with no ruling (`src/kernel/compare.ts`).
    if (ending.outcome === "fail" && ending.kind === "rejected") await rule(solve, task);
  };
  /** Run `jobs`, `concurrency` at a time, until they are done or the comparison is no longer going. */
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
          await run(job);
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
  /**
   * Solve `tasks` under `arms` until each has its solves, and say whether the comparison goes on.
   * It throws what stopped the solves, if a solve or a kill did.
   */
  const solveAll = async (tasks: readonly string[], arms: readonly Arm[]): Promise<boolean> => {
    for (let pass = 0; pass < PASSES && going(); pass += 1) {
      const had = new Map<string, number>();
      for (const { under } of solvesUnder(read(log), fixed).filter(({ counts: own }) => own)) {
        const key = `${under.task} ${under.harness}`;
        had.set(key, (had.get(key) ?? 0) + 1);
      }
      await drain(unsolvedJobs(tasks, arms, (task, digest) => had.get(`${task} ${digest}`) ?? 0));
    }
    if (thrown !== null) throw thrown;
    if (kill.aborted) throw new Error("the comparison was killed; run it again and it goes on from its log");
    return going();
  };
  /** Put to the Referee the rejections an earlier run of the comparison left unruled: it was killed
   *  between a solve's end and its ruling, or its reader failed. */
  const ruleLeft = async (): Promise<void> => {
    const held = new Set(taskSets(before).held);
    const unruled = rejections(before, fixed, NO_LABELS).filter(
      ({ task, ruling }) => ruling === null && held.has(task),
    );
    for (let at = 0; at < unruled.length && going(); at += request.concurrency) {
      const lane = unruled.slice(at, at + request.concurrency);
      await Promise.all(lane.map(({ solve, task }) => rule(solve, task)));
    }
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
  const terms = {
    old: request.old.digest,
    fresh: request.fresh.digest,
    starter: request.starter.digest,
    setting: request.setting,
    solves: request.solves,
    level: request.level,
    noise: request.noise === true,
    budgets: (request.budgets ?? []).map(asBudget),
    cap: request.cap === undefined ? null : { ...request.cap },
    ...keyIfDefined("prediction", request.prediction),
  };
  const was = startOf(read(log), id);
  if (was === undefined) append(log, STARTED, { session: id, ...terms, tasks: [...request.tasks] });
  const fixed = fixedIn(read(log), id);
  if (fixed === null) throw new Error(`comparison ${id} wrote no start the log reads back`);
  const moved = Object.entries(terms).flatMap(([name, value]) =>
    was === undefined || sameJsonValue(was[name], value) ? [] : [name],
  );
  if (moved.length > 0) {
    throw new Error(
      `comparison ${id} began on other terms (${moved.join(", ")}), and its solves so far were made for those: run it as it began, or under another id`,
    );
  }
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
    // The eight truss rounds of 2026-10-08 asked for no scored task, and their logs could not say so.
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
 * checkpoint after several sessions, and with `noise` its gate G2.
 */
export async function checkpoint(request: CheckpointRequest): Promise<Report> {
  const { log, id, old, fresh, starter, solves } = request;
  // A comparison that reported is finished, and run again it says what it said.
  const before = reported(read(log), id);
  if (before !== null) return before;
  if (old.digest === fresh.digest) {
    throw new Error(
      `a comparison sets two harnesses against each other, and both sides are ${old.digest}; the reference harness is read against itself beside a comparison, with noise`,
    );
  }
  refuseTerms(request, { log, id, practised: new Set() });
  const fixed = begin(request);
  const work = floor(request, fixed);
  const head = { old: fixed.old, fresh: fixed.fresh, starter: fixed.starter };
  const asked = { ...request, tasks: fixed.tasks };
  const beside = () => ({ broken: null, reviewFaults: work.faults });
  const disputed = () => fixed.tasks.filter((task) => taskStates(read(log)).get(task) === "disputed");
  /** The report of a comparison that stopped before its test could be read: on its cap, or its
   *  defects. It names the tasks a rejection had set aside by then, the check defects among them. */
  const stopped = (): Report => {
    const open = new Set(
      rejections(read(log), fixed, NO_LABELS).flatMap(({ task, ruling }) =>
        ruling === EARNED ? [] : [task],
      ),
    );
    const told: Report = {
      ...head,
      ...NOTHING,
      disputed: disputed(),
      aside: fixed.tasks.filter((task) => open.has(task)),
      capped: work.capped(),
      reading: work.capped() ? "not-scored" : "check-defects",
    };
    return write(asked, told, beside());
  };
  const arms = [
    { under: old, needed: fixed.noise ? 2 * solves : solves },
    { under: fresh, needed: solves },
  ];
  await work.ruleLeft();
  if (!(await work.solveAll(fixed.tasks, arms))) return stopped();
  let found = compared(log, fixed, NO_LABELS);
  if (found.reading === "starter-unread") {
    // The test cleared its level, so the starter is solved on the tallied tasks to hold it to.
    // Whatever stops those solves, the test stands and is reported: a cap that cut the starter
    // short leaves the reading where it was, unread against the starter.
    await work.solveAll(found.versions, [{ under: starter, needed: solves }]);
    found = compared(log, fixed, NO_LABELS);
  }
  const told = { ...head, ...found, disputed: disputed(), capped: work.capped(), settled: null };
  return write(asked, told, beside());
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
 * Settle a comparison's reading on a person's labels of its rejections, and write its report once
 * more.
 *
 * `labels` holds a ruling a solve, and a person's label stands over the Referee's ruling of the
 * same rejection. Every rejection that set a task aside must carry one. A task whose rejections are
 * then all earned is restored to the tally. One labelled a check defect disputes its task, which
 * leaves every comparison from then on. One labelled unclear leaves its task out of this
 * comparison. The tests are read again from the same solves and logged as the comparison's last
 * report, with what was settled and the labels themselves. Run again with the same labels it
 * returns that report. A comparison is settled once: other labels for one already settled are
 * refused, and so is a settling with no label at all, which would close the comparison to the
 * labels still to come.
 *
 * A settling makes no solve. Where the labels leave a test that clears its level and the starter
 * was never solved for it, the reading is `starter-unread`, and the new harness is compared with
 * the starter in a comparison of its own.
 *
 * The comparison is read as its own report found it (`asReported`), so the labels settle the same
 * reading whether they come at once or after later comparisons have solved the same tasks.
 */
export function settleReading(log: string, id: string, labels: ReadonlyMap<string, Ruling>): Report {
  const before = read(log);
  const last = before.findLast((event) => event.kind === REPORTED && event.data.session === id)?.data;
  const report = reported(before, id);
  const fixed = fixedIn(before, id);
  if (last === undefined || report === null) throw new Error(`comparison ${id} has no report to settle`);
  if (report.settled !== null) {
    const was: Readonly<Record<string, Ruling | undefined>> = report.settled.labels ?? {};
    const other = [...new Set([...labels.keys(), ...Object.keys(was)])].filter(
      (solve) => labels.get(solve) !== was[solve],
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
  // A budget in a unit that is read no longer would come back with no unit, which reads the full
  // limit under no name, and the settled report would hold that in place of the budget the
  // comparison began with (the third review, row F46).
  const began = startOf(before, id)?.budgets;
  const dropped = [
    ...new Set((Array.isArray(began) ? began : []).flatMap((budget) => Object.keys(asRecord(budget) ?? {}))),
  ].filter((unit) => !UNITS.some((known) => known === unit));
  if (dropped.length > 0) {
    throw new Error(
      `comparison ${id} began with a budget in ${dropped.join(" and ")}, which this source reads no longer (${UNITS.join(" and ")} are read): its report stands as it was written. Settle it from the commit it was made at`,
    );
  }
  const { aside, others } = toLabel(before, id);
  const known = new Set([...aside, ...others]);
  const stray = [...labels.keys()].find((solve) => !known.has(solve));
  if (stray !== undefined) throw new Error(`${stray} is no rejected answer of comparison ${id}`);
  const open = aside.filter((solve) => !labels.has(solve));
  if (open.length > 0) {
    throw new Error(
      `${String(open.length)} of ${String(aside.length)} rejections that set a task aside carry no label (earned, check-defect or unclear): ${open.join(", ")}`,
    );
  }
  if (labels.size === 0) {
    throw new Error(
      `comparison ${id} has no rejection that set a task aside, and no label is given: there is nothing to settle`,
    );
  }
  const versionOf = new Map(ranUnder(before).map((solve) => [solve.id, solve.under.task] as const));
  const defects = [...labels].flatMap(([solve, label]) => (label === DEFECT ? [solve] : []));
  const reason = "a person labelled the rejection a check defect";
  // A task a person refused since stays refused: its rejection keeps its label, and the task is
  // left out of this comparison as one set aside.
  const disputed = defects.flatMap((solve) => {
    const version = versionOf.get(solve) ?? "";
    return dispute(log, id, version, { solve, reason }) ? [version] : [];
  });
  const found = compared(log, fixed, labels);
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
    },
  };
  // The comparison's own terms are carried, so the settled report reads alone as the first one did.
  append(log, REPORTED, { ...last, ...asRecord(settled) });
  return settled;
}
