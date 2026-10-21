/**
 * The comparison: does the new harness beat the reference harness on tasks neither was built on?
 *
 * Both harnesses solve the same held-out tasks under the same compute budget, and each task
 * counts once. Every solve of the new harness is paired with every solve of the reference one, and
 * each task is scored by three weighted measures over its pairings (`pointsOf`, `WEIGHTS`): validity,
 * and between two valid answers the objective and the bill. A task with a positive score is won, a
 * negative one lost, and one at zero tied (`tally`).
 *
 * The test is a paired sign-flip test on each task's score (`flipP`, since
 * 12 October): were the two harnesses interchangeable, each untied task would be as likely won as
 * lost by its margin, and p is the share of the signs that sum to at least the sum read. It is
 * exact, by one convolution over the integer sums, and needs no more than the sign test it
 * replaced did: tasks independent, the two sides alike under the null. Where every untied task is
 * won or lost by as many pairs it is the sign test, so the plan's smallest wins (4-0, 6-1, 7-2,
 * 9-3 at 0.10) and its table of power hold to the bit; at four solves a side it also reads how far
 * a task was won, so a 4-1 lost by one pair in sixteen clears 0.10 where the sign test read every
 * 4-1 at 0.1875. A tie says nothing and leaves the test. The same convolution at a share other
 * than one half is the power (`power`), and every reading says the least share of its untied tasks
 * it detects four times in five (`detectable`).
 *
 * The step is one test over the frontier, the scored tasks not exhausted, and the retained tasks,
 * both fixed at the comparison's start (`round.ts`, `begin`; `poolOf`, `reports.ts`). From 12 to
 * 20 October the retained tasks were a second test, read `regressed`; in 58 real readings it fired
 * once, on r3's g-12, the starter, which the one test reads `no-step` (p 0.147). Gains on new tasks
 * may now offset losses on old ones, and the report keeps the two sets' tallies apart. A retained
 * set with no task tallied is `unmeasured`, never no loss. Until 16 October a step whose untied
 * tasks all fell in one family read `narrow`; in 1,598 recorded readings it never fired.
 *
 * One comparison's reading, `step`, is that test at or under the level, 0.02 by default,
 * and a step against the reference promotes (`stepOf`; `decide.ts`). The level is the caller's and
 * recorded with the campaign's opening, so a campaign reads by its own rule whatever the tree's
 * default (`7f0add79:docs/plan.md`, Statistical power and cost). From 10 to 19 October the step was read in
 * two stages: a first reading at or under a trigger, 0.25, bought a repeat on fresh solves, and the
 * two read together had to clear the level. Of 24 readings in 56 campaigns that cleared the level by
 * themselves, 11 were read again and 11 of 11 won at least as many tasks as they lost; the repeat
 * took 1 to 2.5 hours of a promotion's 6 to 7, and a trigger term, a repeat's scored set, its task
 * supply and a rule of the campaign tools served it alone. One exact test at 0.02 promotes equal
 * harnesses 1.13% of the time on 24 untied tasks each won or lost by a pair (`power` at one half).
 *
 * How each ending of a solve enters a pair (`solve.ts` names the endings; the table is the plan's,
 * `7f0add79:docs/plan.md`, Phase 2):
 *
 * | The solve ended | Its part in a pair |
 * | --- | --- |
 * | pass: every check accepted the answer, within the limits | valid. It beats an answer that is not, and is even with another valid one |
 * | fail, `rejected`, and the rejection stands | not valid. It loses to a valid answer and is even with another that is not |
 * | fail, `wall-ended`, `turns-ended`, `context-ended`, `no-answer` | not valid. There is no answer to recompute, so no ruling is needed |
 * | fail, `broken-harness` | not valid: the harness is the thing compared, and one that cannot list its tools answers nothing |
 * | fail, `rejected`, ruled a check defect or unclear, or waiting for a person | the task is set aside and left out of the test for both harnesses (`src/builder/round.ts`) |
 * | non-result of any kind | no measurement. It was solved again, and is in no pair; a task left short of its solves is in no tally |
 *
 * Validity is the measure that weighs most, and it is read alone where one answer of a pairing is
 * valid: the objective and the bill are read only between two valid answers, so no answer the checks
 * refuse is ever the better or the cheaper one. Where the check program declares an objective, a
 * quantity its evaluator computes from a valid answer (`verify.ts`, `OBJECTIVE`), it is a term of
 * the comparison, fixed at its start (`comparison.started`, `objective`), as are the weights
 * (`weights`). The value is the host's: no value the answer reports about itself is read.
 *
 * Every held-out task is compared (`task.ts`). The controls are the Starter Built Harness, which is
 * the first reference and the fixed lower one after a promotion, and the reference harness set
 * against itself on halves of its own solves (`pairsOf`, `halves`), which is read as two harnesses
 * are.
 *
 * The pairs are a view over the log (`pairsOf`). A solve counts for a side when its start names
 * the comparison, and its condition names the task, that side's harness, the test side and the
 * setting the comparison is made under (`condition.ts`). A comparison's solves are the ones it
 * started itself, so the two sides are solved afresh at every comparison: a condition names the
 * host's code, which changes between comparisons, and one frozen draw of the reference harness's
 * solves would bias every later comparison read against it (the review of 2026-10-09, findings 6
 * and 7). A side's solves are in the order they started, and where a side holds more than the
 * comparison asked for the first started are taken, since the order solves ended in would take the
 * quick ones; a task with fewer on a side is in no pair, and named (`short`).
 *
 * Nothing here decides a step; it reports the tally and its test.
 */
