/**
 * A comparison as the log holds it, and how the plan reads it: its start (`Fixed`, from
 * `comparison.started`), the test-side solves it may count, its rejections and what stands of each,
 * the tallies and the reading (`compared`), and its report (`Report`, from `comparison.reported`).
 * Nothing here writes an event. What runs a comparison, writes its start and its report and
 * settles it on a person's labels is `round.ts`, whose head comment is the full account of what is
 * fixed before the first solve, how a solve ends and how a rejection counts.
 *
 * Split from `round.ts` when that file passed the size policy's ceiling of 800
 * nonblank lines (`tools/loc/source-policy.ts`). The readers are here and the moves stay there: a
 * fold over the log has one owner here, and the commands that read a comparison without running
 * one (`tools/d2/round.ts`, `tools/d2/checkpoint.ts`, `tools/d2/settle.ts`) read it through this
 * module.
 */
import {
  decidedByObjective,
  detectable,
  type Gain,
  power,
  type ObjectiveRule,
  objectiveGain,
  objectiveRuleIn,
  type Paired,
  pairsOf,
  scored,
  stepOf,
  type Tally,
  tally,
  UNMEASURED,
  unsolved,
  informative,
} from "../kernel/compare.ts";
import { conditionsOf, settingId } from "../kernel/condition.ts";
import { proposalsOf } from "../kernel/history.ts";
import type { LogEvent } from "../kernel/log.ts";
import { poolOf } from "../kernel/reports.ts";
import { passed, ranUnder, solvesIn } from "../kernel/solves.ts";
import { taskSets, taskStates } from "../kernel/task.ts";
import { asRecord, isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import { median } from "../meta/tally.ts";
import type { Ruling } from "../review/referee.ts";
import { type Worth, worthOf } from "./climb.ts";

/**
 * How the plan's rules read a comparison. A step is the new harness's test against the reference
 * one clearing its level. A comparison that tallied no task is named apart: it tested nothing,
 * and `no-step` would say a test was made and found no gain. Eight rounds of 8 October scored no
 * task and read `no-step` eight times. `check-defects` is the comparison stopped on its check
 * defects, and `no-change` a session that left nothing new to compare. `regressed` is a report's
 * of 12 to 20 October, when the retained tasks were a second test (`stepOf`, `compare.ts`).
 *
 * A report written before 11 October may hold `below-starter` or `starter-unread` and an
 * `against`: readings of a third arm that solved the starter on a step. The starter is now the
 * control after a promotion (`decide.ts`).
 */
type Reading = "step" | "no-step" | "regressed" | "narrow" | "not-scored" | "check-defects" | "no-change";
/** One test's tally, each task's difference in pair wins, and its p. */
type Tested = ReturnType<typeof scored>;
/** One of the two sets a comparison fixes at its start (`retained`, `Fixed`): the tasks that
 *  entered it, which are its denominator, those of them set aside, and its tally and test. */
/** `of` names the task of each difference; a report from before 14 October holds none. */
type Entered = Tested & {
  readonly tasks: readonly string[];
  readonly aside: readonly string[];
  readonly of?: readonly string[];
};
/**
 * How each harness did by itself over the tallied tasks: entry k counts the tasks on which k of its
 * counted solves gave a valid answer, so with two solves a side the three entries are the tasks
 * valid in none, in one and in both. No test is read off it. It says where a budget leaves a
 * harness: valid nearly everywhere, the tasks cannot tell two harnesses apart; valid on about half
 * its solves, the fewest tasks tie by chance (`7f0add79:docs/plan.md`, Phase 0 and Statistical power).
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
  /** The new harness against the reference one, over `versions`: the tally and its test. `unsolved`
   *  counts the tied tasks no counted solve of either harness answered validly. The other ties are
   *  between valid answers, which is the share the plan's Phase 3 turns on. Null when nothing was
   *  compared. The step is read on it (`stepOf`), with its `detectable` and `falseRate`, the test's
   *  `power` at one half and never over the level. Before 20 October those two were the frontier's. */
  readonly scored:
    | (Tested & {
        readonly unsolved: number;
        readonly detectable?: number | null;
        readonly falseRate?: number;
      })
    | null;
  /** Each harness by itself, over `versions`. Null when nothing was compared, and in a report
   *  written before 9 October. */
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
  readonly families: Readonly<Record<string, { readonly frontier: Tally; readonly retained: Tally }>> | null;
  /** The comparison of the same two harnesses before this one, and the task versions both scored. */
  readonly overlap: { readonly with: string; readonly tasks: readonly string[] } | null;
  /** The reference harness against itself on halves of its own solves mirrored in time, the A/A,
   *  where it holds four or more of a task: how often two of its solves of a task
   *  disagree (`flips`), the least share of its untied tasks one half has to win for a reading of it
   *  two-sided at the level to detect it four times in five (`detectable`), which says how much its
   *  reading no step can show. A report of 12 to 18 October also holds the objective's margin its
   *  own spread set, which the next comparison read by until one margin stood for all, and none
   *  since 19 October (`SAME`, `compare.ts`). */
  readonly noise:
    | (Tested & {
        readonly flips: number | null;
        /** Absent in a report written before 14 October. */
        readonly detectable?: number | null;
      })
    | null;
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
  /** Tallied task versions with a solve a solver flagged as malformed, counted as its side's fail. */
  readonly flagged: readonly string[];
  /** Task versions that left the held-out set while the comparison ran: released for practice, or
   *  refused by a person as infeasible. */
  readonly withdrawn: readonly string[];
  /** Whether the dollar cap cut the comparison short of its test, where nothing is tallied. */
  readonly capped: boolean;
  readonly reading: Reading;
  /** The objective the comparison fixed, and how many tallied tasks it decided: won or lost where
   *  validity alone would have tied, and the median relative gain on the frontier tasks the new
   *  harness won (`objectiveGain`; absent before 20 October). Null where the check program declares
   *  none, and in a report written before 10 October. */
  readonly objective: (ObjectiveRule & { readonly decided: number; readonly gain?: Gain | null }) | null;
  /** By task, the median turns each harness's valid answers took, null where it gave none: what
   *  the comparison reports beside each pair and no tally reads (the overhaul plan's P2). */
  readonly turns: Readonly<
    Record<string, { readonly old: number | null; readonly fresh: number | null }>
  > | null;
  /** Where it reads a step, the cost bar as the log stood (`worthOf`, the plan's W): the epoch's
   *  attempts. Reported, and gating nothing. A report before 13 October holds an effect and a
   *  transfer beside it, which nothing reads. */
  readonly worth: Worth | null;
  /** `unsettled` in the comparison's own report until a person answers its packet (`settle.ts`),
   *  which no promotion waits for (the operator, 12 October); then what the labels settled, in
   *  the report `settleReading` writes after it: how many rejections were labelled, how many of
   *  them a check defect, the tasks those disputed, the tasks the labels restored to the tally, and
   *  the labels themselves, by solve. Null in a report that compared nothing. */
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
  { feasible, bests }: Pick<ReturnType<typeof poolOf>, "feasible" | "bests">,
): Valid {
  const census = (side: "old" | "fresh") => {
    const tasks = Array.from({ length: solves + 1 }, () => 0);
    for (const pair of pairs) {
      const valid = pair[side].filter(Boolean).length;
      tasks[valid] = (tasks[valid] ?? 0) + 1;
    }
    return tasks;
  };
  const told = (side: "old" | "fresh") =>
    pairs.filter((pair) => informative(pair, side, feasible, bests)).length;
  return {
    old: census("old"),
    fresh: census("fresh"),
    informative: { old: told("old"), fresh: told("fresh") },
  };
}

