/**
 * A comparison as the log holds it, and how the plan reads it: its start (`Fixed`, from
 * `comparison.started`), the test-side solves it may count, its rejections and what stands of each,
 * the tallies and the reading (`compared`), and its report (`Report`, from `comparison.reported`).
 * Nothing here writes an event. What runs a comparison, writes its start and its report and
 * settles it on a person's labels is `round.ts`, whose head comment is the full account of what is
 * fixed before the first solve, how a solve ends and how a rejection counts.
 *
 * Split from `round.ts` on 10 October, when that file stood at 1,037 nonblank lines against the
 * size policy's ceiling of 800 (`tools/loc/source-policy.ts`, `docs/plan.md` row F34). The
 * readers went, and the moves stayed: a fold over the log has one owner here, and the commands
 * that read a comparison without running one (`tools/d2/round.ts`, `tools/d2/checkpoint.ts`,
 * `tools/d2/settle.ts`) read it through this module. Every function keeps the name and the body it
 * had in `round.ts`.
 */
import {
  decidedByObjective,
  type ObjectiveRule,
  objectiveRuleIn,
  type Paired,
  pairsOf,
  scored,
  type Sides,
} from "../kernel/compare.ts";
import { conditionsOf, settingId } from "../kernel/condition.ts";
import { type LogEvent, read } from "../kernel/log.ts";
import { unsolved, whole } from "../kernel/reports.ts";
import { ranUnder } from "../kernel/solves.ts";
import { taskSets, taskStates } from "../kernel/task.ts";
import { asRecord, isBoolean, isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import type { Ruling } from "../review/referee.ts";

/**
 * How the plan's rules read a comparison. A step is the new harness's test against the reference
 * one clearing its level. A comparison that tallied no task is named apart: it tested nothing,
 * and `no-step` would say a test was made and found no gain. The eight truss rounds of
 * 2026-10-08 scored no task and read `no-step` eight times. `check-defects` is the comparison
 * stopped on its check defects, and `no-change` a session that left nothing new to compare.
 *
 * Until 2026-10-11 a comparison against a promoted reference also solved the starter on the
 * tallied tasks once its test cleared its level, and read `below-starter` with fewer wins than
 * losses there and `starter-unread` while the starter lacked a solve: a third arm, solved only
 * on a step, that no move read but the one that completed it. A report of before holds the two
 * words and its `against`. The starter is the control after a promotion (`decide.ts`), which is
 * where the plan reads whether it loses more each epoch (`docs/simplify.md`, B2).
 */
type Reading = "step" | "no-step" | "not-scored" | "check-defects" | "no-change";
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
  /** The mean billed dollars of a counted solve under each harness; null where the log holds none. */
  readonly billed: { readonly old: number | null; readonly fresh: number | null } | null;
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
  /** Whether the dollar cap cut the comparison short of its test, where nothing is tallied. */
  readonly capped: boolean;
  readonly reading: Reading;
  /** The objective the comparison fixed, and how many tallied tasks it decided: won or lost where
   *  validity alone would have tied. Null where the check program declares none, and in a report
   *  written before 10 October. */
  readonly objective: (ObjectiveRule & { readonly decided: number }) | null;
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
  readonly noise: boolean;
  readonly tasks: readonly string[];
  /** The objective two valid answers are compared by, where the check program declares one. */
  readonly objective: ObjectiveRule | undefined;
}

export const STARTED = "comparison.started";
export const REPORTED = "comparison.reported";
/** A report's fields, as its event carries them beside the comparison's own terms. */
const REPORT_KEYS = [
  "old",
  "fresh",
  "starter",
  "scored",
  "valid",
  "billed",
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
  "objective",
] as const satisfies readonly (keyof Report)[];
const NOTHING_TO_LABEL: ToLabel = { aside: [], others: [] };
export const DEFECT = "check-defect";
export const EARNED = "earned";
export const NO_LABELS: ReadonlyMap<string, Ruling> = new Map();
export const NOTHING = {
  scored: null,
  valid: null,
  billed: null,
  noise: null,
  counted: null,
  versions: [],
  disputed: [],
  aside: [],
  short: [],
  withdrawn: [],
  capped: false,
  settled: null,
  objective: null,
} as const;

