#!/usr/bin/env bun
/**
 * Every promotion on record, and every comparison that fell short of one, scored again by one tree's
 * weighted measures from the recorded solves; and, with `--try`, `--mechanism` or `--against`, any
 * other promotion mechanism read beside the tree's own on one panel. It starts no solve, calls no
 * model and writes nothing of a campaign's.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { type Found, campaignLogs, rehearsed } from "#skills/main/logs.ts";
import { falseSteps } from "#skills/main/stats.ts";
import { short } from "#src/campaign/move.ts";
import { carriedBy as carriedOn, type Paired, wholePoints } from "#src/kernel/compare.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import type { Reported } from "#src/kernel/reports.ts";
import { DAY_MS } from "#src/meta/clock.ts";
import { type JsonValue, asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { resolve } from "#src/meta/path.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { median } from "#src/meta/tally.ts";
import { formatTally, FROM, lost, panelMain, treeMechanism, won } from "./panel.ts";
import { readsStarter, selfTerms } from "./record.ts";
import { epochLines } from "./time.ts";
import { type Points, type Tree, loadTree } from "./tree.ts";

const USAGE = `usage:
  bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/replay.ts [--tree <worktree>]
    [--logs <dir>] [--name <campaign>]... [--since <date>] [--totals]
    [--try <knobs>|standard]... [--mechanism <file>]... [--against <worktree>]...
    [--from <tag or date>] [--record <file>] [--refresh] [--split <tag or date>] [--named]

--tree       the worktree whose src/kernel scores the record (main's, or a candidate's); this checkout by default
--logs       an explicit offline folder of campaigns; default: the registry and every configured host
--name       these campaigns only, whenever they ran (repeatable)
--since      campaigns whose last event is at or after this date; five days back by default
--totals     print the totals alone

A panel of mechanisms beside the tree's own, in place of the replay, with any of these:
--try        a mechanism as knobs over today's, as bill=0.05,when=tied (repeatable; see mechanisms.ts);
             standard: a set of the bill's, time's and the score's forms
--mechanism  a file whose default export is a Mechanism or a list of them (repeatable)
--against    a candidate worktree, read by its own pointsOf and isSignificant, readsStep, or stepOf (repeatable)
--from       campaigns opened at or after this release tag or date; ${FROM} by default
--record     keep the reduced record in this file (under data/derived/: it holds exam-side measures), and
             read it from there next time
--refresh    read the logs again although --record exists
--split      each row's step rates either side of this tag or date, raw and at the pooled mix of packs
--named      name each comparison a mechanism added or dropped`;
const OPTIONS = {
  tree: "abs",
  logs: "abs",
  since: "text",
  name: "list",
  totals: "flag",
  try: "list",
  mechanism: "list",
  against: "list",
  from: "text",
  record: "abs",
  refresh: "flag",
  split: "text",
  named: "flag",
} as const;
const ROOT = resolve(import.meta.dir, "..", "..", "..", "..");
const DAYS_BACK = 5;
const PROMOTED = "harness.promoted";
const MEASURES = ["validity", "objective", "bill"] as const;

type Measure = (typeof MEASURES)[number];

interface Reading {
  readonly session: string;
  readonly key: string;
  readonly differences: readonly number[];
  readonly unbilled: readonly number[] | null;
  readonly level: number;
  readonly step: boolean;
  readonly starter: boolean;
  readonly noise: boolean;
  /** The tasks it won, by the first measure that gave them points: validity, the objective, or the
   *  bill alone. */
  readonly wonBy: Readonly<Record<Measure, number>>;
  readonly aa: {
    readonly differences: readonly number[];
    readonly powered: boolean;
    readonly step: boolean;
  } | null;
}

