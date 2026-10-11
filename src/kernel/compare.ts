/**
 * The comparison: does the new harness beat the reference harness on tasks neither was built on?
 *
 * Both harnesses solve the same held-out tasks under the same compute budget, and each task
 * counts once. Every solve of the new harness is paired with every solve of the reference one
 * (`pairings`), and in a pair a valid answer beats one that is not. Two valid answers are even,
 * and so are two that are not. The harness that wins more pairs wins the task, and otherwise the
 * task is a tie. A tie says nothing and leaves the test. The step is read off a one-sided sign
 * test of wins against losses, read in two stages since 10 October (`src/builder/move.ts`): a
 * comparison whose tally is at or under the trigger, 0.25 by default (2-0, 4-1, 5-2, 7-3), buys
 * the repeat and promotes nothing, and the step and its repeat read together, their wins and
 * losses summed, clear the level, 0.10 by default (4-0, 6-1, 7-2, 9-3). One comparison's own
 * reading, `step`, is its tally against the level alone. For most of 10 October the default was
 * 0.20 on each reading by itself (#175): at 0.10 three campaigns of 9 and 10 October had stopped
 * on 3-0-3, 3-0-5 and 3-0-7, one win short, and at 0.20 on sixteen tasks of which three in four
 * tie a harness that wins 96% of the untied was promoted 55% of the time, two readings at 0.20
 * each; read in two stages it is 82%, and two equal harnesses 3.3% an attempt where it was 0.9%.
 * The level and the trigger are the caller's and recorded with the campaign's opening, so a
 * campaign reads by its own rule whatever the tree's default (`docs/plan.md`, Statistical power
 * and cost).
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
 * reference o(n-f), and the first is the larger exactly when f is. It is stated over pairs because
 * that is the form the objective joins (`ObjectiveRule`, since 10 October): where the check program
 * declares one, a quantity its evaluator computes from a valid answer (`verify.ts`, `OBJECTIVE`),
 * two valid answers in a pair are compared by it, and the better one by more than the margin wins
 * the pair. Validity is read first and the objective only between two valid answers, so no answer
 * the checks refuse is ever the better one, and the margin is relative to the larger of the two
 * magnitudes, so a quantity's unit does not set it. The rule, the direction and the margin, is a
 * term of the comparison, fixed at its start with the rest (`comparison.started`, `objective`); a
 * comparison whose start names none pairs on validity alone, as every comparison before 10
 * October did. The value is the host's: the evaluator computes it from the answer, and no value
 * the answer reports about itself is read. 110 of the 189 pairs on record on 10 October tied,
 * most of them between two valid answers (`docs/plan.md`, the climb).
 *
 * Every held-out task is compared (`task.ts`). Until 2026-10-09 a screening chose the scored tasks
 * by which harness failed them, and an anchor of unscreened tasks guarded that choice. With no
 * choice by pass or fail there is nothing to guard. The controls are the Starter Built Harness,
 * which is the first reference and the fixed lower one after a promotion, and the reference
 * harness set against itself (`pairsOf`, `halves`).
 *
 * How many tasks, how many solves and the level are the caller's. Nothing here decides a step; it
 * reports the tally and its test.
 *
 * The pairs are a view over the log (`pairsOf`). A solve counts for a side when its start names
 * the comparison, and its condition names the task, that side's harness, the test side and the
 * setting the comparison is made under (`condition.ts`). A comparison's solves are the ones it
 * started itself, so the two sides are solved afresh, side by side, at every comparison. No other
 * solve of the same harness is counted, whether made before it or beside it by another comparison:
 * a condition names the host's code, which changes between comparisons, and one frozen draw of
 * the reference harness's solves would bias every later comparison read against it (the review of
 * 2026-10-09, findings 6 and 7). A side's solves are in the order they started. Where a side holds
 * more than a tally takes, the first started are taken, and the order solves ended in would take
 * the quick ones, which under a budget are the valid ones.
 *
 * A comparison is read at the one budget its solves were told. Until 2026-10-11 the same pairs
 * were read again at shorter budgets (`within`): a solve that used more of a unit than the budget
 * allowed counted as no answer. The reading was of a solver told the longer budget, and on
 * 9 October the starter answered 0 of 10 solves read at two turns and 10 of 10 once it was told
 * two, so the shorter readings said nothing of a campaign run at them, and they went with the
 * ladder of budgets that read them (`docs/simplify.md`, A1 and A2). What a solve used of its
 * turns and its seconds is in its `solve.finished`, read by the investigation (`tools/wri/`).
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
 *  log has none. Until 2026-10-11 it also held the model's turns, the prompts, the CPU seconds of
 *  the solve's commands and the attempt's seconds, for the readings at shorter budgets and the
 *  spread between repeated solves, both gone with them (`docs/simplify.md`, A2 and A3). */
export interface Used {
  readonly billed: number | null;
}

/** The trigger a first reading has to clear to buy the repeat, where no flag or opening names one
 *  (`--trigger`): 2-0, 4-1, 5-2 and 7-3 clear it, and 1-0 does not. */