/** The log as comparison `id` is read once it has reported: up to its own first report. What comes
 *  after is other comparisons' and a person's: a later one adds solves of the same tasks, and a
 *  task may be released or disputed since. A comparison with no report yet is read whole. */
function asReported(events: readonly LogEvent[], id: string): LogEvent[] {
  const own = events.findIndex(({ kind, data }) => kind === REPORTED && data.session === id);
  return own === -1 ? [...events] : events.slice(0, own + 1);
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
export function reported(events: readonly LogEvent[], id: string): Report | null {
  const found = events.findLast((event) => event.kind === REPORTED && event.data.session === id)?.data;
  if (found === undefined) return null;
  // A report written before a field existed reads as that field's absence. Until 2026-10-09
  // `counted` was a reading, where it is a tally now.
  const data: JsonObject = { ...NOTHING, ...found, counted: asRecord(found.counted) };
  // SAFETY: only `checkpoint`, `round` and `settleReading` write this event, from the report each returns.
  return Object.fromEntries(REPORT_KEYS.map((key) => [key, data[key]])) as unknown as Report;
}

/** The test-side solves a comparison may count: the ones whose start names it, under one of its
 *  harnesses and its setting. Each says whether it ended in a pass or a fail and so counts. */
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
      ? [{ ...solve, counts: solve.ending?.outcome === "pass" || solve.ending?.outcome === "fail" }]
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
 * The comparison of `fixed.tasks`, read from the log as comparison `id` found it: the new harness
 * against the reference one over the tasks that have their solves under both and no rejection that
 * sets them aside, and the reference harness against itself where that was asked for, with how
 * the plan reads them.
 */
export function compared(log: string, fixed: Fixed, labels: ReadonlyMap<string, Ruling>) {
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
  const sides: Sides = {
    old: fixed.old,
    fresh: fixed.fresh,
    setting: fixed.setting,
    comparison: fixed.id,
    objective: fixed.objective,
  };
  const pairsUnder = (other: Sides) => whole(pairsOf(events, live, other).pairs, fixed.solves);
  const first = pairsUnder(sides);
  const kept = (pairs: readonly Paired[]) => pairs.filter(({ task }) => !open.has(task));
  const pairs = kept(first.pairs);
  const tested = scored(pairs);
  const reading = (): Reading => {
    if (pairs.length === 0) return "not-scored";
    return tested.p > fixed.level ? "no-step" : "step";
  };
  const mean = (side: "old" | "fresh") => {
    const billed = pairs.flatMap((pair) => (pair.used?.[side] ?? []).flatMap((used) => used.billed ?? []));
    return billed.length === 0 ? null : billed.reduce((sum, each) => sum + each, 0) / billed.length;
  };
  return {
    scored: { ...tested, unsolved: pairs.filter(unsolved).length },
    valid: validOf(pairs, fixed.solves),
    billed: { old: mean("old"), fresh: mean("fresh") },
    noise: fixed.noise
      ? scored(kept(pairsUnder({ ...sides, fresh: fixed.old, halves: fixed.solves }).pairs))
      : null,
    counted: pairs.length === first.pairs.length ? null : scored(first.pairs),
    versions: pairs.map(({ task }) => task),
    aside: live.filter((task) => open.has(task)),
    short: live.filter((task) => first.short.includes(task)),
    withdrawn: scorable.filter((task) => !held.has(task)),
    reading: reading(),
    objective:
      fixed.objective === undefined ? null : { ...fixed.objective, decided: decidedByObjective(pairs) },
  };
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
  const { old, fresh, starter, setting, solves, level, noise, tasks } = start;
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
        tasks: Array.isArray(tasks) ? tasks.filter(isString) : [],
        objective: objectiveRuleIn(start),
      }
    : null;
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
