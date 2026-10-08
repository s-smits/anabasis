/**
 * The climb comparison's outcome: whether the pull request's head (the treatment) left more of its
 * Builder's tasks failing for a reason the solver owns than main (the control) did, over the rounds
 * both reached, and the frozen rule that turns that difference into a verdict. Pure: the reader
 * (`climb-outcome-cli.ts`) hands it batteries, labels and round instants, and nothing here reads a
 * file.
 *
 * The count. A cell is one request under one Builder model and effort. In each arm, a measured task
 * set is the batteries that measured one product tree, so a confirming or censored remeasure joins
 * the set it measured again. The seed round both arms share is left out of both by its record, and
 * each cell compares the first k task sets of each arm, k the fewer the two reached. A failure is a
 * verified fail by the case classifier (`classifyCaseOutcome`), never `pass: false`, which an
 * unaccepted attempt also carries. A failure counts, as fresh, when its task's bytes never failed
 * before in the arm and its task, the campaign and task id, did not fail at its previous
 * measurement; a task the seed failed starts the arm as failed. So a task the head keeps after
 * it fails, a task main eases and fails again, a confirming remeasure and a seed failure carried in
 * never count twice, while a Builder that keeps its task ids and edits them still measures a fresh
 * chance each round. On record (notes/wri-20261007/outcome-stress.md) a lineage count, once per
 * campaign and id, left recode and Opus 5 truss, whose Builders keep their ids, about six tasks an
 * arm, and dropping the seed's ids removed nearly all of them; this count has no tilt under F2,
 * full churn or recorded churn in simulation (`sim_full.py`).
 *
 * Valid. M2 labels each verified fail by `caseKey`. A fresh failure is valid when its label is
 * `limit`; an unlabelled fail is never valid.
 *
 * The rule, frozen before the launch:
 *   1. R, the pooled rounds, is the sum over cells of k. Below 12 the comparison is censored; the
 *      margin is 5 from 12 to 16 rounds, 6 from 17 to 23, and 7 from 24. Failures cluster within a
 *      task set on record (intra-class correlation about 0.14 to 0.19), and these margins hold false
 *      support at or below 5% at a 2% main rate under that clustering (`bands.py`).
 *   2. D is the head's valid fresh failures minus main's. Once uncensored, a failed health guard
 *      refutes; otherwise D at or above the margin supports, D at or below minus the margin is
 *      against, and anything between, a tie included, is inconclusive.
 *   3. The health guard reads the head's fresh failures. One is classified when its label is not
 *      `unclassified` and it has one, and a defect when it is `check-defect` or `under-specified`.
 *      The guard fails when defects are more than half of the classified, and is censored, so cannot
 *      fail, below 4 classified.
 * Beside the verdict, with no threshold: per arm the fresh failures, the lineages and byte-distinct
 * tasks measured and failing, the failing lineages carrying each label, the lineages that failed
 * again after an edit, the task sets holding a valid fresh failure, the median solve-wall share, the
 * follow-up, and the rounds started.
 */
import type { CaseOutcome } from "#src/claim/case-record.ts";
import { sha256 } from "#src/meta/digest.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { isRecord, isString } from "#src/meta/json-shape.ts";
import { median } from "#src/meta/tally.ts";

export const FAIL_LABELS = [
  "limit",
  "check-defect",
  "under-specified",
  "wall-ended",
  "unclassified",
] as const;
export type FailLabel = (typeof FAIL_LABELS)[number];
/** A fail with no label in M2's file. */
const UNLABELLED = "unlabelled";
/** The labels that put a fail on the check or the task's wording rather than on the solver. */
const DEFECTS: ReadonlySet<string> = new Set<FailLabel>(["check-defect", "under-specified"]);

export type Verdict = "censored" | "supported" | "against" | "inconclusive" | "refuted";
export type GuardState = "holds" | "fails" | "censored";

/** Below this many pooled rounds the comparison is censored. */
const MIN_ROUNDS = 12;
/** Below this many classified head failures the health guard is censored. */
const GUARD_FLOOR = 4;