import { sha256 } from "../meta/digest.ts";
import { asRecord, isNumber, type JsonObject } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { median } from "../meta/tally.ts";
import { conditionsOf, settingId } from "./condition.ts";
import type { LogEvent } from "./log.ts";
import { ended, passed, ranUnder, verdictsOf } from "./solves.ts";
import { taskSets } from "./task.ts";

/** What one counted solve cost, as its `solve.finished` holds it: billed dollars, null where the
 *  log has none. */
interface Used {
  readonly billed: number | null;
}

/** How two valid answers on one task are set against each other: by the quantity the check program
 *  computes of each, lower or higher being better (`better`). */
export interface ObjectiveRule {
  readonly direction: "lower" | "higher";
  /** The least share of the larger measure by which one valid answer beats another in a pair
   *  (`better`): `ROOM` for a comparison begun since 21 October, none before. */
  readonly room?: number;
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
  /** The weights the comparison began with (`WEIGHTS`), which its tasks are scored by
   *  (`pointsOf`); absent where it began with none. */
  readonly weights?: Measures;
}

/** A number for each of the three measures a task is scored by (`pointsOf`): its weight, or the
 *  points it gave. */
export type Measures = Readonly<Record<"validity" | "objective" | "bill", number>>;

export interface Tally {
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
}

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
  /** The weights, where the comparison began with them (`WEIGHTS`). */
  readonly weights?: Measures | undefined;
}

/** A median relative gain by the objective, over `tasks` tasks (`objectiveGain`). */
export interface Gain {
  readonly median: number;
  readonly tasks: number;
}

/** The chance at which a share of untied tasks won is detected (`detectable`): four times in five. */
const POWER = 0.8;
/** What a report holds for a retained set no task was tallied in: no reading, never no loss. */
export const UNMEASURED = "unmeasured" as const;
/**
 * Two measures within this share of the larger are one measure: what floating-point arithmetic
 * leaves between two answers of the same value, and nothing a harness did. 22 of 4,852 pairings of
 * valid answers in the 11 campaigns of 14 to 19 October differed by less.
 *
 * Until 19 October a margin stood here, 0.01 of the larger magnitude by default and a term of each
 * comparison (`--margin`); from 12 to 18 October the last A/A set it from the reference's own
 * spread. It turned wins into ties and protected no reading. Replayed on the solves of those 18
 * campaigns, the A/A of 38 comparisons read no step at 0.01 or at 0, and at 0 the reference
 * against itself won 140 untied tasks and lost 139, where the new harness won 23 of 24 in r2's
 * comparison g-3, which read 4-0-20 at 0.01; the same solves promote 14 pairs where they promoted
 * 12. The sign-flip test already reads how often equal harnesses win a task by the objective, so a
 * difference the test does not trust is a tie of the test's own, and none is needed of the pair's.
 */