interface Totals {
  campaigns: number;
  compared: number;
  recorded: number;
  rightful: number;
  doubted: number;
  added: number;
  dropped: number;
  unread: number;
  readings: number;
  weighted: number;
  moved: number;
  toStep: number;
  fromStep: number;
  byTest: number;
  storedTasks: number;
  controls: number;
  powered: number;
  aaSteps: number;
  levels: Set<number>;
  aaWon: number;
  aaLost: number;
  aaMoved: number;
  wonBy: Record<Measure, number>;
  followed: number;
  held: number;
  cleared: number;
  hours: number[];
  dollars: number[];
}

interface Promotion {
  readonly key: string;
  readonly index: number;
}

export function emptyTotals(): Totals {
  return {
    campaigns: 0,
    compared: 0,
    recorded: 0,
    rightful: 0,
    doubted: 0,
    added: 0,
    dropped: 0,
    unread: 0,
    readings: 0,
    weighted: 0,
    moved: 0,
    toStep: 0,
    fromStep: 0,
    byTest: 0,
    storedTasks: 0,
    controls: 0,
    powered: 0,
    aaSteps: 0,
    levels: new Set(),
    aaWon: 0,
    aaLost: 0,
    aaMoved: 0,
    wonBy: { validity: 0, objective: 0, bill: 0 },
    followed: 0,
    held: 0,
    cleared: 0,
    hours: [],
    dollars: [],
  };
}

const numbers = (value: JsonValue | undefined) => (Array.isArray(value) ? value.filter(isNumber) : []);

function weightedIn(points: JsonValue | undefined): boolean {
  const { validity, objective } = asRecord(points) ?? {};
  return isNumber(validity) && isNumber(objective);
}

/** A task's scores from its points: with the bill where the tree scores one, and without it, which
 *  a step is read on. */
function scoresOf({ validity, objective, bill }: Points) {
  return { scored: wholePoints(validity + objective + bill), unbilled: wholePoints(validity + objective) };
}

/** The bill where the score without it does not share the score's sign, and otherwise this tree's
 *  reading (`carriedBy`). */
function carriedBy(points: Points): Measure | null {
  const { scored, unbilled } = scoresOf(points);
  if (scored === 0) return null;
  return Math.sign(unbilled) === Math.sign(scored) ? carriedOn(points) : "bill";
}

/** Named tasks rebuilt from pairs; stored scores stand where the log lacks a pair, and missing
 *  cost-excluded evidence stays unknown, so the dual rule cannot promote it. */
function scoredSet(
  tree: Tree,
  set: JsonValue | undefined,
  pairs: ReadonlyMap<string, Paired>,
  totals: Totals,
) {
  const record = asRecord(set);
  const stored = numbers(record?.differences);
  // A report whose scores name no tasks keeps its differences as stored.
  const tasks =
    Array.isArray(record?.of) && record.of.length === stored.length ? record.of : stored.map(() => null);
  const without = numbers(record?.unbilled);
  const unbilled = without.length === stored.length ? without : [];
  const points: Points[] = [];
  const scores = tasks.map((task, at) => {
    const pair = isString(task) ? pairs.get(task) : undefined;
    if (pair === undefined) {
      totals.storedTasks += 1;
      return { scored: stored[at] ?? 0, unbilled: unbilled[at] ?? null };
    }
    const one = tree.points(pair);
    points.push(one);
    return scoresOf(one);
  });
  return {
    stored,
    points,
    differences: scores.map((one) => one.scored),
    unbilled: scores.every((one) => one.unbilled !== null)
      ? scores.flatMap((one) => one.unbilled ?? [])
      : null,
  };
}

/** The reference against itself on halves of its own solves, as the comparison's report reads it
 *  (`compared`, `src/campaign/comparison.ts`), and whether the tree's rule reads it a step and could
 *  read one at all (`falsePromotion`, `src/campaign/climb.ts`); null under two solves a side or an
 *  odd number. */
