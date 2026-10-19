#!/usr/bin/env bun
/**
 * Every promotion on record, and every attempt that fell short of one, read again through one
 * tree's own rule from the recorded solves. It starts no solve, calls no model and writes nothing.
 *
 *   bun .claude/skills/promotion-tuner/scripts/replay.ts --tree <worktree>
 *     [--logs <dir>] [--since <date>] [--name <campaign>]... [--margin <n>] [--level <n>] [--totals]
 *
 * For each pair of harnesses a campaign compared, the tree's `pairings` reads each recorded
 * comparison's pairs again (`pairsReported`), at the recorded objective margin or at `--margin`,
 * and the tree's promotion rule (`promotes`, or `readTwice` where it exports none) is asked of the
 * pair's readings in order, at the recorded level or at `--level`. Beside each promotion it prints
 * the readings it rests on, the A/A of those comparisons (the reference against itself on halves
 * of its own solves mirrored in time, read two-sided at half the level), any later reading of the
 * pair that lost more tasks than it won, and how many untied tasks it won in every pairing. For each
 * epoch that ended in a promotion it prints the hours and dollars, split into the Examiner's
 * sessions, the comparisons and the Builder's own time.
 *
 * Tuning runs it twice, on `main`'s tree and on a candidate's worktree that changes one thing, and
 * sets the two tables side by side (SKILL.md). It prints counts, session ids, short digests and
 * campaign names, and never a task, an answer, a measure or a check.
 *
 * Written on 19 October from six prototypes, each of which had imported a tree by hand and kept its
 * own list of logs: the margin and level replay, the A/A at other margins, the repeats after a
 * reading that cleared the level alone, and three censuses of tied tasks.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import type { Paired } from "#src/kernel/compare.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import type { Reported } from "#src/kernel/reports.ts";
import { type JsonObject, type JsonValue, asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { median } from "#src/meta/tally.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { type Found, type Tree, campaignLogs, loadTree, rehearsed, worktreesHome } from "./tree.ts";
import { epochLines } from "./time.ts";

const USAGE = `usage:
  bun .claude/skills/promotion-tuner/scripts/replay.ts --tree <worktree>
    [--logs <dir>] [--since <date>] [--name <campaign>]... [--margin <n>] [--level <n>] [--totals]

--tree    the worktree whose src/kernel reads the record (main's, or a candidate's)
--logs    the folder whose worktrees hold campaigns; the parent of the repository's main checkout
--since   campaigns whose last event is at or after this date; five days back by default
--name    these campaigns only, whenever they ran (repeatable)
--margin  read every objective at this margin, where the tree's pairs carry one
--level   read every promotion and A/A at this level, in place of the recorded one
--totals  print the totals alone`;
const OPTIONS = {
  tree: "abs",
  logs: "abs",
  since: "text",
  name: "list",
  margin: "text",
  level: "text",
  totals: "flag",
} as const;
const DAYS_BACK = 5;
const DAY_MS = 86_400_000;
const LEVEL = 0.02;
const TRIGGER = 0.25;
const PROMOTED = "harness.promoted";

/** One comparison's last report, read again under the tree's pairing. */
interface Reading {
  readonly session: string;
  readonly key: string;
  readonly data: JsonObject;
  readonly frontier: readonly number[];
  readonly named: readonly (string | null)[];
  readonly pairs: ReadonlyMap<string, Paired>;
  readonly level: number;
  readonly trigger: number;
  /** The A/A's differences, or null where the comparison had fewer than four solves a side. */
  readonly aa: readonly number[] | null;
}

/** What the replay was asked to change of the record's own terms. */
interface Asked {
  readonly margin: number | null;
  readonly level: number | null;
}

/** The counts summed over every campaign read. */
interface Totals {
  campaigns: number;
  compared: number;
  recorded: number;
  replayed: number;
  rightful: number;
  added: number;
  dropped: number;
  unread: number;
  oneReading: number;
  readings: number;
  moved: number;
  storedTasks: number;
  marginless: number;
  controls: number;
  aaSteps: number;
  aaWon: number;
  aaLost: number;
  aaMoved: number;
  alone: number;
  followed: number;
  held: number;
  hours: number[];
  dollars: number[];
}

/** A recorded promotion: the pair it names and where it stands in the log. */
interface Promotion {
  readonly key: string;
  readonly index: number;
}