/** One case of a battery, as the outcome reads it. */
export interface MeasuredCase {
  /** The campaign's real directory; with `taskId`, the task's lineage. */
  campaign: string;
  battery: string;
  taskId: string;
  /** The task's bytes: its recorded public task and the checks over it. Null when unread. */
  bytes: string | null;
  outcome: CaseOutcome;
  /** When the solve ended, which bounds the rounds the pairing counts; null when unrecorded. */
  endedAt: string | null;
}

/** One battery: its cases and the product tree it measured, which names its task set. */
export interface Battery {
  runId: string;
  tree: string;
  cases: readonly MeasuredCase[];
  /** Its median case share of the solve wall (`wri.ts walls`), or null when unread. */
  wallShare: number | null;
  /** What the climb reader's follow-up (`followUpCounts`) counts of its earned fails, flips among
   *  them, whatever fields that reader exposes; absent for a battery with no version of its own. */
  followUp?: Readonly<Record<string, number>>;
}

/** One arm in one cell: its batteries in measurement order, the instants its rounds opened, and the
 *  lineages (`lineageKey`) of every task its campaigns' seed failed. */
export interface ArmInput {
  batteries: readonly Battery[];
  roundStarts: readonly string[];
  seedFailed: ReadonlySet<string>;
}

/** One request under one Builder model and effort, with the seed batteries its record names. */
export interface CellInput {
  key: string;
  seed: ReadonlySet<string>;
  control: ArmInput;
  treatment: ArmInput;
}

export type ClimbOutcome = ReturnType<typeof compareClimb>;
export type ArmReading = ClimbOutcome["control"];

/** The key M2 labels a verified fail by, computed the same way on both sides without the arm. */
export function caseKey(campaignDir: string, batteryRunId: string, taskId: string): string {
  return sha256(`${campaignDir}\0${batteryRunId}\0${taskId}`).slice(0, 16);
}

/** A task's lineage: its campaign and task id, the same across rounds whether kept or edited. */
export const lineageKey = (campaign: string, taskId: string): string => `${campaign}\0${taskId}`;

const lineage = (row: MeasuredCase) => lineageKey(row.campaign, row.taskId);
const keyOf = (row: MeasuredCase) => caseKey(row.campaign, row.battery, row.taskId);
// An unread task is its own byte task, so a missing record never merges two.
const bytesOf = (row: MeasuredCase) =>
  `${row.campaign}\0${row.bytes ?? `unread\0${row.battery}\0${row.taskId}`}`;

/** The margin D must reach at `rounds` pooled rounds, or null where the comparison is censored. */
export function marginFor(rounds: number): number | null {
  if (rounds < MIN_ROUNDS) return null;
  if (rounds <= 16) return 5;
  return rounds <= 23 ? 6 : 7;
}

/** The frozen rule, in the order above: censoring, then the guard, then the margin. */
export function decide(rounds: number, difference: number, guard: GuardState): Verdict {
  const margin = marginFor(rounds);
  if (margin === null) return "censored";
  if (guard === "fails") return "refuted";
  if (difference >= margin) return "supported";
  return difference <= -margin ? "against" : "inconclusive";
}

/** The head's guard over the labels of its fresh failures, null for an unlabelled one. */
export function healthGuard(labels: readonly (FailLabel | null)[]) {
  const classified = labels.filter((label) => label !== null && label !== "unclassified");
  const defects = classified.filter((label) => DEFECTS.has(label)).length;
  const state: GuardState =
    classified.length < GUARD_FLOOR ? "censored" : defects * 2 > classified.length ? "fails" : "holds";
  return { classified: classified.length, defects, state };
}

/** M2's labels file: one JSON object per line, `{caseKey, label}`. A malformed line, an unknown
 *  label or a second label for one case is refused with its line number rather than skipped. */
