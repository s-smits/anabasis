#!/usr/bin/env bun
/**
 * Every promotion on record, and every comparison that fell short of one, scored again by one tree's
 * weighted measures from the recorded solves; and, with `--try`, `--mechanism` or `--against`, any
 * other promotion mechanism read beside the tree's own on one panel. It starts no solve, calls no
 * model and writes nothing of a campaign's.
 *
 * For each pair of harnesses a campaign compared, the tree's `pairsReported` reads each comparison's
 * pairs again, and the tree's `pointsOf` scores each task by validity, the objective and the bill.
 * One reading at or under the level over the frontier and retained tasks together promotes only where
 * the tree's own rule reads a step (`readsStep`, by `stepOf`: without the bill from 31 October, both
 * ways from 25 October), at the recorded level.
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
 * A panel reads each mechanism (`mechanisms.ts`: knobs over today's values, free code in a file, or
 * a candidate tree's own rule) on the reduced record of `record.ts`, which counts a fork's copies of
 * a comparison once, on everything the rule can be wanted for: steps added and dropped against the
 * tree and what each added step had by the tree's own tally; A/A either way beside how many A/As
 * could read a step at all, since a rate over all of them flatters any rule; the starter reads, the
 * sign repeat on the disjoint solves of one comparison and the tasks that moved; what became of each
 * added step, with runs that never read again counted apart; the resources of the harnesses it would
 * promote; and every row by pack, since a pooled rate reads the mix of packs. Until 11 November the
 * panel was a second command over the same tree.
 *
 * Tuning runs it on `main`'s tree and on a candidate (SKILL.md). Replaying the record counts
 * readings and says nothing of the path a campaign would have taken, since an earlier promotion
 * changes every reference after it, so it never establishes a gain. It prints counts, session ids,
 * short digests and campaign names, and never a task, an answer, a measure or a check.
 *
 * Rewritten on 21 October for the weighted score of #306: until then it read the margin, the trigger
 * and the two-stage rule of older trees, and the rule-by-rule tally, none of which `main` holds.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { type Found, campaignLogs, rehearsed } from "#skills/main/logs.ts";
import { short } from "#src/campaign/move.ts";
import { carriedBy as carriedOn, type Paired, readsStep, wholePoints } from "#src/kernel/compare.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import type { Reported } from "#src/kernel/reports.ts";
import { DAY_MS } from "#src/meta/clock.ts";
import { type JsonValue, asRecord, isFunction, isNumber, isString } from "#src/meta/json-shape.ts";
import { resolve } from "#src/meta/path.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { median } from "#src/meta/tally.ts";
import { knobbed, knobsOf, type Mechanism, ratioOf, type Resource, STANDARD, TODAY } from "./mechanisms.ts";
import { type Comparison, once, paired, recordOf, selfTerms, type Task, timeOf } from "./record.ts";
import { epochLines } from "./time.ts";
import { type Points, type Tree, loadTree } from "./tree.ts";

/** Older campaigns ran another exam and another score, and are thin. */
const FROM = "v0.8.0";
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
--against    a candidate worktree, read by its own pointsOf and stepOf (repeatable)
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
const HOUR = 3600;
const ROOT = resolve(import.meta.dir, "..", "..", "..", "..");
const DAYS_BACK = 5;
const PROMOTED = "harness.promoted";
const MEASURES = ["validity", "objective", "bill"] as const;

type Measure = (typeof MEASURES)[number];

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

interface Read {
  readonly scores: readonly number[];
  readonly up: boolean;
  readonly down: boolean;
}

