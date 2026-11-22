/**
 * Paired comparison scoring (`pointsOf`, `WEIGHTS`), exact one-sided sign-flip test (`flipP`,
 * `readsStep`), power analysis (`power`, `detectable`), and log pair assembly (`pairsOf`).
 * Full semantics live in `.claude/skills/comparison-reading/references/tally-and-test.md`.
 */
import { sha256 } from "../meta/digest.ts";
import { asRecord, isNumber, type JsonObject } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { conditionsOf, settingId } from "./condition.ts";
import type { LogEvent } from "./log.ts";
import { ended, passed, ranUnder, verdictsOf } from "./solves.ts";
import { taskSets } from "./task.ts";
import { objectiveOf } from "./verify.ts";

interface SolveCost {
  readonly billed: number | null;
}

export interface ObjectiveRule {
  readonly direction: "lower" | "higher";
}

/** One task's counted solves under reference (`old`) and candidate (`fresh`), plus optional objective/ids/cost. */
export interface Paired {
  readonly task: string;
  readonly old: readonly boolean[];
  readonly fresh: readonly boolean[];
  readonly objective?: ObjectiveRule & {
    readonly old: readonly (number | null)[];
    readonly fresh: readonly (number | null)[];
  };
  readonly solves?: { readonly old: readonly string[]; readonly fresh: readonly string[] };
  readonly used?: { readonly old: readonly SolveCost[]; readonly fresh: readonly SolveCost[] };
}

export type Measures = Readonly<Record<"validity" | "objective", number>>;

export interface Tally {
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
}

interface Sides {
  readonly old: string;
  readonly fresh: string;
  readonly setting: string;
  readonly comparison: string;
  /** `mirrored` for A/A controls: splits reference solves in 4-element mirrored pattern across tasks. */
  readonly halves?: "mirrored" | undefined;
  readonly objective?: ObjectiveRule | undefined;
}

const DETECTION_CHANCE = 0.8;
/** Sentinel for a retained set with zero tallied tasks (distinct from zero losses). */
export const UNMEASURED = "unmeasured" as const;
/** Minimum relative objective improvement worth counting (`objectiveGain`, `informative`, `roomOf`). */
export const GAP_FLOOR = 0.01;
/** Part weights in `pointsOf`; each pairing contributes to validity or (if both valid) objective. */
export const WEIGHTS: Measures = { validity: 0.6, objective: 0.3 };
const POINTS_SCALE = 1000;

/** Exact DP distribution of winning margin sums when each integer margin wins independently with `share`. */
function plusTotalChances(sizes: readonly number[], share: number): number[] {
  let chances = [1];
  for (const size of sizes) {
    const next = Array.from({ length: chances.length + size }, () => 0);
    for (const [at, chance] of chances.entries()) {
      next[at] = (next[at] ?? 0) + chance * (1 - share);
      next[at + size] = (next[at + size] ?? 0) + chance * share;
    }
    chances = next;
  }
  return chances;
}

function untiedMargins(differences: readonly number[]): number[] {
  return differences.flatMap((one) => (one === 0 ? [] : [Math.abs(one)]));
}

function sumOf(values: readonly number[]): number {
  return values.reduce((sum, one) => sum + one, 0);
}

function chanceOfAtLeast(chances: readonly number[], from: number): number {
  return sumOf(chances.slice(Math.max(0, from)));
}

function stepThreshold(sizes: readonly number[], level: number): number {
  const fair = plusTotalChances(sizes, 0.5);
  let [from, tail] = [fair.length, 0];
  while (from > 0 && tail + (fair[from - 1] ?? 0) <= level) {
    from -= 1;
    tail += fair[from] ?? 0;
  }
  return from;
}

/** Exact one-sided paired sign-flip p-value over untied task scores (1 when no task is untied). */
export function flipP(differences: readonly number[]): number {
  const sizes = untiedMargins(differences);
  // Scores sum to 2 * (winning margins) - (all margins).
  return Math.min(
    1,
    chanceOfAtLeast(plusTotalChances(sizes, 0.5), Math.ceil((sumOf(differences) + sumOf(sizes)) / 2)),
  );
}

export function readsStep(scores: readonly number[], level: number): boolean {
  return flipP(scores) <= level;
}

/** Whether an A/A control reads a step in either direction at `level`. */
export function readsStepEitherWay(scores: readonly number[], level: number): boolean {
  return (
    readsStep(scores, level) ||
    readsStep(
      scores.map((one) => -one),
      level,
    )
  );
}

/** Extracts task scores from a recorded test, preferring `unbilled` over legacy billed `differences`. */
export function scoresIn(test: unknown): number[] {
  const { unbilled, differences } = asRecord(test) ?? {};
  const found = Array.isArray(unbilled) ? unbilled : differences;
  return Array.isArray(found) ? found.filter(isNumber) : [];
}

