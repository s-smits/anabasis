/**
 * The comparison: does the new harness beat the reference harness on tasks neither was built on?
 *
 * Both harnesses solve the same held-out tasks under the same compute budget, and each task
 * counts once. Every solve of the new harness is paired with every solve of the reference one
 * (`pairings`), and in a pair a valid answer beats one that is not. Two valid answers are even,
 * and so are two that are not. The harness that wins more pairs wins the task, and otherwise the
 * task is a tie. A tie says nothing and leaves the test. The step is read off a one-sided sign
 * test of wins against losses. At the level of 0.20 its smallest wins are 3-0, 4-1, 6-2 and 7-3;
 * 2-0 and 3-1 clear nothing. The level is the caller's and is recorded with the comparison's
 * terms, so a comparison made at the plan's 0.10 still reads as it did. 0.20 is the default since
 * 10 October: at 0.10 the smallest win was 4-0, and three campaigns of 9 and 10 October stopped
 * on 3-0-3, 3-0-5 and 3-0-7, one win short of a step each; 2-0 stays out because the reference
 * against itself read 2-0-5 (`docs/plan.md`, Statistical power and cost).
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
 * that is the form an objective joins, should validity leave too many ties: the plan adds one only
 * then, computed by the host from the answer, and never a value the answer reports about itself
 * (Phase 3). No objective is built here.
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
 * A budget's units are two (`UNITS`). `turns` are the model's own turns, as a trace counts them,
 * and `seconds` is the whole attempt as the host timed it, from before its sandbox was mounted
 * until its verdict, which is some seconds more than the solver's own wall. They are the two a
 * solver can be told and held to (`--solve-model-turns`, `--solve-minutes`).
 *
 * Until 2026-10-09 a budget could also name `prompts` and `cpu`, and neither read anything a
 * campaign used. Every finished solve of the first three rounds was given one prompt, so a budget
 * in prompts read what the full limit read. The CPU time of a solve's commands is known only from
 * below once one of them is cut, which is the limit solvers meet most, so a budget in CPU left
 * such tasks out and reported how many (`unread`). The CPU a solve used is still measured and
 * reported (`Used.cpu`, `spread`); it is no unit a budget is given in.
 */
import { sha256 } from "../meta/digest.ts";
import { asRecord, isNumber } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { conditionsOf, settingId } from "./condition.ts";
import type { LogEvent } from "./log.ts";
import { ended, passed, ranUnder } from "./solves.ts";
import { taskSets } from "./task.ts";

/** What one counted solve used, as its `solve.finished` holds it: null where the log has none. */
export interface Used {
  /** The model's turns. */
  readonly turns: number | null;
  /** The prompts the solver was given: null for a solve logged before 2026-10-09. */
  readonly prompts: number | null;
  /** CPU seconds of the solve's commands that ended measured. */
  readonly cpu: number | null;
  /** How many of its commands ended with their CPU unmeasured: one cut at its limit or by the wall
   *  takes its record with it (`src/solve/command.ts`). With any, `cpu` is a lower bound of what the
   *  solve used and not the amount, which is why no budget is given in it. Left out where there
   *  was none. */
  readonly unmeasured?: number;
  readonly seconds: number | null;
  /** Billed dollars. */
  readonly billed: number | null;
}

/** The two units a compute budget can be given in. */
export const UNITS = ["turns", "seconds"] as const;
/** What a solve's use is reported in: a budget's units, and the CPU seconds of its commands. */
export const MEASURED = ["turns", "cpu", "seconds"] as const;

/** How far repeated solves of one harness on one task differ in a unit: over the tasks and sides
 *  with two measured solves or more, the largest use divided by the smallest, as the median of
 *  those ratios and the largest. Null where no task has two. */
interface Spread {
  readonly tasks: number;
  readonly median: number;
  readonly most: number;
}

/** One task version's counted solves under the reference harness and under the new: true for a
 *  valid answer. */
export interface Paired {
  readonly task: string;
  readonly old: readonly boolean[];
  readonly fresh: readonly boolean[];
  /** Each of those solves as the log names it, in the same order. */
  readonly solves?: { readonly old: readonly string[]; readonly fresh: readonly string[] };
  /** What each of those solves used of its limits, in the same order. */
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
}

/** A compute budget a comparison is read at after the fact: a solve that used more of any named
 *  unit than this counts as no answer. */
