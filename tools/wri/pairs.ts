/**
 * Every task each comparison named, one row a task, and one summary line a comparison: what each
 * side's solves did, the task's score and what carried it, the reference against itself as its
 * report stored it and as this tree rebuilds it, the new side against itself, and of a tie, its kind.
 *
 *   bun tools/wri/wri.ts reader pairs --log <log>
 */
import {
  type Measures,
  carriedBy,
  differenceOf,
  gainOver,
  gapAgainst,
  type Paired,
  pointsOf,
  GAP_FLOOR,
  scoresIn,
  testOf,
  unsolved,
} from "#src/kernel/compare.ts";
import { campaignOf } from "#src/campaign/handover.ts";
import { OPENING, proposalsOf } from "#src/kernel/history.ts";
import { eventsOf, type LogEvent } from "#src/kernel/log.ts";
import { lastReports, pairsReported, poolOf, type Reported } from "#src/kernel/reports.ts";
import { ended, passed, type Ran, ranUnder } from "#src/kernel/solves.ts";
import { asRecord, isNumber, isString, type JsonObject, type JsonValue } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { median } from "#src/meta/tally.ts";

/** The kind of a tied task, by its solves. */
type TieKind = "both-invalid" | "exact-repeat" | "within-room" | "both-valid" | "cancelling";

export interface SideGap {
  /** The median over tasks of a task's median ratio to the best; null where no task gave one. */
  readonly ratio: number | null;
  readonly atBest: number;
  readonly read: number;
  /** Validly answered tasks that gave no ratio: no best on record, or a measure at or below zero. */
  readonly unread: number;
}

type Grain = { readonly largest: number; readonly of: number } | null;

type Counted = Ran & { readonly finished: number; readonly end: JsonObject };

interface Context {
  readonly session: string;
  readonly read: "candidate" | "starter";
  readonly retained: ReadonlySet<string>;
  readonly writers: ReadonlyMap<string, { readonly session: string; readonly family: string }>;
  readonly ran: ReadonlyMap<string, Counted>;
  readonly byTask: ReadonlyMap<string, readonly Counted[]>;
  readonly stored: ReadonlyMap<string, number>;
  readonly aa: ReadonlyMap<string, Paired>;
  readonly self: ReadonlyMap<string, Paired>;
  readonly bests: ReadonlyMap<string, number>;
}

/** How close two measures stand to read as one, past a float's own noise. */
const EXACTLY = 1e-6;
const APART = ["aside", "short", "disputed", "flagged", "withdrawn"] as const;
const KINDS: readonly TieKind[] = ["exact-repeat", "within-room", "both-valid", "both-invalid", "cancelling"];
const HEAD = [
  "comparison",
  "read",
  "part",
  "task",
  "writer",
  "family",
  "old",
  "new",
  "diff",
  "carried",
  "aa_stored",
  "aa_rebuilt",
  "new_self",
  "flips",
  "repeat",
  "spread",
  "x_best",
  "billed",
  "tie",
].join("\t");
const NONE = "-";
const PASS = "pass";

function pairingOf(pair: Paired, o: number, f: number): Paired {
  const objective = pair.objective;
  return {
    task: pair.task,
    old: pair.old.slice(o, o + 1),
    fresh: pair.fresh.slice(f, f + 1),
    ...keyIfDefined(
      "objective",
      objective && {
        ...objective,
        old: objective.old.slice(o, o + 1),
        fresh: objective.fresh.slice(f, f + 1),
      },
    ),
  };
}

function measuresOf(pair: Paired): (number | null)[] {
  return pair.objective === undefined ? [] : [...pair.objective.old, ...pair.objective.fresh];
}

function tieKind(pair: Paired): TieKind | null {
  if (differenceOf(pair) !== 0) return null;
  if (unsolved(pair)) return "both-invalid";
  if (![...pair.old, ...pair.fresh].every(Boolean)) return "cancelling";
  const measures = measuresOf(pair);
  if (measures.length === 0 || !measures.every(isNumber)) return "both-valid";
  if (Math.max(...measures) - Math.min(...measures) <= EXACTLY) return "exact-repeat";
  const within = [...pair.old.keys()].every((o) =>
    [...pair.fresh.keys()].every((f) => differenceOf(pairingOf(pair, o, f)) === 0),
  );
  return within ? "within-room" : "cancelling";
}