function aaOf(tree: Tree, events: readonly LogEvent[], report: Reported, level: number): Reading["aa"] {
  const terms = selfTerms(events, report);
  if (terms === null) return null;
  const { versions } = report.data;
  const tasks = Array.isArray(versions) ? versions.filter(isString) : [];
  const scores = tree
    .pairsOf(events.slice(0, report.index + 1), tasks, terms.sides, terms.solves)
    .map((pair) => scoresOf(tree.points(pair)));
  const [differences, unbilled] = [scores.map((one) => one.scored), scores.map((one) => one.unbilled)];
  return {
    differences,
    powered: tree.isSignificant(differences.map(Math.abs), unbilled.map(Math.abs), level),
    step: tree.isSignificant(differences, unbilled, level),
  };
}

function readingsOf(tree: Tree, events: readonly LogEvent[], totals: Totals): Reading[] {
  return tree.lastReports(events).flatMap((report): Reading[] => {
    const { old, fresh, frontier, retained, noise, points, reading, level: recorded } = report.data;
    if (!Array.isArray(asRecord(frontier)?.differences) || !isString(old) || !isString(fresh)) return [];
    const pairs = new Map(tree.pairsReported(events, report).map((pair) => [pair.task, pair]));
    const sets = [scoredSet(tree, frontier, pairs, totals), scoredSet(tree, retained, pairs, totals)];
    const differences = sets.flatMap((set) => set.differences);
    const level = isNumber(recorded) ? recorded : 0;
    const unbilled = sets.every((set) => set.unbilled !== null)
      ? sets.flatMap((set) => set.unbilled ?? [])
      : null;
    const step = tree.isSignificant(differences, unbilled, level);
    const weighted = weightedIn(points);
    const aa = aaOf(tree, events, report, level);
    const starter = readsStarter(events, report);
    const noiseOnly = !starter && old === fresh;
    totals.readings += 1;
    totals.weighted += weighted ? 1 : 0;
    if (weighted) {
      totals.moved += differences.join(",") === sets.flatMap((set) => set.stored).join(",") ? 0 : 1;
      totals.aaMoved +=
        aa !== null && aa.differences.join(",") !== numbers(asRecord(noise)?.differences).join(",") ? 1 : 0;
    }
    if (!starter && !noiseOnly && step !== (reading === "step")) {
      totals.toStep += step ? 1 : 0;
      totals.fromStep += step ? 0 : 1;
      const stored = sets.flatMap((set) => set.stored);
      totals.byTest += tree.isSignificant(stored, null, level) === step ? 1 : 0;
    }
    const wonBy = { validity: 0, objective: 0, bill: 0 };
    for (const one of sets.flatMap((set) => set.points)) {
      const by = scoresOf(one).scored > 0 ? carriedBy(one) : null;
      if (by !== null) wonBy[by] += 1;
    }
    return [
      {
        session: report.session,
        key: `${old}>${fresh}`,
        differences,
        unbilled,
        level,
        step,
        starter,
        noise: noiseOnly,
        wonBy,
        aa,
      },
    ];
  });
}

const toldReading = (tree: Tree, reading: Reading) =>
  `${reading.session} ${formatTally(reading.differences)} p ${tree.flipP(reading.differences).toFixed(4)}; without the bill ${reading.unbilled === null ? "unread" : `${formatTally(reading.unbilled)} p ${tree.flipP(reading.unbilled).toFixed(4)}`}`;

const aaLine = (reading: Reading) =>
  reading.aa === null
    ? "A/A unread"
    : `A/A ${formatTally(reading.aa.differences)}${reading.aa.step ? " STEP" : ""}`;