/** By task, the median turns each side's valid answers took (`Report.turns`), null where none. */
function turnsOf(events: readonly LogEvent[], pairs: readonly Paired[]): NonNullable<Report["turns"]> {
  const took = new Map(solvesIn(events).map((solve) => [solve.id, solve.end?.turns]));
  const side = (pair: Paired, named: "old" | "fresh") =>
    median(
      (pair.solves?.[named] ?? [])
        .flatMap((id, at) => (pair[named][at] === true ? [took.get(id)] : []))
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
  // A report written before a field existed reads as that field's absence. A report of before
  // 9 October holds `counted` as a reading, where it is a tally now, and it reads as absent.
  const data: JsonObject = { ...NOTHING, ...found, counted: asRecord(found.counted) };
  // SAFETY: only `checkpoint`, `round` and `settleReading` write this event, from the report each returns.
  return Object.fromEntries(REPORT_KEYS.map((key) => [key, data[key]])) as unknown as Report;
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
  const named = new Map(
    proposalsOf(events).flatMap(({ version, family }) => (family === null ? [] : [[version, family]])),
  );
  const familyOf = (task: string) => named.get(task) ?? "unnamed";
  const part = (retained: boolean) => pairs.filter(({ task }) => kept.has(task) === retained);
  const tallied = { frontier: part(false), retained: part(true) };
  const setOf = (set: keyof typeof tallied): Entered => {
    const within = (task: string) => kept.has(task) === (set === "retained");
    // `of` names the task of each difference, as the report holds it.
    const of = tallied[set].map(({ task }) => task);
    return { tasks: fixed.tasks.filter(within), aside: aside.filter(within), ...scored(tallied[set]), of };
  };
  const ofFamily = (family: string, set: keyof typeof tallied) =>
    tally(tallied[set].filter(({ task }) => familyOf(task) === family));
  const retained = setOf("retained");
  return {
    frontier: setOf("frontier"),
    retained: retained.wins + retained.losses + retained.ties > 0 ? retained : UNMEASURED,
    families: Object.fromEntries(
      [...new Set(fixed.tasks.map(familyOf))].map((family) => [
        family,
        { frontier: ofFamily(family, "frontier"), retained: ofFamily(family, "retained") },
      ]),
    ),
  };
}

/**
 * The comparison of `fixed.tasks`, read from the log as comparison `id` found it: the new harness
 * against the reference one over the tasks that have their solves under both and no rejection that
 * sets them aside, and the reference harness against itself where that was asked for, with how
 * the plan reads them.
 */
export function compared(all: readonly LogEvent[], fixed: Fixed, labels: ReadonlyMap<string, Ruling>) {
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
  const sides = {
    old: fixed.old,
    fresh: fixed.fresh,
    setting: fixed.setting,
    comparison: fixed.id,
    objective: fixed.objective,
  };
  const first = pairsOf(events, live, sides, fixed.solves);
  const kept = (pairs: readonly Paired[]) => pairs.filter(({ task }) => !open.has(task));
  const pairs = kept(first.pairs);
  const aside = live.filter((task) => open.has(task));
  const sets = setsOf(all, fixed, pairs, aside);
  /** The reference against itself on halves of the test's own solves (`Sides`, `halves`), over
   *  the tallied tasks and no other: until 14 October it read every live task, so a task short on
   *  the new side alone stood in the A/A and not in the tally, and its printed count was neither. */
  const tallied = pairs.map(({ task }) => task);
  const itself = () =>
    kept(
      pairsOf(events, tallied, { ...sides, fresh: fixed.old, halves: "mirrored" }, fixed.solves / 2).pairs,
    );
  // The A/A (12 October, the plan's section 4b): where the reference's solves of a task are four
  // or more and even, which halves mirrored in time split two against two at least. At four a
  // side every comparison carries one.
  const mirrored = fixed.solves >= 4 && fixed.solves % 2 === 0 ? itself() : null;
  const aa = mirrored === null ? null : scored(mirrored);
  const valid = validOf(pairs, fixed.solves, poolOf(events));
  // The step is read off the sets as a report holds them, which is how it is read again (`stepOf`).
  const reading = pairs.length === 0 ? ("not-scored" as const) : stepOf(asRecord(sets) ?? {}, fixed.level);
  const tested = scored(pairs);
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
    valid,
    billed: { old: billedMean(pairs, "old"), fresh: billedMean(pairs, "fresh") },
    noise:
      mirrored === null || aa === null
        ? null
        : {
            ...aa,
            flips: flipsOf(mirrored),
            // Two-sided, since which half is which is arbitrary: each side at half the level.
            detectable: detectable(aa.differences, fixed.level / 2),
          },
    counted: pairs.length === first.pairs.length ? null : scored(first.pairs),
    versions: pairs.map(({ task }) => task),
    aside,
    short: live.filter((task) => first.short.includes(task)),
    flagged: flaggedIn(events, pairs),
    withdrawn: scorable.filter((task) => !held.has(task)),
    reading,
    turns: turnsOf(events, pairs),
    // The cost bar, read where a step is (the plan's W): printed, and gating nothing.
    worth: reading === "step" ? worthOf(events, fixed.id) : null,
    objective:
      fixed.objective === undefined
        ? null
        : {
            ...fixed.objective,
            decided: decidedByObjective(pairs),
            gain: objectiveGain(pairs.filter(({ task }) => !fixed.retained.includes(task))),
          },
  };
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
    return solves.length < 2
      ? 0
      : (valid * (solves.length - valid)) / ((solves.length * (solves.length - 1)) / 2);
  });
  return each.length === 0 ? null : each.reduce((sum, one) => sum + one, 0) / each.length;
}

