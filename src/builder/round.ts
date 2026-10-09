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
 * `starter-unread`. A session is stopped by its own limits and not by the cap.
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
 * one. The session is read from the log whether it ran now or in an earlier run. One that started
 * and never finished is refused, since its harness is gone and a second session under one id would
 * be a second try. So is one that was killed or that crashed: what it froze is half a session's
 * work. A session cut at its wall or its turns is a whole session and is compared. One that left
 * the harness it started from, the reference harness itself, or one no solve can open, is
 * reported as no change.
 *
 * A held-out task is never diagnosed and its trace never shown: the Diagnoser's reading goes to
 * the Builder, and a reading of a scored solve would carry the task to it.
 *
 * Nothing here decides what happens next. `reading` says how the plan's rules read the tallies;
 * the stop rule reads the reports (`src/kernel/reports.ts`), and promotion and a next session are
 * the operator's.
 */
import {
  type Budget,
  draw,
  type Paired,
  pairsOf,
  scored,
  type Sides,
  spread,
  UNITS,
  within,
} from "../kernel/compare.ts";
import { conditionsOf, settingId } from "../kernel/condition.ts";
import { append, type LogEvent, read } from "../kernel/log.ts";
import { awaitingLabel, billedFor, unsolved, whole } from "../kernel/reports.ts";
import { ranUnder, solvesIn } from "../kernel/solves.ts";
import { taskSets, taskStates } from "../kernel/task.ts";
import { asRecord, isBoolean, isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import { join } from "../meta/path.ts";
import { asError, errorMessage } from "../meta/runtime-values.ts";
import { sameJsonValue } from "../meta/stable-json.ts";
import type { RefereeFinding, Ruling } from "../review/referee.ts";
import { openHarness } from "../solve/harness.ts";
import { type BuildRequest, type Built, build, type Practised } from "./session.ts";

/** A harness as a solve is handed it. */
export interface Kept {
  readonly dir: string;
  readonly digest: string;
}

/** A dollar cap: the billed dollars a comparison may hold, and what each solve is held at before
 *  it starts. */
export interface Cap {
  readonly dollars: number;
  readonly reserve: number;
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
  readonly builder?: (request: BuildRequest) => Promise<Built>;
}

/**
 * How the plan's rules read a comparison. A step is the new harness's test against the reference
 * one clearing its level, with at least as many wins as losses against the starter; the same test
 * with fewer wins than losses there is named apart, since the new harness then beat the reference
 * and is still worse than no harness. `starter-unread` is a test that clears its level with a
 * tallied task the starter has not its solves on, which a settling, a kill or the cap can leave:
 * the new harness is then compared with the starter in a comparison of its own. A comparison
 * that tallied no task is named apart too: it tested nothing, and `no-step` would say a test was
 * made and found no gain. The eight truss rounds of 2026-10-08 scored no task and read `no-step`
 * eight times. `check-defects` is the comparison stopped on its check defects, and `no-change` a
 * session that left nothing new to compare.
 */
export type Reading =
  | "step"
  | "no-step"
  | "below-starter"
  | "starter-unread"
  | "not-scored"
  | "check-defects"
  | "no-change";

/** One test's tally and its p. */
type Tested = ReturnType<typeof scored>;

/**
 * How each harness did by itself over the tallied tasks: entry k counts the tasks on which k of its
 * counted solves gave a valid answer, so with two solves a side the three entries are the tasks
 * valid in none, in one and in both. No test is read off it. It says where a budget leaves a
 * harness: valid nearly everywhere, the tasks cannot tell two harnesses apart; valid on about half
 * its solves, the fewest tasks tie by chance (`docs/plan.md`, Phase 0 and Statistical power).
 */
export interface Valid {
  readonly old: readonly number[];
  readonly fresh: readonly number[];
}

export interface Report {
  /** The reference harness. */
  readonly old: string;
  /** The digest of the new harness; null when a session left none to compare. Beside a `broken`
   *  in the logged report, it is the last state the session practised with. */
  readonly fresh: string | null;
  readonly starter: string;
  /** The new harness against the reference one, over `versions`: the tally and its test. `unsolved`
   *  counts the tied tasks no counted solve of either harness answered validly. The other ties are
   *  between valid answers, which is the share the plan's Phase 3 turns on. Null when nothing was
   *  compared. */
  readonly scored: (Tested & { readonly unsolved: number }) | null;
  /** Each harness by itself at the full limit, over `versions`. Null when nothing was compared, and
   *  in a report written before 2026-10-09. */
  readonly valid: Valid | null;
  /** The same test at each budget the comparison fixed, in the order it named them, with each
   *  harness by itself at that budget. */
  readonly budgets: readonly (Budget & Tested & { readonly valid?: Valid })[];
  /** How far the use of turns, CPU seconds and seconds moved between repeated solves of one harness
   *  on one task. Null when nothing was compared. */
  readonly spread: ReturnType<typeof spread> | null;
  /** The mean billed dollars of a counted solve under each harness; null where the log holds none. */
  readonly billed: { readonly old: number | null; readonly fresh: number | null } | null;
  /** The new harness against the starter, over the tallied tasks the starter has its solves on.
   *  Null until a step is read against the reference harness, where the starter is one of the two
   *  sides, and when nothing was compared. */
  readonly against: Tested | null;
  /** The reference harness against itself, where the comparison asked for it. */
  readonly noise: Tested | null;
  /** The tally were every rejection that set a task aside to stand; null when no task is set aside. */
  readonly counted: Tested | null;
  /** The task versions tallied. */
  readonly versions: readonly string[];
  /** Task versions left out as disputed for good: a check could not run, or a person labelled a
   *  rejection a check defect. */
  readonly disputed: readonly string[];
  /** Task versions set aside on a rejection that is not ruled a true fail. */
  readonly aside: readonly string[];
  /** Task versions left out as short of `solves` counted solves under a harness. */
  readonly short: readonly string[];
  /** Task versions that left the held-out set while the comparison ran: released for practice, or
   *  refused by a person as infeasible. */
  readonly withdrawn: readonly string[];
  /** Whether the dollar cap cut the comparison short: of its test, where nothing is tallied, or of
   *  the starter's solves, where the test stands and the reading is `starter-unread`. */
  readonly capped: boolean;
  readonly reading: Reading;
  /** What a person's labels settled, in the report `settleReading` writes after the comparison's
   *  own: how many rejections were labelled, how many of them a check defect, the tasks those
   *  disputed, and the tasks the labels restored to the tally. */
  readonly settled: {
    readonly labelled: number;
    readonly defects: number;
    readonly disputed: readonly string[];
    readonly restored: readonly string[];
    /** The labels themselves, by solve: the log's record of what a person said of each answer.
     *  A settling logged before 2026-10-09 holds none. */
    readonly labels?: Readonly<Record<string, Ruling>>;
  } | null;
}

/** What a person is asked to label before a comparison's reading is settled. */
export interface ToLabel {
  /** Rejections that set a task aside: ruled a check defect or unclear, or not ruled. */
  readonly aside: readonly string[];
  /** Every other rejected answer of the comparison: the ones ruled a true fail. */
  readonly others: readonly string[];
}

/** A comparison as its start fixes it: its id, the three harnesses by digest and how it is read. */
interface Fixed {
  readonly id: string;
  readonly old: string;
  readonly fresh: string;
  readonly starter: string;
  readonly setting: string;
  readonly solves: number;
  readonly level: number;
  readonly noise: boolean;
  readonly budgets: readonly Budget[];
  readonly tasks: readonly string[];
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
const STARTED = "comparison.started";
const REPORTED = "comparison.reported";
const BUILD_STARTED = "build.started";
/** A report's fields, as its event carries them beside the comparison's own terms. */
const REPORT_KEYS = [
  "old",
  "fresh",
  "starter",
  "scored",
  "valid",
  "budgets",
  "spread",
  "billed",
  "against",
  "noise",
  "counted",
  "versions",
  "disputed",
  "aside",
  "short",
  "withdrawn",
  "capped",
  "reading",
  "settled",
] as const satisfies readonly (keyof Report)[];
const TASK_STATE = "task.state";
const NOTHING_TO_LABEL: ToLabel = { aside: [], others: [] };
const DEFECT = "check-defect";
const EARNED = "earned";
const NO_LABELS: ReadonlyMap<string, Ruling> = new Map();
const NOTHING = {
  scored: null,
  valid: null,
  budgets: [],
  spread: null,
  billed: null,
  against: null,
  noise: null,
  counted: null,
  versions: [],
  disputed: [],
  aside: [],
  short: [],
  withdrawn: [],
  capped: false,
  settled: null,
} as const;

/**
 * The tasks a comparison scores: `target` of the held-out tasks a log holds, or all of them where
 * it holds fewer, drawn by the contract's hash and nothing else (`draw`). The hash is fixed before
 * any task exists, so no result chooses the set, and a task written since takes a place by its own
 * rank and moves no other's. A task no harness answered validly in two comparisons in a row is
 * left out until a person has labelled it (`awaitingLabel`).
 */
export function scoredSet(events: readonly LogEvent[], target: number, contract: string): string[] {
  const awaiting = new Set(awaitingLabel(events));
  const held = taskSets(events).held.filter((version) => !awaiting.has(version));
  return draw(held, Math.min(target, held.length), contract);
}

/**
 * Why a round will not go on with session `id` from this log, or null when it never started, or
 * ended whole. A launcher asks before it starts the round, and a stop to say what it cut.
 */
export function spent(events: readonly LogEvent[], id: string): string | null {
  const mine = events.filter(({ data }) => data.session === id);
  if (!mine.some(({ kind }) => kind === BUILD_STARTED)) return null;
  const ended = mine.findLast(({ kind }) => kind === "build.finished")?.data.ended;
  if (ended === undefined) {
    return `session ${id} started and never finished; a round does not run a second session under one id`;
  }
  return ended === "killed" || ended === "crashed"
    ? `session ${id} ${ended === "killed" ? "was killed" : "crashed"}, so what it froze is not compared; a round under a new session id starts again`
    : null;
}

/** What session `id` left, from the log: undefined when it never ran, and otherwise the harness to
 *  compare, null when it left none, with why when what it left does not open. A session whose last
 *  state does not open leaves the last state it practised with, when it has one (`session.ts`), so
 *  a harness and a `broken` may come back together. */
async function left(events: readonly LogEvent[], request: BuildRequest, parent: string) {
  const mine = events.filter(({ data }) => data.session === request.id);
  const started = mine.find(({ kind }) => kind === BUILD_STARTED)?.data;
  const finished = mine.findLast(({ kind }) => kind === "build.finished")?.data;
  if (started === undefined) return undefined;
  if (started.parent !== parent) {
    throw new Error(`session ${request.id} started from another harness than ${request.parent}`);
  }
  const why = spent(events, request.id);
  if (why !== null) throw new Error(why);
  const broken = isString(finished?.broken) ? finished.broken : null;
  if (finished?.changed !== true || !isString(finished.harness)) return { kept: null, broken };
  const dir = join(request.states, finished.harness);
  if ((await openHarness(dir)).digest !== finished.harness) {
    throw new Error(`${dir} is not the harness session ${request.id} froze`);
  }
  return { kept: { dir, digest: finished.harness }, broken };
}

/** The log as comparison `id` is read once it has reported: up to its own first report. What comes
 *  after is other comparisons' and a person's: a later one adds solves of the same tasks, and a
 *  task may be released or disputed since. A comparison with no report yet is read whole. */
function asReported(events: readonly LogEvent[], id: string): LogEvent[] {
  const own = events.findIndex(({ kind, data }) => kind === REPORTED && data.session === id);
  return own === -1 ? [...events] : events.slice(0, own + 1);
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

/** Each harness by itself over `pairs`: the tasks by how many of its solves were valid. */
function validOf(pairs: readonly Paired[], solves: number): Valid {
  const census = (side: "old" | "fresh") => {
    const tasks = Array.from({ length: solves + 1 }, () => 0);
    for (const pair of pairs) {
      const valid = pair[side].filter(Boolean).length;
      tasks[valid] = (tasks[valid] ?? 0) + 1;
    }
    return tasks;
  };
  return { old: census("old"), fresh: census("fresh") };
}

/** The last report the log holds for comparison `id`, its own or its settling, or null: a
 *  comparison that reported is finished. */
function reported(events: readonly LogEvent[], id: string): Report | null {
  const found = events.findLast((event) => event.kind === REPORTED && event.data.session === id)?.data;
  if (found === undefined) return null;
  // A report written before a field existed reads as that field's absence. Until 2026-10-09
  // `counted` was a reading, where it is a tally now.
  const data: JsonObject = { ...NOTHING, ...found, counted: asRecord(found.counted) };
  // SAFETY: only `checkpoint`, `round` and `settleReading` write this event, from the report each returns.
  return Object.fromEntries(REPORT_KEYS.map((key) => [key, data[key]])) as unknown as Report;
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
  const { cap } = terms;
  const dollars = cap === undefined ? [] : [cap.dollars, cap.reserve];
  if (!dollars.every((amount) => Number.isFinite(amount) && amount > 0)) {
    throw new Error("a cap and its reserve are dollars, and both are more than nothing");
  }
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

/** The test-side solves a comparison may count: the ones whose start names it, under one of its
 *  harnesses and its setting. Each says whether it ended in a pass or a fail and so counts. */
function solvesUnder(events: readonly LogEvent[], fixed: Fixed) {
  const settings = new Map(
    [...conditionsOf(events)].map(([condition, ran]) => [condition, settingId(ran)] as const),
  );
  const harnesses = new Set([fixed.old, fixed.fresh, fixed.starter]);
  return ranUnder(events).flatMap((solve) =>
    solve.under.side === "test" &&
    harnesses.has(solve.under.harness) &&
    solve.start.comparison === fixed.id &&
    settings.get(solve.condition) === fixed.setting
      ? [{ ...solve, counts: solve.ending?.outcome === "pass" || solve.ending?.outcome === "fail" }]
      : [],
  );
}

/**
 * The rejected answers of a comparison, under any of its harnesses, each with its task version and
 * what stands of it: a person's label where `labels` holds one, the Referee's last ruling
 * otherwise, and null where nobody has ruled.
 */
function rejections(events: readonly LogEvent[], fixed: Fixed, labels: ReadonlyMap<string, Ruling>) {
  const ruled = new Map(
    events.flatMap(({ kind, data }) =>
      kind === "referee.finding" && isString(data.solve) && isString(data.ruling)
        ? [[data.solve, data.ruling] as const]
        : [],
    ),
  );
  return solvesUnder(events, fixed).flatMap(({ id, ending, under }) =>
    ending?.outcome === "fail" && ending.kind === "rejected"
      ? [{ solve: id, task: under.task, ruling: labels.get(id) ?? ruled.get(id) ?? null }]
      : [],
  );
}

/**
 * The comparison of `fixed.tasks`, read from the log as comparison `id` found it: the new harness
 * against the reference one over the tasks that have their solves under both and no rejection that
 * sets them aside, the same tasks at each budget, against the starter where it was solved, and
 * the reference harness against itself where that was asked for, with how the plan reads them.
 */
function compared(log: string, fixed: Fixed, labels: ReadonlyMap<string, Ruling>) {
  const all = read(log);
  const events = asReported(all, fixed.id);
  // A dispute stands whenever it was made: a settling's own come after the comparison's report.
  const states = taskStates(all);
  // A task a person released or refused while the comparison ran is no held-out task any more. It
  // is left out and named, since a comparison that could not report would lose every solve it paid.
  const held = new Set(taskSets(events).held);
  const scorable = fixed.tasks.filter((task) => states.get(task) !== "disputed");
  const live = scorable.filter((task) => held.has(task));
  const open = new Set(
    rejections(events, fixed, labels).flatMap(({ task, ruling }) => (ruling === EARNED ? [] : [task])),
  );
  const sides: Sides = { old: fixed.old, fresh: fixed.fresh, setting: fixed.setting, comparison: fixed.id };
  const pairsUnder = (other: Sides) => whole(pairsOf(events, live, other).pairs, fixed.solves);
  const first = pairsUnder(sides);
  const kept = (pairs: readonly Paired[]) => pairs.filter(({ task }) => !open.has(task));
  const pairs = kept(first.pairs);
  const tallied = new Set(pairs.map(({ task }) => task));
  // The starter is a second opponent only where it is neither side of the test, and the reference
  // harness's later solves a second sample only where the comparison asked for them.
  const guarded = fixed.starter !== fixed.old && fixed.starter !== fixed.fresh;
  const base = guarded
    ? pairsUnder({ ...sides, old: fixed.starter }).pairs.filter(({ task }) => tallied.has(task))
    : [];
  const tested = scored(pairs);
  const against = base.length === 0 ? null : scored(base);
  /** How the plan reads the two tests together. */
  const reading = (): Reading => {
    if (pairs.length === 0) return "not-scored";
    if (tested.p > fixed.level) return "no-step";
    // The starter holds the test only once it has its solves on every tallied task: a tally of
    // the tasks it happened to reach first would be a fraction's.
    if (guarded && base.length < pairs.length) return "starter-unread";
    return against !== null && against.wins < against.losses ? "below-starter" : "step";
  };
  const mean = (side: "old" | "fresh") => {
    const billed = pairs.flatMap((pair) => (pair.used?.[side] ?? []).flatMap((used) => used.billed ?? []));
    return billed.length === 0 ? null : billed.reduce((sum, each) => sum + each, 0) / billed.length;
  };
  return {
    scored: { ...tested, unsolved: pairs.filter(unsolved).length },
    valid: validOf(pairs, fixed.solves),
    budgets: fixed.budgets.map((budget) => {
      const cut = within(pairs, budget);
      return { ...budget, ...scored(cut), valid: validOf(cut, fixed.solves) };
    }),
    spread: spread(pairs),
    billed: { old: mean("old"), fresh: mean("fresh") },
    against,
    noise: fixed.noise
      ? scored(kept(pairsUnder({ ...sides, fresh: fixed.old, halves: fixed.solves }).pairs))
      : null,
    counted: pairs.length === first.pairs.length ? null : scored(first.pairs),
    versions: pairs.map(({ task }) => task),
    aside: live.filter((task) => open.has(task)),
    short: live.filter((task) => first.short.includes(task)),
    withdrawn: scorable.filter((task) => !held.has(task)),
    reading: reading(),
  };
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

/** The start of comparison `id` as the log holds it. */
function startOf(events: readonly LogEvent[], id: string): JsonObject | undefined {
  return events.find(({ kind, data }) => kind === STARTED && data.session === id)?.data;
}

/** What comparison `id` fixed at its start, read back from the log; null where it never began. */
function fixedIn(events: readonly LogEvent[], id: string): Fixed | null {
  const { old, fresh, starter, setting, solves, level, noise, budgets, tasks } = startOf(events, id) ?? {};
  return isString(old) &&
    isString(fresh) &&
    isString(starter) &&
    isString(setting) &&
    isNumber(solves) &&
    isNumber(level)
    ? {
        id,
        old,
        fresh,
        starter,
        setting,
        solves,
        level,
        noise: isBoolean(noise) && noise,
        budgets: Array.isArray(budgets) ? budgets.map(asBudget) : [],
        tasks: Array.isArray(tasks) ? tasks.filter(isString) : [],
      }
    : null;
}

/** A budget as a log holds it: the units it names, each a number. */
function asBudget(value: unknown): Record<string, number> {
  const named = asRecord(value) ?? {};
  return Object.fromEntries(
    UNITS.flatMap((unit) => {
      const most = named[unit];
      return isNumber(most) ? [[unit, most] as const] : [];
    }),
  );
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
  refuseUnreadable(request);
  if (startOf(read(log), id) === undefined) refuseUnscorable(request, log, new Set());
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
  const parent = (await openHarness(session.parent)).digest;
  refuseUnreadable(terms);
  if (startOf(read(log), id) === undefined) {
    refuseUnscorable(terms, log, new Set(session.tasks.map(({ version }) => version)));
  }

  // The session is read from the log whether it ran now or in an earlier run of this round.
  if ((await left(read(log), session, parent)) === undefined) await (builder ?? build)(session);
  const built = await left(read(log), session, parent);
  if (built === undefined) throw new Error(`session ${id} ran and left no record in the log`);
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

/** The rejections of comparison `id` a person may label, from its log: none when it has no report
 *  that compared something. */
export function toLabel(events: readonly LogEvent[], id: string): ToLabel {
  const report = reported(events, id);
  const fixed = fixedIn(events, id);
  if (report === null || fixed === null || report.scored === null) return NOTHING_TO_LABEL;
  const found = asReported(events, id);
  const states = taskStates(found);
  const mine = rejections(found, fixed, NO_LABELS).filter(({ task }) => states.get(task) !== "disputed");
  const pick = (aside: boolean) =>
    mine.flatMap(({ solve, ruling }) => ((ruling !== EARNED) === aside ? [solve] : []));
  return { aside: pick(true), others: pick(false) };
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