function promotedLines(
  tree: Tree,
  readings: readonly Reading[],
  at: number,
  recorded: boolean,
  totals: Totals,
) {
  const rests = readings[at];
  if (rests === undefined) return [];
  const later = readings.slice(at + 1);
  const against = later.filter(({ differences }) => lost(differences) > won(differences));
  const doubts = [
    ...(rests.aa?.step === true ? ["its A/A read a step"] : []),
    ...(against.length > 0 ? [`${String(against.length)} later reading lost more than it won`] : []),
  ];
  for (const measure of MEASURES) totals.wonBy[measure] += rests.wonBy[measure];
  if (!recorded) totals.added += 1;
  else if (doubts.length === 0) totals.rightful += 1;
  else totals.doubted += 1;
  const verdict = doubts.length === 0 ? "rightful" : `in doubt: ${doubts.join("; ")}`;
  return [
    `    ${toldReading(tree, rests)}: promotes; ${recorded ? verdict : "added by this score"}`,
    `    won by validity ${String(rests.wonBy.validity)}, by the objective ${String(rests.wonBy.objective)}, by the bill alone ${String(rests.wonBy.bill)}; ${aaLine(rests)}`,
    `    later readings of the pair: ${later.length === 0 ? "none" : later.map((one) => toldReading(tree, one)).join(", ")}`,
  ];
}

function pairLines(
  tree: Tree,
  readings: readonly Reading[],
  promotions: readonly Promotion[],
  totals: Totals,
) {
  const pairs = Map.groupBy(
    readings.filter(({ starter, noise }) => !starter && !noise),
    ({ key }) => key,
  );
  const lines: string[] = [];
  for (const [key, list] of pairs) {
    const recorded = promotions.some((one) => one.key === key);
    const at = list.findIndex((one) => one.step);
    countFollowed(list, totals);
    const [old = "", fresh = ""] = key.split(">");
    lines.push(`  ${short(old)} > ${short(fresh)}${recorded ? ", promoted on record" : ""}`);
    if (at !== -1) {
      lines.push(...promotedLines(tree, list, at, recorded, totals));
      continue;
    }
    if (recorded) totals.dropped += 1;
    for (const one of list) {
      lines.push(
        `    ${toldReading(tree, one)}: reads no step by the tree's rule at ${String(one.level)}; ${aaLine(one)}`,
      );
    }
    lines.push(`    ${recorded ? "NOT PROMOTED by this score" : "no promotion"}`);
  }
  for (const promotion of promotions) {
    if (pairs.has(promotion.key)) continue;
    totals.unread += 1;
    const [old = "", fresh = ""] = promotion.key.split(">");
    lines.push(
      `  ${short(old)} > ${short(fresh)}, promoted on record with no reading of the pair that holds a frontier`,
    );
  }
  return lines;
}

/** Whether the pair's next reading stepped too or only won at least as many tasks as it lost, since
 *  a reading just over the level can be counted as held where only a tied repeat would have been. */
function countFollowed(list: readonly Reading[], totals: Totals): void {
  for (const [at, reading] of list.entries()) {
    const next = list[at + 1]?.differences;
    if (!reading.step || next === undefined) continue;
    totals.followed += 1;
    totals.held += won(next) >= lost(next) ? 1 : 0;
    totals.cleared += list[at + 1]?.step === true ? 1 : 0;
  }
}

export function campaignLines(tree: Tree, found: Found, totals: Totals): string[] {
  let events: LogEvent[];
  try {
    events = tree.read(found.path);
  } catch (error) {
    return [`${found.name}: not read, ${errorMessage(error)}`];
  }
  if (rehearsed(events)) return [];
  totals.campaigns += 1;
  const promotions = events.flatMap(({ kind, data }, index): Promotion[] =>
    kind === PROMOTED && isString(data.from) && isString(data.harness)
      ? [{ key: `${data.from}>${data.harness}`, index }]
      : [],
  );
  totals.recorded += promotions.length;
  const readings = readingsOf(tree, events, totals);
  totals.compared += readings.length > 0 ? 1 : 0;
  for (const { aa, level } of readings) {
    if (aa === null) continue;
    totals.controls += 1;
    totals.powered += aa.powered ? 1 : 0;
    totals.aaSteps += aa.step ? 1 : 0;
    if (aa.powered) totals.levels.add(level);
    totals.aaWon += won(aa.differences);
    totals.aaLost += lost(aa.differences);
  }
  const time = epochLines(
    tree,
    events,
    promotions.map(({ index }) => index),
  );
  totals.hours.push(...time.promoted.map(({ hours }) => hours));
  totals.dollars.push(...time.promoted.map(({ dollars }) => dollars));
  return [
    `${found.name}: ${String(promotions.length)} promoted on record, ${String(readings.length)} readings`,
    ...pairLines(tree, readings, promotions, totals),
    ...time.lines,
  ];
}

