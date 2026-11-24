import { sha256 } from "../meta/digest.ts";
import { asRecord, isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { settingId } from "./condition.ts";
import { eventsOf, type LogEvent } from "./log.ts";
import { checkerVerdict, countedSolves, ended, passed, ranUnder } from "./solves.ts";
import { taskSets } from "./task.ts";
import { objectiveOf } from "./verify.ts";

interface SolveCost {
  readonly billed: number | null;
}

export interface ObjectiveRule {
  readonly direction: "lower" | "higher";
  readonly scale?: "unit";
}

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
  readonly halves?: "mirrored" | undefined;
  readonly objective?: ObjectiveRule | undefined;
  readonly upTo?: number | undefined;
}

const DETECTION_CHANCE = 0.8;
export const UNMEASURED = "unmeasured" as const;
export const GAP_FLOOR = 0.01;
const ZERO_FLOOR = 1e-12;
export const WEIGHTS: Measures = { validity: 0.6, objective: 0.3 };
const POINTS_SCALE = 1000;

function plusTotalChances(sizes: readonly number[], share: number): Float64Array {
  const chances = new Float64Array(sumOf(sizes) + 1);
  chances[0] = 1;
  const keep = 1 - share;
  let top = 0;
  for (const size of sizes) {
    for (let at = top; at >= 0; at -= 1) {
      const chance = chances[at] ?? 0;
      chances[at] = chance * keep;
      chances[at + size] = (chances[at + size] ?? 0) + chance * share;
    }
    top += size;
  }
  return chances;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const sumOf = (values: readonly number[]) => values.reduce((sum, one) => sum + one, 0);
const chanceOfAtLeast = (chances: Float64Array, from: number) =>
  chances.subarray(Math.max(0, from)).reduce((sum, one) => sum + one, 0);

export function signedRanks(differences: readonly number[]): number[] {
  const untied = differences.filter((one) => one !== 0);
  const sizes = untied.map(Math.abs).toSorted((one, other) => one - other);
  return untied.map((one) => {
    const size = Math.abs(one);
    return Math.sign(one) * (sizes.indexOf(size) + sizes.lastIndexOf(size) + 2);
  });
}

function scaledMargins(differences: readonly number[]) {
  const sizes = differences.flatMap((one) => (one === 0 ? [] : [Math.abs(one)]));
  const unit = sizes.every(Number.isInteger) ? Math.max(1, sizes.reduce(gcd, 0)) : 1;
  return { scaled: sizes.map((size) => size / unit), unit };
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

export function rawFlipP(differences: readonly number[]): number {
  const { scaled, unit } = scaledMargins(differences);
  const from = Math.ceil((sumOf(differences) + sumOf(scaled) * unit) / (2 * unit));
  return Math.min(1, chanceOfAtLeast(plusTotalChances(scaled, 0.5), from));
}

export function flipP(differences: readonly number[]): number {
  return rawFlipP(signedRanks(differences));
}

export function readsStep(scores: readonly number[], level: number): boolean {
  return flipP(scores) <= level;
}

export function readsStepEitherWay(scores: readonly number[], level: number): boolean {
  return (
    readsStep(scores, level) ||
    readsStep(
      scores.map((one) => -one),
      level,
    )
  );
}

export function scoresIn(test: unknown): number[] {
  const { unbilled, differences } = asRecord(test) ?? {};
  const found = Array.isArray(unbilled) ? unbilled : differences;
  return Array.isArray(found) ? found.filter(isNumber) : [];
}

export function power(differences: readonly number[], share: number, level: number): number {
  const { scaled } = scaledMargins(signedRanks(differences));
  return Math.min(1, chanceOfAtLeast(plusTotalChances(scaled, share), stepThreshold(scaled, level)));
}

export function detectable(differences: readonly number[], level: number): number | null {
  const { scaled } = scaledMargins(signedRanks(differences));
  const threshold = stepThreshold(scaled, level);
  let [lo, hi] = [50, 101];
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (chanceOfAtLeast(plusTotalChances(scaled, mid / 100), threshold) >= DETECTION_CHANCE) hi = mid;
    else lo = mid + 1;
  }
  return lo <= 100 ? lo / 100 : null;
}

export function sweepOf(level: number): number {
  let sweep = 1;
  while (0.5 ** sweep > level) sweep += 1;
  return sweep;
}

export function testedSet<S extends { readonly falseRate?: unknown }, F>(
  whole: S | null,
  frontier: F,
): S | F {
  return whole?.falseRate === undefined ? frontier : whole;
}

export function objectiveRuleOf(declared: ObjectiveRule | undefined): ObjectiveRule | undefined {
  return declared === undefined
    ? undefined
    : { direction: declared.direction, ...keyIfDefined("scale", declared.scale) };
}

export function objectiveRuleIn(data: JsonObject): ObjectiveRule | undefined {
  const { direction, scale } = asRecord(data.objective) ?? {};
  if (direction !== "lower" && direction !== "higher") return undefined;
  return { direction, ...keyIfDefined("scale", scale === "unit" ? "unit" : undefined) };
}

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

export function gainOver(
  rule: ObjectiveRule,
  one: number | null | undefined,
  other: number | null | undefined,
): number {
  if (!isNumber(one) || !isNumber(other)) return 0;
  const delta = rule.direction === "lower" ? other - one : one - other;
  if (rule.scale === "unit") return Math.max(-1, Math.min(1, delta));
  const larger = Math.max(Math.abs(one), Math.abs(other));
  if (larger < ZERO_FLOOR) return 0;
  return Math.max(-1, Math.min(1, delta / larger));
}

function objectiveGain(pair: Paired, f: number, o: number): number {
  const rule = pair.objective;
  const gain = rule === undefined ? 0 : gainOver(rule, rule.fresh[f], rule.old[o]);
  return Math.abs(gain) < GAP_FLOOR ? 0 : gain;
}

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

function orderFreeSum(gains: readonly number[]): number {
  const sizes = (sign: number) =>
    gains
      .filter((gain) => Math.sign(gain) === sign)
      .map(Math.abs)
      .toSorted((one, other) => one - other);
  return sumOf(sizes(1)) - sumOf(sizes(-1));
}

export function wholePoints(points: number): number {
  const rounded = Math.sign(points) * Math.round(Math.abs(points));
  return rounded === 0 ? 0 : rounded;
}

export function differenceOf(pair: Paired): number {
  const { validity, objective } = pointsOf(pair);
  return wholePoints(validity + objective);
}

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

export function pairsOf(
  events: readonly LogEvent[],
  versions: readonly string[],
  sides: Sides,
  solves: number,
) {
  const { old, fresh, setting, comparison, halves, objective, upTo = events.length - 1 } = sides;
  if (old === fresh && halves === undefined) {
    throw new Error(`a comparison sets two harnesses against each other, and both sides are ${old}`);
  }
  const { states, held } = taskSets(events, upTo);
  const heldOut = new Set(held);
  const ownSolves = countedSolves(events, upTo).filter(
    (solve) => solve.start.comparison === comparison && passed(solve) !== null,
  );
  const solved = ended(ranUnder(events, ownSolves, upTo));
  const counted = solved
    .filter((solve) => solve.under.side === "test" && settingId(solve.under) === setting)
    .toSorted((a, b) => a.started - b.started);
  const byKey = Map.groupBy(counted, ({ under }) => `${under.task}\u0000${under.harness}`);
  const measures = new Map(
    objective === undefined
      ? []
      : eventsOf(events, "verdict", upTo).flatMap(({ event: { data } }) =>
          isString(data.solve) ? [[data.solve, objectiveOf(checkerVerdict(data))] as const] : [],
        ),
  );
  const disputed = versions.filter((task) => states.get(task) === "disputed");
  const short: string[] = [];
  const pairs = versions.flatMap((task, place): Paired[] => {
    const state = states.get(task);
    if (state === "disputed") return [];
    if (!heldOut.has(task)) {
      const why =
        state === undefined
          ? "is not proposed"
          : state === "held"
            ? "has not passed its gate"
            : `is ${state}`;
      throw new Error(`task ${task} ${why}; only a held-out task is scored`);
    }
    const under = (harness: string) => byKey.get(`${task}\u0000${harness}`) ?? [];
    const ran = old === fresh ? place * 2 * solves : 0;
    const first = (slot: number) => halves === undefined || (ran + slot) % 4 === 0 || (ran + slot) % 4 === 3;
    const reference = under(old);
    const own = reference.filter((_, slot) => first(slot));
    const other = reference.filter((_, slot) => !first(slot));
    const [before, after] = [own, old === fresh ? other : under(fresh)];
    if (before.length < solves || after.length < solves) {
      short.push(task);
      return [];
    }
    const side = <T>(of: (solve: (typeof counted)[number]) => T) => ({
      old: before.slice(0, solves).map(of),
      fresh: after.slice(0, solves).map(of),
    });
    const measured = side(({ id }) => measures.get(id) ?? null);
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
