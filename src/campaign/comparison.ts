/**
 * A comparison as the log holds it: its start (`Fixed`, from `comparison.started`), the test-side
 * solves it may count, its rejections and what stands of each, its tallies and reading (`compared`),
 * and its report (`Report`, from `comparison.reported`). Nothing here writes an event. `round.ts`
 * runs a comparison, writes its start and report, and settles it on a person's labels; its head
 * comment is the full account of what is fixed before the first solve, how a solve ends and how a
 * rejection counts.
 *
 * The readers live here and the moves stay in `round.ts`, so each fold over the log has one owner
 * and the commands that read a comparison without running one (`tools/d2/round.ts`,
 * `tools/d2/checkpoint.ts`, `tools/d2/settle.ts`) read it through this module. Coverage is read at
 * the first report, apart from any tally, so a stopped comparison can be reviewed while its labels
 * cannot turn its completed prefix into a test. Passes a person labelled wrong are read from
 * history, as settlement reads them (`failWrongPasses`).
 */
import {
  detectable,
  power,
  type ObjectiveRule,
  objectiveRuleIn,
  type Measures,
  pointsOf,
  type Paired,
  pairsOf,
  scored,
  readsStep,
  type Tally,
  UNMEASURED,
  unsolved,
  informative,
  wholePoints,
} from "../kernel/compare.ts";
import { conditionsOf, settingId } from "../kernel/condition.ts";
import { failWrongPasses, familiesOf, wrongPasses } from "../kernel/history.ts";
import type { LogEvent } from "../kernel/log.ts";
import { poolOf } from "../kernel/reports.ts";
import { passed, ranUnder, rejected, rulingsOf, solvesIn } from "../kernel/solves.ts";
import { taskSets, taskStates } from "../kernel/task.ts";
import { parseJsonAs } from "../meta/json-runtime.ts";
import { asRecord, isNumber, isString, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import { median } from "../meta/tally.ts";
import type { Ruling } from "../referee/referee.ts";
import { type Worth, worthOf } from "./climb.ts";

/**
 * A `step` requires the new harness to clear the fixed level against the reference on its task
 * scores (`readsStep`, `compare.ts`). A comparison that tallied no task is `not-scored`: it tested
 * nothing, and calling it `no-step` would claim that a test found no gain. `check-defects` marks a
 * comparison stopped for check defects, and `no-change` a session that left no new harness to
 * compare. Old reports may hold readings no longer written (`regressed`, `below-starter`,
 * `starter-unread`); nothing reads them now.
 */
type Reading = "step" | "no-step" | "not-scored" | "check-defects" | "no-change";
/** One test's tally, each task's score and its p; some older reports also hold each task's score
 *  without the bill, which their step was read on (`scoresIn`, `compare.ts`). */
type Tested = ReturnType<typeof scored> & { readonly unbilled?: readonly number[] };
/** One of the two sets a comparison fixes at its start (`retained`, `Fixed`): the tasks that
 *  entered it, which are its denominator, those of them set aside, and its tally and test. `of`
 *  names the task of each difference, which the oldest reports lack. */
type Entered = Tested & {
  readonly tasks: readonly string[];
  readonly aside: readonly string[];
  readonly of?: readonly string[];
};
/**
 * How each harness did by itself over the tallied tasks: entry k counts the tasks on which k of its
 * counted solves gave a valid answer, so with two solves a side the three entries are the tasks
 * valid in none, in one and in both. No test is read off it. It shows where the exam leaves a
 * harness: valid nearly everywhere, the tasks cannot tell two harnesses apart; valid on about half
 * its solves, the fewest tasks tie by chance, which is where a test has most power.
 */
interface Valid {
  readonly old: readonly number[];
  readonly fresh: readonly number[];
  /** The tasks informative for each harness (`informative`), which room is read by (`roomOf`). */
  readonly informative: { readonly old: number; readonly fresh: number };
}
export interface Report {
  /** The reference harness. */
  readonly old: string;
  /** The digest of the new harness; null when a session left none to compare. Beside a `broken`
   *  in the logged report, it is the last state the session practised with. */
  readonly fresh: string | null;
  readonly starter: string;
  /** The new harness against the reference, over `versions`: the tally and its test. `unsolved`
   *  counts the tied tasks no counted solve of either harness answered validly; the other ties are
   *  between valid answers. The step is read on the scores without the bill (`readsStep`), beside
   *  `detectable` and `falseRate`, the test's `power` at one half, which never exceeds the level.
   *  Null when nothing was compared. */
  readonly scored:
    | (Tested & {
        readonly unsolved: number;
        readonly detectable?: number | null;
        readonly falseRate?: number;
      })
    | null;
  /** Each harness by itself, over `versions`. Null when nothing was compared, and in the oldest
   *  reports. */
  readonly valid: Valid | null;
  /** The mean billed dollars of a counted solve under each harness; null where the log holds none. */
  readonly billed: { readonly old: number | null; readonly fresh: number | null } | null;
  /** The scored tasks not exhausted. Null when nothing was compared. */
  readonly frontier: (Entered & { readonly detectable?: number | null; readonly falseRate?: number }) | null;
  /** The exhausted tasks the draw keeps, read in the one test with the frontier and reported apart,
   *  so a loss on them shows; `unmeasured` where none was tallied, never no loss (`compare.ts`). */
  readonly retained: Entered | typeof UNMEASURED | null;
  /** Each family's tallies on the two sets, from the same rows, so they sum to the whole. They show
   *  concentration; a family name can hide correlated tasks, and they establish no independence. */
  readonly families: Readonly<Record<string, { readonly frontier: Tally }>> | null;
  /** The last comparison of its kind under the same reference (`overlapOf`), and the draws' overlap. */
  readonly overlap: { readonly with: string; readonly tasks: readonly string[] } | null;
  /** The A/A control: the reference against itself on halves of its own solves, mirrored in time,
   *  where it holds an even number of solves of a task. `flips` is how often two of its solves of a
   *  task disagree; `detectable` is the least share of its untied tasks one half must win for the
   *  test at the level to detect it four times in five, which says how much a no-step reading can
   *  show. Older reports without unbilled scores are read on their scores as they stand. */
  readonly noise:
    | (Tested & {
        readonly flips: number | null;
        /** Absent in the oldest reports. */
        readonly detectable?: number | null;
      })
    | null;
  /** The tally were every rejection that set a task aside to stand; null when no task is set aside. */
  readonly counted: Tested | null;
  /** The task versions tallied. */
  readonly versions: readonly string[];
  /** Task versions left out as disputed for good: a check could not run on the reference's answer,
   *  or a person labelled a rejection a check defect. */
  readonly disputed: readonly string[];
  /** Task versions set aside on a rejection that is not ruled a true fail. */
  readonly aside: readonly string[];
  /** Task versions left out as short of `solves` counted solves under a harness. */
  readonly short: readonly string[];
  /** Tallied task versions with a solve a solver flagged as malformed, counted as its side's fail. */
  readonly flagged: readonly string[];
  /** Task versions that left the held-out set while the comparison ran: released for practice, or
   *  refused by a person as infeasible. */
  readonly withdrawn: readonly string[];
  /** Whether the dollar cap cut the comparison short of its test, where nothing is tallied. */
  readonly capped: boolean;
  readonly reading: Reading;
  /** The objective the comparison fixed. Null where the check program declares none, and in the
   *  oldest reports. */
  readonly objective: ObjectiveRule | null;
  /** The points each measure gave the tallied tasks together (`pointsOf`), positive for the new
   *  harness; null where nothing was tallied, and absent from older reports. */
  readonly points: Measures | null;
  /** By task, the median turns each harness's valid answers took, null where it gave none: reported
   *  beside each pair, and read by no tally. */
  readonly turns: Readonly<
    Record<string, { readonly old: number | null; readonly fresh: number | null }>
  > | null;
  /** Where it reads a step, the cost bar as the log stood (`worthOf`): the epoch's attempts.
   *  Reported, and deciding no admission. */
  readonly worth: Worth | null;
  /** `unsettled` in the comparison's own report until a person answers its packet (`settle.ts`),
   *  which no promotion waits for. After that, the report `settleReading` writes holds what the
   *  labels settled: how many rejections were labelled, how many of them a check defect, the tasks
   *  those disputed, the tasks the labels restored to the tally, and the labels themselves, by
   *  solve. A stopped comparison has a packet without a test; null where no fixed comparison
   *  began. */
  readonly settled:
    | typeof UNSETTLED
    | {
        readonly labelled: number;
        readonly defects: number;
        readonly disputed: readonly string[];
        readonly restored: readonly string[];
        readonly labels: Readonly<Record<string, Ruling>>;
        readonly passes: Readonly<Record<string, PassLabel>>;
      }
    | null;
}
/** What a person is asked to label before a comparison's reading is settled. */
interface ToLabel {
  /** Rejections that set a task aside: ruled a check defect or unclear, or not ruled. */
  readonly aside: readonly string[];
  /** Every other rejected answer of the comparison: the ones ruled a true fail. */
  readonly others: readonly string[];
}
/** A comparison as its start fixes it: its id, the three harnesses by digest and how it is read. */
export interface Fixed {
  readonly id: string;
  readonly old: string;
  readonly fresh: string;
  readonly starter: string;
  readonly setting: string;
  readonly solves: number;
  readonly level: number;
  readonly tasks: readonly string[];
  /** The scored tasks fixed at the start as retained, from the exhausted ones and an earlier
   *  epoch's (`scoredSet`, `round.ts`); the others are the frontier. */
  readonly retained: readonly string[];
  /** The objective two valid answers are compared by, where the check program declares one. */
  readonly objective: ObjectiveRule | undefined;
}

export const STARTED = "comparison.started";
export const REPORTED = "comparison.reported";
/** What a comparison's report says of its packet until a person has answered it. */
export const UNSETTLED = "unsettled";
/** A person's words on an answer that passed: a valid answer by the rules; not one, and the checks
 *  passed it; unclear. A settled pass labelled wrong is its side's fail (`wrongAsFailed`). */
export const PASS_LABELS = ["sound", "wrong", "unclear"] as const;
export type PassLabel = (typeof PASS_LABELS)[number];
const NOTHING_TO_LABEL: ToLabel = { aside: [], others: [] };
export const DEFECT = "check-defect";
export const EARNED = "earned";
export const NO_LABELS: ReadonlyMap<string, Ruling> = new Map();
export const NOTHING = {
  scored: null,
  frontier: null,
  retained: null,
  families: null,
  overlap: null,
  valid: null,
  billed: null,
  noise: null,
  counted: null,
  versions: [],
  disputed: [],
  aside: [],
  short: [],
  flagged: [],
  withdrawn: [],
  capped: false,
  settled: null,
  objective: null,
  points: null,
  turns: null,
  worth: null,
} as const;

/** A report's fields, as its event carries them beside the comparison's own terms. */
const REPORT_KEYS = [
  "old",
  "fresh",
  "starter",
  "reading",
  // SAFETY: `NOTHING` is a literal, so its keys are the ones it names.
  ...(Object.keys(NOTHING) as (keyof typeof NOTHING)[]),
] satisfies readonly (keyof Report)[];

/** The log as comparison `id` is read once it has reported: up to its own first report. What comes
 *  after is other comparisons' and a person's: a later one adds solves of the same tasks, and a
 *  task may be released or disputed since. A comparison with no report yet is read whole. */
function asReported(events: readonly LogEvent[], id: string): LogEvent[] {
  const own = events.findIndex(({ kind, data }) => kind === REPORTED && data.session === id);
  return own === -1 ? [...events] : events.slice(0, own + 1);
}

/** Each harness by itself over `pairs`: the tasks by how many of its solves were valid, and those
 *  informative for it (`informative`), a task it never answered among them where a valid answer to
 *  it is on record (`feasible`, `poolOf`), and one it answered alike where an author's answer on
 *  record is better by the objective (`bests`). */
function validOf(
  pairs: readonly Paired[],
  solves: number,
  { feasible: knownValidAnswers, bests }: Pick<ReturnType<typeof poolOf>, "feasible" | "bests">,
): Valid {
  const census = (side: "old" | "fresh") => {
    const tasks = Array.from({ length: solves + 1 }, () => 0);
    for (const pair of pairs) {
      const valid = pair[side].filter(Boolean).length;
      tasks[valid] = (tasks[valid] ?? 0) + 1;
    }
    return tasks;
  };
  const informativeFor = (side: "old" | "fresh") =>
    pairs.filter((pair) => informative(pair, side, knownValidAnswers, bests)).length;
  return {
    old: census("old"),
    fresh: census("fresh"),
    informative: { old: informativeFor("old"), fresh: informativeFor("fresh") },
  };
}

/** By task, the median turns each side's valid answers took (`Report.turns`), null where none. */
function turnsOf(events: readonly LogEvent[], pairs: readonly Paired[]): NonNullable<Report["turns"]> {
  const turnsBySolve = new Map(solvesIn(events).map((solve) => [solve.id, solve.end?.turns]));
  const side = (pair: Paired, named: "old" | "fresh") =>
    median(
      (pair.solves?.[named] ?? [])
        .flatMap((id, at) => (pair[named][at] === true ? [turnsBySolve.get(id)] : []))
        .filter(isNumber),
    );
  return Object.fromEntries(
    pairs.map((pair) => [pair.task, { old: side(pair, "old"), fresh: side(pair, "fresh") }]),
  );
}

/** The last report the log holds for comparison `id`, its own or its settling, or null: a
 *  comparison that reported is finished. */
export function reported(events: readonly LogEvent[], id: string): Report | null {
  const found = events.findLast((event) => event.kind === REPORTED && event.data.session === id)?.data;
  if (found === undefined) return null;
  // A report written before a field existed reads as that field's absence. The oldest reports hold
  // `counted` as a reading rather than a tally, and it reads as absent.
  const data: JsonObject = { ...NOTHING, ...found, counted: asRecord(found.counted) };
  // Only `checkpoint`, `round` (`round.ts`) and `settleReading` (`settle.ts`) write this event, from the report each returns.
  return parseJsonAs<Report>(Object.fromEntries(REPORT_KEYS.map((key) => [key, data[key] ?? null])));
}

/** The test-side solves a comparison may count: the ones whose start names it, under one of its
 *  harnesses and its setting. Each says whether it ended in a pass or a fail, a flag among the
 *  fails, and so counts (`passed`). */
export function solvesUnder(events: readonly LogEvent[], fixed: Fixed) {
  const settings = new Map(
    [...conditionsOf(events)].map(([condition, ran]) => [condition, settingId(ran)] as const),
  );
  const harnesses = new Set([fixed.old, fixed.fresh, fixed.starter]);
  return ranUnder(events).flatMap((solve) =>
    solve.under.side === "test" &&
    harnesses.has(solve.under.harness) &&
    solve.start.comparison === fixed.id &&
    settings.get(solve.condition) === fixed.setting
      ? [{ ...solve, counts: passed(solve) !== null }]
      : [],
  );
}

/**
 * The rejected answers of a comparison, under any of its harnesses, each with its task version and
 * what stands of it: a person's label where `labels` holds one, the Referee's last ruling
 * otherwise, and null where nobody has ruled.
 */
export function rejections(events: readonly LogEvent[], fixed: Fixed, labels: ReadonlyMap<string, Ruling>) {
  const ruled = rulingsOf(events);
  return solvesUnder(events, fixed).flatMap(({ id, ending, under }) =>
    rejected(ending)
      ? [{ solve: id, task: under.task, ruling: labels.get(id) ?? ruled.get(id) ?? null }]
      : [],
  );
}

/**
 * The two sets a comparison's start fixed, as its tallied `pairs` fill them, which the step reads
 * as one: the frontier and the retained tasks, each with the tasks that entered it and those of
 * `aside` in it, and each family's tallies on both, from the same rows. A retained set no task
 * was tallied in is unmeasured, never no loss.
 */
function setsOf(
  events: readonly LogEvent[],
  fixed: Fixed,
  pairs: readonly Paired[],
  aside: readonly string[],
) {
  const kept = new Set(fixed.retained);
  const named = familiesOf(events);
  const familyOf = (task: string) => named.get(task) ?? "unnamed";
  const part = (set: "frontier" | "retained") =>
    pairs.filter(({ task }) => kept.has(task) === (set === "retained"));
  const tallied = { frontier: part("frontier"), retained: part("retained") };
  const setOf = (set: keyof typeof tallied): Entered => {
    const within = (task: string) => kept.has(task) === (set === "retained");
    // `of` names the task of each difference, as the report holds it.
    const of = tallied[set].map(({ task }) => task);
    return { tasks: fixed.tasks.filter(within), aside: aside.filter(within), ...scored(tallied[set]), of };
  };
  const families = [...new Set(fixed.tasks.map(familyOf))].map((family) => {
    const { wins, losses, ties } = scored(tallied.frontier.filter(({ task }) => familyOf(task) === family));
    return [family, { frontier: { wins, losses, ties } }] as const;
  });
  return {
    frontier: setOf("frontier"),
    retained: tallied.retained.length > 0 ? setOf("retained") : UNMEASURED,
    families: Object.fromEntries(families),
  };
}

/**
 * The fixed draw's completion and review facts at its first report. Pairs use the same counted
 * solves as the test, without scoring them. Later solves and task-state changes cannot alter this
 * descriptive coverage.
 */
export function coverageOf(
  all: readonly LogEvent[],
  fixed: Fixed,
  labels: ReadonlyMap<string, Ruling> = NO_LABELS,
) {
  const events = asReported(all, fixed.id);
  const states = taskStates(events);
  // A task a person released or refused while the comparison ran is no held-out task any more. It
  // is left out and named, since a comparison that could not report would lose every solve it paid.
  const held = new Set(taskSets(events).held);
  const scorable = fixed.tasks.filter((task) => states.get(task) !== "disputed");
  const live = scorable.filter((task) => held.has(task));
  const open = new Set(
    rejections(events, fixed, labels).flatMap(({ task, ruling }) => (ruling === EARNED ? [] : [task])),
  );
  const sides = {
    old: fixed.old,
    fresh: fixed.fresh,
    setting: fixed.setting,
    comparison: fixed.id,
    objective: fixed.objective,
  };
  const first = pairsOf(events, live, sides, fixed.solves);
  return {
    short: first.short,
    aside: live.filter((task) => open.has(task)),
    disputed: fixed.tasks.filter((task) => states.get(task) === "disputed"),
    withdrawn: scorable.filter((task) => !held.has(task)),
    pairs: first.pairs,
  };
}

/** Read the test from complete pairs, excluding both set-aside rejections and later disputes. */
export function compared(all: readonly LogEvent[], fixed: Fixed, labels: ReadonlyMap<string, Ruling>) {
  const events = asReported(all, fixed.id);
  const coverage = coverageOf(all, fixed, labels);
  // A dispute stands whenever it was made: a settling's own come after the comparison's report.
  const states = taskStates(all);
  const scorable = (task: string) => states.get(task) !== "disputed";
  const first = coverage.pairs.filter(({ task }) => scorable(task));
  const open = new Set(coverage.aside);
  const kept = (pairs: readonly Paired[]) => pairs.filter(({ task }) => !open.has(task));
  const pairs = kept(first);
  const aside = coverage.aside.filter(scorable);
  const sets = setsOf(all, fixed, pairs, aside);
  /** The reference against itself on halves of the test's own solves (`Sides`, `halves`), over the
   *  tallied tasks and no other, so the A/A control and the tally count the same tasks. */
  const againstItself = () =>
    kept(
      pairsOf(
        events,
        pairs.map(({ task }) => task),
        {
          old: fixed.old,
          fresh: fixed.old,
          setting: fixed.setting,
          comparison: fixed.id,
          objective: fixed.objective,
          halves: "mirrored",
        },
        fixed.solves / 2,
      ).pairs,
    );
  // The A/A control: where the reference's solves of a task are even, they are split into halves
  // mirrored in time. At two a side, the default, it is one solve against the other, the earlier one
  // first on every other task (`pairsOf`), which reads the flip rate and a step between halves alike.
  const mirroredOf = (halves: readonly Paired[]) => {
    const aa = scored(halves);
    return { ...aa, flips: flipsOf(halves), detectable: detectable(aa.differences, fixed.level) };
  };
  const mirrored = fixed.solves % 2 === 0 ? mirroredOf(againstItself()) : null;
  const tested = scored(pairs);
  const stepped = readsStep(tested.differences, fixed.level);
  const reading: Reading = pairs.length === 0 ? "not-scored" : stepped ? "step" : "no-step";
  return {
    scored: {
      ...tested,
      unsolved: pairs.filter(unsolved).length,
      detectable: detectable(tested.differences, fixed.level),
      falseRate: power(tested.differences, 0.5, fixed.level),
    },
    frontier: sets.frontier,
    retained: sets.retained,
    families: sets.families,
    overlap: overlapOf(all, fixed),
    valid: validOf(pairs, fixed.solves, poolOf(events)),
    billed: { old: billedMean(pairs, "old"), fresh: billedMean(pairs, "fresh") },
    noise: mirrored,
    counted: pairs.length === first.length ? null : scored(first),
    versions: pairs.map(({ task }) => task),
    aside,
    short: coverage.short.filter(scorable),
    flagged: flaggedIn(events, pairs),
    withdrawn: coverage.withdrawn.filter(scorable),
    reading,
    turns: turnsOf(events, pairs),
    // The cost bar, read where there is a step: printed, and deciding no admission.
    worth: reading === "step" ? worthOf(events, fixed.id) : null,
    objective: fixed.objective ?? null,
    points: pairs.length === 0 ? null : pointsIn(pairs),
  };
}

/** The points each measure gave `pairs` together (`pointsOf`), to the whole point (`wholePoints`). */
function pointsIn(pairs: readonly Paired[]): Measures {
  const each = pairs.map(pointsOf);
  const sum = (measure: keyof Measures) =>
    wholePoints(each.reduce((total, points) => total + points[measure], 0));
  return { validity: sum("validity"), objective: sum("objective") };
}

/** The mean billed dollars of a counted solve under one side of `pairs`, or null where none billed. */
function billedMean(pairs: readonly Paired[], side: "old" | "fresh"): number | null {
  const billed = pairs.flatMap((pair) => (pair.used?.[side] ?? []).flatMap((used) => used.billed ?? []));
  return billed.length === 0 ? null : billed.reduce((sum, each) => sum + each, 0) / billed.length;
}

/** The tasks of `pairs` a solve of either side flagged as malformed (`submit`). */
function flaggedIn(events: readonly LogEvent[], pairs: readonly Paired[]): string[] {
  const flags = new Set(
    solvesIn(events).flatMap((solve) => (solve.ending?.outcome === "flagged" ? [solve.id] : [])),
  );
  return pairs.flatMap(({ task, solves }) =>
    [...(solves?.old ?? []), ...(solves?.fresh ?? [])].some((solve) => flags.has(solve)) ? [task] : [],
  );
}

/** How often two of a harness's solves of one task disagree on validity, over every two of its
 *  solves of each task, the tasks weighed alike: null where none was tallied. */
function flipsOf(pairs: readonly Paired[]): number | null {
  const each = pairs.map(({ old, fresh }) => {
    const solves = [...old, ...fresh];
    const valid = solves.filter(Boolean).length;
    return (valid * (solves.length - valid)) / ((solves.length * (solves.length - 1)) / 2);
  });
  return each.length === 0 ? null : each.reduce((sum, one) => sum + one, 0) / each.length;
}

/** The comparison of the same kind under the same reference that began last before `fixed`, and
 *  the intersection of the two initial draws; null where none did. The kind is a promotion attempt
 *  or a starter comparison, so a candidate scored on tasks an earlier candidate drew names that
 *  attempt, though the test counts those tasks as fresh draws. */
export function overlapOf(events: readonly LogEvent[], fixed: Fixed) {
  const began = events.findIndex(({ kind, data }) => kind === STARTED && data.session === fixed.id);
  const kindOf = (fresh: JsonValue | undefined) => fresh === fixed.starter;
  const before = events
    .slice(0, Math.max(0, began))
    .findLast(
      ({ kind, data }) =>
        kind === STARTED && data.old === fixed.old && kindOf(data.fresh) === kindOf(fixed.fresh),
    );
  if (before === undefined || !isString(before.data.session)) return null;
  const drawnThen = new Set(Array.isArray(before.data.tasks) ? before.data.tasks.filter(isString) : []);
  return { with: before.data.session, tasks: fixed.tasks.filter((task) => drawnThen.has(task)) };
}

/**
 * `events` and `labels` with each answer that passed and a person labelled wrong read as a
 * rejection ruled earned: that side's fail, as an earned rejection is. A pass labelled sound or
 * unclear is read as it was.
 */
export function wrongAsFailed(
  events: readonly LogEvent[],
  labels: ReadonlyMap<string, Ruling>,
  passes: Readonly<Record<string, JsonValue>>,
): { events: readonly LogEvent[]; labels: Map<string, Ruling> } {
  const wrong = wrongPasses(passes);
  return {
    events: failWrongPasses(events, wrong),
    labels: new Map<string, Ruling>([...labels, ...[...wrong].map((solve) => [solve, EARNED] as const)]),
  };
}

/**
 * Comparison `id`'s reading with its packet's labels in place of the verdicts they overturn, beside
 * the reading it was decided on: a rejected answer labelled a check defect read as a valid answer,
 * an answer that passed labelled wrong as a true fail, a rejection labelled earned as a true fail
 * and one labelled unclear left aside. It is read as the comparison's own report found it, before
 * its settling disputed anything. Null until it is settled. A decision that flips means its packet
 * was too small to stand on; it is reported, and no move reads it. The flip is read against the
 * same solves without labels under this tree's rule (`unlabelled`), since a report recorded under
 * an older rule may read otherwise by today's. A comparison whose first report has no score has no
 * decided test to swap.
 */
export function swapped(
  events: readonly LogEvent[],
  id: string,
): { decided: Reading; unlabelled: Reading; swapped: Reading; scored: Tested } | null {
  const own = asReported(events, id);
  const settled = reported(events, id)?.settled;
  const fixed = fixedIn(events, id);
  const original = reported(own, id);
  const decided = original?.reading;
  if (
    fixed === null ||
    original?.scored === null ||
    decided === undefined ||
    settled === undefined ||
    settled === null ||
    settled === UNSETTLED
  ) {
    return null;
  }
  const defects = new Set(Object.keys(settled.labels).filter((solve) => settled.labels[solve] === DEFECT));
  const failed = wrongAsFailed(own, new Map(Object.entries(settled.labels)), settled.passes);
  const swappedIn = failed.events.map((event) =>
    event.kind === "solve.finished" && isString(event.data.solve) && defects.has(event.data.solve)
      ? { ...event, data: { ...event.data, ending: { outcome: "pass" } } }
      : event,
  );
  const { labels } = failed;
  const found = compared(swappedIn, fixed, labels);
  const unlabelled = compared(own, fixed, NO_LABELS).reading;
  return { decided, unlabelled, swapped: found.reading, scored: found.scored };
}

/** What the operator predicted of comparison `id` before its first solve, or null where they
 *  predicted nothing. */
export function predicted(events: readonly LogEvent[], id: string): string | null {
  const said = startOf(events, id)?.prediction;
  return isString(said) ? said : null;
}

/** The start of comparison `id` as the log holds it. */
export function startOf(events: readonly LogEvent[], id: string): JsonObject | undefined {
  return events.find(({ kind, data }) => kind === STARTED && data.session === id)?.data;
}

/** What comparison `id` fixed at its start, read back from the log; null where it never began. */
export function fixedIn(events: readonly LogEvent[], id: string): Fixed | null {
  const start = startOf(events, id) ?? {};
  // Some old starts also hold a trigger for a retired two-stage rule, which is read past.
  const { old, fresh, starter, setting, solves, level, tasks, retained } = start;
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
        tasks: Array.isArray(tasks) ? tasks.filter(isString) : [],
        retained: Array.isArray(retained) ? retained.filter(isString) : [],
        objective: objectiveRuleIn(start),
      }
    : null;
}

/** The answers that passed in comparison `id`: its own solves that ended in a pass. */
export function passesIn(events: readonly LogEvent[], id: string): string[] {
  return solvesIn(events).flatMap((solve) =>
    solve.start.comparison === id && passed(solve) === true ? [solve.id] : [],
  );
}

/** The rejections of comparison `id` a person may label: a fixed start and a report are required,
 *  whether or not the comparison reached its test. */
export function toLabel(events: readonly LogEvent[], id: string): ToLabel {
  const report = reported(events, id);
  const fixed = fixedIn(events, id);
  if (report === null || fixed === null) return NOTHING_TO_LABEL;
  const found = asReported(events, id);
  const states = taskStates(found);
  const undisputed = rejections(found, fixed, NO_LABELS).filter(
    ({ task }) => states.get(task) !== "disputed",
  );
  const pick = (set: "aside" | "others") =>
    undisputed.flatMap(({ solve, ruling }) => ((ruling !== EARNED) === (set === "aside") ? [solve] : []));
  return { aside: pick("aside"), others: pick("others") };
}