/** Chance of reading a step at `level` given per-task win probability `share` (0.5 gives nominal false rate). */
export function power(differences: readonly number[], share: number, level: number): number {
  const sizes = untiedMargins(differences);
  return Math.min(1, chanceOfAtLeast(plusTotalChances(sizes, share), stepThreshold(sizes, level)));
}

/** Smallest win rate (0.01 grid) achieving `DETECTION_CHANCE` power at `level`, or null if undetectable. */
export function detectable(differences: readonly number[], level: number): number | null {
  const shares = Array.from({ length: 51 }, (_, at) => (50 + at) / 100);
  return shares.find((share) => power(differences, share, level) >= DETECTION_CHANCE) ?? null;
}

/** Minimum all-win untied task count needed to clear `level`. */
export function sweepOf(level: number): number {
  let sweep = 1;
  while (0.5 ** sweep > level) sweep += 1;
  return sweep;
}

/** Returns the whole scored set when `falseRate` is present, falling back to `frontier` for legacy reports. */
export function testedSet<S extends { readonly falseRate?: unknown }, F>(
  whole: S | null,
  frontier: F,
): S | F {
  return whole?.falseRate === undefined ? frontier : whole;
}

export function objectiveRuleIn(data: JsonObject): ObjectiveRule | undefined {
  const { direction } = asRecord(data.objective) ?? {};
  return direction === "lower" || direction === "higher" ? { direction } : undefined;
}

/** Whether `side` still has room to improve on `pair` (partial validity, objective gap >= `GAP_FLOOR`, or known valid answer). */
export function informative(
  pair: Paired,
  side: "old" | "fresh",
  knownValidAnswers: ReadonlySet<string>,
  bests: ReadonlyMap<string, number> = new Map(),
): boolean {
  const valid = pair[side].filter(Boolean).length;
  if (valid === 0) return knownValidAnswers.has(pair.task);
  if (valid < pair[side].length) return true;
  const other = pair.objective?.[side === "old" ? "fresh" : "old"] ?? [];
  return gapAgainst(pair, side, [...other, bests.get(pair.task) ?? null]);
}

/** Whether any valid solve on `side` is beaten by >= `GAP_FLOOR` by another solve of `side` or `against`. */
export function gapAgainst(
  pair: Paired,
  side: "old" | "fresh",
  against: readonly (number | null)[],
): boolean {
  const rule = pair.objective;
  if (rule === undefined) return false;
  const own = rule[side].filter(isNumber);
  const known = [...own, ...against.filter(isNumber)];
  return own.some((mine) => known.some((other) => gainOver(rule, other, mine) >= GAP_FLOOR));
}

/** Relative objective gain of `one` over `other` in [-1, 1] (before `GAP_FLOOR`), or 0 if missing. */
export function gainOver(
  rule: ObjectiveRule,
  one: number | null | undefined,
  other: number | null | undefined,
): number {
  if (!isNumber(one) || !isNumber(other)) return 0;
  const larger = Math.max(Math.abs(one), Math.abs(other));
  if (larger === 0) return 0;
  return Math.max(-1, Math.min(1, (rule.direction === "lower" ? other - one : one - other) / larger));
}

function objectiveGain(pair: Paired, f: number, o: number): number {
  const rule = pair.objective;
  const gain = rule === undefined ? 0 : gainOver(rule, rule.fresh[f], rule.old[o]);
  return Math.abs(gain) < GAP_FLOOR ? 0 : gain;
}

/** Per-task validity and objective points (thousandths) averaged over all cross-arm pairings. */
export function pointsOf(pair: Paired): Measures {
  let validity = 0;
  const gains: number[] = [];
  for (const [f, freshValid] of pair.fresh.entries()) {
    for (const [o, oldValid] of pair.old.entries()) {
      if (freshValid !== oldValid) validity += freshValid ? 1 : -1;
      else if (freshValid) gains.push(objectiveGain(pair, f, o));
    }
  }
  const each = POINTS_SCALE / (pair.fresh.length * pair.old.length);
  return {
    validity: validity * WEIGHTS.validity * each,
    objective: orderFreeSum(gains) * WEIGHTS.objective * each,
  };
}

/** Order-independent sum (smallest magnitude first per sign) so swapping sides negates exact half-points symmetrically. */
function orderFreeSum(gains: readonly number[]): number {
  const sizes = (sign: number) =>
    gains
      .filter((gain) => Math.sign(gain) === sign)
      .map(Math.abs)
      .toSorted((one, other) => one - other);
  return sumOf(sizes(1)) - sumOf(sizes(-1));
}

/** Rounds halves away from zero with no -0 so swapping sides exactly negates scores. */
export function wholePoints(points: number): number {
  const rounded = Math.sign(points) * Math.round(Math.abs(points));
  return rounded === 0 ? 0 : rounded;
}