function emptyTotals(): Totals {
  return {
    campaigns: 0,
    compared: 0,
    recorded: 0,
    replayed: 0,
    rightful: 0,
    added: 0,
    dropped: 0,
    unread: 0,
    oneReading: 0,
    readings: 0,
    moved: 0,
    storedTasks: 0,
    marginless: 0,
    controls: 0,
    aaSteps: 0,
    aaWon: 0,
    aaLost: 0,
    aaMoved: 0,
    alone: 0,
    followed: 0,
    held: 0,
    hours: [],
    dollars: [],
  };
}

const short = (digest: string) => digest.slice(0, 8);
const fixed = (p: number) => p.toFixed(4);
const numbers = (value: JsonValue | undefined) => (Array.isArray(value) ? value.filter(isNumber) : []);

/** Won, lost and tied, as `W-L-T`. */
function wlt(differences: readonly number[]): string {
  const won = differences.filter((one) => one > 0).length;
  const lost = differences.filter((one) => one < 0).length;
  return `${String(won)}-${String(lost)}-${String(differences.length - won - lost)}`;
}

/** Each session's level and trigger as its comparison started with them. */
function termsOf(events: readonly LogEvent[]): Map<string, { level: number; trigger: number }> {
  const terms = new Map<string, { level: number; trigger: number }>();
  for (const { kind, data } of events) {
    if (kind !== "comparison.started" || !isString(data.session) || terms.has(data.session)) continue;
    const level = isNumber(data.level) ? data.level : LEVEL;
    terms.set(data.session, { level, trigger: isNumber(data.trigger) ? data.trigger : TRIGGER });
  }
  return terms;
}

/** A report's set with its differences read again from `pairs`, in the order it names its tasks;
 *  a task with no pair keeps its stored difference, and is counted. */
function replayedSet(
  tree: Tree,
  set: JsonValue | undefined,
  pairs: ReadonlyMap<string, Paired>,
  totals: Totals,
) {
  const record = asRecord(set);
  const of = record?.of;
  const stored = numbers(record?.differences);
  if (record === null || !Array.isArray(of) || stored.length !== of.length) {
    // A report before 14 October names no task, so its differences stand as stored.
    totals.storedTasks += stored.length;
    return set ?? null;
  }
  const differences = of.map((task, at) => {
    const pair = isString(task) ? pairs.get(task) : undefined;
    if (pair !== undefined) {
      const { fresh, old } = tree.pairings(pair);
      return fresh - old;
    }
    totals.storedTasks += 1;
    return stored[at] ?? 0;
  });
  return { ...record, differences };
}

/** The reference against itself on halves of its own solves, as the comparison's report reads it
 *  (`compared`, `comparison.ts`), or null under four solves a side or an odd number. */
function aaOf(tree: Tree, events: readonly LogEvent[], report: Reported, margin: number | null) {
  const { old, setting, solves, versions, objective } = report.data;
  if (!isString(old) || !isString(setting) || !isNumber(solves) || solves < 4 || solves % 2 !== 0) {
    return null;
  }
  const rule = asRecord(objective);
  const direction = rule?.direction;
  const recorded = isString(direction) && isNumber(rule?.margin) ? rule.margin : null;
  const sides = {
    old,
    fresh: old,
    setting,
    comparison: report.session,
    halves: "mirrored" as const,
    ...keyIfDefined(
      "objective",
      recorded === null || !isString(direction) ? undefined : { direction, margin: margin ?? recorded },
    ),
  };
  const tasks = Array.isArray(versions) ? versions.filter(isString) : [];
  return tree.pairsOf(events.slice(0, report.index + 1), tasks, sides, solves / 2).map((pair) => {
    const { fresh, old: lost } = tree.pairings(pair);
    return fresh - lost;
  });
}

/** Each comparison with a frontier, read again: its pairs at the margin asked, its sets rebuilt
 *  from them, its A/A. */
