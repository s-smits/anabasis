#!/usr/bin/env bun
/**
 * Every promotion on record, and every comparison that fell short of one, scored again by one tree's
 * weighted measures from the recorded solves. It starts no solve, calls no model and writes nothing.
 *
 *   bun .claude/skills/promotion-tuner/scripts/replay.ts --tree <worktree>
 *     [--logs <dir>] [--since <date>] [--name <campaign>]... [--weights v,o,b] [--level <n>] [--totals]
 *
 * For each pair of harnesses a campaign compared, the tree's `pairsReported` reads each comparison's
 * pairs again, and the tree's `pointsOf` scores each task by validity, the objective and the bill.
 * `--weights` weighs those measures otherwise without a candidate tree: each measure's points are
 * its mean over the pairings times its weight, so the tree's points are divided by its own weight
 * and multiplied by the one asked. The floors (`ROOM`, `FULL`, `CHEAPER`) shape the mean itself, so
 * a floor is changed in a candidate tree. One reading at or under the level over the frontier and
 * retained tasks together promotes only if it also clears without the bill (`readsStep`), at the
 * recorded level or at `--level`.
 *
 * Beside each promotion it prints the tally and p it rests on, as scored and without the bill,
 * which measure won each task, the A/A of that comparison (the reference against itself on halves
 * of its own solves mirrored in time, read either way at the level by `readsStepEitherWay`), and
 * every later reading of the pair.
 * For each epoch that ended in a promotion it prints the hours and dollars (`time.ts`).
 *
 * A report written under the weights holds its points (`points`), and its differences are the
 * tree's own to reconcile; a report from before 21 October was tallied rule by rule, and the replay
 * says how many of those the weights read otherwise.
 *
 * Tuning runs it on `main`'s tree and on a candidate (SKILL.md). It prints counts, session ids, short
 * digests and campaign names, and never a task, an answer, a measure or a check.
 *
 * Rewritten on 21 October for the weighted score of #306: until then it read the margin, the trigger
 * and the two-stage rule of older trees, and the rule-by-rule tally, none of which `main` holds.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { type Measures, type Paired, scoresOf } from "#src/kernel/compare.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import type { Reported } from "#src/kernel/reports.ts";
import { type JsonValue, asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { median } from "#src/meta/tally.ts";
import { epochLines } from "./time.ts";
import { type Found, type Tree, campaignLogs, loadTree, rehearsed } from "./tree.ts";

const USAGE = `usage:
  bun .claude/skills/promotion-tuner/scripts/replay.ts --tree <worktree>
    [--logs <dir>] [--since <date>] [--name <campaign>]... [--weights v,o,b] [--level <n>] [--totals]

--tree     the worktree whose src/kernel scores the record (main's, or a candidate's)
--logs     an explicit offline folder of campaign worktrees; default: the registry and every configured host
--since    campaigns whose last event is at or after this date; five days back by default
--name     these campaigns only, whenever they ran (repeatable)
--weights  weigh validity, the objective and the bill thus, in place of the tree's WEIGHTS (60,30,10)
--level    read every comparison and A/A at this level, in place of the recorded one
--totals   print the totals alone`;
const OPTIONS = {
  tree: "abs",
  logs: "abs",
  since: "text",
  name: "list",
  weights: "text",
  level: "text",
  totals: "flag",
} as const;
const DAYS_BACK = 5;
const DAY_MS = 86_400_000;
const LEVEL = 0.02;
const PROMOTED = "harness.promoted";
const MEASURES = ["validity", "objective", "bill"] as const;

type Measure = (typeof MEASURES)[number];

/** How the replay scores a task: the tree's points, each measure scaled by the weight asked over
 *  the tree's own. */
interface Score {
  readonly tree: Tree;
  readonly scale: Measures;
  /** Whether the weights are the tree's own, so a weighted report's differences reconcile. */
  readonly own: boolean;
  readonly level: number | null;
}

/** One comparison's last report, scored again. */
interface Reading {
  readonly session: string;
  readonly key: string;
  /** The frontier's and retained set's differences together, as the one test reads them. */
  readonly differences: readonly number[];
  /** The same tasks without the bill, or null where the record cannot supply that test. */
  readonly unbilled: readonly number[] | null;
  readonly level: number;
  readonly step: boolean;
  /** The tasks it won, by the first measure that gave them points: validity, the objective, or the
   *  bill alone. */
  readonly wonBy: Readonly<Record<Measure, number>>;
  /** The A/A's differences, or null where the comparison had fewer than two solves a side. */
  readonly aa: { readonly differences: readonly number[]; readonly unbilled: readonly number[] } | null;
}

/** The counts summed over every campaign read. */
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
  storedTasks: number;
  controls: number;
  aaSteps: number;
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

