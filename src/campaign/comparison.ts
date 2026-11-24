/**
 * Pure log folds for a comparison: its fixed start terms (`Fixed`, from `comparison.started`),
 * eligible test-side solves, rejection verdicts, tallies and hypothesis-test readings (`compared`),
 * and reported outcomes (`Report`, from `comparison.reported`). This module writes no events;
 * `round.ts` executes comparisons, appends starts and reports, and handles human settlement.
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
import { settingId } from "../kernel/condition.ts";
import { failWrongPasses, familiesOf, wrongPasses } from "../kernel/history.ts";
import { eventsOf, type LogEvent } from "../kernel/log.ts";
import { poolOf } from "../kernel/reports.ts";
import {
  countedSolves,
  passed,
  ranUnder,
  rejected,
  rulingsOf,
  type Solve,
  solvesIn,
} from "../kernel/solves.ts";
import { taskSets, taskStates } from "../kernel/task.ts";
import { parseJsonAs } from "../meta/json-runtime.ts";
import { asRecord, isNumber, isString, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import { median } from "../meta/tally.ts";
import type { PassLabel } from "../referee/agreement.ts";
import type { Ruling } from "../referee/referee.ts";
import { type Worth, worthOf } from "./climb.ts";

/**
 * Outcome classification for a comparison:
 * - `step`: the candidate harness cleared the fixed significance level against the reference on
 *   per-task scores (`readsStep`, `compare.ts`).
 * - `no-step`: at least one task was tallied, but the test did not clear the significance level.
 * - `not-scored`: no task was tallied (distinct from `no-step`, which claims a null test result).
 * - `check-defects`: halted due to check defects.
 * - `no-change`: a Builder session produced no new harness to compare.
 * Legacy reports may contain retired readings (`regressed`, `below-starter`, `starter-unread`).
 */
type Reading = "step" | "no-step" | "not-scored" | "check-defects" | "no-change";
/** Tally, per-task score differences, and p-value for a single test; legacy reports may also carry
 *  `unbilled` scores on which the step was evaluated (`scoresIn`, `compare.ts`). */
type Tested = ReturnType<typeof scored> & { readonly unbilled?: readonly number[] };
/** One of the two task partitions fixed at comparison start (`retained`, `Fixed`): the entered
 *  denominator tasks, the subset set aside, and its tally and test. `of` lists the task version
 *  corresponding to each difference (absent in the oldest reports). */
type Entered = Tested & {
  readonly tasks: readonly string[];
  readonly aside: readonly string[];
  readonly of?: readonly string[];
};
/**
 * Per-harness validity histogram over tallied tasks: entry `k` counts tasks on which `k` counted
 * solves produced a valid answer (for two solves per side, entries represent 0, 1, and 2 valid
 * solves). Used diagnostically rather than for hypothesis testing: tasks solved almost everywhere
 * cannot separate harnesses, whereas tasks solved roughly half the time minimise ties and maximise
 * statistical power.
 */