export interface Budget {
  readonly turns?: number | undefined;
  readonly seconds?: number | undefined;
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

/** The smallest scored set a sign test at `level` can read a step on: that many tasks, all won. */
export function sweepOf(level: number): number {
  let sweep = 1;
  while (signP(sweep, 0) > level) sweep += 1;
  return sweep;
}

// Two other readings of a tally, kept for a later ablation and deciding nothing. Both are functions
// of a report's wins, losses and ties, so any recorded comparison can be read under them unpaid.
// On the 22 comparisons on record on 10 October each read the same 13 steps as the sign test at 0.20.
//
// The trinomial test (Bian, McAleer and Wong, 2011) reads the ties as evidence: a tie is as likely
// as the tally's share of ties, a win as likely as a loss, and p is how often wins lead by this
// much. 3-0-9 reads 0.071 and 2-0-10 reads 0.134, where the sign test reads 0.125 and 0.25. Bar 0.10.
//   function trinomialP({ wins, losses, ties }: Tally): number {
//     const n = wins + losses + ties, u = (wins + losses) / n; // u: the share of untied tasks
//     let tail = 0;
//     for (let k = 0, c = 1; k <= n; c = (c * (n - k)) / (k + 1), k += 1) { // k of n tasks untied
//       const need = Math.max(0, Math.ceil((k + wins - losses) / 2)); // wins that give the lead
//       if (need <= k) tail += c * u ** k * (1 - u) ** (n - k) * signP(need, k - need);
//     }
//     return Math.min(1, tail);
//   }
// The chance the new harness is the better one: the chance its share of untied wins is over a half,
// every share as likely as another beforehand. 3-0 reads 0.938, 4-1 0.891, 2-0 0.875. Bar 0.90, which
// takes 3-0 and refuses 4-1; at 0.95 it is the sign test at 0.10.
//   const betterP = (wins: number, losses: number) => 1 - signP(wins + 1, losses);

/** One task's pairings: every solve of the new harness against every solve of the reference one,
 *  and how many each side won. A valid answer beats one that is not, and nothing else decides. */
export function pairings(pair: Paired) {
  const [valid, other] = [pair.fresh.filter(Boolean).length, pair.old.filter(Boolean).length];
  return { fresh: valid * (pair.old.length - other), old: other * (pair.fresh.length - valid) };
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

/** Whether a solve used more of a unit `budget` names than it allows. */
function over(budget: Budget, used: Used | undefined): boolean {
  return UNITS.some((unit) => {
    const [most, spent] = [budget[unit], used?.[unit] ?? null];
    return most !== undefined && spent !== null && spent > most;
  });
}

/**
 * The same pairs read at a shorter budget: a solve that used more of a unit the budget names than
 * the budget allows counts as no answer, valid or not. One set of solves so gives the comparison
 * at every shorter budget. It is an approximation: the solver was told the long limit only, and
 * one told a short one may spend its turns otherwise (`docs/plan.md`, Phase 0). A solve whose use
 * of a named unit the log does not hold at all is counted as within it. Every task is read at
 * every budget: both units are measured whole for every solve.
 */
export function within(pairs: readonly Paired[], budget: Budget): Paired[] {
  const cut = (valid: readonly boolean[], used: readonly Used[] | undefined) =>
    valid.map((each, index) => each && !over(budget, used?.[index]));
  return pairs.map((pair) => ({
    ...pair,
    old: cut(pair.old, pair.used?.old),
    fresh: cut(pair.fresh, pair.used?.fresh),
  }));
}

/**
 * How far the use of each measured figure moved between repeated solves of one harness on one
 * task. It is what decides the unit a budget is given in: a unit whose use doubles between two
 * solves of the same harness splits them at random under any budget near it (`docs/plan.md`,
 * Phase 0). CPU is reported beside the two units, and is none. A solve that used none of a figure
 * is left out of that figure's ratio.
 */
export function spread(pairs: readonly Paired[]): Record<(typeof MEASURED)[number], Spread | null> {
  const of = (unit: (typeof MEASURED)[number]): Spread | null => {
    const ratios = pairs
      .flatMap(({ used }) => [used?.old ?? [], used?.fresh ?? []])
      .flatMap((side) => {
        const spent = side.flatMap((each) => {
          const value = each[unit];
          return value !== null && value > 0 ? [value] : [];
        });
        return spent.length < 2 ? [] : [Math.max(...spent) / Math.min(...spent)];
      })
      .sort((a, b) => a - b);
    const middle = ratios[Math.floor(ratios.length / 2)];
    const most = ratios.at(-1);
    return middle === undefined || most === undefined
      ? null
      : {
          tasks: ratios.length,
          median: ratios.length % 2 === 1 ? middle : ((ratios[ratios.length / 2 - 1] ?? middle) + middle) / 2,
          most,
        };
  };
  return { turns: of("turns"), cpu: of("cpu"), seconds: of("seconds") };
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
  const { old, fresh, setting, comparison, halves } = sides;
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
      solves.map(({ end }): Used => {
        const { seconds: cpu, unmeasured } = asRecord(end.cpu) ?? {};
        return {
          turns: isNumber(end.turns) ? end.turns : null,
          prompts: isNumber(end.prompts) ? end.prompts : null,
          cpu: isNumber(cpu) ? cpu : null,
          ...keyIfDefined("unmeasured", isNumber(unmeasured) && unmeasured > 0 ? unmeasured : undefined),
          seconds: isNumber(end.seconds) ? end.seconds : null,
          billed: isNumber(end.billed) ? end.billed : null,
        };
      });
    return [
      {
        task,
        old: before.map((solve) => passed(solve) === true),
        fresh: after.map((solve) => passed(solve) === true),
        solves: { old: before.map(({ id }) => id), fresh: after.map(({ id }) => id) },
        used: { old: used(before), fresh: used(after) },
      },
    ];
  });
  return { pairs, disputed };
}
