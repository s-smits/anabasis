/**
 * The size of the measurement: what a round can show before it runs, and what rounds that fell
 * short of a step show together.
 *
 * Near the top of a climb the gap between two harnesses shrinks, and a round of the size that
 * read the first steps stops deciding. v1 met this without a reading for it: 11 of 322 batteries
 * held a fail nobody contested, and showing a doubled rate would have taken about 650 batteries an
 * arm. The plan's own estimate is that 24 tasks detect a 12-point gain about one time in three,
 * which `chanceOfStep` reproduces: twelve tasks in a hundred won outright and none lost, on 24
 * tasks at 0.10, clear 0.324 of the time.
 *
 * Everything here is arithmetic on the comparison's own test (`signP`, `compare.ts`) and exact:
 * binomial sums by the recurrence `signP` uses, with no normal approximation, since the sizes in
 * question are the ones where an approximation is worst. Nothing here decides. A chance is said
 * for a named effect or for the shares a log showed, and each function's comment states the model
 * it is the chance under.
 *
 * The model, wherever a chance is given: tasks are independent, and each scored task is a win
 * with one chance, a loss with another and a tie otherwise. The untied count is then binomial in
 * the tasks, the wins binomial in the untied, and the scored test clears when the wins reach the
 * fewest that `signP` passes at that untied count. Real tasks are not alike, and a set that is a
 * mixture reads as its mean only in this model. It is a reading of a size, and no forecast.
 *
 * Rounds that each fell short are not summed into a step (`together`). Three things stand
 * against it, and the reading names the ones its counts show:
 *
 * - A step names one harness, the one the campaign then stands on (`ladder.ts`). Rounds from one
 *   parent each built another child, so their summed wins are wins of several harnesses over the
 *   parent and of none of them in particular. A chain of rounds compared different pairs, and
 *   no round compared its ends.
 * - Each round was a look at its own level. A round that reads no step is followed by another
 *   from the same parent, so the number of rounds is not fixed beforehand: a sum read after every
 *   short round, until it clears, calls a step more often than the level allows.
 * - The task is the unit of the test, and a round carries the tasks its parent still fails. The
 *   same task scored in three rounds is three pairs and one task's evidence about the domain.
 *
 * What can be said instead is what a repeat would need (`repeatOf`): were each task's chances the
 * shares these rounds showed, how many scored tasks a round takes to clear its level half the
 * time, and four times in five. And whether twice the scoring solves buy more as tasks or as
 * solves a side (`boughtBy`). The arithmetic of that choice, for a task whose solves pass with
 * chance a under the old harness and b under the new, at k solves a side:
 *
 * - a and b both 0 or 1: the task is a win, a loss or a tie at every k. More solves a side buy
 *   nothing on it, and twice the tasks double the pairs that inform.
 * - a below b, neither settled: its chance of a win rises with k, towards one, and its chance of
 *   a tie falls. From 0.30 to 0.55, a win is 0.385 at one solve a side, 0.597 at three and 0.731
 *   at six, and a loss 0.135, 0.143 and 0.115.
 * - a equal to b, neither settled: more solves turn its ties into wins and losses in equal
 *   parts. At one half each, 0.50 of such tasks tie at one solve a side and 0.31 at three. Those
 *   are pairs the sign test has to outvote, so more solves a side can lower the chance of a step.
 *
 * So the answer depends on which of these the scored tasks are, and `boughtBy` computes it from
 * each task's own counts.
 */
