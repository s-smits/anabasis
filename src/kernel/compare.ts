/**
 * The comparison: does the new harness beat the reference harness on tasks neither was built on?
 *
 * Both harnesses solve the same held-out tasks afresh under one setting. On each task, every solve
 * of the new harness is paired with every solve of the reference, and the task counts once. Its
 * score has two weighted parts (`pointsOf`, `WEIGHTS`). Validity comes first: a valid answer beats
 * an invalid one. Only when both answers are valid does the objective decide, so an answer the
 * checks refuse can never count as the better one. The objective's value is the one the verifier
 * measured, never one the answer reports about itself. A positive score is a win, a negative one a
 * loss and zero a tie, in whole points, so that swapping the sides exactly negates it
 * (`wholePoints`).
 *
 * The test is an exact one-sided paired sign-flip test over the scores of the untied tasks
 * (`flipP`), run once over the frontier and retained tasks fixed when the comparison starts. A step
 * is that test's p at or under the campaign's level (`readsStep`); the same calculation at another
 * win rate gives its power (`power`, `detectable`). The A/A control reads the reference against
 * itself, on two halves of its own solves (`halves`), exactly as two harnesses are read.
 *
 * The weights and floors are constants of this tree, and a comparison continued under other code
 * is refused by its condition, so no comparison is ever scored under two sets of them. How each way
 * a solve can end enters a pair is in `.claude/skills/comparison-reading/references/draw-and-solves.md`,
 * and the evidence behind each rule here in `references/tally-and-test.md`, "The record".
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

/** What one counted solve cost, from its `solve.finished` event: dollars billed, or null where the
 *  log records none. */
interface SolveCost {
  readonly billed: number | null;
}

/** How two valid answers to one task are ranked: by the quantity the check program measures on
 *  each, where lower or higher is better (`objectiveGain`). */
export interface ObjectiveRule {
  readonly direction: "lower" | "higher";
}

/** One task's counted solves under the reference harness (`old`) and the new one (`fresh`), each
 *  true where the answer was valid. */
export interface Paired {
  readonly task: string;
  readonly old: readonly boolean[];
  readonly fresh: readonly boolean[];
  /** The objective each of those solves measured, in the same order, with null where the answer
   *  was invalid or the verdict holds no measure, and the rule that ranks them. Absent where the
   *  comparison has no objective. */
  readonly objective?: ObjectiveRule & {
    readonly old: readonly (number | null)[];
    readonly fresh: readonly (number | null)[];
  };
  /** Each of those solves as the log names it, in the same order. */
  readonly solves?: { readonly old: readonly string[]; readonly fresh: readonly string[] };
  /** What each of those solves cost, in the same order. */
  readonly used?: { readonly old: readonly SolveCost[]; readonly fresh: readonly SolveCost[] };
}

/** One number for each of the two parts of a task's score (`pointsOf`): either its weight or the
 *  points it contributed. */
export type Measures = Readonly<Record<"validity" | "objective", number>>;

export interface Tally {
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
}

/** What a comparison sets against each other: the two harnesses by digest, and the setting every
 *  counted solve ran under (`settingId`). */
interface Sides {
  readonly old: string;
  readonly fresh: string;
  readonly setting: string;
  /** The comparison's id: a solve belongs to it only if the solve's start names it. */
  readonly comparison: string;
  /** `mirrored` where the reference is read against itself, the one case in which both sides name
   *  the same harness. Its solves are then split in the order they started: the first and last of
   *  every four form one half, the middle two the other, and the count carries on from one task to
   *  the next. */
  readonly halves?: "mirrored" | undefined;
  /** How two valid answers are ranked, where the comparison has an objective. */
  readonly objective?: ObjectiveRule | undefined;
}

/** How reliably a win rate must be detected to count as detectable (`detectable`): four times in
 *  five. */