const flipped = (valid: readonly boolean[]) => valid.includes(true) && valid.includes(false);

function repeatOf(pair: Paired, side: "old" | "fresh"): string {
  const measures = pair.objective?.[side] ?? [];
  const known = measures.filter(isNumber);
  if (known.length < 2 || known.length !== pair[side].length) return NONE;
  if (Math.max(...known) - Math.min(...known) <= EXACTLY) return "exact";
  return gapAgainst(pair, side, []) ? "apart" : "within";
}

/** The spread of a task's measures over both sides: raw on a unit scale, else as a share of the
 *  larger magnitude. */
function howOftenValid(pair: Paired): string {
  const known = measuresOf(pair).filter(isNumber);
  if (known.length < 2) return NONE;
  const [low, high] = [Math.min(...known), Math.max(...known)];
  if (pair.objective?.scale === "unit") return (high - low).toFixed(3);
  const larger = Math.max(Math.abs(low), Math.abs(high));
  return larger === 0 ? "0" : ((high - low) / larger).toFixed(3);
}

function billedOf(bills: readonly (number | null | undefined)[]): string {
  const known = bills.filter(isNumber);
  return known.length === 0 ? NONE : known.reduce((sum, bill) => sum + bill, 0).toFixed(2);
}

function endingOf(solve: Counted | undefined): string {
  const ending = solve?.ending;
  if (ending?.outcome === PASS) return "wrong-pass";
  const named = isString(ending?.kind) ? ending.kind : ending?.outcome;
  return isString(named) ? named : NONE;
}

function placeOf(context: Context, part: string, task: string): string[] {
  return [context.session, context.read, part, task.slice(0, 8), ...originOf(context, task)];
}

function originOf(context: Context, task: string): [string, string] {
  const writer = context.writers.get(task);
  return [writer?.session ?? "not recorded", writer?.family ?? NONE];
}

function pairRow(context: Context, pair: Paired): string {
  const side = (which: "old" | "fresh") =>
    pair[which]
      .map((valid, at) => (valid ? PASS : endingOf(context.ran.get(pair.solves?.[which][at] ?? ""))))
      .join(",");
  const difference = differenceOf(pair);
  const measures: Measures = pointsOf(pair);
  const rebuilt = context.aa.get(pair.task);
  const self = context.self.get(pair.task);
  const stored = context.stored.get(pair.task);
  const best = (which: "old" | "fresh") => sideGap([pair], which, context.bests).ratio?.toFixed(2) ?? NONE;
  return [
    ...placeOf(context, context.retained.has(pair.task) ? "retained" : "frontier", pair.task),
    side("old"),
    side("fresh"),
    String(difference),
    carriedBy(measures) ?? NONE,
    stored === undefined ? NONE : String(stored),
    rebuilt === undefined ? NONE : String(differenceOf(rebuilt)),
    self === undefined ? NONE : String(differenceOf(self)),
    `${flipped(pair.old) ? "1" : "0"}/${flipped(pair.fresh) ? "1" : "0"}`,
    `${repeatOf(pair, "old")}/${repeatOf(pair, "fresh")}`,
    howOftenValid(pair),
    `${best("old")}/${best("fresh")}`,
    billedOf([...(pair.used?.old ?? []), ...(pair.used?.fresh ?? [])].map(({ billed }) => billed)),
    tieKind(pair) ?? NONE,
  ].join("\t");
}

function unpairedRow(context: Context, part: string, task: string, sides: readonly [string, string]): string {
  const solves = context.byTask.get(`${context.session}\0${task}`) ?? [];
  const said = (harness: string) =>
    solves
      .filter(({ under }) => under.harness === harness)
      .map((solve) => (passed(solve) === true ? PASS : endingOf(solve)))
      .join(",") || NONE;
  return [
    ...placeOf(context, part, task),
    said(sides[0]),
    said(sides[1]),
    ...Array.from({ length: 9 }, () => NONE),
    billedOf(solves.map(({ end }) => (isNumber(end.billed) ? end.billed : null))),
    NONE,
  ].join("\t");
}

