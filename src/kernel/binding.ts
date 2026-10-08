/**
 * What binds a climb: the compartment that has to move next, read from the log.
 *
 * A campaign has more compartments than a harness, and a harder exam leans on each of them. The
 * tasks have to ask more. The stronger solver has to pass what they ask, or nothing proves a task
 * can be done. The checks have to judge what they ask, and a requirement no check reads cannot be
 * put in a task at all. The limits have to leave room for it. Several of these may move in one
 * cycle: a round compares two harnesses on the same tasks under the same checks, so whatever else
 * moved between rounds, the comparison still reads the harness (`src/builder/round.ts`).
 *
 * What a campaign then needs to know is which one is short. v1 had no such reading: its next move
 * was chosen without the exam's placement (`decideNextMove`), and its Builder, holding every pen,
 * eased a failed task as often as it built against it (three times in six, v1 `AGENTS.md`). Here
 * the pens are apart, and this says whose turn it is:
 *
 * - `harness`: enough of the pool stops the harness or is not yet placed against it, so a round
 *   has an exam to build against.
 * - `measurement`: the pool can be scored and the comparison is what is short (`size.ts`). Either
 *   the round as it is sized cannot read a step, its target being under the least sweep, or the
 *   last two rounds from this harness each told the two harnesses apart on fewer tasks than a step
 *   takes. A third round of that size would most likely read the same, whatever its child is, and
 *   what a repeat would need is `size.ts`'s to say. It is read before `harness` and after
 *   everything a short pool names: a pool that cannot be scored is not mended by a larger round.
 * - otherwise, what the Examiner sessions that stood on this harness were told of their tasks,
 *   by the largest count. `witness`: the stronger solver did not pass them, so the tasks have
 *   outrun the proof that they can be done, and they wait for a harness that lifts it. `checks`:
 *   a check could not run on an accepted answer or did not repeat. `limits`: the measured solver
 *   only ran out of time, under the limits the solver still runs at: a word told under a shorter
 *   wall is a word about that wall, and is not read (`limits.ts`). `tasks`: the measured solver
 *   passes them, or their packages and controls did not hold, and the author has to ask more or
 *   write more carefully.
 * - `correctness-model`: a second session against the same harness, told what the first measured,
 *   still wrote mostly tasks the solver passes. What these checks can ask, this harness answers,
 *   and the exam grows only by a requirement with a check of its own. That is the operator's to
 *   add: a pack that holds it is adopted into the campaign (`tools/c/accept.ts --freeze`).
 *
 * It is a reading and it decides nothing. The counts it rests on are returned beside it, and two
 * sessions is a small number to call a correctness model spent on.
 */
import { isNumber, isString } from "../meta/json-shape.ts";
import { countBy } from "../meta/tally.ts";
import type { Limits } from "./condition.ts";
import { frontierOf, ladder, type Rule, type Stand } from "./ladder.ts";
import type { LogEvent } from "./log.ts";
import { informativeOf } from "./size.ts";
import { outgrown } from "./wall.ts";

export type Compartment =
  | "harness"
  | "measurement"
  | "tasks"
  | "witness"
  | "checks"
  | "limits"
  | "correctness-model";

export interface Binding {
  readonly binds: Compartment;
  readonly why: string;
  /** Pool tasks that stop the harness, and pool tasks no solve has placed against it. */
  readonly stops: number;
  readonly unplaced: number;
  /** Tasks that wait for a witness. */
  readonly reach: number;
  /** The Examiner sessions that stood on the harness, and what each of their tasks was last told. */
  readonly sessions: number;
  readonly words: Readonly<Record<string, number>>;
}

/** What a task's author was last told of it, and by which session. */
export interface Told {
  readonly word: string;
  readonly session: string;
  /** The fails among the solves the word rests on, and how many those were. */
  readonly fails: number;
  readonly solves: number;
  /** Whether an advising Referee ruled a fail behind the word a check defect. */
  readonly flagged: boolean;
}

/** Sessions against one harness after which tasks the solver passes are read as the checks' span
 *  and no longer as their author's first try. */
const TOLD_ONCE = 2;
/** Rounds from one harness, each short of the informative pairs a step takes, after which the
 *  measurement is read as what binds: one such round can be its child's doing, or chance. */
const SHORT_ROUNDS = 2;
const WALL_BOUND = "wall-bound";

/** The last `exam.word` of each task version: a task is told a word at each step it reaches, a
 *  reach task once more by each session that tries it again, and the last one stands. */
export function toldOf(events: readonly LogEvent[]): Map<string, Told> {
  const told = new Map<string, Told>();
  for (const { kind, data } of events) {
    if (kind === "exam.word" && isString(data.version) && isString(data.word)) {
      told.set(data.version, {
        word: data.word,
        session: isString(data.session) ? data.session : "",
        fails: isNumber(data.fails) ? data.fails : 0,
        solves: Array.isArray(data.solves) ? data.solves.length : 0,
        flagged: Array.isArray(data.flagged) && data.flagged.length > 0,
      });
    }
  }
  return told;
}