const DETECTION_CHANCE = 0.8;
/** What a report records for a retained set in which no task was tallied: no reading, which is not
 *  the same as no loss. */
export const UNMEASURED = "unmeasured" as const;
/** The smallest objective improvement worth counting, as a share of the larger of the two values.
 *  Two valid answers closer than this tie (`objectiveGain`). A harness whose own answer is beaten
 *  by less than this, by any answer on record, has no room left on that task (`informative`), which
 *  decides which tasks are admitted, which stay in the frontier, and `roomOf`. The test says
 *  whether a difference is believable; the floor says whether it is worth counting. */
export const GAP_FLOOR = 0.01;

/** How much each part weighs in a task's score (`pointsOf`). Each part is averaged over the task's
 *  pairings, and each pairing counts towards one part only. */
export const WEIGHTS: Measures = { validity: 0.6, objective: 0.3 };
/** Task scores are kept in thousandths of a point, since the test's calculation works on whole
 *  numbers. */
const POINTS_SCALE = 1000;
/**
 * For margins `sizes`, each counted as a win with chance `share` independently, the chance of each
 * possible total of the winning margins: entry k is the chance that the wins add up to k. Margins
 * are whole numbers, as scores in thousandths are, so the calculation is exact up to floating-point
 * rounding; an entry too small to represent reads 0 without affecting the others.
 */
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

/** The margin of each untied task: the size of each score, with ties left out. */
function untiedMargins(differences: readonly number[]): number[] {
  return differences.flatMap((one) => (one === 0 ? [] : [Math.abs(one)]));
}

/** The sum of `values`. */
function sumOf(values: readonly number[]): number {
  return values.reduce((sum, one) => sum + one, 0);
}

/** The chance of a total of `from` or more, given the chance of each total. */
function chanceOfAtLeast(chances: readonly number[], from: number): number {
  return sumOf(chances.slice(Math.max(0, from)));
}

/** The smallest total of winning margins at which the test reads a step at `level`, or a number
 *  beyond the sum of all margins where no total does. */
function stepThreshold(sizes: readonly number[], level: number): number {
  const fair = plusTotalChances(sizes, 0.5);
  let [from, tail] = [fair.length, 0];
  while (from > 0 && tail + (fair[from - 1] ?? 0) <= level) {
    from -= 1;
    tail += fair[from] ?? 0;
  }
  return from;
}

/**
 * The p-value of the paired sign-flip test for the new harness: if each untied task were as likely
 * to be won as lost by its margin, the chance that the scores would add up to at least what they
 * do. With no untied task there is no evidence, and p is 1. Margins matter only when the result is
 * mixed. When every untied task is won, only the case where all are won reaches the sum, so p is
 * one half to the power of their count: two tasks won give 0.25 whether each was won by one pair or
 * by four.
 */
export function flipP(differences: readonly number[]): number {
  const sizes = untiedMargins(differences);
  // The scores add up to twice the winning margins minus all the margins.
  return Math.min(
    1,
    chanceOfAtLeast(plusTotalChances(sizes, 0.5), Math.ceil((sumOf(differences) + sumOf(sizes)) / 2)),
  );
}

/** Whether the task scores show a step for the new harness: p at or under `level`. */
export function readsStep(scores: readonly number[], level: number): boolean {
  return flipP(scores) <= level;
}

/** Whether an A/A control (one harness against itself) shows a step in either direction at
 *  `level`. Its two halves are interchangeable, so either could have been called the new harness,
 *  and a step either way means the comparison drifted, since no harness changed. The whole-run
 *  reader and the UI count such steps; no move waits on them. */
export function readsStepEitherWay(scores: readonly number[], level: number): boolean {
  return (
    readsStep(scores, level) ||
    readsStep(
      scores.map((one) => -one),
      level,
    )
  );
}

/** The task scores of a recorded test. Reports written between 26 October and 2 November counted
 *  the bill in `differences` and kept the scores without it as `unbilled`, which is read where
 *  present. */