/** One mechanism's panel. */
interface Panel {
  readonly name: string;
  readonly steps: ReadonlySet<Comparison>;
  readonly added: readonly Comparison[];
  readonly dropped: readonly Comparison[];
  /** Added steps by what the tree's own tally of the tasks read. */
  readonly classes: Readonly<Record<"ahead" | "level" | "zero" | "behind", number>>;
  readonly starter: { readonly of: number; readonly reads: number };
  readonly aa: { readonly of: number; readonly capable: number; readonly either: number };
  readonly moved: Readonly<Record<"tasks" | "lossToWin" | "winToLoss" | "tieToWin" | "tieToLoss", number>>;
  readonly repeat: { readonly signed: number; readonly same: number };
  readonly later: Readonly<Record<"same" | "other" | "none" | "unread", number>>;
  readonly ratios: Readonly<Record<Resource, number | null>>;
  readonly untied: number | null;
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

const numbers = (value: JsonValue | undefined) => (Array.isArray(value) ? value.filter(isNumber) : []);
const won = (differences: readonly number[]) => differences.filter((one) => one > 0).length;
const lost = (differences: readonly number[]) => differences.filter((one) => one < 0).length;
const wlt = (differences: readonly number[]) =>
  `${String(won(differences))}-${String(lost(differences))}-${String(differences.length - won(differences) - lost(differences))}`;

/** Whether a report holds the points each measure gave, as none before the weights does. */
function weightedIn(points: JsonValue | undefined): boolean {
  const { validity, objective } = asRecord(points) ?? {};
  return isNumber(validity) && isNumber(objective);
}

/** A task's scores from its points: with the bill where the tree scores one (before 2 November),
 *  and without it, which a step is read on. */
function scoresOf({ validity, objective, bill }: Points) {
  return { scored: wholePoints(validity + objective + bill), unbilled: wholePoints(validity + objective) };
}

/** The measure that carried a task's result: the bill where the score without it does not share
 *  the score's sign, and otherwise this tree's reading (`carriedBy`). */
function carriedBy(points: Points): Measure | null {
  const { scored, unbilled } = scoresOf(points);
  if (scored === 0) return null;
  return Math.sign(unbilled) === Math.sign(scored) ? carriedOn(points) : "bill";
}

/** Reconstruct named tasks from pairs; retain stored scores where the log lacks a pair.
 * Missing cost-excluded evidence stays unknown, so the dual rule cannot promote it. */
function scoredSet(
  tree: Tree,
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
 *  (`compared`, `comparison.ts`), or null under two solves a side or an odd number. */
function aaOf(tree: Tree, events: readonly LogEvent[], report: Reported): Reading["aa"] {
  const terms = selfTerms(report);
  if (terms === null) return null;
  const { versions } = report.data;
  const tasks = Array.isArray(versions) ? versions.filter(isString) : [];
  const scores = tree
    .pairsOf(events.slice(0, report.index + 1), tasks, terms.sides, terms.solves)
    .map((pair) => scoresOf(tree.points(pair)));
  return {
    differences: scores.map((one) => one.scored),
    unbilled: scores.map((one) => one.unbilled),
  };
}

/** Each comparison with a frontier, scored again, its counts added to `totals`. */
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
    const step = tree.readsStep(differences, unbilled, level);
    const weighted = weightedIn(points);
    const aa = aaOf(tree, events, report);
    totals.readings += 1;
    totals.weighted += weighted ? 1 : 0;
    if (weighted) {
      totals.moved += differences.join(",") === sets.flatMap((set) => set.stored).join(",") ? 0 : 1;
      totals.aaMoved +=
        aa !== null && aa.differences.join(",") !== numbers(asRecord(noise)?.differences).join(",") ? 1 : 0;
    }
    totals.toStep += step && reading !== "step" ? 1 : 0;
    totals.fromStep += !step && reading === "step" ? 1 : 0;
    const wonBy = { validity: 0, objective: 0, bill: 0 };
    for (const one of sets.flatMap((set) => set.points)) {
      const by = scoresOf(one).scored > 0 ? carriedBy(one) : null;
      if (by !== null) wonBy[by] += 1;
    }
    return [
      { session: report.session, key: `${old}>${fresh}`, differences, unbilled, level, step, wonBy, aa },
    ];
  });
}