const SAME = 1e-9;
/**
 * The least improvement by the objective worth counting, as a share of the larger magnitude: the
 * room floor, recorded with the rule's direction at each comparison's start. One
 * judgement in every place it is asked: two valid answers closer than it tie in a pair (`better`),
 * and an answer on record better than one of a harness's own by less leaves that harness no room on
 * the task (`bettered`), which decides the gate, the frontier and `roomOf`.
 *
 * In buffer-fresh-opus-r6 every solve of both sides was valid on all 24 tasks of comparison g-2,
 * which read 23-0-1 and promoted on gains of 0.01% to 0.65%: at this floor the same solves read
 * 3-3-18, and its gate held 10 of the 29 drafts it held at `SAME`. The sign-flip test says whether
 * a difference is believable, and the floor whether it is worth counting: six tasks with room won by
 * 0.01% read p = 0.016 and promoted. It declines smaller gains even where they are consistent. A
 * comparison that began before 21 October recorded no floor, and its pairs read at `SAME` as they
 * were read, while what room its tasks leave now is read at this one. A `--room` term set it per
 * campaign for a day; no campaign named one, and on 21 October the operator chose one fixed floor.
 */
export const ROOM = 0.01;

/**
 * How much each measure weighs in a task's score (`pointsOf`), recorded at each comparison's start
 * (`weights`): whether an answer was valid, then between two valid answers how much better it is by
 * the objective and how much less its solve billed. Each measure is the mean over the task's pairings
 * of a solve of each side, from -1 to 1, so a task's score runs from -1 to 1 and is read in
 * thousandths (`POINTS`) by the one test.
 *
 * Until 21 October a task was read by validity, then the objective, then the bill, one rule to a
 * task, and the size of a gain counted nowhere: a harness that won 23 tasks by 0.01% read as
 * strongly as one that halved every bill. The operator then chose a score of weighted measures
 * (60, 30 and 10, in steps of five). Replayed on 74 recorded comparisons, it reads 52 steps where 47
 * were read, and none of the 26 A/A controls reads one; the five steps it drops rested on objective
 * gaps of a ten-thousandth, and the ones it adds mostly halved the bill on tasks that otherwise tied.
 * The test reads the signs of the task scores more than their size, so a harness a little better on
 * enough tasks still steps: the floors below (`ROOM`, `CHEAPER`) set the least gain a pairing counts.
 */
export const WEIGHTS: Measures = { validity: 0.6, objective: 0.3, bill: 0.1 };
/** The objective's gain, as a share of the larger magnitude, at which a pairing takes the whole of
 *  the objective's weight: an answer a tenth better. */
export const FULL = 0.1;
/** The least ratio of two valid answers' bills that counts, a fifth less of the dearer; half the bill
 *  takes the whole of the bill's weight (`saved`). */
export const CHEAPER = 1.25;
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
    chances.forEach((chance, at) => {
      next[at] = (next[at] ?? 0) + chance * (1 - share);
      next[at + size] = (next[at + size] ?? 0) + chance * share;
    });
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

/** Whether a reading of one harness against itself reads a step either way at `level`: the
 *  smaller of its two one-sided tests at or under it, as a comparison would read a step whichever
 *  sample it took for the new harness. Its two sides are interchangeable by construction, so such
 *  a step says the comparison moved, not a harness. The whole-run reader and the UI count it so,
 *  and no move waits on it: until 20 October the table ended a campaign on its epoch's first. */
