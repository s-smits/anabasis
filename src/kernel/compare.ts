/**
 * The comparison: does the new harness beat the reference harness on tasks neither was built on?
 *
 * Both harnesses solve the same held-out tasks under the same compute budget, and each task
 * counts once. Every solve of the new harness is paired with every solve of the reference one
 * (`pairings`), and in a pair a valid answer beats one that is not. Two valid answers are even,
 * and so are two that are not. The harness that wins more pairs wins the task, and otherwise the
 * task is a tie (`tally`).
 *
 * The test is a paired sign-flip test on each task's difference in pair wins (`flipP`, since
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
 * With the same number of solves a side, the pairing reads exactly as "the harness with more valid
 * answers wins": of n solves a side with f and o valid, the new harness wins f(n-o) pairs and the
 * reference o(n-f), a difference of n(f-o). It is stated over pairs because that is the form the
 * objective joins (`ObjectiveRule`, since 10 October): where the check program declares one, a
 * quantity its evaluator computes from a valid answer (`verify.ts`, `OBJECTIVE`), two valid answers
 * in a pair are compared by it, and the better one wins the pair (`better`). Validity is read
 * first and the objective only between two valid answers, so no answer the checks refuse is ever
 * the better one. The rule is a term of the comparison, fixed at its start
 * (`comparison.started`, `objective`); a comparison whose start names none pairs on validity alone.
 * The value is the host's: no value the answer reports about itself is read.
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
}

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
 * and a solve's answer better than one of a harness's own by less leaves that harness no room on
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
 * The chance of each total of `sizes` taken with a plus sign, where each is taken so with chance
 * `share`, independently: entry k is the chance that the sizes signed plus sum to k. The sizes are
 * whole numbers, as differences in pair wins are, so the convolution is over integer sums and
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
 *  and retained tasks' differences in pair wins together clears it, and `no-step` otherwise. A
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

// Two other readings of a tally, the trinomial test and the chance that the new harness is the
// better one, decide nothing and are not built: their formulas and what they read of the recorded
// comparisons are in `7f0add79:docs/plan.md`, "Statistical power and cost" (row C3).

/**
 * Whether a task tells something of the harness on `side` (the overhaul plan's one definition of
 * informative, section 4b, the one `try_task` admits a draft by, and the one the exhausted fold
 * closes a task by, through `closedTo`): valid on some of its solves and not all; valid on all
 * where a solve on record is better by the objective (`bettered`); or valid on none where the task is among
 * `feasible`, the versions a valid answer is on record for (`poolOf`, `reports.ts`): another
 * harness's, a reference solve's at the gate, or its author's. A task it answers alike in every
 * solve, at the best answer on record, leaves it nothing to gain on, and so does one it fails in
 * every solve that nobody has answered. Until 15 October a task the reference failed in every
 * solve was never informative, so once a promoted harness passed every scored solve (buffer-149's
 * 68 of 68 in two comparisons, recode-151's 56 of 56, buffer-159-opus's 38 of 40) its room was
 * only the tasks it answered some of the time, and the gate held out only such drafts.
 */
export function informative(pair: Paired, side: "old" | "fresh", feasible: ReadonlySet<string>): boolean {
  const valid = pair[side].filter(Boolean).length;
  if (valid === 0) return feasible.has(pair.task);
  return valid < pair[side].length || bettered(pair, side);
}

/**
 * Whether a solve's measure is better by the objective, by at least the floor (`ROOM`), than one of
 * the side's own valid answers: another of its own, or the other side's. A harness that reaches it
 * wins the pairs against that answer, so the task has room. False where the pair carries no
 * objective; a valid answer with no measure is compared with nothing.
 *
 * Only a solve's answer counts. From 19 to 21 October an author's own answer did too
 * (`task.feasible`), so an Examiner could hold a draft by computing a better optimum than the
 * reference's, and a harness then climbed towards its author's optimiser, which rule 9 keeps out.
 * In the 30 comparisons of the buffer campaigns after the first, the reference was valid in every
 * solve on 656 of 687 scored tasks and the objective decided 382 tasks, against 388 won; in
 * buffer-fresh-opus-forkedPR223_v0_5_4-r3 up to 15 of a comparison's 32 tasks had room from the
 * author's answer alone. A task the reference answers in every solve within the floor of itself now
 * leaves room only where another harness's solve has beaten it.
 */
function bettered(pair: Paired, side: "old" | "fresh"): boolean {
  const rule = pair.objective;
  if (rule === undefined) return false;
  const left = roomLeft(pair, side, rule[side === "old" ? "fresh" : "old"]) ?? 0;
  return left > 0 && left >= ROOM;
}

/** The most that a measure on record, one of the side's own or one `against` it, is better by than
 *  one of the side's own valid answers, as a share of the larger magnitude: the room the task
 *  leaves that harness, which `bettered` holds to the floor. Null where the pair carries no
 *  objective or the side no measure. Its author is told it against its own answer alone, since the
 *  other harness's answers are its result on the task (`exam-results`). */
