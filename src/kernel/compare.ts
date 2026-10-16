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
 * The step is read on the frontier (12 October, the revised plan's M1.4): the scored tasks not
 * exhausted, fixed at the comparison's start (`round.ts`, `begin`). The retained tasks, fixed at
 * the same time from the third of the exhausted ones the draw keeps (`poolOf`, `reports.ts`),
 * are where a harness may not lose more pairs than it wins. A step with a net loss there reads
 * `regressed`, and one whose untied tasks all fall in one family of the two or more its set holds
 * reads `narrow`; neither promotes (`stepOf`). A retained set with no task tallied is `unmeasured`,
 * never no loss: against the provisioned starter nothing is exhausted yet.
 *
 * The step is read in two stages since 10 October (`src/builder/move.ts`): a comparison whose test
 * is at or under the trigger, 0.25 by default, with more won than lost, buys the repeat and
 * promotes nothing, and the step and its repeat read together clear the level, 0.02 by default
 * (`readTwice`). One comparison's own reading, `step`, is its test against the level alone. The
 * level and the trigger are the caller's and recorded with the campaign's opening, so a campaign
 * reads by its own rule whatever the tree's default (`docs/plan.md`, Statistical power and cost).
 *
 * How each ending of a solve enters a pair (`solve.ts` names the endings; the table is the plan's,
 * `docs/plan.md`, Phase 2):
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
 * in a pair are compared by it, and the better one by more than the margin wins the pair. Validity
 * is read first and the objective only between two valid answers, so no answer the checks refuse
 * is ever the better one, and the margin is relative to the larger of the two magnitudes, so a
 * quantity's unit does not set it. The rule is a term of the comparison, fixed at its start
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
import { asRecord, isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
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
 *  computes of each, lower or higher being better, where the two differ by more than `margin` of
 *  the larger magnitude. */
export interface ObjectiveRule {
  readonly direction: "lower" | "higher";
  readonly margin: number;
  /** Where no command named the margin, what set it: the reference's own A/A pairings it was read
   *  from (`marginOf`), or null where none was on record and `MARGIN` stood. */
  readonly from?: number | null;
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

/**
 * What the two-stage reading reads of one comparison: each frontier task's difference in pair wins,
 * where the step is read; the retained tasks', or null where none was tallied, which is unmeasured
 * and never no loss; the families that hold an untied frontier task; and every family the frontier
 * scored a task of (`comparison.ts`, `compared`).
 */
interface Stage {
  readonly frontier: readonly number[];
  /** The task each frontier difference is of, where the report names them (since 14 October). */
  readonly named: readonly string[] | null;
  readonly retained: readonly number[] | null;
  readonly untied: readonly string[];
  readonly families: readonly string[];
}

/** The trigger a first reading has to clear to buy the repeat, where no flag or opening names one
 *  (`--trigger`): 2-0, 4-1, 5-2 and 7-3 clear it, and 1-0 does not. */
export const TRIGGER = 0.25;
/** The chance at which a share of untied tasks won is detected (`detectable`): four times in five. */
const POWER = 0.8;
/** What a report holds for a retained set no task was tallied in: no reading, never no loss. */
export const UNMEASURED = "unmeasured" as const;
/** The objective's margin before an A/A has set one (`marginOf`): `--margin`'s default from
 *  10 October, whatever the domain's own noise, until 12 October. */
export const MARGIN = 0.01;
/** The share of the reference's own A/A pairings its margin covers (`marginOf`). */
const COVERED = 0.9;

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
 *  a step says the comparison moved, not a harness. The whole-run reader and the UI count it so;
 *  the decision table holds its control to the level two-sided, and asks it at half the level
 *  (`controlled`, `decide.ts`). */
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

/** A report's stage, where it holds a frontier and a retained reading. A report written before
 *  12 October holds a pooled tally alone, which reads as none. */
function stageOf(report: JsonObject): Stage | null {
  const differences = (held: unknown) => {
    const found = asRecord(held)?.differences;
    return Array.isArray(found) && found.every(isNumber) ? found : null;
  };
  const frontier = differences(report.frontier);
  const of = asRecord(report.frontier)?.of;
  const named = Array.isArray(of) && of.every(isString) && of.length === frontier?.length ? of : null;
  const retained = report.retained === UNMEASURED ? null : differences(report.retained);
  if (frontier === null || (retained === null && report.retained !== UNMEASURED)) return null;
  // A family's frontier tally: its untied tasks, and all it scored there.
  const counts = Object.entries(asRecord(report.families) ?? {}).map(([name, tallies]) => {
    const own = asRecord(asRecord(tallies)?.frontier) ?? {};
    const count = (key: string) => (isNumber(own[key]) ? own[key] : 0);
    return {
      name,
      untied: count("wins") + count("losses"),
      tallied: count("wins") + count("losses") + count("ties"),
    };
  });
  return {
    frontier,
    named,
    retained,
    untied: counts.flatMap(({ name, untied }) => (untied > 0 ? [name] : [])),
    families: counts.flatMap(({ name, tallied }) => (tallied > 0 ? [name] : [])),
  };
}

/** Whether a stage lost more pairs than it won on its retained tasks. */
function regressed({ retained }: Stage): boolean {
  return retained !== null && total(retained) < 0;
}

/** Whether every untied frontier task of `stages` falls in one family where their scored sets
 *  hold two or more: concentration, which a family name can hide and which says nothing of
 *  independence. */
function narrowed(stages: readonly Stage[]): boolean {
  const untied = new Set(stages.flatMap(({ untied: named }) => named));
  return untied.size === 1 && new Set(stages.flatMap(({ families }) => families)).size >= 2;
}

/** One comparison's own reading of its report's frontier at `level`: `no-step` short of it,
 *  `regressed` where a step lost more retained pairs than it won, `narrow` where its untied tasks
 *  fall in one family of the two or more its set holds, and neither promotes. A report with no
 *  frontier and retained set holds no reading, and is refused. */
export function stepOf(report: JsonObject, level: number): "step" | "no-step" | "regressed" | "narrow" {
  const stage = stageOf(report);
  if (stage === null) throw new Error("a reading needs a frontier and a retained set");
  if (flipP(stage.frontier) > level) return "no-step";
  if (regressed(stage)) return "regressed";
  return narrowed([stage]) ? "narrow" : "step";
}

/** A report's untied frontier tasks, by version where it names them, and the one family they all
 *  fall in where they fall in one: a repeat scores those tasks again first, and draws other
 *  families next (`scoredSet`, `round.ts`). */
export function untiedOf(report: JsonObject) {
  const stage = stageOf(report);
  const untied = stage?.untied ?? [];
  return {
    tasks: stage?.named?.filter((_, at) => stage.frontier[at] !== 0) ?? [],
    family: untied.length === 1 ? (untied[0] ?? null) : null,
  };
}

/** Whether one comparison's reading buys the repeat: more frontier pairs won than lost, its test
 *  at or under `trigger`, and no net loss on its retained tasks. A narrow stage buys it, and the
 *  repeat draws where it can from other families. It is what the stop rule counts as a
 *  move that showed a gain (`stopRule`): a 2-0 at level 0.10 reads `no-step` and buys the repeat,
 *  and counted as no gain it ended a campaign of patience 3 before the repeat was bought
 *  (11 October). */
export function triggered(report: JsonObject, trigger: number): boolean {
  const stage = stageOf(report);
  return stage !== null && total(stage.frontier) > 0 && flipP(stage.frontier) <= trigger && !regressed(stage);
}

/**
 * Whether an attempt among a pair's comparisons promotes (`attemptsOf`): its first bought the repeat
 * (`triggered`), the repeat untied a frontier task, won at least as many frontier pairs as it lost and lost no more
 * retained pairs than it won, the two frontiers read together, a task both scored once with its
 * differences summed (`joined`), clear `level`, and their untied tasks do not all fall in one family of two or more. Summed
 * alone, a 4-0 and a repeat that tied every task would promote on one draw, against AGENTS §7,
 * where a step is one draw and is repeated on fresh solves. Read together at 0.10 a 2-0 and a 2-0
 * are a 4-0 (p 0.0625). A promotion needs the two together to clear the level, so it is no
 * likelier than one exact test of both stages' tasks: at sixteen tasks of which three in four tie,
 * two equal harnesses are promoted 3.3% of the time, a harness that wins 96% of the untied 82% and
 * one that wins 75% 31%, by enumeration (`test/compare.test.ts`). The null is the fixed-task one:
 * on the tasks drawn, each untied task as likely won as lost on fresh solves; a task the repeat
 * scores again adds solves, not a task. A campaign makes many attempts, and what they risk
 * together is the climb's reading (`falsePromotionOf`, `climb.ts`). Until 16 October the pair's
 * last two comparisons were read, so a repeat could stand as the first stage of the next reading:
 * buffer-159-opus's second promotion came from its pair's third and fourth readings, which the
 * climb counted as the first attempt's, and by enumeration such windows over four readings
 * promote equal harnesses 4.3% of the time where the rule is built for 1.6%.
 */
export function readTwice(reports: readonly JsonObject[], level: number, trigger: number): boolean {
  return attemptsOf(reports, (report) => triggered(report, trigger)).some((attempt) => {
    const [first, second] = attempt.map(stageOf);
    if (first == null || second == null || regressed(second)) return false;
    const repeat = second.frontier;
    if (repeat.every((difference) => difference === 0) || total(repeat) < 0) return false;
    return flipP(joined([first, second])) <= level && !narrowed([first, second]);
  });
}

/** A pair's comparisons in order as its attempts: a reading that buys the repeat (`bought`) takes
 *  the next as its repeat, and any other stands alone. A repeat is never the first of another. */
export function attemptsOf<T>(reports: readonly T[], bought: (report: T) => boolean): T[][] {
  const attempts: T[][] = [];
  for (const report of reports) {
    const open = attempts.at(-1);
    if (open?.length === 1 && open[0] !== undefined && bought(open[0])) open.push(report);
    else attempts.push([report]);
  }
  return attempts;
}

/**
 * The stages' frontier differences with a task both scored counted once, its differences summed.
 * Fresh solves do not make a task drawn twice two tasks: buffer-149's repeat g-2 scored g-1's 11
 * tasks, and counted twice its tasks would read as 22 signs where 11 were drawn. Under the
 * fixed-task null (AGENTS.md, section 7) the sum changes nothing; under a task-population null it
 * stops one task counting twice. A report from before 14 October names no task, and its
 * differences stand alone.
 */
function joined(stages: readonly Stage[]): number[] {
  const sums = new Map<string, number>();
  const unnamed: number[] = [];
  for (const { frontier, named } of stages) {
    for (const [at, difference] of frontier.entries()) {
      const task = named?.[at];
      if (task === undefined) unnamed.push(difference);
      else sums.set(task, (sums.get(task) ?? 0) + difference);
    }
  }
  return [...sums.values(), ...unnamed];
}

/**
 * The chance that an attempt promotes between equal harnesses by the two-stage rule (`triggered`,
 * `readTwice`): a first reading on untied tasks with the margins of `differences` buys the repeat
 * at `trigger`, and a repeat on as many tasks with the same margins promotes with it at `level`,
 * every untied task as likely won as lost. It is the rule's effective rate an attempt, which the
 * level alone misstates: 5.8% at 0.10 on 24 untied tasks each won or lost by a pair. The retained
 * set and the families can only refuse a promotion, so it bounds them too. Every report carries
 * it at its own margins (`comparison.ts`), and a size says it before a campaign opens (`size.ts`).
 */
export function falseRate(differences: readonly number[], level: number, trigger: number): number {
  const sizes = sizesOf(differences);
  const all = total(sizes);
  const tails = (chances: readonly number[]) =>
    chances.reduceRight<number[]>((tail, chance) => [chance + (tail[0] ?? 0), ...tail], [0]);
  const one = signed(sizes, 0.5);
  const [first, both] = [tails(one), tails(signed([...sizes, ...sizes], 0.5))];
  // A stage's differences sum to twice its plus-total less all of its sizes (`flipP`).
  const repeated = (plus: number) =>
    total(one.map((chance, more) => (2 * more >= all && (both[plus + more] ?? 0) <= level ? chance : 0)));
  const bought = (plus: number) => 2 * plus > all && (first[plus] ?? 0) <= trigger;
  return Math.min(1, total(one.map((chance, plus) => (bought(plus) ? chance * repeated(plus) : 0))));
}

/** The objective rule a comparison's start, or its report, carries, or undefined where it fixed
 *  none: a direction and a margin that is a number from nothing up. */
export function objectiveRuleIn(data: JsonObject): ObjectiveRule | undefined {
  const { direction, margin, from } = asRecord(data.objective) ?? {};
  return (direction === "lower" || direction === "higher") && isNumber(margin) && margin >= 0
    ? { direction, margin, ...keyIfDefined("from", isNumber(from) || from === null ? from : undefined) }
    : undefined;
}

// Two other readings of a tally, the trinomial test and the chance that the new harness is the
// better one, decide nothing and are not built: their formulas and what they read of the recorded
// comparisons are in `docs/plan.md`, "Statistical power and cost" (row C3).

/** How far apart two measures are, as a share of the larger magnitude: what a margin is read against. */
function apart(one: number, other: number): number {
  const larger = Math.max(Math.abs(one), Math.abs(other));
  return larger === 0 ? 0 : Math.abs(one - other) / larger;
}

/** The measures of one side's valid answers to a task, where its pair carries an objective. */
function measures(pair: Paired, side: "old" | "fresh"): number[] {
  return (pair.objective?.[side] ?? []).filter(isNumber);
}

/**
 * Whether a task tells something of the harness on `side` (the overhaul plan's one definition of
 * informative, section 4b, and the one `try_task` admits a draft by): valid on some of its solves
 * and not all; valid on all with two of its own measures apart by more than the objective's
 * margin, so that a better answer is there to find; or valid on none where the task is among
 * `feasible`, the versions a valid answer is on record for (`poolOf`, `reports.ts`): another
 * harness's, a reference solve's at the gate, or its author's. A task it answers alike in every
 * solve leaves it nothing to gain on, and so does one it fails in every solve that nobody has
 * answered. Until 15 October a task the reference failed in every solve was never informative, so
 * once a promoted harness passed every scored solve (buffer-149's 68 of 68 in two comparisons,
 * recode-151's 56 of 56, buffer-159-opus's 38 of 40) its room was only the tasks it answered some
 * of the time, and the gate held out only such drafts.
 */
export function informative(pair: Paired, side: "old" | "fresh", feasible: ReadonlySet<string>): boolean {
  const valid = pair[side].filter(Boolean).length;
  if (valid === 0) return feasible.has(pair.task);
  if (valid < pair[side].length) return true;
  const own = measures(pair, side);
  const margin = pair.objective?.margin ?? Number.POSITIVE_INFINITY;
  return own.some((one, at) => own.slice(at + 1).some((other) => apart(one, other) > margin));
}

/**
 * The objective's margin the reference's own noise sets (the overhaul plan's P2): the 90th
 * percentile of how far apart two of its valid answers to one task measure, over every pairing
 * across the two sides of `pairs`, which are the reference against itself (the A/A, `compared`,
 * `comparison.ts`). At that margin the objective sets apart no more than one in ten of the
 * reference's own pairings, so the tier never reads as a gain what its noise alone would. Null
 * where no pairing holds two measured valid answers. Until 12 October the margin was `MARGIN`
 * whatever a domain's noise.
 */
export function marginOf(
  pairs: readonly Paired[],
): { readonly margin: number; readonly pairings: number } | null {
  const spreads = pairs
    .flatMap((pair) =>
      measures(pair, "fresh").flatMap((one) => measures(pair, "old").map((other) => apart(one, other))),
    )
    .toSorted((a, b) => a - b);
  const at = spreads[Math.ceil(COVERED * spreads.length) - 1];
  return at === undefined ? null : { margin: at, pairings: spreads.length };
}

/** Which of two valid answers' measures is the better by more than the rule's margin: 1 for the
 *  first, -1 for the second, 0 where neither is or one is missing. */
function better(rule: ObjectiveRule, one: number | null, other: number | null): -1 | 0 | 1 {
  if (one === null || other === null || apart(one, other) <= rule.margin) return 0;
  const lower = one < other ? 1 : -1;
  return rule.direction === "lower" ? lower : lower === 1 ? -1 : 1;
}

/** One task's pairings: every solve of the new harness against every solve of the reference one,
 *  and how many each side won. A valid answer beats one that is not; two valid answers are even,
 *  unless the pair carries an objective and one is the better by it. Beside each side's wins, what
 *  decided them: `validity`, where one answer was valid; the `objective`, between two valid answers
 *  it told apart by more than the margin; and `valid`, the pairings of two valid answers, which
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

/** Whether the harness on `side` closed the task: valid in every counted solve, and no pairing of
 *  two valid answers the objective told apart. A closed task can only tie again at that budget or
 *  be lost; where the objective separates two valid answers, a harness that answers it validly can
 *  still win or lose it. The one rule under the exhausted fold (`poolOf`, `reports.ts`): until
 *  12 October the supply read validity alone and counted a task the objective still separates as
 *  closed, and until 16 October it read this a second time as an untied share. */
export function closedTo(pair: Paired, side: "old" | "fresh"): boolean {
  return pair[side].length > 0 && pair[side].every(Boolean) && !separatedByObjective(pair);
}

/** Whether the objective told two valid answers of one task apart: a pairing of two valid answers
 *  that one side won by more than the margin (`closedTo`). False where the pair carries no objective. */
function separatedByObjective(pair: Paired): boolean {
  const { objective } = pairings(pair);
  return objective.fresh + objective.old > 0;
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