export function differenceOf(pair: Paired): number {
  const { validity, objective } = pointsOf(pair);
  return wholePoints(validity + objective);
}

/** Deciding part of a non-tied task (`validity` if its sign matches the total, else `objective`). */
export function carriedBy({ validity, objective }: Measures): keyof Measures | null {
  const sign = Math.sign(wholePoints(validity + objective));
  if (sign === 0) return null;
  return Math.sign(wholePoints(validity)) === sign ? "validity" : "objective";
}

export function unsolved({ old, fresh }: Paired): boolean {
  return ![...old, ...fresh].some(Boolean);
}

export function testOf(differences: readonly number[]): Tally & { readonly p: number } {
  const count = (sign: number) => differences.filter((one) => Math.sign(one) === sign).length;
  return { wins: count(1), losses: count(-1), ties: count(0), p: flipP(differences) };
}

export function scored(pairs: readonly Paired[]) {
  const differences = pairs.map((pair) => {
    const { task, old, fresh } = pair;
    if (old.length === 0 || old.length !== fresh.length) {
      throw new Error(
        `task ${task} has ${String(old.length)} solve(s) under the old harness and ${String(fresh.length)} under the new; a comparison needs as many of each`,
      );
    }
    return differenceOf(pair);
  });
  return { ...testOf(differences), differences };
}

/** Deterministic `count`-item subset of `versions` ranked by `sha256(seed:version)`. */
export function draw(versions: readonly string[], count: number, seed: string): string[] {
  const pool = [...new Set(versions)];
  if (pool.length < count) {
    throw new Error(`a draw of ${String(count)} needs as many task versions; ${String(pool.length)} given`);
  }
  return pool
    .map((version) => ({ version, rank: sha256(`${seed}:${version}`) }))
    .toSorted((a, b) => compareCodeUnits(a.rank, b.rank))
    .slice(0, count)
    .map(({ version }) => version);
}

/** Builds paired comparison records from the log, taking the first `solves` started per side and excluding disputed/short tasks. */
export function pairsOf(
  events: readonly LogEvent[],
  versions: readonly string[],
  sides: Sides,
  solves: number,
) {
  const { old, fresh, setting, comparison, halves, objective } = sides;
  const verdicts = objective === undefined ? null : verdictsOf(events);
  if (old === fresh && halves === undefined) {
    throw new Error(`a comparison sets two harnesses against each other, and both sides are ${old}`);
  }
  const { states, held } = taskSets(events);
  const heldOut = new Set(held);
  const settings = new Map(
    [...conditionsOf(events)].map(([id, condition]) => [id, settingId(condition)] as const),
  );
  const counted = ended(ranUnder(events))
    .filter(
      (solve) =>
        solve.under.side === "test" &&
        solve.start.comparison === comparison &&
        settings.get(solve.condition) === setting &&
        passed(solve) !== null,
    )
    .toSorted((a, b) => a.started - b.started);
  const disputed = versions.filter((task) => states.get(task) === "disputed");
  const short: string[] = [];
  const pairs = versions.flatMap((task, place): Paired[] => {
    if (disputed.includes(task)) return [];
    const state = states.get(task);
    if (!heldOut.has(task)) {
      const why =
        state === undefined
          ? "is not proposed"
          : state === "held"
            ? "has not passed its gate"
            : `is ${state}`;
      throw new Error(`task ${task} ${why}; only a held-out task is scored`);
    }
    const under = (harness: string) =>
      counted.filter((solve) => solve.under.task === task && solve.under.harness === harness);
    // Mirror A/A split across tasks (0,3 vs 1,2 mod 4): always putting earlier solves first showed
    // order bias across 234 controls (446-363, p=0.004) vs balanced (405-404) when mirrored.
    const ran = old === fresh ? place * 2 * solves : 0;
    const first = (at: number) => halves === undefined || (ran + at) % 4 === 0 || (ran + at) % 4 === 3;
    const reference = under(old);
    const own = reference.filter((_, at) => first(at));
    const other = reference.filter((_, at) => !first(at));
    const [before, after] = [own, old === fresh ? other : under(fresh)];
    if (before.length < solves || after.length < solves) {
      short.push(task);
      return [];
    }
    const side = <T>(of: (solve: (typeof counted)[number]) => T) => ({
      old: before.slice(0, solves).map(of),
      fresh: after.slice(0, solves).map(of),
    });
    const measured = side(({ id }) => objectiveOf(verdicts?.get(id)?.checker));
    return [
      {
        task,
        ...side((solve) => passed(solve) === true),
        solves: side(({ id }) => id),
        used: side(({ end }): SolveCost => ({ billed: isNumber(end.billed) ? end.billed : null })),
        ...keyIfDefined("objective", objective === undefined ? undefined : { ...objective, ...measured }),
      },
    ];
  });
  return { pairs, short, disputed };
}
