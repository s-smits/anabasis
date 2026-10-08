/**
 * The comparison: does the new harness beat the old on tasks neither was built on?
 *
 * A task is solved the same number of times under each harness and counts once: a win when the new
 * harness passes it more often, a loss when less often, a tie otherwise. A tie says nothing and
 * leaves the test. The step is read off a one-sided sign test of wins against losses. At the plan's
 * p <= 0.10 its smallest wins are 4-0, 6-1, 7-2 and 9-3.
 *
 * The anchor is the set no screening chose, and it guards the other direction. The plan asks that
 * a step "hold" it and names no test, so it is read here as the same sign test turned round: the
 * anchor is lost when its losses beat its wins at the level the caller gives it, which need not be
 * the win test's: a guard may be asked to fire sooner. An anchor task both harnesses pass on every
 * solve informs nothing, and neither does one both fail on every solve: neither can show a win or a
 * loss. The anchor is drawn from unscreened tasks, so both kinds are common in it. Below a floor of
 * informative tasks the anchor is not tested, which is not the same as held.
 *
 * How many tasks, how many solves, the level and the floor are the caller's: they wait on D1's
 * supply and noise. Nothing here decides a step; it reports the two readings, and the pooled gain
 * the plan's stop rule reads (`gain`).
 *
 * The pairs are a view over the log (`pairsOf`). A task's solves count from the event that set it
 * apart for scoring, its admission or the anchor's draw, so a screening solve, which comes before
 * admission, never counts in a score. The log's condition records say which harness each solve ran
 * under, and a task whose solves differ in anything but the harness is refused: two solves are
 * comparable only when their conditions differ in the one thing being compared (`condition.ts`).
 */
import { sha256 } from "../meta/digest.ts";
import { asRecord, isNumber, isString } from "../meta/json-shape.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { conditionsOf, fieldsApart } from "./condition.ts";
import type { LogEvent } from "./log.ts";
import { taskStates } from "./task.ts";

/** One task version's counted solves under the old harness and under the new: true for a pass. */
export interface Paired {
  readonly task: string;
  readonly old: readonly boolean[];
  readonly fresh: readonly boolean[];
  /** Each of those solves' seconds, in the same order; null where the log has none. */
  readonly seconds?: { readonly old: readonly (number | null)[]; readonly fresh: readonly (number | null)[] };
}

export interface Tally {
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
}

export type AnchorReading = "held" | "lost" | "not-tested";

/** What a harness and its tool tree move together; a comparison holds every other field still. */
const COMPARED = new Set(["harness", "solverTools"]);
/** The 90th percentile of the standard normal. */
const Z90 = 1.2815515655446004;

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

/** Each task once: won, lost or tied by how often each harness passed it. A task solved more often
 *  under one harness than the other is refused, since the harness with more solves has more chances. */
export function tally(pairs: readonly Paired[]): Tally {
  const counts = { wins: 0, losses: 0, ties: 0 };
  for (const { task, old, fresh } of pairs) {
    if (old.length === 0 || old.length !== fresh.length) {
      throw new Error(
        `task ${task} has ${String(old.length)} solve(s) under the old harness and ${String(fresh.length)} under the new; a comparison needs as many of each`,
      );
    }
    const ahead = fresh.filter(Boolean).length - old.filter(Boolean).length;
    counts[ahead > 0 ? "wins" : ahead < 0 ? "losses" : "ties"] += 1;
  }
  return counts;
}

/** The scored set's reading: the tally, and the sign test's p for the new harness. */
export function scored(pairs: readonly Paired[]): Tally & { readonly p: number } {
  const counts = tally(pairs);
  return { ...counts, p: signP(counts.wins, counts.losses) };
}

/** The anchor's reading at `level`, with how many of its tasks could inform it: `floor` is the
 *  fewest that test it at all. */
export function anchor(
  pairs: readonly Paired[],
  level: number,
  floor: number,
): Tally & { readonly informative: number; readonly reading: AnchorReading } {
  const counts = tally(pairs);
  const informative = pairs.filter(({ old, fresh }) => {
    const solves = [...old, ...fresh];
    return solves.some(Boolean) && !solves.every(Boolean);
  }).length;
  const reading =
    informative < floor ? "not-tested" : signP(counts.losses, counts.wins) <= level ? "lost" : "held";
  return { ...counts, informative, reading };
}

/**
 * The pooled gain in points: the mean over tasks of the new harness's pass rate less the old's, and
 * the bound that mean stays under with 90% confidence, one-sided. The plan's stop rule reads the
 * bound: after three Builder sessions, a pooled gain below ten points at that confidence ends the
 * experiment. The task is the unit, as in the sign test, and the bound is Student's over the tasks'
 * differences, its quantile by the Cornish-Fisher expansion to two terms, which is right to the third
 * decimal from six tasks up.
 *
 * Fewer than two tasks bound nothing, and read as the largest gain there is. Tasks that all differ
 * alike have no spread, so their bound is their mean: the caller's count of tasks is what says how
 * much that is worth.
 */