export function readsStepEitherWay(differences: readonly number[], level: number): boolean {
  return Math.min(flipP(differences), flipP(differences.map((one) => -one))) <= level;
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

/** One comparison's reading of its report at `level`: `step` where the one test over its frontier
 *  and retained tasks' scores together clears it, and `no-step` otherwise. A
 *  step against the reference promotes (`decide.ts`). A report written before 12 October holds a
 *  pooled tally alone, with no frontier and retained set, and is refused. */
export function stepOf(report: JsonObject, level: number): "step" | "no-step" {
  const differences = (held: unknown) => {
    const found = asRecord(held)?.differences;
    return Array.isArray(found) && found.every(isNumber) ? found : null;
  };
  const frontier = differences(report.frontier);
  const retained = report.retained === UNMEASURED ? [] : differences(report.retained);
  if (frontier === null || retained === null) {
    throw new Error("a reading needs a frontier and a retained set");
  }
  return flipP([...frontier, ...retained]) <= level ? "step" : "no-step";
}

/** The objective rule a comparison's start, or its report, carries, or undefined where it fixed
 *  none. A log of before 19 October holds a margin beside the direction, which is no longer read. */
export function objectiveRuleIn(data: JsonObject): ObjectiveRule | undefined {
  const { direction, room } = asRecord(data.objective) ?? {};
  if (direction !== "lower" && direction !== "higher") return undefined;
  return { direction, ...keyIfDefined("room", isNumber(room) ? room : undefined) };
}

/** A number for each measure where `value` holds one, as a comparison's start holds its weights
 *  (`WEIGHTS`) and its report the points they gave; undefined otherwise, as in every comparison
 *  begun before 21 October. */
export function measuresIn(value: unknown): Measures | undefined {
  const { validity, objective, bill } = asRecord(value) ?? {};
  return isNumber(validity) && isNumber(objective) && isNumber(bill)
    ? { validity, objective, bill }
    : undefined;
}

// Two other readings of a tally, the trinomial test and the chance that the new harness is the
// better one, decide nothing and are not built: their formulas and what they read of the recorded
// comparisons are in `7f0add79:docs/plan.md`, "Statistical power and cost" (row C3).

/**
 * Whether a task tells something of the harness on `side` (the overhaul plan's one definition of
 * informative, section 4b, the one `try_task` admits a draft by, and the one the exhausted fold
 * closes a task by, through `closedTo`): valid on some of its solves and not all; valid on all
 * where a better answer is on record (`bettered`); or valid on none where the task is among
 * `feasible`, the versions a valid answer is on record for (`poolOf`, `reports.ts`): another
 * harness's, a reference solve's at the gate, or its author's. A task it answers alike in every
 * solve, at the best answer on record, leaves it nothing to gain on, and so does one it fails in
 * every solve that nobody has answered. Until 15 October a task the reference failed in every
 * solve was never informative, so once a promoted harness passed every scored solve (buffer-149's
 * 68 of 68 in two comparisons, recode-151's 56 of 56, buffer-159-opus's 38 of 40) its room was
 * only the tasks it answered some of the time, and the gate held out only such drafts.
 */
export function informative(
  pair: Paired,
  side: "old" | "fresh",
  feasible: ReadonlySet<string>,
  bests: ReadonlyMap<string, number> = new Map(),
): boolean {
  const valid = pair[side].filter(Boolean).length;
  if (valid === 0) return feasible.has(pair.task);
  return valid < pair[side].length || bettered(pair, side, bests.get(pair.task) ?? null);
}

/**
 * Whether a measure on record is better by the objective, by at least the floor (`ROOM`), than one
 * of the side's own valid answers: another of its own, the other side's, or `best`, its author's
 * (`task.feasible`). A harness that reaches it wins the pairs against that answer, so the task has
 * room. False where the pair carries no objective; a valid answer with no measure is compared with
 * nothing.
 *
 * The author's answer counts because it proves a better answer exists, which is the room a better
 * harness can take; it never reaches a solver. On 21 October it counted from solves alone for a few
 * hours: a live Examiner then had 7 of 7 drafts refused, three of them with an answer of its own 3%
 * to 20% cheaper than every reference solve's, because the reference repeated one recipe within the
 * floor. The floor is what keeps the author's precision out: in buffer-fresh-opus-r6 its answers
 * held drafts by a hundredth of a percent.
 */
function bettered(pair: Paired, side: "old" | "fresh", best: number | null): boolean {
  return (
    (roomLeft(pair, side, [...(pair.objective?.[side === "old" ? "fresh" : "old"] ?? []), best]) ?? 0) > 0
  );
}

/** The most that a measure, one of the side's own or one `against` it, is better by than one of
 *  the side's own valid answers, as a share of the larger magnitude, where that reaches the floor
 *  (`ROOM`), and 0 under it: the room the task leaves that harness. Null where the pair carries no
 *  objective or the side no measure. Its author is told it against the side's own answers alone,
 *  since the other harness's answers are its result on the task (`exam-results`). */
export function roomLeft(
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
export function gainOver(rule: ObjectiveRule, one: number | null, other: number | null): number | null {
  if (one === null || other === null) return null;
  // How far apart they are, as a share of the larger magnitude.
  const larger = Math.max(Math.abs(one), Math.abs(other));
  const gap = larger === 0 ? 0 : Math.abs(one - other) / larger;
  if (gap <= SAME) return 0;
  return (rule.direction === "lower") === one < other ? gap : -gap;
}

/** How much better the new side's answer of pairing (`f`, `o`) is by the objective, between two
 *  valid answers: 0 under the comparison's floor (`ROOM`; none where its start recorded none) or
 *  where a measure is missing; under weights its gain as a share of `FULL`, at most one either way;
 *  before them its sign alone. */
function told(pair: Paired, f: number, o: number): number {
  const rule = pair.objective;
  const gain = rule === undefined ? 0 : (gainOver(rule, rule.fresh[f] ?? null, rule.old[o] ?? null) ?? 0);
  if (rule === undefined || Math.abs(gain) < (rule.room ?? 0)) return 0;
  return pair.weights === undefined ? Math.sign(gain) : capped(gain / FULL);
}

/** How much less the new side's solve of pairing (`f`, `o`) billed, between two valid answers: the
 *  base-2 logarithm of the reference's bill over the new one's, at most one either way, so half the
 *  bill takes the whole weight; 0 where the two are within `CHEAPER` of each other, a bill is
 *  missing, or the comparison recorded no weights. */
function saved(pair: Paired, f: number, o: number): number {
  const [fresh, old] = [pair.used?.fresh[f]?.billed ?? 0, pair.used?.old[o]?.billed ?? 0];
  if (pair.weights === undefined || fresh <= 0 || old <= 0) return 0;
  const ratio = Math.log2(old / fresh);
  // A fifth less is at the floor, though log2(0.5 / 0.4) reads a hair over log2(1.25).
  return Math.abs(ratio) < Math.log2(CHEAPER) - SAME ? 0 : capped(ratio);
}

/** `value`, held between -1 and 1. */
function capped(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

/** One task's score by measure, the new side's against the reference's over every pairing of a solve
 *  of each. Under weights, each measure is its mean over the pairings, from -1 to 1, times its weight,
 *  in thousandths (`POINTS`): `validity` where one answer of the two was valid, the `objective` and the
 *  `bill` between two valid answers (`told`, `saved`). A comparison begun before 21 October
 *  recorded no weights, and reads as it was read: its pairings won on validity, and on the objective
 *  between two valid answers, with no bill. */
export function pointsOf(pair: Paired): Measures {
  const sums = { validity: 0, objective: 0, bill: 0 };
  for (const [f, freshValid] of pair.fresh.entries()) {
    for (const [o, oldValid] of pair.old.entries()) {
      if (freshValid !== oldValid) sums.validity += freshValid ? 1 : -1;
      if (!freshValid || !oldValid) continue;
      sums.objective += told(pair, f, o);
      sums.bill += saved(pair, f, o);
    }
  }
  const { weights } = pair;
  if (weights === undefined) return sums;
  const each = POINTS / Math.max(1, pair.fresh.length * pair.old.length);
  return {
    validity: sums.validity * weights.validity * each,
    objective: sums.objective * weights.objective * each,
    bill: sums.bill * weights.bill * each,
  };
}

/** One task's difference: its points by every measure together (`pointsOf`), to the whole point,
 *  positive where the new harness won it. */
export function differenceOf(pair: Paired): number {
  const { validity, objective, bill } = pointsOf(pair);
  return Math.round(validity + objective + bill);
}

/** How much better the new side's median valid measure is than the reference's, as a share of the
 *  larger magnitude; null where the pair carries no objective or a side no measure. */
function medianGain(pair: Paired): number | null {
  const rule = pair.objective;
  if (rule === undefined) return null;
  return gainOver(rule, median(rule.fresh.filter(isNumber)), median(rule.old.filter(isNumber)));
}

/** How far apart the two sides' median valid measures were where validity left a task even and the
 *  objective gave it points, as a share of the larger magnitude; null otherwise. */
export function objectiveMargin(pair: Paired): number | null {
  const { validity, objective } = pointsOf(pair);
  const gain = validity === 0 && Math.round(objective) !== 0 ? medianGain(pair) : null;
  return gain === null ? null : Math.abs(gain);
}

/**
 * The median relative gain by the objective over the tasks of `pairs` the new harness won: each
 * task's median valid measure against the reference's, as a share of the larger magnitude
 * (`apart`), positive where the new one is better, over the won tasks with a valid measure on both
 * sides (`tasks`). Null where none has. A report beside the tally, which decides nothing (the
 * improvement plan's C1): in r3 the pair dropped the size of each difference, and g-3's 18 wins
 * added under no margin had a median gain of 0.00076%.
 */
export function objectiveGain(pairs: readonly Paired[]): Gain | null {
  const gains = pairs.flatMap((pair) => {
    const gain = differenceOf(pair) > 0 ? medianGain(pair) : null;
    return gain === null ? [] : [gain];
  });
  const middle = median(gains);
  return middle === null ? null : { median: middle, tasks: gains.length };
}

/** Whether the harness on `side` closed the task: valid in every counted solve, and not
 *  `informative` for it, so that it can only tie again at that budget or be lost. Until 12 October
 *  the supply read validity alone; until 19 October it kept a rule of its own beside `informative`
 *  (`bettered`). */
export function closedTo(pair: Paired, side: "old" | "fresh", best: number | null = null): boolean {
  return pair[side].length > 0 && pair[side].every(Boolean) && !bettered(pair, side, best);
}

/** Whether no solve of a pair gave a valid answer. */
export function unsolved({ old, fresh }: Paired): boolean {
  return ![...old, ...fresh].some(Boolean);
}

/** Each task's difference (`differenceOf`), the new harness's less the reference's. A task solved more
 *  often under one harness than the other is refused, since the harness with more solves has more
 *  chances. */
function differencesOf(pairs: readonly Paired[]): number[] {
  return pairs.map((pair) => {
    const { task, old, fresh } = pair;
    if (old.length === 0 || old.length !== fresh.length) {
      throw new Error(
        `task ${task} has ${String(old.length)} solve(s) under the old harness and ${String(fresh.length)} under the new; a comparison needs as many of each`,
      );
    }
    return differenceOf(pair);
  });
}

/** The scored set's reading: each task once, won by the harness its score favours and
 *  tied otherwise, each task's score (`differenceOf`), and the test's p for the new harness. */
export function scored(pairs: readonly Paired[]) {
  const differences = differencesOf(pairs);
  const count = (sign: number) => differences.filter((one) => Math.sign(one) === sign).length;
  return { wins: count(1), losses: count(-1), ties: count(0), p: flipP(differences), differences };
}

/** The tally of `scored` alone. */
export function tally(pairs: readonly Paired[]): Tally {
  const { wins, losses, ties } = scored(pairs);
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
 * to the first `solves` it started. A solve counts for a side when its start names the comparison,
 * its condition names the task, that side's harness, the test side and the comparison's setting,
 * and it ended in a pass or a fail; a non-result was solved again. A task with fewer than `solves`
 * on a side is in no pair and named in `short`, as a resume may leave one. A disputed version is
 * left out on both sides and named in `disputed`, so a dispute can remove a task from the test and
 * cannot make a win. Any other version that is no held-out task is refused.
 */
export function pairsOf(
  events: readonly LogEvent[],
  versions: readonly string[],
  sides: Sides,
  solves: number,
) {
  const { old, fresh, setting, comparison, halves, objective, weights } = sides;
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
    const measured = side(({ id }) => {
      const checker = verdicts?.get(id)?.checker;
      return checker?.kind === "pass" && checker.objective !== undefined ? checker.objective : null;
    });
    return [
      {
        task,
        ...side((solve) => passed(solve) === true),
        solves: side(({ id }) => id),
        used: side(({ end }): Used => ({ billed: isNumber(end.billed) ? end.billed : null })),
        ...keyIfDefined("objective", objective === undefined ? undefined : { ...objective, ...measured }),
        ...keyIfDefined("weights", weights),
      },
    ];
  });
  return { pairs, short, disputed };
}