function readingsOf(tree: Tree, events: readonly LogEvent[], asked: Asked, totals: Totals): Reading[] {
  const terms = termsOf(events);
  return tree.lastReports(events).flatMap((report): Reading[] => {
    const frontier = asRecord(report.data.frontier);
    const { old, fresh } = report.data;
    if (!Array.isArray(frontier?.differences) || !isString(old) || !isString(fresh)) return [];
    const recorded = tree.pairsReported(events, report);
    if (asked.margin !== null && recorded.some((pair) => pair.objective !== undefined)) {
      totals.marginless += recorded.some((pair) => isNumber(pair.objective?.margin)) ? 0 : 1;
    }
    // The margin asked, where a pair carries an objective to read it by.
    const pairs = new Map(
      recorded.map((pair): [string, Paired] => [
        pair.task,
        asked.margin === null || pair.objective === undefined
          ? pair
          : { ...pair, objective: { ...pair.objective, margin: asked.margin } },
      ]),
    );
    const data = {
      ...report.data,
      frontier: replayedSet(tree, report.data.frontier, pairs, totals),
      retained: replayedSet(tree, report.data.retained, pairs, totals),
    };
    const differences = numbers(asRecord(data.frontier)?.differences);
    totals.readings += 1;
    totals.moved += differences.join() === numbers(frontier?.differences).join() ? 0 : 1;
    const aa = aaOf(tree, events, report, asked.margin);
    const storedAa = numbers(asRecord(report.data.noise)?.differences);
    totals.aaMoved += aa !== null && asked.margin === null && aa.join() !== storedAa.join() ? 1 : 0;
    const term = terms.get(report.session) ?? { level: LEVEL, trigger: TRIGGER };
    return [
      {
        session: report.session,
        key: `${old}>${fresh}`,
        data,
        frontier: differences,
        named: differences.map((_, at) => {
          const task = Array.isArray(frontier?.of) ? frontier.of[at] : undefined;
          return isString(task) ? task : null;
        }),
        pairs,
        level: asked.level ?? term.level,
        trigger: term.trigger,
        aa,
      },
    ];
  });
}

/** The differences of several readings with a task more than one scored counted once, summed, as
 *  the two-stage rule reads an attempt (`joined`, `compare.ts`). */
function joinedOf(readings: readonly Reading[]): number[] {
  const sums = new Map<string, number>();
  const unnamed: number[] = [];
  for (const reading of readings) {
    for (const [at, difference] of reading.frontier.entries()) {
      const task = reading.named[at] ?? null;
      if (task === null) unnamed.push(difference);
      else sums.set(task, (sums.get(task) ?? 0) + difference);
    }
  }
  return [...sums.values(), ...unnamed];
}

const toldReading = (tree: Tree, reading: Reading) =>
  `${reading.session} ${wlt(reading.frontier)} p ${fixed(tree.flipP(reading.frontier))}`;

/** One attempt's readings, and what they read together where there are two or more. */
function attemptLine(tree: Tree, attempt: readonly Reading[], verdict: (p: number) => string): string {
  const readings = attempt.map((reading) => toldReading(tree, reading)).join(" + ");
  if (attempt.length < 2) return `${readings}: ${verdict(Number.NaN)}`;
  const joined = joinedOf(attempt);
  const p = tree.flipP(joined);
  return `${readings} = joined ${wlt(joined)} p ${fixed(p)}: ${verdict(p)}`;
}

/** Why an attempt that the rule does not promote fell short of it. */
function shortfall(tree: Tree, attempt: readonly Reading[], place: "last" | "earlier") {
  return (p: number): string => {
    const [first] = attempt;
    if (first === undefined) return "no reading";
    if (attempt.length === 1) {
      if (!tree.triggered(first.data, first.trigger)) return `bought no repeat at ${String(first.trigger)}`;
      return place === "last" ? "its repeat is owed and not read" : "its repeat was not taken";
    }
    return p <= first.level
      ? `clears ${String(first.level)} together, and the rule refuses it on its other terms`
      : `short of ${String(first.level)}`;
  };
}

/** The untied frontier tasks of `readings` won in every pairing, won in some, and lost. */
function consistency(tree: Tree, readings: readonly Reading[]): string {
  let [every, some, lost] = [0, 0, 0];
  for (const reading of readings) {
    for (const [at, difference] of reading.frontier.entries()) {
      const pair = reading.pairs.get(reading.named[at] ?? "");
      if (difference < 0) lost += 1;
      if (difference <= 0 || pair === undefined) continue;
      const all = pair.fresh.length * pair.old.length;
      if (tree.pairings(pair).fresh === all) every += 1;
      else some += 1;
    }
  }
  return `untied tasks won in every pairing ${String(every)}, in some ${String(some)}, lost ${String(lost)}`;
}

