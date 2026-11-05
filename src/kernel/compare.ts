/**
 * The comparison: does the new harness beat the reference harness on tasks neither was built on?
 *
 * Both harnesses solve the same held-out tasks afresh under one setting, and every solve of the
 * new harness is paired with every solve of the reference on each task, which counts once. A task
 * is scored by two weighted measures over its pairings (`pointsOf`, `WEIGHTS`): validity, and
 * between two valid answers the objective, so no answer the checks refuse is ever the better one;
 * the objective's value is the verifier's, never one the answer reports about itself.
 * A positive score is a win, a negative one a loss and zero a tie (`tally`), in whole points so that
 * exchanging sides negates it (`wholePoints`).
 *
 * The test is an exact one-sided paired sign-flip test over the untied tasks' scores (`flipP`),
 * one test over the frontier and the retained tasks both fixed at the comparison's start, and a
 * step is that test at or under the campaign's level (`readsStep`); the same convolution at another
 * share is its power (`power`, `detectable`). The A/A comparison reads the reference against
 * itself on halves of its own solves (`halves`) as two harnesses are read.
 *
 * The weights and floors are this tree's constants, and a comparison continued under other code is
 * refused by its condition, so none is scored by two sets of them. How each ending of a solve
 * enters a pair is `.claude/skills/comparison-reading/references/draw-and-solves.md`, and the
 * dated record behind each rule here is `references/tally-and-test.md`, "The record".
 */
import { sha256 } from "../meta/digest.ts";
import { asRecord, isNumber, type JsonObject } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { conditionsOf, settingId } from "./condition.ts";
import type { LogEvent } from "./log.ts";
import { ended, measureOf, passed, ranUnder, verdictsOf } from "./solves.ts";
import { taskSets } from "./task.ts";

/** What one counted solve cost, as its `solve.finished` holds it: billed dollars, null where the
 *  log has none. */
interface Used {
  readonly billed: number | null;
}

/** How two valid answers on one task are set against each other: by the quantity the check program
 *  computes of each, lower or higher being better (`told`). */
export interface ObjectiveRule {
  readonly direction: "lower" | "higher";
}

/** One task version's counted solves under the reference harness and under the new: true for a
 *  valid answer. */
export interface Paired {
  readonly task: string;
  readonly old: readonly boolean[];
  readonly fresh: readonly boolean[];
  /** The objective each of those solves measured, in the same order, null where its answer was
   *  not valid or the verdict holds none; and the rule it is read by. Absent where the comparison
   *  fixed no objective. */
  readonly objective?: ObjectiveRule & {
    readonly old: readonly (number | null)[];
    readonly fresh: readonly (number | null)[];
  };
  /** Each of those solves as the log names it, in the same order. */
  readonly solves?: { readonly old: readonly string[]; readonly fresh: readonly string[] };
  /** What each of those solves cost, in the same order. */
  readonly used?: { readonly old: readonly Used[]; readonly fresh: readonly Used[] };
}

/** A number for each of the two measures a task is scored by (`pointsOf`): its weight, or the
 *  points it gave. */
export type Measures = Readonly<Record<"validity" | "objective", number>>;

export interface Tally {
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
}

/** The measures retained in a task's score (`scoresOf`). */
export type Kept = "scored" | "validity";

/** What a comparison is made between: the two harnesses by digest, and the setting every counted
 *  solve ran under (`settingId`). */
interface Sides {
  readonly old: string;
  readonly fresh: string;
  readonly setting: string;
  /** The comparison's id: only a solve whose start names it is a solve of it. */
  readonly comparison: string;
  /** Where the reference harness is read against itself, `mirrored`: its first sample of a task
   *  is the first and last of each four of its solves in the order they started, and its other
   *  solves are the second, the other side where the two harnesses are one: the one case in which
   *  both sides may name the same harness. */
  readonly halves?: "mirrored" | undefined;
  /** The objective two valid answers are compared by, where the comparison fixed one. */
  readonly objective?: ObjectiveRule | undefined;
}

/** The chance at which a share of untied tasks won is detected (`detectable`): four times in five. */
const POWER = 0.8;
/** What a report holds for a retained set no task was tallied in: no reading, never no loss. */
export const UNMEASURED = "unmeasured" as const;
/** Two measures within this share of the larger are one measure: what floating-point arithmetic
 *  leaves between two answers of the same value, and nothing a harness did. */