export function parseLabels(text: string): Map<string, FailLabel> {
  const labels = new Map<string, FailLabel>();
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    const row = parseJsonAs<unknown>(line);
    const label = isRecord(row) ? FAIL_LABELS.find((known) => known === row.label) : undefined;
    if (!isRecord(row) || !isString(row.caseKey) || label === undefined) {
      throw new Error(
        `labels line ${index + 1}: want {"caseKey": "...", "label": "${FAIL_LABELS.join("|")}"}`,
      );
    }
    if ((labels.get(row.caseKey) ?? label) !== label) {
      throw new Error(`labels line ${index + 1}: case ${row.caseKey} already carries another label`);
    }
    labels.set(row.caseKey, label);
  }
  return labels;
}

/** The arm's batteries grouped into measured task sets in measurement order, the seed's left out. */
function taskSetsOf(arm: ArmInput, seed: ReadonlySet<string>): Battery[][] {
  const sets = new Map<string, Battery[]>();
  for (const battery of arm.batteries) {
    if (seed.has(battery.runId) || battery.cases.length === 0) continue;
    sets.set(battery.tree, [...(sets.get(battery.tree) ?? []), battery]);
  }
  return [...sets.values()];
}

/** The rounds the arm opened by the end of its last paired task set; every one when no solve end
 *  is recorded there, none when nothing is paired. */
function roundsWithin(arm: ArmInput, paired: readonly Battery[][]): number {
  const last = paired.at(-1);
  if (last === undefined) return 0;
  const ends = last.flatMap((battery) => battery.cases.flatMap((row) => row.endedAt ?? []));
  const cutoff = ends.toSorted().at(-1);
  return arm.roundStarts.filter((at) => cutoff === undefined || at <= cutoff).length;
}

/** Each key's values over the failures, in order. */
function groupBy<T>(
  fails: readonly MeasuredCase[],
  key: (row: MeasuredCase) => string,
  value: (row: MeasuredCase) => T,
) {
  const by = new Map<string, T[]>();
  for (const row of fails) by.set(key(row), [...(by.get(key(row)) ?? []), value(row)]);
  return by;
}

/** M2's label of a case, null when its file names none. */
const labelIn =
  (labels: ReadonlyMap<string, FailLabel>) =>
  (row: MeasuredCase): FailLabel | null =>
    labels.get(caseKey(row.campaign, row.battery, row.taskId)) ?? null;

/** The verified fails of some task sets: the classifier's `fail`, never an unaccepted attempt. */
const failsIn = (sets: readonly Battery[][]) =>
  sets.flat().flatMap((battery) => battery.cases.filter((row) => row.outcome === "fail"));

/** Counts summed field by field, or null when there are none to sum. */
function summed(counts: readonly Readonly<Record<string, number>>[]): Record<string, number> | null {
  if (counts.length === 0) return null;
  const total: Record<string, number> = {};
  for (const count of counts) {
    for (const [field, value] of Object.entries(count)) total[field] = (total[field] ?? 0) + value;
  }
  return total;
}

/** The arm's fresh failures by `caseKey`: each verified fail whose bytes never failed before and whose
 *  task did not fail at its previous measurement, read over every battery in measurement order, a
 *  seed battery the arm holds included. A pass clears the task; any other outcome leaves it. */
function freshFails(arm: ArmInput): Set<string> {
  const lastFailed = new Set(arm.seedFailed);
  const bytesFailed = new Set<string>();
  const fresh = new Set<string>();
  for (const row of arm.batteries.flatMap((battery) => battery.cases)) {
    if (row.outcome === "pass") lastFailed.delete(lineage(row));
    if (row.outcome !== "fail") continue;
    if (!bytesFailed.has(bytesOf(row)) && !lastFailed.has(lineage(row))) fresh.add(keyOf(row));
    bytesFailed.add(bytesOf(row));
    lastFailed.add(lineage(row));
  }
  return fresh;
}