/** A recorded promotion: the pair it names and where it stands in the log. */
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
    storedTasks: 0,
    controls: 0,
    aaSteps: 0,
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

const short = (digest: string) => digest.slice(0, 8);
const numbers = (value: JsonValue | undefined) => (Array.isArray(value) ? value.filter(isNumber) : []);
const won = (differences: readonly number[]) => differences.filter((one) => one > 0).length;
const lost = (differences: readonly number[]) => differences.filter((one) => one < 0).length;
const wlt = (differences: readonly number[]) =>
  `${String(won(differences))}-${String(lost(differences))}-${String(differences.length - won(differences) - lost(differences))}`;

/** A task's points by measure under the weights asked. */
function pointsOf(score: Score, pair: Paired): Measures {
  const points = score.tree.points(pair);
  return {
    validity: points.validity * score.scale.validity,
    objective: points.objective * score.scale.objective,
    bill: points.bill * score.scale.bill,
  };
}

/** Reconstruct named tasks from pairs; retain stored scores where the log lacks a pair.
 * Missing cost-excluded evidence stays unknown, so the dual rule cannot promote it. */
function scoredSet(
  score: Score,
  set: JsonValue | undefined,
  pairs: ReadonlyMap<string, Paired>,
  totals: Totals,
) {
  const record = asRecord(set);
  const stored = numbers(record?.differences);
  // A report before 14 October names no task, so its differences stand as stored.
  const tasks =
    Array.isArray(record?.of) && record.of.length === stored.length ? record.of : stored.map(() => null);
  const without = numbers(record?.unbilled);
  const unbilled = without.length === stored.length ? without : [];
  const points: Measures[] = [];
  const scores = tasks.map((task, at) => {
    const pair = isString(task) ? pairs.get(task) : undefined;
    if (pair === undefined) {
      totals.storedTasks += 1;
      return { scored: stored[at] ?? 0, unbilled: unbilled[at] ?? null };
    }
    const one = pointsOf(score, pair);
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
 *  (`compared`, `comparison.ts`), or null under two solves a side or an odd number. */
function aaOf(score: Score, events: readonly LogEvent[], report: Reported): Reading["aa"] {
  const { old, setting, solves, versions, objective } = report.data;
  if (!isString(old) || !isString(setting) || !isNumber(solves) || solves < 2 || solves % 2 !== 0) {
    return null;
  }
  const direction = asRecord(objective)?.direction;
  const rule: { direction: "lower" | "higher" } | undefined =
    direction === "lower" || direction === "higher" ? { direction } : undefined;
  const sides = {
    old,
    fresh: old,
    setting,
    comparison: report.session,
    halves: "mirrored" as const,
    ...keyIfDefined("objective", rule),
  };
  const tasks = Array.isArray(versions) ? versions.filter(isString) : [];
  const scores = score.tree
    .pairsOf(events.slice(0, report.index + 1), tasks, sides, solves / 2)
    .map((pair) => scoresOf(pointsOf(score, pair)));
  return {
    differences: scores.map((one) => one.scored),
    unbilled: scores.map((one) => one.unbilled),
  };
}

/** Each comparison with a frontier, scored again, its counts added to `totals`. */
function readingsOf(score: Score, events: readonly LogEvent[], totals: Totals): Reading[] {
  return score.tree.lastReports(events).flatMap((report): Reading[] => {
    const { old, fresh, frontier, retained, noise, points, reading, level: recorded } = report.data;
    if (!Array.isArray(asRecord(frontier)?.differences) || !isString(old) || !isString(fresh)) return [];
    const pairs = new Map(score.tree.pairsReported(events, report).map((pair) => [pair.task, pair]));
    const sets = [scoredSet(score, frontier, pairs, totals), scoredSet(score, retained, pairs, totals)];
    const differences = sets.flatMap((set) => set.differences);
    const level = score.level ?? (isNumber(recorded) ? recorded : LEVEL);
    const unbilled = sets.every((set) => set.unbilled !== null)
      ? sets.flatMap((set) => set.unbilled ?? [])
      : null;
    const step = score.tree.readsStep(differences, unbilled, level);
    const weighted = score.tree.measures(points) !== undefined;
    const aa = aaOf(score, events, report);
    totals.readings += 1;
    totals.weighted += weighted ? 1 : 0;
    if (weighted && score.own) {
      totals.moved += differences.join() === sets.flatMap((set) => set.stored).join() ? 0 : 1;
      totals.aaMoved +=
        aa !== null && aa.differences.join() !== numbers(asRecord(noise)?.differences).join() ? 1 : 0;
    }
    totals.toStep += step && reading !== "step" ? 1 : 0;
    totals.fromStep += !step && reading === "step" ? 1 : 0;
    const wonBy = { validity: 0, objective: 0, bill: 0 };
    for (const one of sets.flatMap((set) => set.points)) {
      // A won task counts for the first measure that gave it points.
      if (scoresOf(one).scored > 0) wonBy[MEASURES.find((measure) => one[measure] > 0) ?? "bill"] += 1;
    }
    return [
      { session: report.session, key: `${old}>${fresh}`, differences, unbilled, level, step, wonBy, aa },
    ];
  });
}

const toldReading = (score: Score, reading: Reading) =>
  `${reading.session} ${wlt(reading.differences)} p ${score.tree.flipP(reading.differences).toFixed(4)}; without the bill ${reading.unbilled === null ? "unread" : `${wlt(reading.unbilled)} p ${score.tree.flipP(reading.unbilled).toFixed(4)}`}`;

const aaLine = (score: Score, reading: Reading) =>
  reading.aa === null
    ? "A/A unread"
    : `A/A ${wlt(reading.aa.differences)}${score.tree.readsStepEitherWay(reading.aa.differences, reading.level, reading.aa.unbilled) ? " STEP" : ""}`;

/** A pair the score promotes: the reading it rests on, its A/A, and later readings. */
function promotedLines(
  score: Score,
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
    ...(rests.aa !== null &&
    score.tree.readsStepEitherWay(rests.aa.differences, rests.level, rests.aa.unbilled)
      ? ["its A/A read a step"]
      : []),
    ...(against.length > 0 ? [`${String(against.length)} later reading lost more than it won`] : []),
  ];
  for (const measure of MEASURES) totals.wonBy[measure] += rests.wonBy[measure];
  if (!recorded) totals.added += 1;
  else if (doubts.length === 0) totals.rightful += 1;
  else totals.doubted += 1;
  const verdict = doubts.length === 0 ? "rightful" : `in doubt: ${doubts.join("; ")}`;
  return [
    `    ${toldReading(score, rests)}: promotes; ${recorded ? verdict : "added by this score"}`,
    `    won by validity ${String(rests.wonBy.validity)}, by the objective ${String(rests.wonBy.objective)}, by the bill alone ${String(rests.wonBy.bill)}; ${aaLine(score, rests)}`,
    `    later readings of the pair: ${later.length === 0 ? "none" : later.map((one) => toldReading(score, one)).join(", ")}`,
  ];
}

/** The pairs a campaign compared, each with what the score reads of it. */
function pairLines(
  score: Score,
  readings: readonly Reading[],
  promotions: readonly Promotion[],
  totals: Totals,
) {
  const pairs = Map.groupBy(readings, ({ key }) => key);
  const lines: string[] = [];
  for (const [key, list] of pairs) {
    const recorded = promotions.some((one) => one.key === key);
    const at = list.findIndex((one) => one.step);
    countFollowed(list, totals);
    const [old = "", fresh = ""] = key.split(">");
    lines.push(`  ${short(old)} > ${short(fresh)}${recorded ? ", promoted on record" : ""}`);
    if (at !== -1) {
      lines.push(...promotedLines(score, list, at, recorded, totals));
      continue;
    }
    if (recorded) totals.dropped += 1;
    for (const one of list) {
      lines.push(
        `    ${toldReading(score, one)}: does not clear both tests at ${String(one.level)}; ${aaLine(score, one)}`,
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

/** Readings that step, and whether the pair's next reading stepped too or only won at least as many
 *  tasks as it lost: on 22 October an outside review found r3's g-14, 12-9-11 at p 0.0223, counted as
 *  held at 0.02, and a tied repeat would have been. */
function countFollowed(list: readonly Reading[], totals: Totals): void {
  for (const [at, reading] of list.entries()) {
    const next = list[at + 1]?.differences;
    if (!reading.step || next === undefined) continue;
    totals.followed += 1;
    totals.held += won(next) >= lost(next) ? 1 : 0;
    totals.cleared += list[at + 1]?.step === true ? 1 : 0;
  }
}

/** One campaign's block, its counts added to `totals`. */
export function campaignLines(score: Score, found: Found, totals: Totals): string[] {
  let events: LogEvent[];
  try {
    events = score.tree.read(found.path);
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
  const readings = readingsOf(score, events, totals);
  totals.compared += readings.length > 0 ? 1 : 0;
  for (const { aa, level } of readings) {
    if (aa === null) continue;
    totals.controls += 1;
    totals.aaSteps += score.tree.readsStepEitherWay(aa.differences, level, aa.unbilled) ? 1 : 0;
    totals.aaWon += won(aa.differences);
    totals.aaLost += lost(aa.differences);
  }
  const time = epochLines(
    score.tree,
    events,
    promotions.map(({ index }) => index),
  );
  totals.hours.push(...time.promoted.map(({ hours }) => hours));
  totals.dollars.push(...time.promoted.map(({ dollars }) => dollars));
  return [
    `${found.name}: ${String(promotions.length)} promoted on record, ${String(readings.length)} readings`,
    ...pairLines(score, readings, promotions, totals),
    ...time.lines,
  ];
}

function totalLines(score: Score, totals: Totals): string[] {
  const per = (values: readonly number[], unit: string) =>
    values.length === 0
      ? "none"
      : `median ${(median(values) ?? 0).toFixed(1)}${unit}, from ${Math.min(...values).toFixed(1)} to ${Math.max(...values).toFixed(1)}`;
  const weights = MEASURES.map((measure) =>
    String(Math.round(score.tree.weights[measure] * score.scale[measure] * 100)),
  ).join(",");
  const reconciled = score.own
    ? `; of the ${String(totals.weighted)} written under the weights, read otherwise than stored ${String(totals.moved)}, A/A ${String(totals.aaMoved)}`
    : `; ${String(totals.weighted)} written under the weights, not reconciled under weights asked`;
  const { validity, objective, bill } = totals.wonBy;
  return [
    `totals, tree ${score.tree.path} at ${score.tree.commit}, weights ${weights}${score.own ? " (the tree's)" : ""}, ${score.level === null ? "the recorded level" : `level ${String(score.level)}`}`,
    `  campaigns ${String(totals.campaigns)}, with a reading ${String(totals.compared)}; promotions on record ${String(totals.recorded)}: rightful ${String(totals.rightful)}, in doubt ${String(totals.doubted)}, not promoted by this score ${String(totals.dropped)}, on readings with no frontier (before 12 October) ${String(totals.unread)}`,
    `  pairs this score promotes ${String(totals.rightful + totals.doubted + totals.added)} (added ${String(totals.added)})`,
    `  readings ${String(totals.readings)}${reconciled}; reading otherwise than recorded: to a step ${String(totals.toStep)}, from a step ${String(totals.fromStep)}; tasks read from the stored difference for want of a pair ${String(totals.storedTasks)}`,
    `  A/A controls ${String(totals.controls)}, steps ${String(totals.aaSteps)}, untied won ${String(totals.aaWon)} lost ${String(totals.aaLost)}`,
    `  tasks the promoting readings won: by validity ${String(validity)}, by the objective ${String(objective)}, by the bill alone ${String(bill)}`,
    `  steps followed by a reading of the same pair ${String(totals.followed)}, of which stepped again ${String(totals.cleared)} and won at least as many as lost ${String(totals.held)}`,
    `  per promotion: hours ${per(totals.hours, " h")}; dollars ${per(totals.dollars, "")}`,
  ];
}

/** A number option, or null where it was not passed. */
function numberOption(args: CommandArgs, name: string): number | null {
  const raw = args.value(name);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0
    ? value
    : args.die(`--${name} must be a number from 0 up, got ${raw}`);
}

/** The scale of each measure for `--weights v,o,b`, in hundredths, over the tree's own weights. */
function scaleOf(args: CommandArgs, tree: Tree): Measures {
  const raw = args.value("weights");
  if (raw === null) return { validity: 1, objective: 1, bill: 1 };
  const asked = raw.split(",").map(Number);
  if (asked.length !== MEASURES.length || !asked.every((one) => Number.isFinite(one) && one >= 0)) {
    return args.die(`--weights takes three numbers from 0 up, as 60,30,10; got ${raw}`);
  }
  const [validity = 0, objective = 0, bill = 0] = asked.map((one, at) => {
    const own = tree.weights[MEASURES[at] ?? "validity"];
    return own > 0
      ? one / 100 / own
      : args.die(`the tree weighs ${MEASURES[at] ?? ""} at 0; change it in a candidate tree`);
  });
  return { validity, objective, bill };
}

async function main(args: CommandArgs): Promise<number> {
  const tree = await loadTree(args.required("tree"));
  const scale = scaleOf(args, tree);
  const own = MEASURES.every((measure) => Math.abs(scale[measure] - 1) < 1e-9);
  const score = { tree, scale, own, level: numberOption(args, "level") };
  const since = args.value("since") ?? new Date(Date.now() - DAYS_BACK * DAY_MS).toISOString();
  const logs = await campaignLogs(args.value("logs"), args.list("name"), since);
  const totals = emptyTotals();
  for (const found of logs) {
    const lines = campaignLines(score, found, totals);
    if (!args.flag("totals") && lines.length > 0) console.log(`${lines.join("\n")}\n`);
  }
  console.log(totalLines(score, totals).join("\n"));
  return 0;
}

if (import.meta.main) await runCommand({ name: "replay", usage: USAGE, options: OPTIONS }, main);