export function gain(pairs: readonly Paired[]) {
  const rate = (solves: readonly boolean[]) => solves.filter(Boolean).length / solves.length;
  const gains = pairs.map(({ old, fresh }) => 100 * (rate(fresh) - rate(old)));
  const count = gains.length;
  if (count < 2) return { points: gains[0] ?? 0, upper: 100 };
  const mean = gains.reduce((sum, each) => sum + each, 0) / count;
  const spread = Math.sqrt(gains.reduce((sum, each) => sum + (each - mean) ** 2, 0) / (count - 1));
  const freedom = count - 1;
  const quantile =
    Z90 + (Z90 ** 3 + Z90) / (4 * freedom) + (5 * Z90 ** 5 + 16 * Z90 ** 3 + 3 * Z90) / (96 * freedom ** 2);
  return { points: mean, upper: Math.min(100, mean + (quantile * spread) / Math.sqrt(count)) };
}

/** Each harness's mean seconds over the set's counted solves, null for none timed. v1 found pass
 *  counts could not separate two harnesses at this size and read solve time beside them; it is
 *  reported here, and nothing decides on it. */
export function solveSeconds(pairs: readonly Paired[]) {
  const mean = (side: "old" | "fresh") => {
    const timed = pairs.flatMap((pair) => pair.seconds?.[side] ?? []).filter(isNumber);
    return timed.length === 0 ? null : timed.reduce((sum, each) => sum + each, 0) / timed.length;
  };
  return { old: mean("old"), fresh: mean("fresh") };
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
 * The pairs a comparison of harness `old` with harness `fresh` reads, for `versions`, from the log
 * alone. Only the test side's pass and fail endings count; a non-result was run again. A version a
 * check defect was ruled on is left out on both sides and named in `disputed`, so a ruling can
 * remove a comparison and cannot make a win. Refused: any other version that is neither admitted
 * nor the anchor's, and a task whose solves ran under conditions that differ in more than the
 * harness.
 */
export function pairsOf(
  events: readonly LogEvent[],
  versions: readonly string[],
  old: string,
  fresh: string,
) {
  const conditions = conditionsOf(events);
  const states = taskStates(events);
  const disputed = versions.filter((task) => states.get(task) === "disputed");
  const pairs = versions.flatMap((task) => {
    if (disputed.includes(task)) return [];
    const from = events.findLastIndex(
      ({ kind, data }) =>
        (kind === "task.state" && data.version === task && data.state === "admitted") ||
        (kind === "anchor.drawn" && Array.isArray(data.tasks) && data.tasks.includes(task)),
    );
    const state = states.get(task);
    if (from === -1 || (state !== "admitted" && state !== "held")) {
      throw new Error(
        `task ${task} is ${state ?? "not proposed"}; only an admitted task or an anchor task is scored`,
      );
    }
    const later = events.slice(from);
    const ran = new Map<string, string>();
    for (const { kind, data } of later) {
      const id = isString(data.condition) ? data.condition : "";
      const condition = conditions.get(id);
      if (
        kind === "solve.started" &&
        isString(data.solve) &&
        condition?.task === task &&
        condition.side === "test" &&
        (condition.harness === old || condition.harness === fresh)
      ) {
        ran.set(data.solve, id);
      }
    }
    const [first, ...rest] = [...new Set(ran.values())].map((id) => conditions.get(id));
    const apart = rest.flatMap((other) =>
      first === undefined || other === undefined ? [] : fieldsApart(first, other),
    );
    const moved = [...new Set(apart)].filter((field) => !COMPARED.has(field));
    if (moved.length > 0) {
      throw new Error(
        `task ${task}: its solves differ in ${moved.join(", ")}, and a comparison holds everything but the harness`,
      );
    }
    const counted = (harness: string) =>
      later.flatMap(({ kind, data }) => {
        const outcome = asRecord(data.ending)?.outcome;
        const under = conditions.get(ran.get(isString(data.solve) ? data.solve : "") ?? "");
        return kind === "solve.finished" &&
          under?.harness === harness &&
          (outcome === "pass" || outcome === "fail")
          ? [{ pass: outcome === "pass", seconds: isNumber(data.seconds) ? data.seconds : null }]
          : [];
      });
    const [before, after] = [counted(old), counted(fresh)];
    return [
      {
        task,
        old: before.map(({ pass }) => pass),
        fresh: after.map(({ pass }) => pass),
        seconds: { old: before.map(({ seconds }) => seconds), fresh: after.map(({ seconds }) => seconds) },
      },
    ];
  });
  return { pairs, disputed };
}