function quantile(values: readonly number[], share: number): number {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(share * sorted.length) - 1)] ?? 0;
}

/** A tally of task scores and its sign-flip p-value. */
function formatDifferenceTest(differences: readonly number[]): string {
  const { wins, losses, ties, p } = testOf(differences);
  return `${String(wins)}-${String(losses)}-${String(ties)} p ${p.toFixed(4)}`;
}

/** The tally of each arm's first rollouts alone and second rollouts alone: descriptive only,
 *  never a decision reading (rule 1). */
function formatSplitHalves(pairs: readonly Paired[]): string {
  if (pairs.length === 0 || pairs.some(({ old, fresh }) => old.length < 2 || fresh.length < 2)) {
    return "solve halves: not split, fewer than two rollouts per arm";
  }
  const at = (index: number) => pairs.map((pair) => differenceOf(pairingOf(pair, index, index)));
  return `solve halves (descriptive only): first rollouts ${formatDifferenceTest(at(0))}, second rollouts ${formatDifferenceTest(at(1))}`;
}

function winsAgainstNoise(context: Context, pairs: readonly Paired[]): string {
  const counts = { inside: 0, level: 0, outside: 0, none: 0 };
  for (const pair of pairs) {
    const stands = againstNoise(context, pair);
    if (stands !== null) counts[stands] += 1;
  }
  const { inside, level, outside, none } = counts;
  return `== ${context.session} wins of the new side against their own task's rebuilt A/A: inside ${String(inside)}, level ${String(level)}, outside ${String(outside)}, no A/A ${String(none)}`;
}

function againstNoise(context: Context, pair: Paired): "inside" | "level" | "outside" | "none" | null {
  const [win, aa] = [differenceOf(pair), context.aa.get(pair.task)];
  if (win <= 0) return null;
  if (aa === undefined) return "none";
  const noise = Math.abs(differenceOf(aa));
  return win < noise ? "inside" : win === noise ? "level" : "outside";
}

function formatGroupBreakdown(context: Context, pairs: readonly Paired[], by: "writer" | "family"): string {
  const groups = Map.groupBy(pairs, ({ task }) => originOf(context, task)[by === "writer" ? 0 : 1]);
  const lines = [...groups]
    .toSorted(([, one], [, other]) => other.length - one.length)
    .map(([key, some]) => {
      const diffs = some.map((pair) => differenceOf(pair));
      const count = (sign: number) => String(diffs.filter((diff) => Math.sign(diff) === sign).length);
      const net = diffs.reduce((sum, diff) => sum + diff, 0);
      const outside = some.filter((pair) => againstNoise(context, pair) === "outside").length;
      const retained = some.filter(({ task }) => context.retained.has(task)).length;
      return `${key} ${count(1)}-${count(-1)}-${count(0)}, diff ${net > 0 ? "+" : ""}${String(net)}, ${String(outside)} outside${retained === 0 ? "" : `, ${String(retained)} retained`}`;
    });
  return `== ${context.session} by ${by} (won-lost-tied of the new arm, summed diff, wins outside their task's A/A): ${lines.join("; ")}`;
}

function formatGranularityBreakdown(context: Context, pairs: readonly Paired[], grain: Grain): string {
  const [largest = 0, ...rest] = pairs
    .map((pair) => Math.abs(differenceOf(pair)))
    .toSorted((one, other) => other - one);
  const others = rest.reduce((sum, size) => sum + size, 0);
  const family =
    grain === null
      ? "no family tallies"
      : `the largest family holds ${String(grain.largest)} of ${String(grain.of)} tallied frontier tasks`;
  const carried =
    rest.length > 0 && largest > others
      ? `one task's diff (${String(largest)} in size) exceeds the other ${String(rest.length)} together (${String(others)})`
      : "no task's diff exceeds the others together";
  return `== ${context.session} grain, naming no family: ${family}; ${carried}`;
}