function totalLines(tree: Tree, totals: Totals): string[] {
  const per = (values: readonly number[], unit: string) =>
    values.length === 0
      ? "none"
      : `median ${(median(values) ?? 0).toFixed(1)}${unit}, from ${Math.min(...values).toFixed(1)} to ${Math.max(...values).toFixed(1)}`;
  const weights = MEASURES.map((measure) => String(Math.round(tree.weights[measure] * 100))).join(",");
  const reconciled = `; of the ${String(totals.weighted)} written under the weights, read otherwise than stored ${String(totals.moved)}, A/A ${String(totals.aaMoved)}`;
  const { validity, objective, bill } = totals.wonBy;
  return [
    `totals, tree ${tree.path} at ${tree.commit}, weights ${weights}, the recorded level`,
    `  campaigns ${String(totals.campaigns)}, with a reading ${String(totals.compared)}; promotions on record ${String(totals.recorded)}: rightful ${String(totals.rightful)}, in doubt ${String(totals.doubted)}, not promoted by this score ${String(totals.dropped)}, on readings with no frontier (before 12 October) ${String(totals.unread)}`,
    `  pairs this score promotes ${String(totals.rightful + totals.doubted + totals.added)} (added ${String(totals.added)})`,
    `  readings ${String(totals.readings)}${reconciled}; candidates read otherwise than recorded: to a step ${String(totals.toStep)}, from a step ${String(totals.fromStep)}, of which ${String(totals.byTest)} by this tree's test on the stored scores and the rest by its scores; tasks read from the stored difference for want of a pair ${String(totals.storedTasks)}`,
    `  A/A controls ${String(totals.controls)}, powered ${String(totals.powered)}, false steps ${falseSteps(totals.aaSteps, totals.powered, [...totals.levels])}; untied won ${String(totals.aaWon)} lost ${String(totals.aaLost)}`,
    `  tasks the promoting readings won: by validity ${String(validity)}, by the objective ${String(objective)}, by the bill alone ${String(bill)}`,
    `  steps followed by a reading of the same pair ${String(totals.followed)}, of which stepped again ${String(totals.cleared)} and won at least as many as lost ${String(totals.held)}`,
    `  per promotion: hours ${per(totals.hours, " h")}; dollars ${per(totals.dollars, "")}`,
  ];
}

async function main(args: CommandArgs): Promise<number> {
  const tree = await loadTree(args.value("tree") ?? ROOT);
  const panel = ["try", "mechanism", "against"].some((name) => args.list(name).length > 0);
  if (panel || args.flag("named") || args.value("split") !== null) {
    return panelMain(args, tree, treeMechanism(tree, "tree"));
  }
  const since = args.value("since") ?? new Date(Date.now() - DAYS_BACK * DAY_MS).toISOString();
  const logs = await campaignLogs(args.value("logs"), args.list("name"), since);
  const totals = emptyTotals();
  for (const found of logs) {
    const lines = campaignLines(tree, found, totals);
    if (!args.flag("totals") && lines.length > 0) console.log(`${lines.join("\n")}\n`);
  }
  console.log(totalLines(tree, totals).join("\n"));
  return 0;
}

if (import.meta.main) await runCommand({ name: "replay", usage: USAGE, options: OPTIONS }, main);