export function roomLeft(
  pair: Paired,
  side: "old" | "fresh",
  against: readonly (number | null)[],
): number | null {
  const rule = pair.objective;
  const own = rule?.[side].filter(isNumber) ?? [];
  if (rule === undefined || own.length === 0) return null;
  const known = [...own, ...against.filter(isNumber)];
  return Math.max(...own.flatMap((mine) => known.map((other) => gainOver(rule, other, mine) ?? 0)));
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

/** Which of two valid answers' measures is the better in a pair: 1 for the first, -1 for the second,
 *  0 where they are closer than the comparison's floor (`ROOM`; none where its start recorded
 *  none), one measure (`SAME`), or one is missing. */
function better(rule: ObjectiveRule, one: number | null, other: number | null): -1 | 0 | 1 {
  const gain = gainOver(rule, one, other) ?? 0;
  if (gain === 0 || Math.abs(gain) < (rule.room ?? 0)) return 0;
  return gain > 0 ? 1 : -1;
}

/** One task's pairings: every solve of the new harness against every solve of the reference one,
 *  and how many each side won. A valid answer beats one that is not; two valid answers are even,
 *  unless the pair carries an objective and one is the better by it. Beside each side's wins, what
 *  decided them: `validity`, where one answer was valid; the `objective`, between two valid answers
 *  it told apart; and `valid`, the pairings of two valid answers, which
 *  the effect bar reads the objective over (`climb.ts`). */
export function pairings(pair: Paired) {
  const [validity, objective] = [
    { fresh: 0, old: 0 },
    { fresh: 0, old: 0 },
  ];
  let valid = 0;
  for (const [f, freshValid] of pair.fresh.entries()) {
    for (const [o, oldValid] of pair.old.entries()) {
      if (freshValid !== oldValid) validity[freshValid ? "fresh" : "old"] += 1;
      if (!freshValid || !oldValid) continue;
      valid += 1;
      const told =
        pair.objective &&
        better(pair.objective, pair.objective.fresh[f] ?? null, pair.objective.old[o] ?? null);
      if (told === 1 || told === -1) objective[told === 1 ? "fresh" : "old"] += 1;
    }
  }
  return {
    fresh: validity.fresh + objective.fresh,
    old: validity.old + objective.old,
    validity,
    objective,
    valid,
  };
}

/** How many of `pairs` the objective decided: tasks won or lost that would tie on validity alone. */
export function decidedByObjective(pairs: readonly Paired[]): number {
  return pairs.filter((pair) => {
    const { fresh, old, validity } = pairings(pair);
    return Math.sign(fresh - old) !== Math.sign(validity.fresh - validity.old);
  }).length;
}

/** How far apart the two sides' median valid measures were where the objective alone decided a
 *  task, as a share of the larger magnitude; null where validity decided it, or it tied. */
export function objectiveMargin(pair: Paired): number | null {
  const { fresh, old, validity } = pairings(pair);
  const rule = pair.objective;
  if (rule === undefined || fresh === old) return null;
  if (Math.sign(fresh - old) === Math.sign(validity.fresh - validity.old)) return null;
  const gain = gainOver(rule, median(rule.fresh.filter(isNumber)), median(rule.old.filter(isNumber)));
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
    const { fresh, old } = pairings(pair);
    const rule = pair.objective;
    if (rule === undefined || fresh <= old) return [];
    const [mine, theirs] = [median(rule.fresh.filter(isNumber)), median(rule.old.filter(isNumber))];
    const gain = gainOver(rule, mine, theirs);
    return gain === null ? [] : [gain];
  });
  const middle = median(gains);
  return middle === null ? null : { median: middle, tasks: gains.length };
}

/** Whether the harness on `side` closed the task: valid in every counted solve, and not
 *  `informative` for it, so that it can only tie again at that budget or be lost. Until 12 October
 *  the supply read validity alone; until 19 October it kept a rule of its own beside `informative`
 *  (`bettered`). */
export function closedTo(pair: Paired, side: "old" | "fresh"): boolean {
  return pair[side].length > 0 && pair[side].every(Boolean) && !bettered(pair, side);
}

/** Whether no solve of a pair gave a valid answer. */
export function unsolved({ old, fresh }: Paired): boolean {
  return ![...old, ...fresh].some(Boolean);
}

/** Each task's difference in pair wins, the new harness's less the reference's. A task solved more
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
    const won = pairings(pair);
    return won.fresh - won.old;
  });
}

/** The scored set's reading: each task once, won by the harness that wins more of its pairings and
 *  tied otherwise, each task's difference in pair wins, and the test's p for the new harness. */
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
      },
    ];
  });
  return { pairs, short, disputed };
}