const toldReading = (tree: Tree, reading: Reading) =>
  `${reading.session} ${wlt(reading.differences)} p ${tree.flipP(reading.differences).toFixed(4)}; without the bill ${reading.unbilled === null ? "unread" : `${wlt(reading.unbilled)} p ${tree.flipP(reading.unbilled).toFixed(4)}`}`;

const aaLine = (tree: Tree, reading: Reading) =>
  reading.aa === null
    ? "A/A unread"
    : `A/A ${wlt(reading.aa.differences)}${tree.readsStepEitherWay(reading.aa.differences, reading.level, reading.aa.unbilled) ? " STEP" : ""}`;

/** A pair the score promotes: the reading it rests on, its A/A, and later readings. */
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
    ...(rests.aa !== null && tree.readsStepEitherWay(rests.aa.differences, rests.level, rests.aa.unbilled)
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
    `    ${toldReading(tree, rests)}: promotes; ${recorded ? verdict : "added by this score"}`,
    `    won by validity ${String(rests.wonBy.validity)}, by the objective ${String(rests.wonBy.objective)}, by the bill alone ${String(rests.wonBy.bill)}; ${aaLine(tree, rests)}`,
    `    later readings of the pair: ${later.length === 0 ? "none" : later.map((one) => toldReading(tree, one)).join(", ")}`,
  ];
}

/** The pairs a campaign compared, each with what the score reads of it. */
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
        `    ${toldReading(tree, one)}: reads no step by the tree's rule at ${String(one.level)}; ${aaLine(tree, one)}`,
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
    totals.aaSteps += tree.readsStepEitherWay(aa.differences, level, aa.unbilled) ? 1 : 0;
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
    `  readings ${String(totals.readings)}${reconciled}; reading otherwise than recorded: to a step ${String(totals.toStep)}, from a step ${String(totals.fromStep)}; tasks read from the stored difference for want of a pair ${String(totals.storedTasks)}`,
    `  A/A controls ${String(totals.controls)}, steps ${String(totals.aaSteps)}, untied won ${String(totals.aaWon)} lost ${String(totals.aaLost)}`,
    `  tasks the promoting readings won: by validity ${String(validity)}, by the objective ${String(objective)}, by the bill alone ${String(bill)}`,
    `  steps followed by a reading of the same pair ${String(totals.followed)}, of which stepped again ${String(totals.cleared)} and won at least as many as lost ${String(totals.held)}`,
    `  per promotion: hours ${per(totals.hours, " h")}; dollars ${per(totals.dollars, "")}`,
  ];
}

const swapped = (task: Task): Task => ({ ...task, old: task.fresh, fresh: task.old });

/** A tree's own rule as a mechanism: its `pointsOf`, and its `stepOf`, given the scores without a
 *  bill where it scores one. */
function treeMechanism(tree: Tree, name: string): Mechanism {
  const answers = (task: Task) => {
    const { validity, objective } = tree.points(paired(task));
    return wholePoints(validity + objective);
  };
  return {
    name,
    score: (task) => {
      const { validity, objective, bill } = tree.points(paired(task));
      return wholePoints(validity + objective + bill);
    },
    test: (scores, level, tasks) => tree.readsStep(scores, tasks.map(answers), level),
  };
}

/** What a mechanism's test reads of a set of tasks, each way. A guard is not read here. */
function readOf(mechanism: Mechanism, tasks: readonly Task[], level: number): Read {
  const test = mechanism.test ?? readsStep;
  const scores = tasks.map(mechanism.score);
  return {
    scores,
    up: test(scores, level, tasks),
    down: test(
      scores.map((one) => -one),
      level,
      tasks.map(swapped),
    ),
  };
}