/** One arm over its paired task sets, pooled across cells. */
function readArm(
  sets: readonly Battery[][],
  rounds: { started: number; total: number },
  labels: ReadonlyMap<string, FailLabel>,
  fresh: ReadonlySet<string>,
) {
  const cases = sets.flat().flatMap((battery) => battery.cases);
  const labelOf = labelIn(labels);
  const fails = failsIn(sets);
  const freshValid = (row: MeasuredCase) => fresh.has(keyOf(row)) && labelOf(row) === "limit";
  const byLineage = groupBy(fails, lineage, labelOf);
  const carrying = (label: string) =>
    [...byLineage.values()].filter((found) => found.some((each) => (each ?? UNLABELLED) === label)).length;
  return {
    taskSets: sets.length,
    rounds,
    fresh: {
      failing: fails.filter((row) => fresh.has(keyOf(row))).length,
      valid: fails.filter(freshValid).length,
    },
    lineages: {
      measured: new Set(cases.map(lineage)).size,
      failing: byLineage.size,
      // A failing lineage whose later, changed bytes failed too.
      failedAfterEdit: [...groupBy(fails, lineage, bytesOf).values()].filter(
        (found) => new Set(found).size > 1,
      ).length,
    },
    bytes: {
      measured: new Set(cases.map(bytesOf)).size,
      failing: new Set(fails.map(bytesOf)).size,
      unread: cases.filter((row) => row.bytes === null).length,
    },
    // A lineage with mixed labels counts under each of them.
    labels: Object.fromEntries([...FAIL_LABELS, UNLABELLED].map((label) => [label, carrying(label)])),
    // Failures cluster, so this says how many task sets the valid failures came from.
    validSets: sets.filter((set) => set.some((battery) => battery.cases.some(freshValid))).length,
    wallShare: median(sets.flat().flatMap((battery) => battery.wallShare ?? [])),
    followUp: summed(sets.flat().flatMap(({ followUp }) => (followUp === undefined ? [] : [followUp]))),
  };
}

/** The comparison over every cell: each paired on the task sets both arms reached, then pooled. */
export function compareClimb(cells: readonly CellInput[], labels: ReadonlyMap<string, FailLabel>) {
  const arms: Record<"control" | "treatment", Battery[][]> = { control: [], treatment: [] };
  const fresh = { control: new Set<string>(), treatment: new Set<string>() };
  const rounds = { control: { started: 0, total: 0 }, treatment: { started: 0, total: 0 } };
  const rows = cells.map(({ key, seed, control, treatment }) => {
    const sets = { control: taskSetsOf(control, seed), treatment: taskSetsOf(treatment, seed) };
    const paired = Math.min(sets.control.length, sets.treatment.length);
    for (const [side, input] of [
      ["control", control],
      ["treatment", treatment],
    ] as const) {
      const pairedSets = sets[side].slice(0, paired);
      arms[side].push(...pairedSets);
      for (const failure of freshFails(input)) fresh[side].add(failure);
      rounds[side].started += roundsWithin(input, pairedSets);
      rounds[side].total += input.roundStarts.length;
    }
    const excluded = (arm: ArmInput) => arm.batteries.filter((battery) => seed.has(battery.runId)).length;
    return {
      key,
      reached: { control: sets.control.length, treatment: sets.treatment.length },
      paired,
      seedExcluded: { control: excluded(control), treatment: excluded(treatment) },
    };
  });
  const control = readArm(arms.control, rounds.control, labels, fresh.control);
  const treatment = readArm(arms.treatment, rounds.treatment, labels, fresh.treatment);
  const pooled = rows.reduce((sum, row) => sum + row.paired, 0);
  const difference = treatment.fresh.valid - control.fresh.valid;
  const guard = healthGuard(
    failsIn(arms.treatment).flatMap((row) => (fresh.treatment.has(keyOf(row)) ? [labelIn(labels)(row)] : [])),
  );
  return {
    rule: {
      rounds: pooled,
      margin: marginFor(pooled),
      difference,
      guard,
      verdict: decide(pooled, difference, guard.state),
    },
    cells: rows,
    control,
    treatment,
  };
}
