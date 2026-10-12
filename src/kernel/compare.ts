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
 * the same time from the third of the exhausted ones the draw keeps (`retainable`, `reports.ts`),
 * are where a harness may not lose more pairs than it wins. A step with a net loss there reads
 * `regressed`, and one whose untied tasks all fall in one family of the two or more its set holds
 * reads `narrow`; neither promotes (`stepOf`). A retained set with no task tallied is `unmeasured`,
 * never no loss: against the provisioned starter nothing is exhausted yet.
 *
 * The step is read in two stages since 10 October (`src/builder/move.ts`): a comparison whose test
 * is at or under the trigger, 0.25 by default, with more won than lost, buys the repeat and
 * promotes nothing, and the step and its repeat read together clear the level, 0.10 by default
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
 * and 7). A side's solves are in the order they started, and where a side holds more than a tally
 * takes the first started are taken, since the order solves ended in would take the quick ones.
 *
 * Nothing here decides a step; it reports the tally and its test.
 */
import { sha256 } from "../meta/digest.ts";
import { asRecord, isNumber, type JsonObject } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { conditionsOf, settingId } from "./condition.ts";
import type { LogEvent } from "./log.ts";
import { ended, passed, ranUnder, verdictsOf } from "./solves.ts";
import { taskSets } from "./task.ts";

/** What one counted solve cost, as its `solve.finished` holds it: billed dollars, null where the
 *  log has none. */
export interface Used {
  readonly billed: number | null;
}

/** How two valid answers on one task are set against each other: by the quantity the check program
 *  computes of each, lower or higher being better, where the two differ by more than `margin` of
 *  the larger magnitude. */