/** Whether a reading of the reference against itself reads a step either way at half the level. */
function aaStep(tree: Tree, reading: Reading): boolean {
  const aa = reading.aa ?? [];
  return Math.min(tree.flipP(aa), tree.flipP(aa.map((one) => -one))) <= reading.level / 2;
}

const aaLine = (tree: Tree, readings: readonly Reading[]) =>
  readings
    .map((one) =>
      one.aa === null
        ? `${one.session} unread`
        : `${one.session} ${wlt(one.aa)}${aaStep(tree, one) ? " STEP" : ""}`,
    )
    .join(", ");

/** A pair the rule promotes: the readings it rests on, its A/A, later readings and consistency. */
function promotedLines(
  tree: Tree,
  readings: readonly Reading[],
  at: number,
  recorded: boolean,
  totals: Totals,
) {
  const upTo = readings.slice(0, at + 1);
  const attempts = tree.attempts(
    upTo.map(({ data }) => data),
    readings[0]?.trigger ?? TRIGGER,
  );
  const rests = (attempts.at(-1) ?? []).flatMap((data) => upTo.filter((one) => one.data === data));
  const later = readings.slice(at + 1);
  const against = later.filter(
    ({ frontier }) => frontier.filter((one) => one < 0).length > frontier.filter((one) => one > 0).length,
  );
  const doubts = [
    ...(rests.some((one) => one.aa !== null && aaStep(tree, one)) ? ["an A/A read a step"] : []),
    ...(against.length > 0 ? [`${String(against.length)} later reading lost more than it won`] : []),
  ];
  if (recorded) totals.replayed += 1;
  else totals.added += 1;
  if (recorded && doubts.length === 0) totals.rightful += 1;
  const verdict = doubts.length === 0 ? "rightful" : `in doubt: ${doubts.join("; ")}`;
  const status = recorded ? verdict : "added by this rule";
  return [
    `    ${attemptLine(tree, rests, () => "promotes")}`,
    `    ${status}; A/A ${aaLine(tree, rests)}; ${consistency(tree, rests)}`,
    `    later readings of the pair: ${later.length === 0 ? "none" : later.map((one) => toldReading(tree, one)).join(", ")}`,
  ];
}