/**
 * What binds the climb from where the solver stands. `least` is the smallest scored set a round can read a step
 * on, which is the comparison's arithmetic and the caller's to give. A session logged before
 * sessions named their harness stood on the campaign's first one. `target` is the scored set the
 * next round would fill, where the caller knows it, and `limits` what the solver's next solves
 * would run under, where it does: without them neither is read against.
 */
export function binding(
  events: readonly LogEvent[],
  stand: Stand,
  given: {
    readonly rule: Rule;
    readonly least: number;
    readonly target?: number;
    readonly limits?: Limits;
  },
): Binding {
  const placed = ladder(events, stand, given.rule);
  const first = frontierOf(events) === null;
  const stood = new Set(
    events.flatMap(({ kind, data }) =>
      kind === "exam.started" &&
      isString(data.session) &&
      (data.standsOn === stand.harness || (data.standsOn === undefined && first))
        ? [data.session]
        : [],
    ),
  );
  // A wall-bound word from a session whose solver ran under a shorter wall says nothing of this one.
  const lifted = given.limits === undefined ? new Set<string>() : outgrown(events, given.limits);
  const told = new Map(
    [...toldOf(events)].flatMap(([version, { word, session }]) =>
      stood.has(session) && !(word === WALL_BOUND && lifted.has(session)) ? [[version, word] as const] : [],
    ),
  );
  const words = countBy([...told.values()], (word) => word);
  // A refusal at gate 2 or 3 is a check's: it could not run on an answer, or did not repeat.
  const byChecks = new Set(
    events.flatMap(({ kind, data }) =>
      kind === "task.gate" && data.outcome === "refused" && (data.gate === 2 || data.gate === 3)
        ? [data.version]
        : [],
    ),
  );
  const unsound = [...told].filter(([version, word]) => word === "refused" && byChecks.has(version)).length;
  const counts = {
    stops: placed.pool.stops.length,
    unplaced: placed.pool.unknown.length,
    reach: placed.reach.length,
    sessions: stood.size,
    words,
  };
  const scorable = counts.stops + counts.unplaced;
  if (scorable >= given.least) {
    const least = String(given.least);
    const last = informativeOf(events, stand.harness).slice(-SHORT_ROUNDS);
    if (given.target !== undefined && given.target < given.least) {
      return {
        ...counts,
        binds: "measurement",
        why: `${String(scorable)} of the pool can be scored and a step takes ${least}, and the round's target is ${String(given.target)}: at this size no result reads a step`,
      };
    }
    if (last.length === SHORT_ROUNDS && last.every((pairs) => pairs < given.least)) {
      return {
        ...counts,
        binds: "measurement",
        why: `${String(scorable)} of the pool can be scored, and the last ${String(SHORT_ROUNDS)} rounds from this harness told the two harnesses apart on ${last.join(" and ")} tasks where a step takes ${least}: a round of this size has not been able to read one`,
      };
    }
    return {
      ...counts,
      binds: "harness",
      why: `${String(counts.stops)} of the pool stop this harness and ${String(counts.unplaced)} are not yet placed against it: a round has an exam to build against`,
    };
  }
  const easy = words["too easy"] ?? 0;
  const classes: readonly (readonly [Compartment, number, string])[] = [
    [
      "checks",
      unsound,
      "were refused because a check could not run on an accepted answer or did not repeat; a repaired pack is adopted into the campaign with tools/c/accept.ts --freeze",
    ],
    [
      "witness",
      words["too hard"] ?? 0,
      "were not passed by the stronger solver, and wait for a harness that lifts it",
    ],
    ["limits", words[WALL_BOUND] ?? 0, "only ran the measured solver out of time"],
    stood.size >= TOLD_ONCE
      ? [
          "correctness-model",
          easy,
          "are passed by the measured solver, in a session told what the one before measured; a pack with a further requirement is adopted into the campaign with tools/c/accept.ts --freeze",
        ]
      : ["tasks", easy, "are passed by the measured solver"],
    ["tasks", (words.refused ?? 0) - unsound, "were refused on their own packages or controls"],
  ];
  const [binds, most, how] = classes.reduce((best, each) => (each[1] > best[1] ? each : best));
  const short = `${String(counts.stops + counts.unplaced)} of the pool can be scored and a step takes ${String(given.least)}`;
  if (most === 0) {
    return {
      ...counts,
      binds: "tasks",
      why:
        stood.size === 0
          ? `${short}: no Examiner session has written against this harness`
          : `${short}: what was written against this harness is in the pool, and is too little`,
    };
  }
  return {
    ...counts,
    binds,
    why: `${short}: ${String(most)} of the ${String(told.size)} tasks written against this harness ${how}`,
  };
}