export interface ObjectiveRule {
  readonly direction: "lower" | "higher";
  readonly margin: number;
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
export interface Sides {
  readonly old: string;
  readonly fresh: string;
  readonly setting: string;
  /** The comparison's id: only a solve whose start names it is a solve of it. */
  readonly comparison: string;
  /** Where the reference harness was solved twice as often, to be read against itself, which of
   *  its solves of a task are its first sample: `mirrored`, the first and last of each four in the
   *  order they started, which sit around the new harness's solve between them (`round.ts`), or
   *  `in-order`, the first half. Its other solves are the second sample, the other side where the
   *  two harnesses are one: the one case in which both sides may name the same harness. */
  readonly halves?: "mirrored" | "in-order" | undefined;
  /** The objective two valid answers are compared by, where the comparison fixed one. */
  readonly objective?: ObjectiveRule | undefined;
}

/**
 * What the two-stage reading reads of one comparison: each frontier task's difference in pair wins,
 * where the step is read; the retained tasks', or null where none was tallied, which is unmeasured
 * and never no loss; the families that hold an untied frontier task; and every family the frontier
 * scored a task of (`comparison.ts`, `compared`).
 */
export interface Stage {
  readonly frontier: readonly number[];
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
 * no evidence, and reads 1.
 */
export function flipP(differences: readonly number[]): number {
  const sizes = sizesOf(differences);
  // The differences sum to twice their plus-total less all of the sizes.
  return Math.min(1, above(signed(sizes, 0.5), Math.ceil((total(differences) + total(sizes)) / 2)));
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

/** Whether a stage buys the repeat: more frontier pairs won than lost, its test at or under
 *  `trigger`, and no net loss on its retained tasks. A narrow stage buys it, and the repeat draws
 *  where it can from other families. */
function buys(stage: Stage, trigger: number): boolean {
  return total(stage.frontier) > 0 && flipP(stage.frontier) <= trigger && !regressed(stage);
}

/** One comparison's own reading of its frontier at `level`: `regressed` where a step lost more
 *  retained pairs than it won, `narrow` where its untied tasks fall in one family of the two or
 *  more its set holds, and neither promotes. */
export function stepOf(stage: Stage, level: number): "step" | "no-step" | "regressed" | "narrow" {
  if (flipP(stage.frontier) > level) return "no-step";
  if (regressed(stage)) return "regressed";
  return narrowed([stage]) ? "narrow" : "step";
}

/** Whether one comparison's reading buys the repeat (`buys`). It is what the stop rule counts as a
 *  move that showed a gain (`stopRule`): a 2-0 at level 0.10 reads `no-step` and buys the repeat,
 *  and counted as no gain it ended a campaign of patience 3 before the repeat was bought
 *  (11 October). */
export function triggered(report: JsonObject, trigger: number): boolean {
  const stage = stageOf(report);
  return stage !== null && buys(stage, trigger);
}

/**
 * Whether the last two of a pair's comparisons promote: the first bought the repeat (`buys`), the
 * repeat untied a frontier task, won at least as many frontier pairs as it lost and lost no more
 * retained pairs than it won, the two frontiers read together, every task of both in one test,
 * clear `level`, and their untied tasks do not all fall in one family of two or more. Summed
 * alone, a 4-0 and a repeat that tied every task would promote on one draw, against AGENTS §7,
 * where a step is one draw and is repeated on fresh solves. Read together at 0.10 a 2-0 and a 2-0
 * are a 4-0 (p 0.0625). A promotion needs the two together to clear the level, so it is no
 * likelier than one exact test of both stages' tasks: at sixteen tasks of which three in four tie,
 * two equal harnesses are promoted 3.3% of the time, a harness that wins 96% of the untied 82% and
 * one that wins 75% 31%, by enumeration (`test/compare.test.ts`). Every untied task of either
 * comparison is a fresh solve, so the null holds; a campaign makes many attempts, and what they
 * risk together is the climb's reading (`falsePromotionOf`, `climb.ts`).
 */
export function readTwice(reports: readonly JsonObject[], level: number, trigger: number): boolean {
  const [first, second] = (reports.length < 2 ? [] : reports.slice(-2)).map(stageOf);
  if (first == null || second == null || !buys(first, trigger) || regressed(second)) return false;
  const repeat = second.frontier;
  if (repeat.every((difference) => difference === 0) || total(repeat) < 0) return false;
  return flipP([...first.frontier, ...repeat]) <= level && !narrowed([first, second]);
}

/**
 * The chance that an attempt promotes between equal harnesses by the two-stage rule (`buys`,
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
  const { direction, margin } = asRecord(data.objective) ?? {};
  return (direction === "lower" || direction === "higher") && isNumber(margin) && margin >= 0
    ? { direction, margin }
    : undefined;
}

// Two other readings of a tally, the trinomial test and the chance that the new harness is the
// better one, decide nothing and are not built: their formulas and what they read of the recorded
// comparisons are in `docs/plan.md`, "Statistical power and cost" (row C3).

/** Which of two valid answers' measures is the better by more than the rule's margin: 1 for the
 *  first, -1 for the second, 0 where neither is or one is missing. */
function better(rule: ObjectiveRule, one: number | null, other: number | null): -1 | 0 | 1 {
  if (one === null || other === null) return 0;
  if (Math.abs(one - other) <= rule.margin * Math.max(Math.abs(one), Math.abs(other))) return 0;
  const lower = one < other ? 1 : -1;
  return rule.direction === "lower" ? lower : lower === 1 ? -1 : 1;
}

/** One task's pairings: every solve of the new harness against every solve of the reference one,
 *  and how many each side won. A valid answer beats one that is not; two valid answers are even,
 *  unless the pair carries an objective and one is the better by it. */
export function pairings(pair: Paired) {
  const won = { fresh: 0, old: 0 };
  /** Who wins one pairing: the valid answer, or between two valid ones the better by the objective. */
  const winner = (f: number, o: number): "fresh" | "old" | null => {
    const [freshValid, oldValid] = [pair.fresh[f] === true, pair.old[o] === true];
    if (freshValid !== oldValid) return freshValid ? "fresh" : "old";
    if (!freshValid || pair.objective === undefined) return null;
    const by = better(pair.objective, pair.objective.fresh[f] ?? null, pair.objective.old[o] ?? null);
    return by === 0 ? null : by === 1 ? "fresh" : "old";
  };
  for (let f = 0; f < pair.fresh.length; f += 1) {
    for (let o = 0; o < pair.old.length; o += 1) {
      const side = winner(f, o);
      if (side !== null) won[side] += 1;
    }
  }
  return won;
}

/** How many of `pairs` the objective decided: tasks won or lost that would tie on validity alone. */
export function decidedByObjective(pairs: readonly Paired[]): number {
  const outcome = (pair: Paired) => Math.sign(pairings(pair).fresh - pairings(pair).old);
  return pairs.filter(
    ({ objective, ...rest }) => objective !== undefined && outcome({ objective, ...rest }) !== outcome(rest),
  ).length;
}

/** Whether the objective told two valid answers of one task apart: a pairing of two valid answers
 *  that one side won by more than the margin. Such a task is not closed by the reference's
 *  validity alone, since a harness that answers it validly can still win or lose it (`exhausted`,
 *  `reports.ts`). False where the pair carries no objective. */
export function separatedByObjective(pair: Paired): boolean {
  const { objective } = pair;
  if (objective === undefined) return false;
  return pair.fresh.some(
    (freshValid, f) =>
      freshValid &&
      pair.old.some(
        (oldValid, o) =>
          oldValid && better(objective, objective.fresh[f] ?? null, objective.old[o] ?? null) !== 0,
      ),
  );
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

/** Each task once: won by the harness that wins more of its pairings, and tied otherwise. */
export function tally(pairs: readonly Paired[]): Tally {
  const each = differencesOf(pairs);
  return {
    wins: each.filter((one) => one > 0).length,
    losses: each.filter((one) => one < 0).length,
    ties: each.filter((one) => one === 0).length,
  };
}

/** The scored set's reading: the tally, each task's difference in pair wins, and the test's p for
 *  the new harness. */
export function scored(pairs: readonly Paired[]) {
  const each = differencesOf(pairs);
  return { ...tally(pairs), p: flipP(each), differences: each };
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
 * The pairs a comparison of two harnesses reads, for `versions`, from the log alone. A solve counts
 * for a side when its start names the comparison, its condition names the task, that side's
 * harness, the test side and the comparison's setting, and it ended in a pass or a fail; a
 * non-result was solved again. Each side's solves are in the order they started. A
 * disputed version is left out on both sides and named in `disputed`, so a dispute can remove a
 * task from the test and cannot make a win. Any other version that is no held-out task is refused.
 */
export function pairsOf(events: readonly LogEvent[], versions: readonly string[], sides: Sides) {
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
    // Where the reference was solved twice as often, its first sample and its second (`halves`).
    const first = (at: number, of: number) =>
      halves === "mirrored" ? at % 4 === 0 || at % 4 === 3 : halves === undefined || at < Math.ceil(of / 2);
    const reference = under(old);
    const own = reference.filter((_, at) => first(at, reference.length));
    const other = reference.filter((_, at) => !first(at, reference.length));
    const [before, after] = [own, old === fresh ? other : under(fresh)];
    const used = (solves: typeof counted) =>
      solves.map(({ end }): Used => ({ billed: isNumber(end.billed) ? end.billed : null }));
    const measured = (solves: typeof counted) =>
      solves.map(({ id }) => {
        const checker = verdicts?.get(id)?.checker;
        return checker?.kind === "pass" && checker.objective !== undefined ? checker.objective : null;
      });
    return [
      {
        task,
        old: before.map((solve) => passed(solve) === true),
        fresh: after.map((solve) => passed(solve) === true),
        solves: { old: before.map(({ id }) => id), fresh: after.map(({ id }) => id) },
        used: { old: used(before), fresh: used(after) },
        ...keyIfDefined(
          "objective",
          objective === undefined
            ? undefined
            : { ...objective, old: measured(before), fresh: measured(after) },
        ),
      },
    ];
  });
  return { pairs, disputed };
}