function summaryOf(
  context: Context,
  report: JsonObject,
  pairs: readonly Paired[],
  untallied: string,
): string {
  const kinds = pairs.flatMap((pair) => tieKind(pair) ?? []);
  const tieKindsSummary = KINDS.map(
    (kind) => `${kind} ${String(kinds.filter((one) => one === kind).length)}`,
  ).join(", ");
  const rebuilt = pairs.flatMap(({ task }) => {
    const aa = context.aa.get(task);
    return aa === undefined ? [] : [Math.abs(differenceOf(aa))];
  });
  const differ = pairs.filter(({ task }) => {
    const [aa, stored] = [context.aa.get(task), context.stored.get(task)];
    return aa !== undefined && stored !== undefined && differenceOf(aa) !== stored;
  }).length;
  const aaSummary =
    rebuilt.length === 0
      ? "A/A not rebuilt"
      : `A/A |difference| rebuilt median ${String(quantile(rebuilt, 0.5))}, p75 ${String(quantile(rebuilt, 0.75))}, p90 ${String(quantile(rebuilt, 0.9))}, max ${String(quantile(rebuilt, 1))} over ${String(rebuilt.length)}; stored ${context.stored.size === 0 ? "not recorded" : `differs from rebuilt on ${String(differ)} of ${String(rebuilt.length)}`}`;
  const tied = pairs.filter((pair) => differenceOf(pair) === 0);
  const billed = (some: readonly Paired[]) => {
    const amount = billedOf(
      some.flatMap((pair) =>
        [...(pair.used?.old ?? []), ...(pair.used?.fresh ?? [])].map(({ billed: one }) => one),
      ),
    );
    return amount === NONE ? "none recorded" : `$${amount}`;
  };
  const retained = pairs.filter(({ task }) => context.retained.has(task)).length;
  return [
    `== ${context.session} ${context.read} ${isString(report.reading) ? report.reading : "unread"}: tallied ${String(pairs.length)} (frontier ${String(pairs.length - retained)}, retained ${String(retained)})${untallied}`,
    `ties ${String(tied.length)}: ${tieKindsSummary}`,
    aaSummary,
    formatSplitHalves(pairs),
    `billed ${billed(tied)} on tied tasks, ${billed(pairs.filter((pair) => differenceOf(pair) !== 0))} on untied`,
  ].join("; ");
}

/** The stored A/A of a report by task, where its scores align with `versions`. */
function storedOf(data: JsonObject): Map<string, number> {
  const versions = Array.isArray(data.versions) ? data.versions.filter(isString) : [];
  const scores = scoresIn(asRecord(data.noise) ?? {});
  return scores.length === versions.length && scores.length > 0
    ? new Map(versions.map((version, at) => [version, scores[at] ?? 0]))
    : new Map<string, number>();
}

function versionsIn(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.filter(isString) : [];
}