interface Valid {
  readonly old: readonly number[];
  readonly fresh: readonly number[];
  /** Number of tasks informative for each harness (`informative`), used by `roomOf`. */
  readonly informative: { readonly old: number; readonly fresh: number };
}
export interface Report {
  /** Reference harness digest. */
  readonly old: string;
  /** Candidate harness digest, or null when a session produced no candidate. Alongside a `broken`
   *  field in the logged report, this is the last state the session practised on. */
  readonly fresh: string | null;
  readonly starter: string;
  /** Overall comparison of candidate against reference across `versions`. `unsolved` counts tied
   *  tasks where neither harness produced a valid answer (remaining ties are between valid answers).
   *  The step is evaluated on unbilled scores (`readsStep`), reported alongside `detectable` and
   *  `falseRate` (`power` at 0.5, bounded above by the significance level). Null when nothing was
   *  compared. */
  readonly scored:
    | (Tested & {
        readonly unsolved: number;
        readonly detectable?: number | null;
        readonly falseRate?: number;
      })
    | null;
  /** Per-harness validity histograms over `versions` (null when uncompared or in legacy reports). */
  readonly valid: Valid | null;
  /** Mean billed cost in dollars per counted solve for each harness, or null when unbilled. */
  readonly billed: { readonly old: number | null; readonly fresh: number | null } | null;
  /** Non-exhausted scored tasks (null when nothing was compared). */
  readonly frontier: (Entered & { readonly detectable?: number | null; readonly falseRate?: number }) | null;
  /** Exhausted tasks retained in the draw to detect regressions; scored jointly with the frontier
   *  and reported separately, or `unmeasured` when none was tallied (`compare.ts`). */
  readonly retained: Entered | typeof UNMEASURED | null;
  /** Per-family frontier tallies derived from the same rows to expose concentration; shared family
   *  names can hide correlated tasks and do not establish independence. */
  readonly families: Readonly<Record<string, { readonly frontier: Tally }>> | null;
  /** Most recent prior comparison of the same kind under the same reference (`overlapOf`) and the
   *  shared tasks between their initial draws. */
  readonly overlap: { readonly with: string; readonly tasks: readonly string[] } | null;
  /** Empirical A/A control: the reference compared against itself across time-mirrored halves of
   *  its own solves when `solves` is even. `flips` is the per-task validity disagreement rate;
   *  `detectable` is the minimum win share detectable at 80% power. Legacy reports without unbilled
   *  scores are read on their stored scores. */
  readonly noise:
    | (Tested & {
        readonly flips: number | null;
        /** Absent in the oldest reports. */
        readonly detectable?: number | null;
      })
    | null;
  /** Counterfactual tally if every set-aside rejection were counted as a failure; null when no task
   *  was set aside. */
  readonly counted: Tested | null;
  /** Task versions included in the tally. */
  readonly versions: readonly string[];
  /** Task versions permanently excluded as disputed (check failure on reference answer or human
   *  `check-defect` label). */
  readonly disputed: readonly string[];
  /** Task versions set aside due to an unresolved or non-earned rejection. */
  readonly aside: readonly string[];
  /** Task versions excluded for having fewer than `solves` counted solves on either side. */
  readonly short: readonly string[];
  /** Tallied task versions with at least one solve flagged as malformed (counted as a side failure). */
  readonly flagged: readonly string[];
  /** Task versions removed from the held-out pool during the comparison (released to practice or
   *  marked infeasible by the operator). */
  readonly withdrawn: readonly string[];
  /** Whether the dollar cap truncated the comparison before scoring. */
  readonly capped: boolean;
  readonly reading: Reading;
  /** Objective rule fixed at comparison start, or null if none was declared (or in legacy reports). */
  readonly objective: ObjectiveRule | null;
  /** Aggregate points contributed by each measure across tallied tasks (`pointsOf`), positive for
   *  the candidate; null when untallied or absent in legacy reports. */
  readonly points: Measures | null;
  /** Per-task median turn counts for valid answers on each side (null if none valid); descriptive
   *  only and excluded from scoring. */
  readonly turns: Readonly<
    Record<string, { readonly old: number | null; readonly fresh: number | null }>
  > | null;
  /** Epoch cost evaluation (`worthOf`) recorded when the comparison reads a step; descriptive only. */
  readonly worth: Worth | null;
  /** Settlement state: `unsettled` until a human completes the review packet (`settle.ts`), which
   *  does not block promotion. Once settled, records label counts, defects, disputed and restored
   *  tasks, and per-solve rejection and pass labels. Null when no fixed comparison started. */
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
/** Rejections queued for human labelling during settlement. */
interface ToLabel {
  /** Rejections that set a task aside (ruled `check-defect` or `unclear`, or unruled). */
  readonly aside: readonly string[];
  /** Remaining rejections in the comparison (ruled `earned`). */
  readonly others: readonly string[];
}
/** Immutable comparison terms recorded at `comparison.started`. */
export interface Fixed {
  readonly id: string;
  readonly old: string;
  readonly fresh: string;
  readonly starter: string;
  readonly setting: string;
  readonly solves: number;
  readonly level: number;
  readonly tasks: readonly string[];
  /** Subset of `tasks` fixed at start as retained (exhausted or from prior epochs, `scoredSet` in
   *  `round.ts`); the complement forms the frontier. */
  readonly retained: readonly string[];
  /** Objective rule used to compare valid answers, when declared by the check program. */
  readonly objective: ObjectiveRule | undefined;
}

export const STARTED = "comparison.started";
export const REPORTED = "comparison.reported";
/** Sentinel stored in `Report.settled` until human settlement completes. */
export const UNSETTLED = "unsettled";
const NOTHING_TO_LABEL: ToLabel = { aside: [], others: [] };
export const DEFECT = "check-defect";
export const EARNED = "earned";
type Labels = ReadonlyMap<string, Ruling>;
export const NO_LABELS: Labels = new Map();
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

/** Report keys persisted in `comparison.reported` events alongside comparison terms. */
const REPORT_KEYS = [
  "old",
  "fresh",
  "starter",
  "reading",
  // SAFETY: `NOTHING` is a literal, so its keys are the ones it names.
  ...(Object.keys(NOTHING) as (keyof typeof NOTHING)[]),
] satisfies readonly (keyof Report)[];

const reportedIndex = (events: readonly LogEvent[], id: string): number =>
  eventsOf(events, REPORTED).find(({ event }) => event.data.session === id)?.index ?? -1;

/** Slice `events` up to and including the first report for comparison `id` so later comparisons or
 *  task-state changes do not alter its reading; returns `events` unchanged if unreported or at end. */
function asReported(events: readonly LogEvent[], id: string): readonly LogEvent[] {
  const own = reportedIndex(events, id);
  return own === -1 || own === events.length - 1 ? events : events.slice(0, own + 1);
}

/** Build per-harness validity histograms and informative task counts over `pairs`, accounting for
 *  known feasible tasks (`feasible`, `poolOf`) and author best objective values (`bests`). */
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

/** Compute per-task median turn counts for valid answers on each side (`Report.turns`). */
function turnsOf(solves: readonly Solve[], pairs: readonly Paired[]): NonNullable<Report["turns"]> {
  if (pairs.length === 0) return {};
  const turnsBySolve = new Map(solves.map((solve) => [solve.id, solve.end?.turns]));
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

/** Return the most recent report recorded for comparison `id` (initial or settled), or null. */
export function reported(events: readonly LogEvent[], id: string): Report | null {
  const found = eventsOf(events, REPORTED).findLast(({ event }) => event.data.session === id)?.event.data;
  if (found === undefined) return null;
  // Default missing fields for backwards compatibility; legacy reports stored `counted` as a string
  // reading rather than a tally object, so coerce non-records to null.
  const data: JsonObject = { ...NOTHING, ...found, counted: asRecord(found.counted) };
  // Only `checkpoint`, `round` (`round.ts`) and `settleReading` (`settle.ts`) write this event, from the report each returns.
  return parseJsonAs<Report>(Object.fromEntries(REPORT_KEYS.map((key) => [key, data[key] ?? null])));
}

/** Return test-side solves eligible for comparison `fixed` (matching comparison id, harness, and
 *  setting), annotated with whether each solve yielded a countable pass or fail (`passed`). */
export function solvesUnder(events: readonly LogEvent[], fixed: Fixed, upTo = events.length - 1) {
  const harnesses = new Set([fixed.old, fixed.fresh, fixed.starter]);
  const own = countedSolves(events, upTo).filter(({ start }) => start.comparison === fixed.id);
  return ranUnder(events, own, upTo).flatMap((solve) =>
    solve.under.side === "test" &&
    harnesses.has(solve.under.harness) &&
    settingId(solve.under) === fixed.setting
      ? [{ ...solve, counts: passed(solve) !== null }]
      : [],
  );
}

/**
 * Return all rejected answers in comparison `fixed`, paired with their task version and standing
 * verdict: human label from `labels` if present, otherwise the latest Referee ruling, or null.
 */
export function rejections(events: readonly LogEvent[], fixed: Fixed, labels: Labels, upTo?: number) {
  const end = upTo ?? events.length - 1;
  const ruled = rulingsOf(events, end);
  return solvesUnder(events, fixed, end).flatMap(({ id, ending, under }) =>
    rejected(ending)
      ? [{ solve: id, task: under.task, ruling: labels.get(id) ?? ruled.get(id) ?? null }]
      : [],
  );
}

/** Partition tallied `pairs` into the fixed frontier and retained subsets alongside per-family
 *  frontier tallies. An empty retained subset reports `UNMEASURED` rather than zero regressions. */
function setsOf(
  events: readonly LogEvent[],
  fixed: Fixed,
  pairs: readonly Paired[],
  aside: readonly string[],
) {
  const [kept, named] = [new Set(fixed.retained), familiesOf(events)];
  const familyOf = (task: string) => named.get(task) ?? "unnamed";
  const part = (set: "frontier" | "retained"): Entered => {
    const isRetained = set === "retained";
    const picked = pairs.filter(({ task }) => kept.has(task) === isRetained);
    return {
      tasks: fixed.tasks.filter((task) => kept.has(task) === isRetained),
      aside: aside.filter((task) => kept.has(task) === isRetained),
      ...scored(picked),
      of: picked.map(({ task }) => task),
    };
  };
  const [frontier, retained] = [part("frontier"), part("retained")];
  const byFamily = Map.groupBy(
    pairs.filter(({ task }) => !kept.has(task)),
    ({ task }) => familyOf(task),
  );
  const families = Object.fromEntries(
    [...new Set(fixed.tasks.map(familyOf))].map((family) => {
      const { wins, losses, ties } = scored(byFamily.get(family) ?? []);
      return [family, { frontier: { wins, losses, ties } }] as const;
    }),
  );
  return { frontier, retained: retained.of && retained.of.length > 0 ? retained : UNMEASURED, families };
}

/**
 * Compute completion and review coverage for `fixed` at its first report without scoring. Later
 * solves and task-state transitions cannot retroactively alter this snapshot.
 */
export function coverageOf(all: readonly LogEvent[], fixed: Fixed, labels: Labels = NO_LABELS) {
  const events = asReported(all, fixed.id);
  // Exclude tasks released or refused while the comparison was running so they are reported as
  // withdrawn instead of blocking the comparison report.
  const { states, held: heldList } = taskSets(events);
  const held = new Set(heldList);
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

/** Score complete pairs for `fixed`, excluding set-aside rejections and any disputed tasks. */
export function compared(all: readonly LogEvent[], fixed: Fixed, labels: Labels) {
  const events = asReported(all, fixed.id);
  const coverage = coverageOf(events, fixed, labels);
  // Disputes apply regardless of when they were recorded (including during post-report settlement).
  const states = taskStates(all);
  const scorable = (task: string) => states.get(task) !== "disputed";
  const first = coverage.pairs.filter(({ task }) => scorable(task));
  const open = new Set(coverage.aside);
  const kept = (pairs: readonly Paired[]) => pairs.filter(({ task }) => !open.has(task));
  const pairs = kept(first);
  const aside = coverage.aside.filter(scorable);
  const sets = setsOf(all, fixed, pairs, aside);
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
  const mirroredOf = (halves: readonly Paired[]) => {
    const aa = scored(halves);
    return { ...aa, flips: flipsOf(halves), detectable: detectable(aa.differences, fixed.level) };
  };
  const mirrored = fixed.solves % 2 === 0 ? mirroredOf(againstItself()) : null;
  const tested = scored(pairs);
  const stepped = readsStep(tested.differences, fixed.level);
  const reading: Reading = pairs.length === 0 ? "not-scored" : stepped ? "step" : "no-step";
  const solves = pairs.length === 0 ? [] : solvesIn(events);
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
    flagged: flaggedIn(solves, pairs),
    withdrawn: coverage.withdrawn.filter(scorable),
    reading,
    turns: turnsOf(solves, pairs),
    // Attach descriptive epoch cost when the comparison reads a step.
    worth: reading === "step" ? worthOf(events, fixed.id) : null,
    objective: fixed.objective ?? null,
    points: pairs.length === 0 ? null : pointsIn(pairs),
  };
}

/** Sum per-measure points across `pairs` (`pointsOf`), rounded to whole points (`wholePoints`). */
function pointsIn(pairs: readonly Paired[]): Measures {
  const each = pairs.map(pointsOf);
  const sum = (measure: keyof Measures) =>
    wholePoints(each.reduce((total, points) => total + points[measure], 0));
  return { validity: sum("validity"), objective: sum("objective") };
}

/** Mean billed dollars per counted solve on one side of `pairs`, or null when unbilled. */
function billedMean(pairs: readonly Paired[], side: "old" | "fresh"): number | null {
  const billed = pairs.flatMap((pair) => (pair.used?.[side] ?? []).flatMap((used) => used.billed ?? []));
  return billed.length === 0 ? null : billed.reduce((sum, each) => sum + each, 0) / billed.length;
}

/** Return task versions in `pairs` where either side flagged a solve as malformed (`submit`). */
function flaggedIn(solves: readonly Solve[], pairs: readonly Paired[]): string[] {
  if (pairs.length === 0) return [];
  const flags = new Set(solves.flatMap((solve) => (solve.ending?.outcome === "flagged" ? [solve.id] : [])));
  return pairs.flatMap(({ task, solves: pairSolves }) =>
    [...(pairSolves?.old ?? []), ...(pairSolves?.fresh ?? [])].some((solve) => flags.has(solve))
      ? [task]
      : [],
  );
}

/** Mean pairwise validity disagreement rate across solves of the same task, weighting tasks equally
 *  (null when no task was tallied). */
function flipsOf(pairs: readonly Paired[]): number | null {
  const each = pairs.map(({ old, fresh }) => {
    const solves = [...old, ...fresh];
    const valid = solves.filter(Boolean).length;
    return (valid * (solves.length - valid)) / ((solves.length * (solves.length - 1)) / 2);
  });
  return each.length === 0 ? null : each.reduce((sum, one) => sum + one, 0) / each.length;
}

/** Find the most recent prior comparison of the same kind (promotion attempt vs starter comparison)
 *  under the same reference, and return the intersection of their initial task draws. */
export function overlapOf(events: readonly LogEvent[], fixed: Fixed) {
  const starts = eventsOf(events, STARTED);
  const began = starts.find(({ event }) => event.data.session === fixed.id)?.index ?? -1;
  const kindOf = (fresh: JsonValue | undefined) => fresh === fixed.starter;
  const before = starts.findLast(
    ({ index, event: { data } }) =>
      index < began && data.old === fixed.old && kindOf(data.fresh) === kindOf(fixed.fresh),
  )?.event;
  if (before === undefined || !isString(before.data.session)) return null;
  const drawnThen = new Set(Array.isArray(before.data.tasks) ? before.data.tasks.filter(isString) : []);
  return { with: before.data.session, tasks: fixed.tasks.filter((task) => drawnThen.has(task)) };
}

/**
 * Rewrite `events` and `labels` so passing answers labelled `wrong` by a human are treated as
 * earned rejections (side failures), leaving `sound` and `unclear` passes unchanged.
 */
export function wrongAsFailed(
  events: readonly LogEvent[],
  labels: Labels,
  passes: Readonly<Record<string, JsonValue>>,
): { events: readonly LogEvent[]; labels: Map<string, Ruling> } {
  const wrong = wrongPasses(passes);
  return {
    events: failWrongPasses(events, wrong),
    labels: new Map<string, Ruling>([...labels, ...[...wrong].map((solve) => [solve, EARNED] as const)]),
  };
}

/**
 * Recompute comparison `id`'s reading with human settlement labels substituted for the verdicts
 * they overturn (`check-defect` rejections treated as valid passes, `wrong` passes as earned
 * failures, `earned` rejections as failures, and `unclear` rejections set aside), evaluated on the
 * log snapshot at initial report prior to settlement disputes. Returns null until settled or if the
 * initial report had no scored test. Also returns `unlabelled` under the current tree's rule for
 * apples-to-apples flip detection; purely descriptive.
 */
export function swapped(
  events: readonly LogEvent[],
  id: string,
): { decided: Reading; unlabelled: Reading; swapped: Reading; scored: Tested } | null {
  const own = asReported(events, id);
  const settled = reported(events, id)?.settled;
  const fixed = fixedIn(events, id);
  const original = reported(own, id);
  if (fixed === null || original?.scored == null || settled == null || settled === UNSETTLED) return null;
  const defects = new Set(Object.keys(settled.labels).filter((solve) => settled.labels[solve] === DEFECT));
  const failed = wrongAsFailed(own, new Map(Object.entries(settled.labels)), settled.passes);
  const swappedIn = failed.events.map((event) =>
    event.kind === "solve.finished" && isString(event.data.solve) && defects.has(event.data.solve)
      ? { ...event, data: { ...event.data, ending: { outcome: "pass" } } }
      : event,
  );
  const found = compared(swappedIn, fixed, failed.labels);
  return {
    decided: original.reading,
    unlabelled: compared(own, fixed, NO_LABELS).reading,
    swapped: found.reading,
    scored: found.scored,
  };
}

/** Return the operator's pre-solve prediction for comparison `id`, or null if none was recorded. */
export function predicted(events: readonly LogEvent[], id: string): string | null {
  const said = startOf(events, id)?.prediction;
  return isString(said) ? said : null;
}

/** Return the raw `comparison.started` payload for comparison `id`, if present. */
export function startOf(events: readonly LogEvent[], id: string): JsonObject | undefined {
  return eventsOf(events, STARTED).find(({ event }) => event.data.session === id)?.event.data;
}

/** Reconstruct the immutable `Fixed` terms for comparison `id`, or null if it never started. */
export function fixedIn(events: readonly LogEvent[], id: string): Fixed | null {
  const start = startOf(events, id) ?? {};
  // Legacy starts may include a retired two-stage trigger field, which is ignored.
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

/** Return solve identifiers that ended in a pass within comparison `id`. */
export function passesIn(events: readonly LogEvent[], id: string): string[] {
  return solvesIn(events).flatMap((solve) =>
    solve.start.comparison === id && passed(solve) === true ? [solve.id] : [],
  );
}

/** Partition undisputed rejections of comparison `id` into set-aside and earned sets for human
 *  labelling; requires both a fixed start and a report (whether scored or halted). */
export function toLabel(events: readonly LogEvent[], id: string): ToLabel {
  const report = reported(events, id);
  const fixed = fixedIn(events, id);
  if (report === null || fixed === null) return NOTHING_TO_LABEL;
  const own = reportedIndex(events, id);
  const upTo = own === -1 ? events.length - 1 : own;
  const states = taskStates(events, upTo);
  const undisputed = rejections(events, fixed, NO_LABELS, upTo).filter(
    ({ task }) => states.get(task) !== "disputed",
  );
  const pick = (set: "aside" | "others") =>
    undisputed.flatMap(({ solve, ruling }) => ((ruling !== EARNED) === (set === "aside") ? [solve] : []));
  return { aside: pick("aside"), others: pick("others") };
}