const stepsUnder = (mechanism: Mechanism, candidates: readonly Comparison[]) =>
  new Set(
    candidates.filter(
      ({ tasks, level }) => readOf(mechanism, tasks, level).up && (mechanism.guard?.(tasks) ?? true),
    ),
  );

/** The tasks' solves one by one, so that the two samples of a comparison share no solve. */
function samples(tasks: readonly Task[]): [Task[], Task[]] | null {
  if (tasks.length === 0 || tasks.some(({ old, fresh }) => old.length < 2 || fresh.length < 2)) return null;
  const at = (index: number) =>
    tasks.map(
      (task): Task => ({
        ...task,
        old: task.old.slice(index, index + 1),
        fresh: task.fresh.slice(index, index + 1),
      }),
    );
  return [at(0), at(1)];
}

/** How often the sign of a task's score holds on the comparison's other solves. */
function repeatOf(mechanism: Mechanism, candidates: readonly Comparison[]) {
  let [signed, same] = [0, 0];
  for (const { tasks } of candidates) {
    const both = samples(tasks);
    if (both === null) continue;
    const [one, other] = both;
    for (const [at, task] of one.entries()) {
      const [first, second] = [mechanism.score(task), mechanism.score(other[at] ?? task)];
      if (first === 0 || second === 0) continue;
      signed += 1;
      same += Math.sign(first) === Math.sign(second) ? 1 : 0;
    }
  }
  return { signed, same };
}

function movedOf(mechanism: Mechanism, base: Mechanism, comparisons: readonly Comparison[]) {
  const moved = { tasks: 0, lossToWin: 0, winToLoss: 0, tieToWin: 0, tieToLoss: 0 };
  for (const task of comparisons.flatMap(({ tasks }) => tasks)) {
    const [was, now] = [base.score(task), mechanism.score(task)];
    moved.tasks += was === now ? 0 : 1;
    moved.lossToWin += was < 0 && now > 0 ? 1 : 0;
    moved.winToLoss += was > 0 && now < 0 ? 1 : 0;
    moved.tieToWin += was === 0 && now > 0 ? 1 : 0;
    moved.tieToLoss += was === 0 && now < 0 ? 1 : 0;
  }
  return moved;
}

function classesOf(added: readonly Comparison[], base: Mechanism) {
  const classes = { ahead: 0, level: 0, zero: 0, behind: 0 };
  for (const { tasks } of added) {
    const scores = tasks.map(base.score);
    const [ahead, behind] = [won(scores), lost(scores)];
    if (ahead === 0 && behind === 0) classes.zero += 1;
    else if (behind > ahead) classes.behind += 1;
    else if (behind === ahead) classes.level += 1;
    else classes.ahead += 1;
  }
  return classes;
}

/** What became of a step the record did not act on. Censored where the campaign read nothing after. */
function laterOf(added: readonly Comparison[]) {
  const later = { same: 0, other: 0, none: 0, unread: 0 };
  for (const { fresh, after } of added) {
    if (after.promoted.includes(fresh)) later.same += 1;
    else if (after.promoted.length > 0) later.other += 1;
    else if (after.readings > 0) later.none += 1;
    else later.unread += 1;
  }
  return later;
}