export function scoresIn(test: unknown): number[] {
  const { unbilled, differences } = asRecord(test) ?? {};
  const found = Array.isArray(unbilled) ? unbilled : differences;
  return Array.isArray(found) ? found.filter(isNumber) : [];
}

/** The test's power: the chance it shows a step at `level`, on untied tasks with the margins of
 *  `differences`, if the new harness wins each with chance `share`. At a share of one half this is
 *  the false-positive rate for those margins, which never exceeds the level. */
export function power(differences: readonly number[], share: number, level: number): number {
  const sizes = untiedMargins(differences);
  return Math.min(1, chanceOfAtLeast(plusTotalChances(sizes, share), stepThreshold(sizes, level)));
}

/** The smallest win rate over the untied tasks, to the hundredth, that the test at `level` detects
 *  four times in five (`DETECTION_CHANCE`) on tasks with the margins of `differences`; null where
 *  even winning every task would show no step. */
export function detectable(differences: readonly number[], level: number): number | null {
  const shares = Array.from({ length: 51 }, (_, at) => (50 + at) / 100);
  return shares.find((share) => power(differences, share, level) >= DETECTION_CHANCE) ?? null;
}

/** The fewest scored tasks on which the test at `level` can show a step at all: that many, every
 *  one won. */
export function sweepOf(level: number): number {
  let sweep = 1;
  while (0.5 ** sweep > level) sweep += 1;
  return sweep;
}

/** The task set a report's test ran on: the whole scored set, which carries a `falseRate`, or the
 *  frontier alone in reports written before 20 October. */
export function testedSet<S extends { readonly falseRate?: unknown }, F>(
  whole: S | null,
  frontier: F,
): S | F {
  return whole?.falseRate === undefined ? frontier : whole;
}

/** The objective rule recorded in a comparison's start or report, or undefined where it has none.
 *  Logs from before 21 October may also hold a margin or floor beside the direction; those are
 *  ignored. */
export function objectiveRuleIn(data: JsonObject): ObjectiveRule | undefined {
  const { direction } = asRecord(data.objective) ?? {};
  return direction === "lower" || direction === "higher" ? { direction } : undefined;
}

/**
 * Whether a task can still show a difference for the harness on `side`, which is true in three
 * cases. The harness is valid on some solves but not all. It is valid on every solve, but a better
 * answer is on record (`gapAgainst`): another of its own, the other side's, or the task author's
 * (`task.feasible`). Or it is valid on none, but someone has given a valid answer
 * (`knownValidAnswers`, from `poolOf` in `reports.ts`). A task the harness answers perfectly every
 * time leaves it nothing to gain, and so does one it always fails that nobody has ever answered.
 */
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

/** Whether any of the side's own valid answers is beaten by at least the floor (`GAP_FLOOR`), by
 *  another of its own or by one in `against`: the room on the objective the task still leaves that
 *  harness. False where the pair has no objective or the side no measured answer. When drawing
 *  tasks for an author, only the side's own answers and the author's are passed, since the other
 *  harness's answers are its result on the task. */
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

/** How much better `one` is than `other` on the objective, as a share of the larger of the two
 *  values: negative where it is worse, 0 where either is missing. The floor is not applied here;
 *  callers compare this value against it. */
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

/** In pairing (`f`, `o`) of two valid answers, how much better the new side's is on the objective
 *  (`gainOver`), or 0 where the gap is under the floor (`GAP_FLOOR`). */
function objectiveGain(pair: Paired, f: number, o: number): number {
  const rule = pair.objective;
  const gain = rule === undefined ? 0 : gainOver(rule, rule.fresh[f], rule.old[o]);
  return Math.abs(gain) < GAP_FLOOR ? 0 : gain;
}