/** The comparison of the same two harnesses that began before `fixed` did, and the tasks both
 *  scored; null where none did. */
function overlapOf(events: readonly LogEvent[], fixed: Fixed) {
  const began = events.findIndex(({ kind, data }) => kind === STARTED && data.session === fixed.id);
  const before = events
    .slice(0, Math.max(0, began))
    .findLast(({ kind, data }) => kind === STARTED && data.old === fixed.old && data.fresh === fixed.fresh);
  if (before === undefined || !isString(before.data.session)) return null;
  const scoredThen = new Set(Array.isArray(before.data.tasks) ? before.data.tasks.filter(isString) : []);
  return { with: before.data.session, tasks: fixed.tasks.filter((task) => scoredThen.has(task)) };
}

/**
 * `events` and `labels` with each answer that passed and a person labelled wrong read as a
 * rejection ruled earned: that side's fail, as an earned rejection is. A pass labelled sound or
 * unclear is read as it was.
 */
export function wrongAsFailed(
  events: readonly LogEvent[],
  labels: ReadonlyMap<string, Ruling>,
  passes: Readonly<Record<string, PassLabel>>,
): { events: LogEvent[]; labels: Map<string, Ruling> } {
  const wrong = new Set(Object.keys(passes).filter((solve) => passes[solve] === "wrong"));
  const ending = { outcome: "fail", kind: "rejected", reason: "a person labelled the pass wrong" };
  return {
    events: events.map((event) =>
      event.kind === "solve.finished" && isString(event.data.solve) && wrong.has(event.data.solve)
        ? { ...event, data: { ...event.data, ending } }
        : event,
    ),
    labels: new Map<string, Ruling>([...labels, ...[...wrong].map((solve) => [solve, EARNED] as const)]),
  };
}