export const TRIGGER = 0.25;
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
  /** The solves a side of a harness set against itself: its first so many solves of a task are the
   *  one side and the ones after them the other. It is how the noise of one harness is read, and
   *  the one case in which both sides may name the same harness. */
  readonly halves?: number | undefined;
  /** The objective two valid answers are compared by, where the comparison fixed one. */
  readonly objective?: ObjectiveRule | undefined;
}

/** The chance of at least `wins` wins among `wins + losses` untied tasks, were either harness as
 *  likely to win each. No untied task is no evidence, and reads 1. */
export function signP(wins: number, losses: number): number {
  const untied = wins + losses;
  let term = 0.5 ** untied;
  let tail = 0;
  for (let k = 0; k <= untied; k += 1) {
    if (k >= wins) tail += term;
    term = (term * (untied - k)) / (k + 1);
  }
  return Math.min(1, tail);
}

/** A report's tally, where it holds one. */
function tallyOf(report: JsonObject): { readonly wins: number; readonly losses: number } | null {
  const counts = asRecord(report.scored);
  return counts !== null && isNumber(counts.wins) && isNumber(counts.losses)
    ? { wins: counts.wins, losses: counts.losses }
    : null;
}

/** Whether one comparison's reading buys the repeat: more wins than losses, and the sign test at
 *  or under `trigger`. It is what the stop rule counts as a move that showed a gain, since 11
 *  October (`stopRule`): a 2-0 at level 0.10 reads `no-step` and buys the repeat, and counted as
 *  no gain it ended a campaign of patience 3 before the repeat was bought. */
export function triggered(report: JsonObject, trigger: number): boolean {
  const read = tallyOf(report);
  return read !== null && read.wins > read.losses && signP(read.wins, read.losses) <= trigger;
}

/**
 * Whether the last two of a pair's comparisons, read together, clear `level`: the step and its
 * repeat as one sign test, their wins and losses summed, ties dropped. The first has to have
 * bought the repeat (`triggered`), and the repeat has to have untied a task and won at least as
 * many as it lost: summed alone, a 4-0 and a repeat that tied every task promoted on one draw
 * (found by review, 11 October), against AGENTS §7, where a step is one draw and is repeated on
 * fresh solves. Until 10 October each had to read a step by itself, which at 0.20 took three wins
 * and no loss twice; on sixteen tasks of which three in four tie that came through 8% of the
 * time for a harness that wins 96% of the tasks it unties, and the operator found the rule too
 * strict ("2-0-4 should climb"). Read together at 0.10 a 2-0 and a 2-0 are a 4-0 (p 0.0625): 31%
 * at a win rate of 0.75 where it was 14%, and a false promotion of two equal harnesses 3.3% an
 * attempt where it was 0.9%, by exact enumeration (`chanceOfPromotion`, `size.ts`; 82%, 31% and
 * 3.3% with the repeat held to an untied task, where the sum alone gave 83%, 31% and 3.4%). Every untied
 * task of either comparison is a fresh solve, so the null holds.
 */
export function readTwice(reports: readonly JsonObject[], level: number, trigger: number): boolean {
  if (reports.length < 2) return false;
  const [first, second] = reports.slice(-2);
  if (first === undefined || second === undefined || !triggered(first, trigger)) return false;
  const [one, two] = [tallyOf(first), tallyOf(second)];
  if (one === null || two === null || two.wins + two.losses === 0 || two.wins < two.losses) return false;
  return signP(one.wins + two.wins, one.losses + two.losses) <= level;
}

/** The objective rule a comparison's start, or its report, carries, or undefined where it fixed
 *  none: a direction and a margin that is a number from nothing up. */
export function objectiveRuleIn(data: JsonObject): ObjectiveRule | undefined {
  const { direction, margin } = asRecord(data.objective) ?? {};
  return (direction === "lower" || direction === "higher") && isNumber(margin) && margin >= 0
    ? { direction, margin }
    : undefined;
}

/** The smallest scored set a sign test at `level` can read a step on: that many tasks, all won. */
export function sweepOf(level: number): number {
  let sweep = 1;
  while (signP(sweep, 0) > level) sweep += 1;
  return sweep;
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

/** Each task once: won by the harness that wins more of its pairings, and tied otherwise. A task
 *  solved more often under one harness than the other is refused, since the harness with more
 *  solves has more chances. */
export function tally(pairs: readonly Paired[]): Tally {
  const counts = { wins: 0, losses: 0, ties: 0 };
  for (const pair of pairs) {
    const { task, old, fresh } = pair;
    if (old.length === 0 || old.length !== fresh.length) {
      throw new Error(
        `task ${task} has ${String(old.length)} solve(s) under the old harness and ${String(fresh.length)} under the new; a comparison needs as many of each`,
      );
    }
    const won = pairings(pair);
    counts[won.fresh > won.old ? "wins" : won.fresh < won.old ? "losses" : "ties"] += 1;
  }
  return counts;
}

/** The scored set's reading: the tally, and the sign test's p for the new harness. */
export function scored(pairs: readonly Paired[]): Tally & { readonly p: number } {
  const counts = tally(pairs);
  return { ...counts, p: signP(counts.wins, counts.losses) };
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
    const own = under(old);
    const [before, after] = old === fresh ? [own.slice(0, halves), own.slice(halves)] : [own, under(fresh)];
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