/** One task's score for the new harness against the reference, part by part, over every pairing
 *  of one solve from each side. A pairing where exactly one answer is valid counts towards
 *  `validity`; a pairing where both are valid counts towards the `objective` (`objectiveGain`). Each
 *  part is its mean over the pairings times its weight (`WEIGHTS`), in thousandths
 *  (`POINTS_SCALE`). */
export function pointsOf(pair: Paired): Measures {
  const sums = { validity: 0, objective: 0 };
  for (const [f, freshValid] of pair.fresh.entries()) {
    for (const [o, oldValid] of pair.old.entries()) {
      if (freshValid !== oldValid) sums.validity += freshValid ? 1 : -1;
      else if (freshValid) sums.objective += objectiveGain(pair, f, o);
    }
  }
  const each = POINTS_SCALE / (pair.fresh.length * pair.old.length);
  return {
    validity: sums.validity * WEIGHTS.validity * each,
    objective: sums.objective * WEIGHTS.objective * each,
  };
}

/** `points` rounded to a whole number, halves away from zero and with no negative zero, so that
 *  swapping the sides exactly negates the result. Scores, their parts and the tuner's replay all
 *  round through here. */
export function wholePoints(points: number): number {
  return Math.sign(points) * Math.round(Math.abs(points));
}

/** One task's score: its two parts added, then rounded. */
export function differenceOf(pair: Paired): number {
  const { validity, objective } = pointsOf(pair);
  return wholePoints(validity + objective);
}

/** Which part decided a task's result (`pointsOf`), or null for a tie: validity where its points
 *  alone point the same way as the score, otherwise the objective. */
export function carriedBy({ validity, objective }: Measures): keyof Measures | null {
  const sign = Math.sign(wholePoints(validity + objective));
  if (sign === 0) return null;
  return Math.sign(wholePoints(validity)) === sign ? "validity" : "objective";
}

/** Whether no solve of a pair gave a valid answer. */
export function unsolved({ old, fresh }: Paired): boolean {
  return ![...old, ...fresh].some(Boolean);
}

/** The tally of `differences` (each task won by the side its score favours, or tied at zero) and
 *  the test's p for the new harness. */
export function testOf(differences: readonly number[]): Tally & { readonly p: number } {
  const count = (sign: number) => differences.filter((one) => Math.sign(one) === sign).length;
  return { wins: count(1), losses: count(-1), ties: count(0), p: flipP(differences) };
}

/** The score of each pair, in order, and their test. Refuses a pair with no solves or with unequal
 *  counts on the two sides. */
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

/** `count` of `versions`, chosen by `seed` alone. Each version is ranked by the hash of the seed
 *  and the version, so the draw can be replayed from the logged seed, and adding a version to the
 *  pool does not change any other's rank. Fix the seed before the pool exists (the frozen
 *  contract's hash, for example): a seed chosen after seeing the pool could be picked to favour a
 *  result. */
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

/**
 * The pairs a comparison of two harnesses scores on `versions`, built from the log alone. Each side
 * keeps the first `solves` it started, not the first to finish, which would favour quick solves. A
 * solve counts for a side when its start names the comparison, its condition names the task, that
 * side's harness, the test side and the comparison's setting, and it ended in a pass or a fail; a
 * non-result was solved again. A task with fewer than `solves` on either side (as a resume may
 * leave) gets no pair and is listed in `short`. A disputed task is left out on both sides and
 * listed in `disputed`, so a dispute can remove a task from the test but can never create a win.
 * Any other task that is not held out is refused.
 */
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
  /** Each recorded condition's setting, by condition id, so that each setting is hashed once per
   *  condition rather than once per solve. */
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
    // For an A/A control, split the reference's solves into two halves (`halves`). The pattern
    // carries on from one task to the next, so with one solve per half the earlier solve goes to
    // the first half on every other task. Always putting the earlier solve first was biased: over
    // the 234 controls on record by 10 November the later half lost 446 tasks and won 363 (sign
    // test, p 0.004); alternating, it won 405 and lost 404.
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