function panelOf(mechanism: Mechanism, base: Mechanism, comparisons: readonly Comparison[]): Panel {
  const candidates = comparisons.filter(({ kind }) => kind === "candidate");
  const starters = comparisons.filter(({ kind }) => kind === "starter");
  const controls = comparisons.filter(({ aa }) => aa.length > 0);
  const steps = stepsUnder(mechanism, candidates);
  const baseSteps = stepsUnder(base, candidates);
  const added = candidates.filter((one) => steps.has(one) && !baseSteps.has(one));
  const reads = controls.map(({ aa, level }) => ({ read: readOf(mechanism, aa, level), level }));
  const ratio = (resource: Resource) =>
    median([...steps].flatMap(({ tasks }) => ratioOf(tasks, resource) ?? [])) ?? null;
  return {
    name: mechanism.name,
    steps,
    added,
    dropped: candidates.filter((one) => baseSteps.has(one) && !steps.has(one)),
    classes: classesOf(added, base),
    starter: {
      of: starters.length,
      reads: starters.filter(({ tasks, level }) => readOf(mechanism, tasks, level).down).length,
    },
    aa: {
      of: controls.length,
      // Could these margins read a step at all: the signing that wins every untied task. Every test
      // here reads that signing as its least p, so the sign-flip test answers for all of them.
      capable: reads.filter(({ read, level }) => readsStep(read.scores.map(Math.abs), level)).length,
      either: reads.filter(({ read }) => read.up || read.down).length,
    },
    moved: movedOf(mechanism, base, comparisons),
    repeat: repeatOf(mechanism, candidates),
    later: laterOf(added),
    ratios: { bill: ratio("bill"), turns: ratio("turns"), seconds: ratio("seconds") },
    untied: median(
      [...steps].map(({ tasks }) => tasks.map(mechanism.score).filter((one) => one !== 0).length),
    ),
  };
}

const pad = (text: string, width: number) => text.padStart(width);
const two = (value: number | null) => (value === null ? "-" : value.toFixed(2));
const share = (some: number, of: number) => (of === 0 ? "-" : (some / of).toFixed(2));

/** The main table: one row a mechanism. */
function panelLines(panels: readonly Panel[], comparisons: readonly Comparison[]): string[] {
  // Tasks alone: an A/A halves the reference's own solves, so counting it would pay for them twice.
  const solves = comparisons
    .filter(({ kind }) => kind === "candidate")
    .flatMap(({ tasks }) => tasks.flatMap(({ old, fresh }) => [...old, ...fresh]));
  const dollars = solves.reduce((all, { billed }) => all + (billed ?? 0), 0);
  const hours = solves.reduce((all, { seconds }) => all + (seconds ?? 0), 0) / HOUR;
  const width = Math.max(10, ...panels.map(({ name }) => name.length));
  const candidates = comparisons.filter(({ kind }) => kind === "candidate").length;
  const header = `${"mechanism".padEnd(width)} steps   +   - | ahead lvl 0-0 bhd | starter  A/A (could) | repeat | bill turns  secs | $/step h/step untied`;
  return [
    `steps of ${String(candidates)} candidate comparisons; + and - against the first row; bill, turns and secs are the new side over the reference in the comparisons it steps on`,
    header,
    ...panels.map((one) => {
      const { steps, added, dropped, classes, starter, aa, repeat, ratios, untied } = one;
      const per = (total: number) => (steps.size === 0 ? "-" : (total / steps.size).toFixed(1));
      return [
        `${one.name.padEnd(width)} ${pad(String(steps.size), 5)} ${pad(`+${String(added.length)}`, 3)} ${pad(`-${String(dropped.length)}`, 3)}`,
        `${pad(String(classes.ahead), 5)} ${pad(String(classes.level), 3)} ${pad(String(classes.zero), 3)} ${pad(String(classes.behind), 3)}`,
        `${pad(`${String(starter.reads)}/${String(starter.of)}`, 7)} ${pad(`${String(aa.either)}/${String(aa.capable)}`, 4)} ${pad(`(${String(aa.of)})`, 7)}`,
        pad(share(repeat.same, repeat.signed), 6),
        `${pad(two(ratios.bill), 4)} ${pad(two(ratios.turns), 5)} ${pad(two(ratios.seconds), 5)}`,
        `${pad(per(dollars), 6)} ${pad(per(hours), 6)} ${pad(untied === null ? "-" : String(untied), 6)}`,
      ].join(" | ");
    }),
  ];
}

