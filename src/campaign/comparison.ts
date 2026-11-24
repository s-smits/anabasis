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
  judgedPairs,
  judgeIn,
  type JudgeWeights,
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

type Reading = "step" | "no-step" | "not-scored" | "check-defects" | "no-change";
type Tested = ReturnType<typeof scored>;
type Entered = Tested & {
  readonly tasks: readonly string[];
  readonly aside: readonly string[];
  readonly of?: readonly string[];
};
interface Valid {
  readonly old: readonly number[];
  readonly fresh: readonly number[];
  readonly informative: { readonly old: number; readonly fresh: number };
}
export interface Report {
  readonly old: string;
  readonly fresh: string | null;
  readonly starter: string;
  readonly scored:
    | (Tested & {
        readonly unsolved: number;
        readonly detectable?: number | null;
        readonly falseRate?: number;
      })
    | null;
  readonly valid: Valid | null;
  readonly billed: { readonly old: number | null; readonly fresh: number | null } | null;
  readonly frontier: (Entered & { readonly detectable?: number | null; readonly falseRate?: number }) | null;
  readonly retained: Entered | typeof UNMEASURED | null;
  readonly families: Readonly<Record<string, { readonly frontier: Tally }>> | null;
  readonly overlap: { readonly with: string; readonly tasks: readonly string[] } | null;
  readonly noise:
    | (Tested & {
        readonly flips: number | null;
        readonly detectable?: number | null;
      })
    | null;
  readonly counted: Tested | null;
  readonly versions: readonly string[];
  readonly disputed: readonly string[];
  readonly aside: readonly string[];
  readonly short: readonly string[];
  readonly flagged: readonly string[];
  readonly withdrawn: readonly string[];
  readonly capped: boolean;
  readonly reading: Reading;
  readonly objective: ObjectiveRule | null;
  readonly points: Measures | null;
  readonly turns: Readonly<
    Record<string, { readonly old: number | null; readonly fresh: number | null }>
  > | null;
  readonly worth: Worth | null;
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
interface ToLabel {
  readonly aside: readonly string[];
  readonly others: readonly string[];
}
export interface Fixed {
  readonly id: string;
  readonly old: string;
  readonly fresh: string;
  readonly starter: string;
  readonly setting: string;
  readonly solves: number;
  readonly level: number;
  readonly tasks: readonly string[];
  readonly retained: readonly string[];
  readonly objective: ObjectiveRule | undefined;
  readonly judge?: JudgeWeights | undefined;
}

export const STARTED = "comparison.started";
export const REPORTED = "comparison.reported";
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

function asReported(events: readonly LogEvent[], id: string): readonly LogEvent[] {
  const own = reportedIndex(events, id);
  return own === -1 || own === events.length - 1 ? events : events.slice(0, own + 1);
}

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

export function reported(events: readonly LogEvent[], id: string): Report | null {
  const found = eventsOf(events, REPORTED).findLast(({ event }) => event.data.session === id)?.event.data;
  if (found === undefined) return null;
  const data: JsonObject = { ...NOTHING, ...found, counted: asRecord(found.counted) };
  return parseJsonAs<Report>(Object.fromEntries(REPORT_KEYS.map((key) => [key, data[key] ?? null])));
}

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

export function rejections(events: readonly LogEvent[], fixed: Fixed, labels: Labels, upTo?: number) {
  const end = upTo ?? events.length - 1;
  const ruled = rulingsOf(events, end);
  return solvesUnder(events, fixed, end).flatMap(({ id, ending, under }) =>
    rejected(ending)
      ? [{ solve: id, task: under.task, ruling: labels.get(id) ?? ruled.get(id) ?? null }]
      : [],
  );
}

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

export function coverageOf(all: readonly LogEvent[], fixed: Fixed, labels: Labels = NO_LABELS) {
  const events = asReported(all, fixed.id);
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
    judge: fixed.judge,
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

function mirroredPairs(events: readonly LogEvent[], fixed: Fixed, tasks: readonly string[]) {
  const sides = {
    old: fixed.old,
    fresh: fixed.old,
    setting: fixed.setting,
    comparison: fixed.id,
    objective: fixed.objective,
    judge: fixed.judge,
    halves: "mirrored" as const,
  };
  return fixed.solves % 2 === 0 ? pairsOf(events, tasks, sides, fixed.solves / 2).pairs : [];
}

export function judgingLeft(all: readonly LogEvent[], fixed: Fixed) {
  if (fixed.judge === undefined) return [];
  const events = asReported(all, fixed.id);
  const { pairs } = coverageOf(events, fixed, NO_LABELS);
  const asked = [
    ...pairs,
    ...mirroredPairs(
      events,
      fixed,
      pairs.map(({ task }) => task),
    ),
  ];
  return asked.flatMap(({ task, fresh, old, solves, judged }) => {
    if (solves === undefined || judged === undefined) return [];
    const cast = new Set(judged.votes.map((vote) => `${String(vote.fresh)}:${String(vote.old)}`));
    return judgedPairs(`${fixed.id}:${task}`, solves, { fresh, old }).flatMap(([f, o]) =>
      cast.has(`${String(f)}:${String(o)}`)
        ? []
        : [{ task, first: solves.fresh[f] ?? "", second: solves.old[o] ?? "" }],
    );
  });
}

export function compared(all: readonly LogEvent[], fixed: Fixed, labels: Labels) {
  const events = asReported(all, fixed.id);
  const coverage = coverageOf(events, fixed, labels);
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
      mirroredPairs(
        events,
        fixed,
        pairs.map(({ task }) => task),
      ),
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
    worth: reading === "step" ? worthOf(events, fixed.id) : null,
    objective: fixed.objective ?? null,
    points: pairs.length === 0 ? null : pointsIn(pairs),
  };
}

function pointsIn(pairs: readonly Paired[]): Measures {
  const each = pairs.map(pointsOf);
  const sum = (measure: keyof Measures) =>
    wholePoints(each.reduce((total, points) => total + points[measure], 0));
  return { validity: sum("validity"), objective: sum("objective") };
}

function billedMean(pairs: readonly Paired[], side: "old" | "fresh"): number | null {
  const billed = pairs.flatMap((pair) => (pair.used?.[side] ?? []).flatMap((used) => used.billed ?? []));
  return billed.length === 0 ? null : billed.reduce((sum, each) => sum + each, 0) / billed.length;
}

function flaggedIn(solves: readonly Solve[], pairs: readonly Paired[]): string[] {
  if (pairs.length === 0) return [];
  const flags = new Set(solves.flatMap((solve) => (solve.ending?.outcome === "flagged" ? [solve.id] : [])));
  return pairs.flatMap(({ task, solves: pairSolves }) =>
    [...(pairSolves?.old ?? []), ...(pairSolves?.fresh ?? [])].some((solve) => flags.has(solve))
      ? [task]
      : [],
  );
}

function flipsOf(pairs: readonly Paired[]): number | null {
  const each = pairs.map(({ old, fresh }) => {
    const solves = [...old, ...fresh];
    const valid = solves.filter(Boolean).length;
    return (valid * (solves.length - valid)) / ((solves.length * (solves.length - 1)) / 2);
  });
  return each.length === 0 ? null : each.reduce((sum, one) => sum + one, 0) / each.length;
}

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

export function predicted(events: readonly LogEvent[], id: string): string | null {
  const said = startOf(events, id)?.prediction;
  return isString(said) ? said : null;
}

export function startOf(events: readonly LogEvent[], id: string): JsonObject | undefined {
  return eventsOf(events, STARTED).find(({ event }) => event.data.session === id)?.event.data;
}

export function fixedIn(events: readonly LogEvent[], id: string): Fixed | null {
  const start = startOf(events, id) ?? {};
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
        judge: judgeIn(start),
      }
    : null;
}

export function passesIn(events: readonly LogEvent[], id: string): string[] {
  return solvesIn(events).flatMap((solve) =>
    solve.start.comparison === id && passed(solve) === true ? [solve.id] : [],
  );
}

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