/**
 * Comparison `id`'s reading with its packet's labels in place of the verdicts they overturn, beside
 * the reading it was decided on: a rejected answer labelled a check defect read as a valid answer,
 * an answer that passed labelled wrong as a true fail, a rejection labelled earned as a true fail
 * and one labelled unclear left aside. It is read as the comparison's own report found it, before
 * its settling disputed anything. Null until it is settled. A decision that flips means its packet
 * was too small to stand on (the overhaul plan's M3, research 06): a report, and no move reads it.
 */
export function swapped(
  events: readonly LogEvent[],
  id: string,
): { decided: Reading; swapped: Reading; scored: Tested } | null {
  const own = asReported(events, id);
  const settled = reported(events, id)?.settled;
  const fixed = fixedIn(events, id);
  const decided = reported(own, id)?.reading;
  if (
    fixed === null ||
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
  return { decided, swapped: found.reading, scored: found.scored };
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
  // A start of 10 to 18 October also holds the trigger of the two-stage rule, which is read past.
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

/** A person's label of each rejected answer, by its solve, over every settled packet of the log:
 *  what stands over the Referee's ruling of the same rejection wherever one is read
 *  (`tools/d2/settle.ts`, `tools/c/repaired.ts`). */
export function settledLabels(events: readonly LogEvent[]): Map<string, Ruling> {
  const ids = new Set(
    events.flatMap(({ kind, data }) => (kind === REPORTED && isString(data.session) ? [data.session] : [])),
  );
  return new Map(
    [...ids].flatMap((id) => {
      const settled = reported(events, id)?.settled;
      return settled === undefined || settled === null || settled === UNSETTLED
        ? []
        : Object.entries(settled.labels);
    }),
  );
}