function comparisonRows(
  events: readonly LogEvent[],
  start: JsonObject,
  report: Reported | undefined,
  shared: Pick<Context, "writers" | "ran" | "byTask" | "bests">,
  grain: Grain = null,
): string[] {
  const data = report?.data ?? start;
  const [old, fresh] = [isString(data.old) ? data.old : "", isString(data.fresh) ? data.fresh : ""];
  const byTask = (pairs: readonly Paired[]) => new Map(pairs.map((pair) => [pair.task, pair]));
  const context: Context = {
    ...shared,
    session: isString(start.session) ? start.session : "",
    read: fresh === data.starter && old !== data.starter ? "starter" : "candidate",
    retained: new Set(versionsIn(start.retained)),
    stored: report === undefined ? new Map() : storedOf(report.data),
    aa: report === undefined ? new Map() : byTask(pairsReported(events, report, "old")),
    self: report === undefined ? new Map() : byTask(pairsReported(events, report, "fresh")),
  };
  const sides = [old, fresh] as const;
  if (report === undefined) {
    const rows = versionsIn(start.tasks).map((task) => unpairedRow(context, "open", task, sides));
    return [
      ...rows,
      `== ${context.session} ${context.read} open: no report; ${String(rows.length)} tasks named at its start`,
    ];
  }
  const pairs = pairsReported(events, report);
  const listed = new Map(
    APART.flatMap((part) => versionsIn(report.data[part]).map((task) => [task, part] as const)),
  );
  const tallied = new Set(pairs.map(({ task }) => task));
  const unpaired = versionsIn(start.tasks).filter((task) => !tallied.has(task) && !listed.has(task));
  const apart = [...listed].map(([task, part]) => unpairedRow(context, part, task, sides));
  const loose = unpaired.map((task) => unpairedRow(context, "unpaired", task, sides));
  const counts = [
    ...APART.map((part) => [part, [...listed.values()].filter((one) => one === part).length] as const),
    ["unpaired", unpaired.length] as const,
  ];
  const untallied = counts.flatMap(([part, n]) => (n === 0 ? [] : [`, ${part} ${String(n)}`])).join("");
  return [
    ...pairs.map((pair) => pairRow(context, pair)),
    ...apart,
    ...loose,
    winsAgainstNoise(context, pairs),
    formatGroupBreakdown(context, pairs, "writer"),
    formatGroupBreakdown(context, pairs, "family"),
    formatGranularityBreakdown(context, pairs, grain),
    summaryOf(context, report.data, pairs, untallied),
  ];
}

export function pairRows(events: readonly LogEvent[]): string[] {
  const reports = new Map(lastReports(events).map((report) => [report.session, report]));
  const starts = new Map(
    eventsOf(events, "comparison.started").flatMap(({ event: { data } }) =>
      isString(data.session) ? [[data.session, data] as const] : [],
    ),
  );
  const writers = new Map(
    proposalsOf(events).map(({ version, session, family }) => [
      version,
      { session: session ?? OPENING, family: family ?? NONE },
    ]),
  );
  const { bests } = poolOf(events);
  const testSolves = ended(ranUnder(events)).filter((solve) => solve.under.side === "test");
  const ran = new Map(testSolves.map((solve) => [solve.id, solve] as const));
  const byTask = Map.groupBy(
    testSolves,
    ({ start, under }) => `${isString(start.comparison) ? start.comparison : ""}\0${under.task}`,
  );
  const grains = new Map(
    campaignOf(events).steps.flatMap((step) => (step.step === "comparison" ? [[step.id, step.grain]] : [])),
  );
  const rows = [...starts].flatMap(([session, start]) =>
    comparisonRows(events, start, reports.get(session), { writers, ran, byTask, bests }, grains.get(session)),
  );
  const unaligned = [...reports.values()].filter(
    ({ data }) => asRecord(data.noise) !== null && storedOf(data).size === 0,
  ).length;
  return [
    `pairs: one row per task each comparison named, by its last report; diff, aa_stored, aa_rebuilt and new_self in thousandths, new side over reference${unaligned === 0 ? "" : `; the stored A/A of ${String(unaligned)} reports is not recorded by task`}`,
    HEAD,
    ...rows,
  ];
}

export function sideGap(
  pairs: readonly Paired[],
  side: "old" | "fresh",
  bests: ReadonlyMap<string, number>,
): SideGap {
  const ratios: number[] = [];
  let unread = 0;
  for (const { task, objective } of pairs) {
    const measures = objective?.[side].filter((measure) => measure !== null) ?? [];
    if (measures.length === 0) continue;
    const best = bests.get(task);
    let entry: number | null = null;
    if (best !== undefined && objective?.scale === "unit") {
      entry = median(measures.map((measure) => 1 + gainOver(objective, best, measure)));
    } else if (best !== undefined && best > 0) {
      const own = measures.filter((measure) => measure > 0);
      entry = median(
        own.map((measure) => (objective?.direction === "lower" ? measure / best : best / measure)),
      );
    }
    if (entry === null) unread += 1;
    else ratios.push(entry);
  }
  return {
    ratio: median(ratios),
    atBest: ratios.filter((ratio) => ratio <= 1 + GAP_FLOOR).length,
    read: ratios.length,
    unread,
  };
}