const SAME = 1e-9;
/** The least improvement by the objective worth counting, as a share of the larger magnitude: the
 *  objective gap floor. Two valid answers closer than it tie in a pair (`told`), and an answer on
 *  record better than one of a harness's own by less leaves it no room on the task
 *  (`hasObjectiveGap`), which decides task admission, the frontier and `roomOf`. The test says
 *  whether a difference is believable, and the floor whether it is worth counting. */
export const ROOM = 0.01;

/** How much each measure weighs in a task's score (`pointsOf`). Each measure is its mean over the
 *  task's pairings, from -1 to 1, and a pairing counts on one measure only, so a task's score runs
 *  from -600 to 600 thousandths (`POINTS`). */
export const WEIGHTS: Measures = { validity: 0.6, objective: 0.3 };
/** A task's score in whole points: thousandths, since the test's convolution is over whole numbers. */
const POINTS = 1000;
/**
 * The chance of each total of `sizes` taken with a plus sign, where each is taken so with chance
 * `share`, independently: entry k is the chance that the sizes signed plus sum to k. The sizes are
 * whole numbers, as task scores in points are, so the convolution is over integer sums and
 * exact up to the rounding of each step; an entry too small for a number reads 0 and takes no
 * other with it.
 */
function signed(sizes: readonly number[], share: number): number[] {
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

/** The untied tasks' margins: each difference's size, the ties dropped. */
function sizesOf(differences: readonly number[]): number[] {
  return differences.flatMap((one) => (one === 0 ? [] : [Math.abs(one)]));
}

/** The sum of `values`. */
function total(values: readonly number[]): number {
  return values.reduce((sum, one) => sum + one, 0);
}

/** The chance that `chances` reaches a total of `from` or more. */
function above(chances: readonly number[], from: number): number {
  return total(chances.slice(Math.max(0, from)));
}

/** The least plus-total of `sizes` that the test reads a step at at `level`; past their sum where
 *  none does. */
function critical(sizes: readonly number[], level: number): number {
  const fair = signed(sizes, 0.5);
  let [from, tail] = [fair.length, 0];
  while (from > 0 && tail + (fair[from - 1] ?? 0) <= level) {
    from -= 1;
    tail += fair[from] ?? 0;
  }
  return from;
}

/**
 * The paired sign-flip test's p for the new harness: the chance, were each untied task as likely
 * won as lost by its margin, that the differences sum to at least what they do. No untied task is
 * no evidence, and reads 1. The margins weigh a mixed result, and none where every untied task is
 * won: then only the signing that wins them all reaches the sum, and p is one half to the power of
 * their count, so two tasks won read 0.25 whether by one pair each or by four.
 */
export function flipP(differences: readonly number[]): number {
  const sizes = sizesOf(differences);
  // The differences sum to twice their plus-total less all of the sizes.
  return Math.min(1, above(signed(sizes, 0.5), Math.ceil((total(differences) + total(sizes)) / 2)));
}

/** Whether the test on the task scores clears `level` for the new harness. */
export function readsStep(scores: readonly number[], level: number): boolean {
  return flipP(scores) <= level;
}

/** Whether a reading of one harness against itself reads a step either way at `level`, as a
 *  comparison would read a step whichever sample it took for the new harness. Its two sides are
 *  interchangeable by construction, so such a step says the comparison moved, not a harness. The
 *  whole-run reader and the UI count it so, and no move waits on it. */
export function readsStepEitherWay(scores: readonly number[], level: number): boolean {
  return (
    readsStep(scores, level) ||
    readsStep(
      scores.map((one) => -one),
      level,
    )
  );
}

/** The scores a recorded test is read on: `unbilled` where a report of 26 October to 2 November
 *  holds them (its `differences` had the bill's points in), else its `differences`. */
export function scoresIn(test: unknown): number[] {
  const { unbilled, differences } = asRecord(test) ?? {};
  const found = Array.isArray(unbilled) ? unbilled : differences;
  return Array.isArray(found) ? found.filter(isNumber) : [];
}

/** The chance that a reading at `level` of untied tasks with the margins of `differences` reads a
 *  step where the new harness wins each with chance `share`. At one half it is the test's
 *  false-positive rate on those margins, which is never over the level. */
export function power(differences: readonly number[], share: number, level: number): number {
  const sizes = sizesOf(differences);
  return Math.min(1, above(signed(sizes, share), critical(sizes, level)));
}

/** The least share of the untied tasks won, in hundredths, that a reading at `level` of tasks with
 *  the margins of `differences` reads a step on four times in five (`POWER`); null where even every
 *  task won reads none. */
export function detectable(differences: readonly number[], level: number): number | null {
  const shares = Array.from({ length: 51 }, (_, at) => (50 + at) / 100);
  return shares.find((share) => power(differences, share, level) >= POWER) ?? null;
}

/** The smallest scored set the test at `level` can read a step on: that many tasks, all won. */
export function sweepOf(level: number): number {
  let sweep = 1;
  while (0.5 ** sweep > level) sweep += 1;
  return sweep;
}

/** The promotion tuner's reading at `level`: `step` where frontier and retained tasks together
 *  clear it (`readsStep`). It reads only sets this tree has just scored, so a set without its
 *  scores is the caller's fault and is refused: a report before 12 October holds a pooled tally
 *  alone. A recorded report keeps the reading it wrote; the promotion tuner scores its pairs again
 *  instead. */
export function stepOf(report: JsonObject, level: number): "step" | "no-step" {
  const sets = [report.frontier, ...(report.retained === UNMEASURED ? [] : [report.retained])];
  const scores = sets.flatMap((set) => {
    const found = asRecord(set)?.differences;
    if (!Array.isArray(found) || !found.every(isNumber)) {
      throw new Error("a reading needs a frontier and a retained set, each with its differences");
    }
    return scoresIn(set);
  });
  return readsStep(scores, level) ? "step" : "no-step";
}

/** The objective rule a comparison's start, or its report, carries, or undefined where it fixed
 *  none. A log of before 21 October may hold a margin or a floor beside the direction, which is no
 *  longer read. */
export function objectiveRuleIn(data: JsonObject): ObjectiveRule | undefined {
  const { direction } = asRecord(data.objective) ?? {};
  return direction === "lower" || direction === "higher" ? { direction } : undefined;
}

/** A number for each measure where `value` holds one, as a report holds the points each measure
 *  gave; undefined otherwise, as in every report before 21 October. */
export function measuresIn(value: unknown): Measures | undefined {
  const { validity, objective } = asRecord(value) ?? {};
  return isNumber(validity) && isNumber(objective) ? { validity, objective } : undefined;
}

/**
 * Whether a task tells something of the harness on `side`: valid on some of its solves and not all;
 * valid on all where a better answer is on record (`hasObjectiveGap`); or valid on none where the
 * task is among `feasible`, the versions a valid answer is on record for (`poolOf`, `reports.ts`).
 * A task it answers alike in every solve, at the best answer on record, leaves it nothing to gain
 * on, and so does one it fails in every solve that nobody has answered.
 */
export function informative(
  pair: Paired,
  side: "old" | "fresh",
  knownValidAnswers: ReadonlySet<string>,
  bests: ReadonlyMap<string, number> = new Map(),
): boolean {
  const valid = pair[side].filter(Boolean).length;
  if (valid === 0) return knownValidAnswers.has(pair.task);
  return valid < pair[side].length || hasObjectiveGap(pair, side, bests.get(pair.task) ?? null);
}

/**
 * Whether a measure on record is better by the objective, by at least the floor (`ROOM`), than one
 * of the side's own valid answers: another of its own, the other side's, or `best`, its author's
 * (`task.feasible`). A harness that reaches it wins the pairs against that answer, so the task has
 * room. False where the pair carries no objective; a valid answer with no measure is compared with
 * nothing. The author's answer counts because it proves a better answer exists, which is the room
 * a better harness can take; it never reaches a solver.
 */
export function hasObjectiveGap(pair: Paired, side: "old" | "fresh", best: number | null): boolean {
  return (
    (objectiveGap(pair, side, [...(pair.objective?.[side === "old" ? "fresh" : "old"] ?? []), best]) ?? 0) > 0
  );
}

/** The most that a measure, one of the side's own or one `against` it, is better by than one of
 *  the side's own valid answers, as a share of the larger magnitude, where that reaches the floor
 *  (`ROOM`), and 0 under it: the objective gap the task leaves that harness. Null where the pair carries no
 *  objective or the side no measure. Its author is told it against the side's own answers alone,
 *  since the other harness's answers are its result on the task. */
export function objectiveGap(
  pair: Paired,
  side: "old" | "fresh",
  against: readonly (number | null)[],
): number | null {
  const rule = pair.objective;
  const own = rule?.[side].filter(isNumber) ?? [];
  if (rule === undefined || own.length === 0) return null;
  const known = [...own, ...against.filter(isNumber)];
  const most = Math.max(...own.flatMap((mine) => known.map((other) => gainOver(rule, other, mine) ?? 0)));
  return most >= ROOM ? most : 0;
}

/** How much better `one` is than `other` by the objective, as a share of the larger magnitude:
 *  negative where it is worse, 0 where they are one measure (`SAME`), null where one is missing.
 *  The floor plays no part: this is the fact a floor is held to. */
function gainOver(rule: ObjectiveRule, one: number | null, other: number | null): number | null {
  if (one === null || other === null) return null;
  // How far apart they are, as a share of the larger magnitude, and at most one: two measures
  // either side of zero would otherwise be up to two apart, past the objective's weight.
  const larger = Math.max(Math.abs(one), Math.abs(other));
  const gap = larger === 0 ? 0 : Math.min(1, Math.abs(one - other) / larger);
  if (gap <= SAME) return 0;
  return (rule.direction === "lower") === one < other ? gap : -gap;
}

/** How much better the new side's answer of pairing (`f`, `o`) is by the objective, between two
 *  valid answers: its gain as a share of the larger magnitude, which `gainOver` bounds at one
 *  either way; 0 under the floor (`ROOM`) or where a measure is missing. */
function told(pair: Paired, f: number, o: number): number {
  const rule = pair.objective;
  const gain = rule === undefined ? 0 : (gainOver(rule, rule.fresh[f] ?? null, rule.old[o] ?? null) ?? 0);
  return Math.abs(gain) < ROOM ? 0 : gain;
}

/** One task's score by measure, the new side's against the reference's over every pairing of a solve
 *  of each: each measure is its mean over the pairings, from -1 to 1, times its weight (`WEIGHTS`),
 *  in thousandths (`POINTS`): `validity` where one answer of the two was valid, the `objective`
 *  between two valid answers (`told`). A pairing counts on one of the two, so the sum runs from
 *  -600 to 600. */
export function pointsOf(pair: Paired): Measures {
  const sums = { validity: 0, objective: 0 };
  for (const [f, freshValid] of pair.fresh.entries()) {
    for (const [o, oldValid] of pair.old.entries()) {
      if (freshValid !== oldValid) sums.validity += freshValid ? 1 : -1;
      else if (freshValid) sums.objective += told(pair, f, o);
    }
  }
  const each = POINTS / Math.max(1, pair.fresh.length * pair.old.length);
  return {
    validity: sums.validity * WEIGHTS.validity * each,
    objective: sums.objective * WEIGHTS.objective * each,
  };
}

/** `points` to the whole point, half points away from zero and zero normalised, so that exchanging
 *  the sides negates it: the one rounding of a score, its measures' totals and the tuner's replay. */
export function wholePoints(points: number): number {
  const magnitude = Math.round(Math.abs(points));
  return magnitude === 0 ? 0 : Math.sign(points) * magnitude;
}

/** Project one task's weighted components, rounding only after adding the kept measures.
 * Both readings share this arithmetic, including replay under different weights. */
export function scoresOf({ validity, objective }: Measures): Readonly<Record<Kept, number>> {
  return { scored: wholePoints(validity + objective), validity: wholePoints(validity) };
}

/** One task's rounded score on the measures `kept` names. */
export function differenceOf(pair: Paired, kept: Kept = "scored"): number {
  return scoresOf(pointsOf(pair))[kept];
}

/** The measure that carried a task's result from its points (`pointsOf`), null for a tie: validity
 *  where its points alone share the score's sign, and otherwise the objective. It reads points
 *  rather than a pair so that the promotion tuner, which scales them by other weights, credits a
 *  win by this rule too. */
export function carriedBy(points: Measures): keyof Measures | null {
  const score = scoresOf(points);
  const sign = Math.sign(score.scored);
  if (sign === 0) return null;
  return Math.sign(score.validity) === sign ? "validity" : "objective";
}

/** Whether no solve of a pair gave a valid answer. */
export function unsolved({ old, fresh }: Paired): boolean {
  return ![...old, ...fresh].some(Boolean);
}

/** Validate complete, balanced pairs and calculate their score components once. */
function differencesOf(pairs: readonly Paired[]) {
  return pairs.map((pair) => {
    const { task, old, fresh } = pair;
    if (old.length === 0 || old.length !== fresh.length) {
      throw new Error(
        `task ${task} has ${String(old.length)} solve(s) under the old harness and ${String(fresh.length)} under the new; a comparison needs as many of each`,
      );
    }
    return scoresOf(pointsOf(pair));
  });
}

/** The test of `differences`: each task won by the harness its score favours and tied otherwise,
 *  and the test's p for the new harness. */
export function testOf(differences: readonly number[]): Tally & { readonly p: number } {
  const count = (sign: number) => differences.filter((one) => Math.sign(one) === sign).length;
  return { wins: count(1), losses: count(-1), ties: count(0), p: flipP(differences) };
}

/** The scores of `pairs`, in their order, and their test. */
export function scored(pairs: readonly Paired[]) {
  const differences = differencesOf(pairs).map((one) => one.scored);
  return { ...testOf(differences), differences };
}

/** The tally of `scored` alone. */
export function tally(pairs: readonly Paired[]): Tally {
  const { wins, losses, ties } = testOf(differencesOf(pairs).map((one) => one.scored));
  return { wins, losses, ties };
}

/** `count` of `versions`, chosen by `seed` and nothing else. Each version is ranked by the hash of
 *  the seed and itself, so a draw replays from the log that records its seed, and a version added
 *  to the pool moves no other's rank. The seed is to be fixed before the pool exists, the frozen
 *  contract's hash for one: a seed chosen once the pool is known can be searched for. */
export function draw(versions: readonly string[], count: number, seed: string): string[] {
  const pool = [...new Set(versions)];
  if (pool.length < count) {
    throw new Error(`a draw of ${String(count)} needs as many task versions; ${String(pool.length)} given`);
  }
  return pool
    .map((version) => ({ version, rank: sha256(`${seed}:${version}`) }))
    .sort((a, b) => compareCodeUnits(a.rank, b.rank))
    .slice(0, count)
    .map(({ version }) => version);
}

/**
 * The pairs a comparison of two harnesses reads, for `versions`, from the log alone, each side cut
 * to the first `solves` it started, since the order solves ended in would take the quick ones. A
 * solve counts for a side when its start names the comparison, its condition names the task, that
 * side's harness, the test side and the comparison's setting, and it ended in a pass or a fail; a
 * non-result was solved again. A task with fewer than `solves` on a side is in no pair and named in
 * `short`, as a resume may leave one. A disputed version is left out on both sides and named in
 * `disputed`, so a dispute can remove a task from the test and cannot make a win. Any other version
 * that is no held-out task is refused.
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
  /** Each recorded condition's setting, by the condition's id: a setting is hashed once a condition
   *  and not once a solve. */
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
    .sort((a, b) => a.started - b.started);
  const disputed = versions.filter((task) => states.get(task) === "disputed");
  const short: string[] = [];
  const pairs = versions.flatMap((task): Paired[] => {
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
    // Where the reference is read against itself, its first sample and its second (`halves`).
    const first = (at: number) => halves === undefined || at % 4 === 0 || at % 4 === 3;
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
    const measured = side(({ id }) => measureOf(verdicts?.get(id)));
    return [
      {
        task,
        ...side((solve) => passed(solve) === true),
        solves: side(({ id }) => id),
        used: side(({ end }): Used => ({ billed: isNumber(end.billed) ? end.billed : null })),
        ...keyIfDefined("objective", objective === undefined ? undefined : { ...objective, ...measured }),
      },
    ];
  });
  return { pairs, short, disputed };
}