function detailLines(panels: readonly Panel[], comparisons: readonly Comparison[]): string[] {
  const candidates = comparisons.filter(({ kind }) => kind === "candidate");
  const packs = [...new Set(candidates.map(({ pack }) => pack))].toSorted();
  const width = Math.max(10, ...panels.map(({ name }) => name.length));
  const of = (pack: string) => candidates.filter((one) => one.pack === pack).length;
  const lines = [
    "",
    `steps by pack, of ${packs.map((pack) => `${pack} ${String(of(pack))}`).join(", ")}`,
    `${"mechanism".padEnd(width)} ${packs.map((pack) => pad(pack, Math.max(pack.length, 3))).join(" ")}`,
    ...panels.map(({ name, steps }) => {
      const cells = packs.map((pack) =>
        pad(String([...steps].filter((one) => one.pack === pack).length), Math.max(pack.length, 3)),
      );
      return `${name.padEnd(width)} ${cells.join(" ")}`;
    }),
    "",
    "tasks moved against the first row; what became of each added step (the harness promoted later, another, none though read again, nothing read after)",
    `${"mechanism".padEnd(width)}  moved  L>W  W>L  T>W  T>L | same other none unread | added shared with the row above`,
  ];
  for (const [at, panel] of panels.entries()) {
    const { moved, later, added } = panel;
    const above = panels[at - 1]?.added ?? [];
    const shared = added.filter((one) => above.includes(one)).length;
    lines.push(
      [
        `${panel.name.padEnd(width)} ${pad(String(moved.tasks), 6)} ${pad(String(moved.lossToWin), 4)} ${pad(String(moved.winToLoss), 4)} ${pad(String(moved.tieToWin), 4)} ${pad(String(moved.tieToLoss), 4)}`,
        `${pad(String(later.same), 4)} ${pad(String(later.other), 5)} ${pad(String(later.none), 4)} ${pad(String(later.unread), 6)}`,
        `${String(shared)} of ${String(added.length)} (above ${String(above.length)})`,
      ].join(" | "),
    );
  }
  return lines;
}

/** Each row's step rate either side of a time, raw and at the pooled mix of packs on both sides: on
 *  the record a later cohort read lower raw and higher at one mix, the gap being which packs ran. */
function splitLines(
  panels: readonly Panel[],
  comparisons: readonly Comparison[],
  time: number,
  label: string,
) {
  const candidates = comparisons.filter(({ kind }) => kind === "candidate");
  const sides = [
    candidates.filter(({ opened }) => opened < time),
    candidates.filter(({ opened }) => opened >= time),
  ];
  const shared = [...new Set(candidates.map(({ pack }) => pack))].filter((pack) =>
    sides.every((side) => side.some((one) => one.pack === pack)),
  );
  const pooled = candidates.filter(({ pack }) => shared.includes(pack));
  const rate = (steps: ReadonlySet<Comparison>, side: readonly Comparison[]) => {
    const rows = shared.map((pack) => {
      const mine = side.filter((one) => one.pack === pack);
      const weight = pooled.filter((one) => one.pack === pack).length / Math.max(1, pooled.length);
      return (mine.filter((one) => steps.has(one)).length / Math.max(1, mine.length)) * weight;
    });
    return rows.reduce((all, one) => all + one, 0);
  };
  const [before = [], since = []] = sides;
  return [
    "",
    `step rate before and from ${label} (${String(before.length)}, ${String(since.length)}), raw, then at the pooled mix of ${shared.join(", ")}`,
    ...panels.map(({ name, steps }) => {
      const raw = (side: readonly Comparison[]) =>
        share(side.filter((one) => steps.has(one)).length, side.length);
      return `  ${name}: ${raw(before)} ${raw(since)}; ${rate(steps, before).toFixed(2)} ${rate(steps, since).toFixed(2)}`;
    }),
  ];
}