/** The pairs a campaign compared, each with what the rule reads of it. */
function pairLines(
  tree: Tree,
  readings: readonly Reading[],
  promotions: readonly Promotion[],
  totals: Totals,
) {
  const pairs = Map.groupBy(readings, ({ key }) => key);
  const lines: string[] = [];
  for (const [key, list] of pairs) {
    const recorded = promotions.some((one) => one.key === key);
    const data = list.map((one) => one.data);
    const at = list.findIndex((_, k) =>
      tree.promotes(data.slice(0, k + 1), list[0]?.level ?? LEVEL, list[0]?.trigger ?? TRIGGER),
    );
    totals.oneReading += list.some((one) => tree.stepOf(one.data, one.level, one.trigger) === "step") ? 1 : 0;
    countAlone(tree, list, totals);
    const [old = "", fresh = ""] = key.split(">");
    lines.push(`  ${short(old)} > ${short(fresh)}${recorded ? ", promoted on record" : ""}`);
    if (at !== -1) {
      lines.push(...promotedLines(tree, list, at, recorded, totals));
      continue;
    }
    if (recorded) totals.dropped += 1;
    const attempts = tree.attempts(data, list[0]?.trigger ?? TRIGGER);
    for (const [n, attempt] of attempts.entries()) {
      const own = attempt.flatMap((one) => list.filter((reading) => reading.data === one));
      lines.push(
        `    ${attemptLine(tree, own, shortfall(tree, own, n === attempts.length - 1 ? "last" : "earlier"))}`,
      );
    }
    lines.push(`    ${recorded ? "NOT PROMOTED by this rule" : "no promotion"}; A/A ${aaLine(tree, list)}`);
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

/** Readings that cleared their level alone, and whether the pair's next reading won at least as
 *  many tasks as it lost. */
function countAlone(tree: Tree, list: readonly Reading[], totals: Totals): void {
  for (const [at, reading] of list.entries()) {
    const net = reading.frontier.reduce((total, one) => total + one, 0);
    if (tree.flipP(reading.frontier) > reading.level || net <= 0) continue;
    totals.alone += 1;
    const next = list[at + 1]?.frontier;
    if (next === undefined) continue;
    totals.followed += 1;
    totals.held += next.filter((one) => one > 0).length >= next.filter((one) => one < 0).length ? 1 : 0;
  }
}

/** One campaign's block, its counts added to `totals`. */
function campaignLines(tree: Tree, found: Found, asked: Asked, totals: Totals): string[] {
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
  const readings = readingsOf(tree, events, asked, totals);
  totals.compared += readings.length > 0 ? 1 : 0;
  for (const reading of readings) {
    if (reading.aa === null) continue;
    totals.controls += 1;
    totals.aaSteps += aaStep(tree, reading) ? 1 : 0;
    totals.aaWon += reading.aa.filter((one) => one > 0).length;
    totals.aaLost += reading.aa.filter((one) => one < 0).length;
  }
  const [first] = readings;
  const terms =
    first === undefined ? "no reading" : `level ${String(first.level)}, trigger ${String(first.trigger)}`;
  const time = epochLines(
    tree,
    events,
    promotions.map(({ index }) => index),
  );
  totals.hours.push(...time.promoted.map(({ hours }) => hours));
  totals.dollars.push(...time.promoted.map(({ dollars }) => dollars));
  return [
    `${found.name}: ${String(promotions.length)} promoted on record, ${String(readings.length)} readings (${terms})`,
    ...pairLines(tree, readings, promotions, totals),
    ...time.lines,
  ];
}

function totalLines(tree: Tree, asked: Asked, totals: Totals): string[] {
  const per = (values: readonly number[], unit: string) =>
    values.length === 0
      ? "none"
      : `median ${(median(values) ?? 0).toFixed(1)}${unit}, from ${Math.min(...values).toFixed(1)} to ${Math.max(...values).toFixed(1)}`;
  const margin =
    asked.margin === null
      ? "the recorded margin"
      : `margin ${String(asked.margin)}${totals.marginless > 0 ? ` (ignored in ${String(totals.marginless)} readings whose pairs carry no margin)` : ""}`;
  return [
    `totals, tree ${tree.path} at ${tree.commit}, rule ${tree.rule}, ${margin}, ${asked.level === null ? "the recorded level" : `level ${String(asked.level)}`}`,
    `  campaigns ${String(totals.campaigns)}, with a reading ${String(totals.compared)}; promotions on record ${String(totals.recorded)}: replayed ${String(totals.replayed)}, rightful ${String(totals.rightful)}, not promoted by this rule ${String(totals.dropped)}, on readings with no frontier (before 12 October) ${String(totals.unread)}`,
    `  pairs this rule promotes ${String(totals.replayed + totals.added)} (added ${String(totals.added)}); pairs with one reading at the level ${String(totals.oneReading)}`,
    `  readings ${String(totals.readings)}, whose frontier reads otherwise than stored ${String(totals.moved)}; frontier tasks read from the stored difference for want of a pair ${String(totals.storedTasks)}`,
    `  A/A controls ${String(totals.controls)}, steps ${String(totals.aaSteps)}, untied won ${String(totals.aaWon)} lost ${String(totals.aaLost)}${asked.margin === null ? `, read otherwise than stored ${String(totals.aaMoved)}` : ""}`,
    `  readings that cleared the level alone ${String(totals.alone)}, followed by a reading of the same pair ${String(totals.followed)}, of which won at least as many as lost ${String(totals.held)}`,
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

async function main(args: CommandArgs): Promise<number> {
  const tree = await loadTree(args.required("tree"));
  const asked = { margin: numberOption(args, "margin"), level: numberOption(args, "level") };
  const since = args.value("since") ?? new Date(Date.now() - DAYS_BACK * DAY_MS).toISOString();
  const logs = campaignLogs(args.value("logs") ?? worktreesHome(tree.path), args.list("name"), since);
  const totals = emptyTotals();
  for (const found of logs) {
    const lines = campaignLines(tree, found, asked, totals);
    if (!args.flag("totals") && lines.length > 0) console.log(`${lines.join("\n")}\n`);
  }
  console.log(totalLines(tree, asked, totals).join("\n"));
  return 0;
}

if (import.meta.main) await runCommand({ name: "replay", usage: USAGE, options: OPTIONS }, main);