import { asRecord, isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import { plural } from "../meta/text.ts";
import { type Paired, signP, sweepOf, type Tally } from "./compare.ts";
import { lastReports } from "./ladder.ts";
import type { LogEvent } from "./log.ts";

/** One scored task's chances in the model: of a win and of a loss. The rest is a tie. */
export interface Each {
  readonly win: number;
  readonly loss: number;
}

/** A true effect a chance is stated for: a share of the scored tasks the new harness moves, each
 *  from one chance of a pass on a solve to another. The other tasks tie however often they are
 *  solved. Its gain in points is 100 x share x (fresh - old). */
export interface Effect {
  readonly name: string;
  readonly share: number;
  readonly old: number;
  readonly fresh: number;
}

/** A scored set's result: so many wins beside so many losses. */
export interface Result {
  readonly wins: number;
  readonly losses: number;
}

export interface RoundSize {
  /** The scored tasks a round is sure of, which the parent's solves on record already stop, and
   *  the most it can fill: both capped by its target. */
  readonly sure: number;
  readonly most: number;
  /** Pool tasks counted in neither: the ones the parent's solves clear, and the ones whose only
   *  fails under it ended at the wall. A round scores such a task only when the child fails it. */
  readonly rest: number;
  readonly target: number;
  readonly solves: number;
  readonly level: number;
  /** The smallest results that clear the level on `most` tasks: the fewest wins beside no loss,
   *  beside one, and so on while the two fit in the set. Empty when no result clears. */
  readonly clearing: readonly Result[];
  /** The chance that the scored test clears, for each stated effect, at `sure` tasks and at `most`. */
  readonly chances: readonly { readonly effect: Effect; readonly sure: number; readonly most: number }[];
}

export interface Repeat {
  /** The scored tasks the shares are of, and the wins and losses among them. */
  readonly tasks: number;
  readonly wins: number;
  readonly losses: number;
  /** The chance that a round of as many scored tasks clears its level, in the model. */
  readonly again: number;
  /** For each stated chance, the fewest scored tasks at which a round first reaches it, or null
   *  when none up to `CEILING` does. */
  readonly needs: readonly { readonly chance: number; readonly tasks: number | null }[];
}

/** A round whose scored test did not clear its level, as its last report holds it. */
export interface ShortRound extends Tally {
  readonly session: string;
  readonly old: string;
  readonly fresh: string;
  readonly versions: readonly string[];
}

export interface Together extends Tally {
  readonly rounds: number;
  readonly parents: number;
  readonly children: number;
  /** The scored pairs summed over the rounds, and the task versions they are of. */
  readonly pairs: number;
  readonly tasks: number;
  /** Why the sum is no test of a step: the reasons these rounds' own counts show. */
  readonly apart: readonly string[];
  /** What a repeat would need at the summed shares; null when the rounds scored no task. */
  readonly repeat: Repeat | null;
}

export interface Bought {
  /** The scored tasks read, and the solves a side of the first of them. */
  readonly tasks: number;
  readonly solves: number;
  /** The chance that the scored test clears: on as many tasks at as many solves a side, on twice
   *  the tasks, and on the same tasks at twice the solves a side. The last two cost the same
   *  scoring solves. */
  readonly asIs: number;
  readonly moreTasks: number;
  readonly moreSolves: number;
}

/** The effects a round's chances are stated for. Each gain is given twice, since the same gain in
 *  points reads differently by how it is spread: as tasks turned from always failed to always
 *  passed, which is the plan's reading of its 12 points, and as every task lifted alike from a
 *  parent that passes three solves in ten, where the solves a side matter. */
export const EFFECTS: readonly Effect[] = [
  { name: "12 points as 12 tasks in 100 turned from failed to passed", share: 0.12, old: 0, fresh: 1 },
  { name: "12 points as every task lifted from 0.30 to 0.42", share: 1, old: 0.3, fresh: 0.42 },
  { name: "25 points as 25 tasks in 100 turned", share: 0.25, old: 0, fresh: 1 },
  { name: "25 points as every task lifted from 0.30 to 0.55", share: 1, old: 0.3, fresh: 0.55 },
];
/** The chances a repeat's size is given for: half the time, and four times in five. */
const CHANCES = [0.5, 0.8] as const;
/** The largest scored set a repeat's size is searched to. `signP` starts from 0.5 to the power of
 *  the untied count, which is a whole number of bits down to about a thousand and loses them
 *  after. A round of more than a thousand tasks is no round this plan can run either. */
export const CEILING = 1000;
/** How many of the smallest clearing results a line names. */
const NAMED = 3;

/** The chance of each count of successes among `trials` independent ones, from none to all: the
 *  recurrence `signP` runs, started from the likelier end so that the first term does not vanish. */
export function binomial(trials: number, chance: number): number[] {
  if (chance > 0.5) return binomial(trials, 1 - chance).toReversed();
  const terms: number[] = [];
  let term = (1 - chance) ** trials;
  for (let count = 0; count <= trials; count += 1) {
    terms.push(term);
    term = (term * (trials - count) * chance) / ((count + 1) * (1 - chance));
  }
  return terms;
}

/** For each untied count from none to `most`: the chance that as many of the untied are wins as
 *  clear `level`, were each a win with chance `share`. The fewest wins that clear never fall as the
 *  untied count grows, so they are found in one pass. */
function clears(level: number, share: number, most: number): number[] {
  const chances: number[] = [];
  let wins = 0;
  for (let untied = 0; untied <= most; untied += 1) {
    while (wins <= untied && signP(wins, untied - wins) > level) wins += 1;
    chances.push(
      binomial(untied, share)
        .slice(wins)
        .reduce((sum, term) => sum + term, 0),
    );
  }
  return chances;
}

/** The chance that a scored set of `tasks` clears, given each task's chance of being untied and
 *  `byUntied`, the chance of clearing at each untied count (`clears`). */
function weighed(tasks: number, untied: number, byUntied: readonly number[]): number {
  const chance = binomial(tasks, Math.min(1, untied)).reduce(
    (sum, term, count) => sum + term * (byUntied[count] ?? 0),
    0,
  );
  return Math.min(1, chance);
}

/**
 * The chance that the scored test of a round clears `level` on `tasks` scored tasks, in the model:
 * each task independently a win with chance `each.win` and a loss with `each.loss`, a tie
 * otherwise. No untied task, or fewer tasks than the least sweep, is a chance of none. With no
 * tie and no true difference, win and loss both one half, it is the test's own size, which is at
 * most the level.
 */
export function chanceOfStep(tasks: number, each: Each, level: number): number {
  const untied = each.win + each.loss;
  if (tasks < 1 || untied <= 0) return 0;
  return weighed(tasks, untied, clears(level, each.win / untied, tasks));
}

/**
 * One task's chances of a win and of a loss at `solves` a side, when each solve passes
 * independently with chance `rates.old` under the old harness and `rates.fresh` under the new: a
 * win is more passes under the new (`tally`, `compare.ts`). Solves of one task are taken as
 * independent given the task, which a host under load or a provider in a bad hour can break.
 */
export function taskChances(rates: { readonly old: number; readonly fresh: number }, solves: number): Each {
  const [old, fresh] = [binomial(solves, rates.old), binomial(solves, rates.fresh)];
  const below = (passes: number) => old.slice(0, passes).reduce((sum, term) => sum + term, 0);
  const above = (passes: number) => old.slice(passes + 1).reduce((sum, term) => sum + term, 0);
  return {
    win: fresh.reduce((sum, term, passes) => sum + term * below(passes), 0),
    loss: fresh.reduce((sum, term, passes) => sum + term * above(passes), 0),
  };
}

/** The smallest results that clear `level` on at most `tasks` scored tasks: at 0.10, 4-0, 6-1, 7-2
 *  and 9-3 as far as they fit. */
export function clearing(tasks: number, level: number): Result[] {
  const results: Result[] = [];
  let wins = 0;
  for (let losses = 0; wins + losses <= tasks; losses += 1) {
    while (wins + losses <= tasks && signP(wins, losses) > level) wins += 1;
    if (wins + losses <= tasks) results.push({ wins, losses });
  }
  return results;
}

/**
 * What a round of this size can show, before it runs. `pool` is how the pool stands against the
 * round's parent (`ladder.ts`): the tasks its solves on record stop, which the round admits with
 * no solve, and the tasks no solve has placed, each of which it may admit or retire. `rest` is the
 * pool beside them, where the caller knows a standing: the tasks the parent's solves clear, and
 * the ones whose only fails under it ended at the wall. Those are left out of the size. A round
 * scores one only when the child fails it in screening, so the size is of the tasks a new harness
 * can be read to win on, and `sizeLines` names the count left out. The chances are
 * `chanceOfStep`'s, for each of `effects` with every moved task's win and loss chances taken at
 * the round's solves a side (`taskChances`) and scaled by the effect's share. They are the scored
 * test's alone: a step also needs the anchor held, which no size of the scored set gives.
 */
export function roundSize(
  pool: { readonly stops: number; readonly unplaced: number; readonly rest?: number },
  asked: { readonly target: number; readonly solves: number; readonly level: number },
  effects: readonly Effect[] = EFFECTS,
): RoundSize {
  const sure = Math.min(asked.target, pool.stops);
  const most = Math.min(asked.target, pool.stops + pool.unplaced);
  return {
    sure,
    most,
    rest: pool.rest ?? 0,
    ...asked,
    clearing: clearing(most, asked.level),
    chances: effects.map((effect) => {
      const moved = taskChances(effect, asked.solves);
      const each = { win: effect.share * moved.win, loss: effect.share * moved.loss };
      return {
        effect,
        sure: chanceOfStep(sure, each, asked.level),
        most: chanceOfStep(most, each, asked.level),
      };
    }),
  };
}

/** That reading in lines, for a launch's notes and `prepare.ts`'s output. */
export function sizeLines(size: RoundSize): string[] {
  const { sure, most, level } = size;
  if (most === 0) return [];
  // Said wherever a size is, so that "at most" is not read as the whole pool's.
  const beside =
    size.rest === 0
      ? ""
      : `; ${plural(size.rest, "pool task")} the parent clears or ran to the wall on ${size.rest === 1 ? "is" : "are"} not counted, and a round scores one only when the child fails it`;
  if (size.clearing.length === 0) {
    return [
      `at most ${String(most)} task(s) can be scored, and at --level ${String(level)} a step takes ${String(sweepOf(level))}, all won: this round cannot read step. Its screening still retires each candidate both harnesses pass, as too-easy${beside}`,
    ];
  }
  const named = size.clearing.slice(0, NAMED).map(({ wins, losses }) => `${String(wins)}-${String(losses)}`);
  const between = sure > 0 && sure < most;
  const chances = size.chances.map(
    (said) => `${said.effect.name}, ${between ? `${said.sure.toFixed(2)} to ` : ""}${said.most.toFixed(2)}`,
  );
  return [
    `at most ${plural(most, "task")} can be scored${sure > 0 ? `, ${String(sure)} of them stopped by the parent's solves on record` : ""}; at --level ${String(level)} the smallest results that clear are ${named.join(", ")}${beside}`,
    `the chance that the scored test clears on ${between ? `${String(sure)} to ` : ""}${plural(most, "task")} at ${plural(size.solves, "solve")} a side, were the true effect: ${chances.join("; ")}`,
  ];
}

/**
 * What a repeat would need, from a tally that fell short. The model is `chanceOfStep`'s with each
 * task's chances set to the shares the tally showed: a win `wins` in its tasks, a loss `losses` in
 * them. That is the assumption, and it is a strong one: the shares are an estimate from as many
 * tasks as the tally holds, and the true ones may be far from it, the more so the fewer tasks
 * there were. So the sizes say what it takes to see an effect of exactly the size observed, and
 * not that the effect is there. A tally that does not favour the new harness is reached by no
 * size, and one with no task says nothing.
 *
 * The chance does not rise at every added task, since the test moves in whole wins, so a size is
 * the first at which the chance is reached.
 */
export function repeatOf(tally: Tally, level: number): Repeat | null {
  const tasks = tally.wins + tally.losses + tally.ties;
  if (tasks === 0) return null;
  const informative = tally.wins + tally.losses;
  // With no untied task there is no share of wins to read, and no size clears.
  const cleared = informative === 0 ? [] : clears(level, tally.wins / informative, CEILING);
  const at = (size: number) => weighed(size, informative / tasks, cleared);
  const sizes = Array.from({ length: CEILING }, (_, index) => index + 1);
  return {
    tasks,
    wins: tally.wins,
    losses: tally.losses,
    again: at(Math.min(tasks, CEILING)),
    needs: CHANCES.map((chance) => ({ chance, tasks: sizes.find((size) => at(size) >= chance) ?? null })),
  };
}

/** The rounds since the campaign last stepped whose scored test did not clear its level, from
 *  each one's last report: the rounds a reading of what fell short is of. A round that scored no
 *  task tested nothing and is not among them. */
export function shortRounds(events: readonly LogEvent[]): ShortRound[] {
  const reports = lastReports(events);
  const stepped = reports.findLastIndex(({ data }) => data.reading === "step");
  return reports.slice(stepped + 1).flatMap(({ session, data }) => {
    const tally = tallyIn(data);
    const read = isString(data.counted) ? data.counted : data.reading;
    return read === "no-step" && tally !== null && isString(data.old) && isString(data.fresh)
      ? [
          {
            session,
            old: data.old,
            fresh: data.fresh,
            ...tally,
            versions: Array.isArray(data.versions) ? data.versions.filter(isString) : [],
          },
        ]
      : [];
  });
}

/** The informative pairs, wins and losses together, of each round from `harness` that scored a
 *  task, oldest first: what `binding.ts` reads the measurement on. */
export function informativeOf(events: readonly LogEvent[], harness: string): number[] {
  return lastReports(events).flatMap(({ data }) => {
    const tally = tallyIn(data);
    return data.old === harness && tally !== null ? [tally.wins + tally.losses] : [];
  });
}

/** A report's scored tally, or null where it scored no task. */
function tallyIn(report: JsonObject): Tally | null {
  const scored = asRecord(report.scored);
  if (scored === null) return null;
  const { wins, losses, ties } = scored;
  return isNumber(wins) && isNumber(losses) && isNumber(ties) && wins + losses + ties > 0
    ? { wins, losses, ties }
    : null;
}

/**
 * What rounds that each fell short show together: their tallies summed, how many tasks, parents
 * and children the sum is of, why it is no test of a step, and what a repeat would need at the
 * summed shares (`repeatOf`). The header says why no step is read off the sum. The summed shares
 * are the mean of what the Builder's sessions did from these parents, which is the one estimate
 * there is of what its next session does, and no more than that.
 */
export function together(rounds: readonly ShortRound[], level: number): Together {
  const sum = (count: (round: ShortRound) => number) =>
    rounds.reduce((total, round) => total + count(round), 0);
  const tally = {
    wins: sum((round) => round.wins),
    losses: sum((round) => round.losses),
    ties: sum((round) => round.ties),
  };
  const distinct = (values: readonly string[]) => new Set(values).size;
  const pairs = tally.wins + tally.losses + tally.ties;
  const tasks = distinct(rounds.flatMap((round) => round.versions));
  const [parents, children] = [
    distinct(rounds.map((round) => round.old)),
    distinct(rounds.map((round) => round.fresh)),
  ];
  const apart = [
    ...(children > 1
      ? [`the rounds compared ${String(children)} children, and a step names one harness`]
      : []),
    ...(parents > 1
      ? [`they started from ${String(parents)} parents, and no round compared the first with the last`]
      : []),
    ...(rounds.length > 1
      ? [
          `each of the ${String(rounds.length)} was a look at its own level, and a sum read after every short round clears more often than the level allows`,
        ]
      : []),
    ...(tasks < pairs
      ? [
          `the ${String(pairs)} pairs are of ${plural(tasks, "task")}, and a task scored in several rounds is one task's evidence`,
        ]
      : []),
  ];
  return {
    ...tally,
    rounds: rounds.length,
    parents,
    children,
    pairs,
    tasks,
    apart,
    repeat: repeatOf(tally, level),
  };
}

/**
 * Whether twice the scoring solves buy more as tasks or as solves a side, at the pass rates the
 * scored tasks showed. The model: each task passes a solve under each harness with exactly the
 * rate its counted solves showed, a further task is one of these drawn at random, and solves and
 * tasks are independent. Each task's chances of a win and of a loss are then `taskChances` at its
 * own solves a side and at twice as many, a set's are their mean, and the three chances are
 * `chanceOfStep`'s.
 *
 * The first assumption is the one to hold against the result. A task that passed three of three
 * is taken to pass always, so a task that looks settled on a few solves is one more solves are
 * said to buy nothing on, and the reading leans towards tasks. The second leans the same way: the
 * tasks a pool still holds, or an Examiner would write, need not be like the ones scored. Null
 * for no task.
 */
export function boughtBy(pairs: readonly Paired[], level: number): Bought | null {
  const [first] = pairs;
  if (first === undefined) return null;
  const rate = (solved: readonly boolean[]) => solved.filter(Boolean).length / solved.length;
  /** The set's mean chances with each task solved `times` its own solves a side. */
  const mean = (times: number): Each => {
    const each = pairs.map(({ old, fresh }) =>
      taskChances({ old: rate(old), fresh: rate(fresh) }, times * old.length),
    );
    return {
      win: each.reduce((sum, task) => sum + task.win, 0) / pairs.length,
      loss: each.reduce((sum, task) => sum + task.loss, 0) / pairs.length,
    };
  };
  const once = mean(1);
  return {
    tasks: pairs.length,
    solves: first.old.length,
    asIs: chanceOfStep(pairs.length, once, level),
    moreTasks: chanceOfStep(2 * pairs.length, once, level),
    moreSolves: chanceOfStep(pairs.length, mean(2), level),
  };
}

/** Those two readings in lines, for whoever chooses the next command. None when no round fell
 *  short. */
export function shortLines(read: Together, bought: Bought | null): string[] {
  if (read.rounds === 0) return [];
  const needs = (read.repeat?.needs ?? []).map(
    ({ chance, tasks }) =>
      `${String(chance)} of the time from ${tasks === null ? `no size up to ${String(CEILING)}` : `${String(tasks)} scored tasks`}`,
  );
  return [
    `${plural(read.rounds, "round")} since the last step fell short of one: ${String(read.wins)} wins, ${String(read.losses)} losses and ${String(read.ties)} ties over ${plural(read.pairs, "scored pair")} of ${plural(read.tasks, "task")}`,
    ...(read.apart.length === 0 ? [] : [`their sum is no test of a step: ${read.apart.join("; ")}`]),
    ...(needs.length === 0
      ? []
      : [
          `were every task's chances the shares these showed, a round's scored test would clear ${needs.join(", ")}`,
        ]),
    ...(bought === null
      ? []
      : [
          `at the pass rates these tasks showed, ${String(bought.tasks)} tasks at ${String(bought.solves)} a side clear ${bought.asIs.toFixed(2)} of the time; twice the scoring solves clear ${bought.moreTasks.toFixed(2)} as ${String(2 * bought.tasks)} tasks, and ${bought.moreSolves.toFixed(2)} as ${String(2 * bought.solves)} solves a side. A task that passed every solve or none is taken to do so always, which leans this towards tasks`,
        ]),
  ];
}