function namedLines(panels: readonly Panel[], mechanisms: readonly Mechanism[], base: Mechanism): string[] {
  return panels.flatMap((panel, at) => {
    const mechanism = mechanisms[at] ?? base;
    const row = (sign: string, { campaign, session, tasks, after }: Comparison) =>
      `  ${sign} ${campaign} ${session}: ${wlt(tasks.map(base.score))} by the tree, ${wlt(tasks.map(mechanism.score))} here; later promotions ${String(after.promoted.length)}, later readings ${String(after.readings)}`;
    const rows = [...panel.added.map((one) => row("+", one)), ...panel.dropped.map((one) => row("-", one))];
    return rows.length === 0 ? [] : ["", panel.name, ...rows];
  });
}

/** How far the knobs at production's values and the record's own readings stand from the tree. */
function reconcileLines(base: Mechanism, comparisons: readonly Comparison[], tree: Tree): string[] {
  const knobs = knobbed(TODAY, "knobs");
  const tasks = comparisons.flatMap(({ tasks: scored, aa }) => [...scored, ...aa]);
  const differ = tasks.filter((task) => knobs.score(task) !== base.score(task)).length;
  const otherwise = comparisons.filter(({ kind, tasks: scored, level, reading }) => {
    if (kind !== "candidate") return false;
    return readOf(base, scored, level).up !== (reading === "step");
  }).length;
  return [
    `tree ${tree.path} at ${tree.commit}`,
    `knobs at today's values against the tree's score: ${String(tasks.length)} tasks, ${String(differ)} differ${differ === 0 ? "" : ": rows of knobs are not read from the tree's rule"}`,
    `candidates the tree reads otherwise than their report did, under the rule of their own day: ${String(otherwise)}`,
  ];
}

async function fileMechanisms(args: CommandArgs): Promise<Mechanism[]> {
  const found: Mechanism[] = [];
  for (const file of args.list("mechanism")) {
    // SAFETY: the check below refuses an export without a name and a score.
    const { default: exported } = (await import(resolve(file))) as { default: Mechanism | Mechanism[] };
    for (const one of Array.isArray(exported) ? exported : [exported]) {
      if (!isString(one?.name) || !isFunction(one.score)) {
        return args.die(`${file} must export a mechanism with a name and a score`);
      }
      found.push(one);
    }
  }
  return found;
}
/** Each mechanism asked for read beside the tree's own on one panel. */
async function panelMain(args: CommandArgs, tree: Tree, base: Mechanism): Promise<number> {
  const { comparisons: read, unread } = await recordOf({
    file: args.value("record"),
    home: args.value("logs"),
    names: args.list("name"),
    from: timeOf(args.value("from") ?? FROM),
    refresh: args.flag("refresh"),
  });
  const comparisons = once(read);
  const { die } = args;
  const tried = args
    .list("try")
    .flatMap((spec) => (spec === "standard" ? STANDARD : [spec]))
    .map((spec) => knobbed(knobsOf(spec, die), spec));
  const others = await Promise.all(
    args.list("against").map(async (path) => treeMechanism(await loadTree(resolve(path)), path)),
  );
  const asked = [...tried, ...(await fileMechanisms(args)), ...others];
  const mechanisms = [
    base,
    ...(asked.length > 0 ? asked : STANDARD.map((spec) => knobbed(knobsOf(spec, die), spec))),
  ];
  const panels = mechanisms.map((mechanism) => panelOf(mechanism, base, comparisons));
  const split = args.value("split");
  console.log(
    [
      ...reconcileLines(base, comparisons, tree),
      `comparisons ${String(comparisons.length)} (${String(read.length - comparisons.length)} fork copies dropped), campaigns not read ${String(unread.length)}${unread.length === 0 ? "" : `: ${unread.join("; ")}`}`,
      "",
      ...panelLines(panels, comparisons),
      ...detailLines(panels, comparisons),
      ...(split === null ? [] : splitLines(panels, comparisons, timeOf(split), split)),
      ...(args.flag("named") ? namedLines(panels, mechanisms, base) : []),
    ].join("\n"),
  );
  return 0;
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
