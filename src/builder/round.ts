/**
 * One round: a Builder session, then the comparison of the harness it left with the one it started
 * from, on tasks it never saw. This is the plan's D2 from its first event to its reading, and until
 * this file its parts had no caller that ran them in order.
 *
 * A round is four steps over one log.
 * 1. The session (`session.ts`): it practises on released tasks and freezes a harness.
 * 2. Screening, the task's gate 5, over the whole live pool: every feasible task held or admitted
 *    outside the anchor, whichever round admitted it before. A task either harness fails often
 *    enough is admitted (`screen`), by this round, and one both pass goes to `too-easy`: the
 *    campaign has got past it. Admission is symmetric and comes after the session, since it needs
 *    the new harness, and before any scoring solve, which counts only from this round's admission
 *    on. The parent's side is read from the solves the log already holds of a task under that
 *    harness, an earlier round's or an Examiner session's, and only what is missing is solved: a
 *    task those solves already stop is admitted whatever the child does, so it is admitted with no
 *    solve at all. Tasks are taken in the caller's order, as many at a time as the scored set
 *    still lacks, so no more are screened than the set needs.
 *
 *    This is what moves the exam with the harness (`src/kernel/ladder.ts`). After a step the next
 *    round's parent is the harness that stepped: the tasks it still fails are carried at no
 *    screening cost, the tasks it now passes are screened against the new child and mostly
 *    retire, and what the pool then lacks is the Examiner's to write.
 * 3. Scoring: each scored task and each anchor task is solved `solves` times under each harness.
 * 4. The reading: the scored set's sign test, its pooled gain and the anchor's test, logged as
 *    `comparison.reported` and `anchor.scored`.
 *
 * In steps 2 and 3 the two harnesses are interleaved, task by task, so that neither has the quieter
 * hours or the warmer cache, and only solves made in the round's own window are counted, from its
 * session's start to the next session's: an anchor solve an earlier round made under the same old
 * harness was not made beside this round's, and may rest on another condition, since the host's
 * code is part of one and is edited between rounds.
 *
 * A fail is put to the Referee when the caller has one. Whether its ruling decides is the caller's
 * word (`refereeDecides`), and the plan's: the hand reading is the gate until the Referee's rulings
 * have cleared the operator's bar against hand labels (`src/review/agreement.ts`). Deciding, a fail
 * it rules a check defect disputes the task; advising, the fail stands and the task is reported as
 * flagged, for the person who reads the fails before the reading is read. The report then holds a
 * second reading beside the first, `unflagged`: the same tests with the flagged tasks left out.
 * Where the two differ the round reads `flags-decide` and claims neither: counted, the reading
 * rests on fails a reviewer laid to a check, and left out, on one reviewer's word. A person's labels
 * of those fails settle it (`settleReading`): a fail labelled a check defect disputes its task, one
 * labelled earned stands, and the report is written once more as the labels leave it.
 * A check that could not run disputes its task either way. A disputed task is neither admitted nor compared. The Referee
 * reads both harnesses' fails: a defect on the old side would make a win as surely as one on the
 * new side makes a loss. Past `defects` disputed tasks outside the anchor the round stops, which is
 * the plan's rule that more than three check defects send the work to the contract.
 *
 * The round keeps no state of its own. What is left to do is read from the log each time it is run:
 * a session that finished is not run again, a task screened is not screened again, and a solve
 * counted is not solved again, so a round killed in its sixth hour goes on from there. A round that
 * wrote its report is finished, and run again it returns that report and does nothing: topping up a
 * set a dispute thinned, after the tallies could be seen, would be a second look at the data. A
 * session that started and never finished is refused, since its harness is gone and a second
 * session under one id would be a second try. So is one that was killed or that crashed, a failed
 * provider turn among the crashes: what it froze is half a session's work, and comparing it would
 * spend a comparison on a harness nobody meant to measure. A session cut at its wall or its turns
 * is a whole session and is compared. One that left a harness no solve can open is reported as no
 * change, with why. A round with no report is refused as well once another Builder session has
 * started in the log: its window ends where that session starts, so what it solved from then on
 * would be counted nowhere (`spent`).
 *
 * A round also stops, to go on the same way, when the provider has stopped answering: `SILENT`
 * tasks in a row whose solve ended, after its reruns, with nothing written for it. A login at its
 * session limit does that to every solve in seconds. Solved on, the round would report every task
 * short and be finished, with its Builder session and its counted solves spent on that report.
 *
 * A scored task is never diagnosed and its trace never shown: the Diagnoser's reading goes to the
 * Builder, and a reading of a scored fail would carry the task to it.
 *
 * The round decides nothing. `reading` says how the plan's rules read the tallies, and `stopRule`
 * how its three-session rule reads the rounds so far; promotion and a next session are the
 * operator's, behind gate G4.
 */
import { anchor, draw, gain, type Paired, pairsOf, scored, solveSeconds } from "../kernel/compare.ts";
import { conditionsOf } from "../kernel/condition.ts";
import { endingsOf, lastReports, standing } from "../kernel/ladder.ts";
import { append, type LogEvent, read } from "../kernel/log.ts";
import { screen, taskSets, taskStates } from "../kernel/task.ts";
import { asRecord, isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import { keyIfTruthy } from "../meta/optional-key.ts";
import { join } from "../meta/path.ts";
import { asError, errorMessage } from "../meta/runtime-values.ts";
import type { RefereeFinding, Ruling } from "../review/referee.ts";
import { openHarness } from "../solve/harness.ts";
import { type BuildRequest, type Built, build, type Practised } from "./session.ts";

export interface RoundRequest {
  /** The session, as `build` takes it. Its id names the round in the log. */
  readonly session: BuildRequest;
  /** Runs the session: `build`, unless a caller without a command wall stands in for it. */
  readonly builder?: (request: BuildRequest) => Promise<Built>;
  /** The live pool: feasible task versions held or admitted, outside the anchor, screened in this
   *  order until the scored set is full. */
  readonly candidates: readonly string[];
  /** The anchor's task versions, as `anchor.drawn` named them. */
  readonly anchor: readonly string[];
  /** How many scored tasks the round fills: the plan's 24. */
  readonly target: number;
  /** Gate 5: solves of a candidate under each harness, and the fails by one harness that admit it.
   *  The plan's decision 26 is three and two. */
  readonly screening: { readonly solves: number; readonly fails: number };
  /** Counted solves of each scored and anchor task under each harness. */
  readonly solves: number;
  /** The sign test's level for the scored set, and the anchor's level and floor (`compare.ts`). */
  readonly level: number;
  readonly anchorLevel: number;
  readonly anchorFloor: number;
  /** Disputed tasks outside the anchor past which the round stops: the plan's three. */
  readonly defects: number;
  /** Solves in flight at once. */
  readonly concurrency: number;
  /** One solve of a task version under the test condition, with the harness kept in `harness` and
   *  digested as `digest`. The caller builds the condition and records it, names the solve so that
   *  no two share an id, and hands `kill` to the solve. A throw stops the round. */
  readonly solve: (version: string, harness: string, digest: string, kill: AbortSignal) => Promise<Practised>;
  /** The setting `solve` records in each condition (`settingId`): the solver, its limits and the
   *  host. Screening reads the parent's solves the log already holds, and only those made under
   *  this setting are this solver's. */
  readonly setting: string;
  /** The Referee, when the caller has a reader for it. */
  readonly referee?: (solve: string, version: string, kill: AbortSignal) => Promise<RefereeFinding>;
  /** Whether a check-defect ruling disputes its task, or only flags it for a person to read. */
  readonly refereeDecides: boolean;
}

/**
 * How the plan's rules read a round. A step is the scored set's test clearing its level with the
 * anchor held. An anchor too thin to test is named apart, since not tested is not held, and whether
 * a step may rest on it is the operator's. A round that scored no task is named apart for the same
 * reason: it tested nothing, and `no-step` would say a test was made and found no gain. The eight
 * truss rounds of 2026-10-08 scored no task and read `no-step` eight times. `flags-decide` is a
 * reading that differs with and without the tasks an advising Referee flagged: no step is claimed
 * on it and none denied, until the flagged fails are read by hand. `check-defects` is the round
 * stopped on its disputes, and `no-change` a session that left the harness it started from.
 */
export type RoundReading =
  | "step"
  | "no-step"
  | "not-scored"
  | "flags-decide"
  | "anchor-lost"
  | "anchor-not-tested"
  | "check-defects"
  | "no-change";

export interface RoundReport {
  readonly old: string;
  /** The digest of the harness the session left; null when it left none to compare. Beside a
   *  `broken` in the logged report, it is the last state the session practised with. */
  readonly fresh: string | null;
  /** The scored set's tally, test, pooled gain and each harness's mean solve seconds; null when the
   *  round never scored. */
  readonly scored:
    | (ReturnType<typeof scored> & ReturnType<typeof gain> & { seconds: ReturnType<typeof solveSeconds> })
    | null;
  readonly anchor: ReturnType<typeof anchor> | null;
  /** The task versions tallied in the scored set. */
  readonly versions: readonly string[];
  /** Task versions left out: disputed, short of `solves` counted solves, or candidates whose
   *  screening solves did not all end in a pass or a fail. */
  readonly disputed: readonly string[];
  /** Task versions still counted that an advising Referee ruled a check defect on. */
  readonly flagged: readonly string[];
  /** The two tests and their reading with the flagged tasks left out; null when none is flagged. */
  readonly unflagged: {
    readonly scored: ReturnType<typeof scored>;
    readonly anchor: ReturnType<typeof anchor>;
    readonly reading: RoundReading;
  } | null;
  readonly short: readonly string[];
  readonly unscreened: readonly string[];
  /** The reading with every task counted, flagged or not: `reading`, unless the flags decide. */
  readonly counted: RoundReading;
  readonly reading: RoundReading;
  /** What a person's labels settled, in the report `settleReading` writes after the round's own: how many
   *  fails were labelled, how many of them a check defect, and the tasks those disputed. */
  readonly settled: {
    readonly labelled: number;
    readonly defects: number;
    readonly disputed: readonly string[];
  } | null;
}

/** A comparison's fixed terms: the round's window of the log, the two harnesses and the tests'. */
interface Terms {
  readonly log: string;
  readonly id: string;
  readonly old: string;
  readonly fresh: string;
  readonly solves: number;
  readonly level: number;
  readonly anchorLevel: number;
  readonly anchorFloor: number;
}

/** What a person is asked to label before a round's reading is settled. */
export interface ToLabel {
  /** Fails of the round an advising Referee ruled a check defect, on tasks the report counts. */
  readonly flagged: readonly string[];
  /** Every other answer of the round some check refused, on those tasks and the anchor's. */
  readonly others: readonly string[];
}

/** A harness as a solve is handed it. */
interface Kept {
  readonly dir: string;
  readonly digest: string;
}

/** One solve still to run: a task version under one of the two harnesses. */
interface Job {
  readonly task: string;
  readonly under: Kept;
}

/** A task with what each harness has of it so far, whatever the solves are counted as. */
interface Had {
  readonly task: string;
  readonly old: readonly unknown[];
  readonly fresh: readonly unknown[];
}

/** Passes over what is still unscored. A solve's own non-result is run again inside `solve`, so a
 *  second pass covers what outlasted that, and a task still short after it is reported short. */
const PASSES = 2;
/** Tasks in a row the provider wrote nothing for, at which the round stops and waits to be run
 *  again. Tasks and not solves: one task its provider refuses at the first turn is that task's
 *  fault, and is reported short. */
const SILENT = 3;
/** The pooled gain, in points, below which the plan's three-session rule stops the experiment. */
const STOP_POINTS = 10;
const STOP_SESSIONS = 3;
/** The fewest pooled tasks the rule's bound is trusted on: one scored set of the plan's size. */
const STOP_TASKS = 24;
const REPORTED = "comparison.reported";
const BUILD_STARTED = "build.started";
/** A report's fields, as its event carries them beside the round's own. */
const REPORT_KEYS = [
  "old",
  "fresh",
  "scored",
  "anchor",
  "versions",
  "disputed",
  "flagged",
  "unflagged",
  "short",
  "unscreened",
  "counted",
  "reading",
  "settled",
] as const satisfies readonly (keyof RoundReport)[];
const ANCHOR_SCORED = "anchor.scored";
const TASK_STATE = "task.state";
const NOTHING_TO_LABEL: ToLabel = { flagged: [], others: [] };
const DEFECT = "check-defect";
/** The states a task may be disputed from (`src/kernel/task.ts`). */
const DISPUTABLE = ["held", "admitted", "released"];

/**
 * The order a round screens its candidates in: drawn by the contract's hash and the session's id,
 * both fixed before any solve of the round, so that neither harness's fails choose which come
 * first. The log holds both, so the order needs no record of its own: a reader draws it again and
 * sets the tasks that were screened beside it (`tools/wri/read.ts`).
 */
export function screeningOrder(candidates: readonly string[], contract: string, session: string): string[] {
  return draw(candidates, candidates.length, `${contract}:${session}`);
}

/**
 * Why a round will not go on with session `id` from this log, or null when it never started, or
 * ended whole with nothing in its way. A launcher asks before it starts the round, and a stop to
 * say what it cut.
 *
 * A session that ended whole is still refused when it has no report and another Builder session
 * has started since. A round counts the solves made from its session's start to the next
 * session's (`since`), so every solve it made from here on would fall outside its own window. On
 * 2026-10-08 a simulated round killed in its screening and run again after another round had run
 * made 156 solves, counted none of them and reported `not-scored` with 13 tasks short of solves:
 * a reading of where the window ended and of neither harness.
 */
export function spent(events: readonly LogEvent[], id: string): string | null {
  const mine = events.filter(({ data }) => data.session === id);
  const began = events.findIndex(({ kind, data }) => kind === BUILD_STARTED && data.session === id);
  if (began === -1) return null;
  const ended = mine.findLast(({ kind }) => kind === "build.finished")?.data.ended;
  if (ended === undefined) {
    return `session ${id} started and never finished; a round does not run a second session under one id`;
  }
  if (ended === "killed" || ended === "crashed") {
    return `session ${id} ${ended === "killed" ? "was killed" : "crashed"}, so what it froze is not compared; a round under a new session id starts again`;
  }
  const next = events.slice(began).find(({ kind, data }) => kind === BUILD_STARTED && data.session !== id)
    ?.data.session;
  if (!isString(next) || mine.some(({ kind }) => kind === REPORTED)) return null;
  return `session ${id} has no report and session ${next} started after it. A round counts the solves made before the next session starts, so what ${id} solved now would not be counted and its tasks would be reported short; a round under a new session id starts again`;
}

/** What session `id` left, from the log: undefined when it never ran, and otherwise the harness to
 *  compare, null when it left none, with why when what it left does not open. A session whose last
 *  state does not open leaves the last state it practised with, when it has one (`session.ts`), so
 *  a harness and a `broken` may come back together. */
async function left(events: readonly LogEvent[], request: BuildRequest, old: string) {
  const mine = events.filter(({ data }) => data.session === request.id);
  const started = mine.find(({ kind }) => kind === BUILD_STARTED)?.data;
  const finished = mine.findLast(({ kind }) => kind === "build.finished")?.data;
  if (started === undefined) return undefined;
  if (started.parent !== old) {
    throw new Error(`session ${request.id} started from another harness than ${request.parent}`);
  }
  const why = spent(events, request.id);
  if (why !== null) throw new Error(why);
  const broken = isString(finished?.broken) ? finished.broken : null;
  if (finished?.changed !== true || !isString(finished.harness)) return { kept: null, broken };
  const dir = join(request.states, finished.harness);
  if ((await openHarness(dir)).digest !== finished.harness) {
    throw new Error(`${dir} is not the harness session ${request.id} froze`);
  }
  return { kept: { dir, digest: finished.harness }, broken };
}

/**
 * The log as a round counts it: every event, but of the solves only those made in the round's own
 * window, from its session's start to the next session's. Rounds run one after another in a log, so
 * the window is the round: an earlier round's solves under the same old harness are not this
 * round's, and neither are a later round's when this one is read again. A round that would go on
 * past the next session's start is refused before it solves (`spent`).
 *
 * An Examiner session may start inside a window, between a round's stop and its going on, and its
 * solves stay in it. They are of tasks that were not yet feasible when they were made, and a task
 * counts from its admission or the anchor's draw (`pairsOf`), which follow them: screening reads
 * them as the parent's side on record, as it reads any, and no tally counts one.
 */
function since(events: readonly LogEvent[], session: string): LogEvent[] {
  const starts = (index: number, mine: boolean) => {
    const event = events[index];
    return event?.kind === BUILD_STARTED && (event.data.session === session) === mine;
  };
  const began = events.findIndex((_event, index) => starts(index, true));
  const next = events.findIndex((_event, index) => index > began && starts(index, false));
  const until = next === -1 ? events.length : next;
  return events.filter(({ kind }, index) => !kind.startsWith("solve.") || (index >= began && index < until));
}

/**
 * The log as session `id`'s round is read once it has reported: up to its own report, and within
 * its window. What comes after is other sessions': a later round admits the round's tasks again or
 * retires them (`screenPool`), and `tools/d2/prepare.ts` draws into the anchor and releases from
 * the pool before each round. Read with those, a round settled after the next one ran lost every
 * scored task to the later admission, which its own solves all precede: on 2026-10-08 a simulated
 * round whose labels settled it a step at once was settled `not-scored` on the same labels after
 * a later round had carried its seven tasks. A round with no report yet is read whole.
 */
function asReported(events: readonly LogEvent[], id: string): LogEvent[] {
  const own = events.findIndex(({ kind, data }) => kind === REPORTED && data.session === id);
  return since(own === -1 ? events : events.slice(0, own + 1), id);
}

/** The solves still to run, by what each task has: slot by slot over the tasks, the two harnesses
 *  taking the first place in turn. */
function unsolved(tasks: readonly Had[], solves: number, old: Kept, fresh: Kept): Job[] {
  const jobs: Job[] = [];
  for (let slot = 0; slot < solves; slot += 1) {
    for (const [index, task] of tasks.entries()) {
      const sides = [
        { had: task.old.length, under: old },
        { had: task.fresh.length, under: fresh },
      ];
      if ((index + slot) % 2 === 1) sides.reverse();
      jobs.push(...sides.flatMap(({ had, under }) => (had <= slot ? [{ task: task.task, under }] : [])));
    }
  }
  return jobs;
}

/** Each pair cut to its first `solves` solves a side, and the tasks that have fewer. A resumed round
 *  can leave a task one solve over on a side, and a tally needs as many of each. */
function whole(pairs: readonly Paired[], solves: number) {
  const enough = ({ old, fresh }: Paired) => old.length >= solves && fresh.length >= solves;
  const cut = <T>(list: readonly T[] = []) => list.slice(0, solves);
  return {
    pairs: pairs.flatMap((pair) => {
      const { task, old, fresh, seconds } = pair;
      if (!enough(pair)) return [];
      return [
        {
          task,
          old: cut(old),
          fresh: cut(fresh),
          seconds: { old: cut(seconds?.old), fresh: cut(seconds?.fresh) },
        },
      ];
    }),
    short: pairs.flatMap((pair) => (enough(pair) ? [] : [pair.task])),
  };
}

/** How the plan reads the two tests together. */
function readingOf(p: number, level: number, guard: ReturnType<typeof anchor>["reading"]): RoundReading {
  if (p > level) return "no-step";
  if (guard === "lost") return "anchor-lost";
  return guard === "held" ? "step" : "anchor-not-tested";
}

/** The task versions session `id` moved, each with the state it moved it to. */
function movedBy(events: readonly LogEvent[], id: string): Map<string, string> {
  return new Map(
    events.flatMap(({ kind, data }): [string, string][] =>
      kind === TASK_STATE && data.session === id && isString(data.version) && isString(data.state)
        ? [[data.version, data.state]]
        : [],
    ),
  );
}

/** The last report the log holds for session `id`, the round's own or its settling, or null: a
 *  round that reported is finished. A report written before a field existed reads as that field's
 *  absence: counted as it read, and neither flagged nor settled. */
function reported(events: readonly LogEvent[], id: string): RoundReport | null {
  const found = events.findLast((event) => event.kind === REPORTED && event.data.session === id)?.data;
  if (found === undefined) return null;
  const data: JsonObject = { counted: found.reading ?? null, unflagged: null, settled: null, ...found };
  // SAFETY: only `round` and `settleReading` write this event, from the report each returns.
  return Object.fromEntries(REPORT_KEYS.map((key) => [key, data[key]])) as unknown as RoundReport;
}

/** A whole number of at least `least`, which a count read from a command line may not be. */
function counts(value: number, least: number): boolean {
  return Number.isInteger(value) && value >= least;
}

/** Refuse, before a session is spent, a request whose sets could not be screened or scored. */
function refuseUnscorable(request: RoundRequest, old: string): void {
  const { session, screening } = request;
  const versions = [...request.candidates, ...request.anchor];
  const twice = versions.find((version, index) => versions.indexOf(version) !== index);
  if (twice !== undefined) {
    throw new Error(`task ${twice} is listed twice among the tasks to screen and the anchor's`);
  }
  const practised = new Set(session.tasks.map(({ version }) => version));
  const seen = versions.find((version) => practised.has(version));
  if (seen !== undefined) {
    throw new Error(`task ${seen} is a practice task, and a round scores no task its session saw`);
  }
  if (!counts(request.solves, 1) || !counts(request.concurrency, 1) || !counts(request.target, 0)) {
    throw new Error(
      "a round needs whole numbers: at least one solve a harness, one solve at a time, no fewer than no tasks",
    );
  }
  if (
    !counts(screening.fails, 1) ||
    !counts(screening.solves, screening.fails) ||
    !counts(request.defects, 0)
  ) {
    throw new Error(
      "screening needs at least as many solves as the fails that admit, and both whole numbers",
    );
  }
  const levels = [request.level, request.anchorLevel];
  if (!levels.every((level) => level > 0 && level < 1) || !counts(request.anchorFloor, 0)) {
    throw new Error("a sign test's level lies between 0 and 1, and the anchor's floor is a whole number");
  }
  const events = read(session.log);
  // The anchor is the log's as much as the caller's: a task its draw named is never screened,
  // whatever list it arrives in.
  const { states, anchor: drawn } = taskSets(events);
  const mine = movedBy(events, session.id);
  const anchored = request.candidates.find((version) => drawn.has(version));
  if (anchored !== undefined) {
    throw new Error(`task ${anchored} is the anchor's, and an anchor task is never screened`);
  }
  for (const [listed, fit, name] of [
    [request.candidates, ["held", "admitted"], "a task to screen is held or admitted"],
    [request.anchor, ["held"], "an anchor task is held"],
  ] as const) {
    // A disputed task is in no comparison, whoever disputed it, and a task this round already moved
    // is where the round left it when the round is run again.
    const settled = (version: string) => {
      const state = states.get(version) ?? "";
      return fit.some((wanted) => wanted === state) || state === "disputed" || mine.has(version);
    };
    const wrong = listed.find((version) => !settled(version));
    if (wrong !== undefined) {
      throw new Error(`task ${wrong} is ${states.get(wrong) ?? "not proposed"}, and ${name}`);
    }
  }
  // The log is asked what it would refuse of the sets it can already name: an anchor task never
  // drawn. It is asked without its solves, which are other rounds' and may rest on other conditions.
  const bare = events.filter(({ kind }) => !kind.startsWith("solve."));
  pairsOf(bare, request.anchor, old, old);
}

/** Each solve of `events` by the task version its condition names. */
function versionBySolve(events: readonly LogEvent[]): Map<string, string> {
  const conditions = conditionsOf(events);
  return new Map(
    events.flatMap(({ kind, data }): [string, string][] => {
      const version = conditions.get(isString(data.condition) ? data.condition : "")?.task;
      return kind === "solve.started" && isString(data.solve) && version !== undefined
        ? [[data.solve, version]]
        : [];
    }),
  );
}

/** The solves of a round's window the log holds a check-defect ruling for, each with its task
 *  version. */
function flaggedFails(events: readonly LogEvent[]): { solve: string; version: string }[] {
  const versionOf = versionBySolve(events);
  return events.flatMap(({ kind, data }) => {
    const solve = isString(data.solve) ? data.solve : "";
    const version = versionOf.get(solve);
    return kind === "referee.finding" && data.ruling === DEFECT && version !== undefined
      ? [{ solve, version }]
      : [];
  });
}

/**
 * The comparison of a round, read from its window of the log: the scored set's test and the
 * anchor's over `lists`, and how the plan reads them, once with every task counted and, where
 * `flagged` names any of the compared tasks, once more with those left out. It logs the anchor's
 * reading and returns the report's fields a comparison gives. Where the two readings differ the
 * reading is `flags-decide`.
 */
function compared(
  terms: Terms,
  lists: { readonly scored: readonly string[]; readonly anchor: readonly string[] },
  flagged: (among: ReadonlySet<string>) => string[],
) {
  const { log, id, old, fresh, solves } = terms;
  const all = read(log);
  const events = asReported(all, id);
  // A dispute stands whenever it was made: a settling's own come after the round's report.
  const states = taskStates(all);
  const setOf = (listed: readonly string[]) => {
    const disputed = listed.filter((task) => states.get(task) === "disputed");
    const { pairs } = pairsOf(
      events,
      listed.filter((task) => !disputed.includes(task)),
      old,
      fresh,
    );
    return { ...whole(pairs, solves), disputed };
  };
  const test = setOf(lists.scored);
  const guard = setOf(lists.anchor);
  /** The two tests over the tasks `kept` keeps, and how the plan reads them. */
  const readings = (kept: (task: string) => boolean) => {
    const pairs = test.pairs.filter(({ task }) => kept(task));
    const tested = scored(pairs);
    const guarded = anchor(
      guard.pairs.filter(({ task }) => kept(task)),
      terms.anchorLevel,
      terms.anchorFloor,
    );
    const reading: RoundReading =
      pairs.length === 0 ? "not-scored" : readingOf(tested.p, terms.level, guarded.reading);
    return { scored: tested, anchor: guarded, reading };
  };
  const first = readings(() => true);
  append(log, ANCHOR_SCORED, {
    session: id,
    old,
    fresh,
    solves,
    level: terms.anchorLevel,
    floor: terms.anchorFloor,
    ...first.anchor,
    tasks: guard.pairs.length,
    disputed: guard.disputed,
    short: guard.short,
  });
  const marked = flagged(new Set([...test.pairs, ...guard.pairs].map(({ task }) => task)));
  const unflagged = marked.length === 0 ? null : readings((task) => !marked.includes(task));
  const reading: RoundReading =
    unflagged !== null && unflagged.reading !== first.reading ? "flags-decide" : first.reading;
  return {
    scored: { ...first.scored, ...gain(test.pairs), seconds: solveSeconds(test.pairs) },
    anchor: first.anchor,
    versions: test.pairs.map(({ task }) => task),
    flagged: marked,
    unflagged,
    short: [...test.short, ...guard.short],
    counted: first.reading,
    reading,
  };
}

/** What the provider said of a solve it wrote nothing for, or null: no output token in the solve's
 *  last attempt's record. A solve the provider cut after an hour's work holds thousands (the Sol
 *  rounds of 2026-10-08), and is a non-result the round solves on from. */
function unanswered(log: string, { solve, ending }: Practised): string | null {
  if (ending.outcome !== "non-result" || ending.kind !== "provider") return null;
  const record = read(log).findLast(({ kind, data }) => kind === "solve.finished" && data.solve === solve);
  return asRecord(record?.data.tokens)?.output === 0 ? ending.reason : null;
}

/**
 * What runs a round's solves: the jobs' pool, the Referee's part, and the reasons it stops taking
 * jobs. A solve that throws ends the pool and is thrown again by `settle` once every solve in
 * flight has returned.
 */
function floor(request: RoundRequest) {
  const { log, id } = request.session;
  const halt = new AbortController();
  const kill = AbortSignal.any([halt.signal, ...(request.session.kill ? [request.session.kill] : [])]);
  // The anchor is the log's as much as the caller's: a caller that lists only the anchor tasks still
  // held leaves out one this round disputed, which is no less an anchor task for that.
  const anchored = new Set([...request.anchor, ...taskSets(read(log)).anchor]);
  const faults: string[] = [];
  const flagged = new Set<string>();
  let thrown: Error | null = null;
  // The tasks this round disputed, kept beside the log so that a job does not read the whole of it.
  const dropped = new Set(
    movedBy(read(log), id)
      .entries()
      .flatMap(([version, state]) => (state === "disputed" ? [version] : [])),
  );
  /** The disputed tasks the plan's rule counts: those outside the anchor. */
  const defects = () => [...dropped].filter((version) => !anchored.has(version));
  const going = () => thrown === null && !kill.aborted && defects().length <= request.defects;
  const dispute = (version: string, solve: string, reason: string) => {
    if (dropped.has(version) || taskStates(read(log)).get(version) === "disputed") return;
    dropped.add(version);
    append(log, TASK_STATE, { version, state: "disputed", session: id, solve, reason });
  };
  const silent = new Set<string>();
  const run = async ({ task, under }: Job): Promise<void> => {
    if (dropped.has(task)) return;
    const solved = await request.solve(task, under.dir, under.digest, kill);
    const { solve, ending } = solved;
    const why = unanswered(log, solved);
    if (why === null) silent.clear();
    else if (silent.add(task).size >= SILENT) {
      throw new Error(
        `the provider answered no solve of ${String(SILENT)} tasks in a row, so the round stops: ${why}. Run it again and it goes on from its log`,
      );
    }
    if (ending.outcome === "non-result" && ending.kind === "check") {
      dispute(task, solve, "its own check could not run on an answer");
    }
    if (ending.outcome !== "fail" || ending.kind === "broken-harness" || request.referee === undefined) {
      return;
    }
    try {
      const finding = await request.referee(solve, task, kill);
      if (finding.ruling === "check-defect" && request.refereeDecides) {
        dispute(task, solve, `the Referee ruled a check defect: ${finding.check ?? "no check named"}`);
      } else if (finding.ruling === "check-defect") {
        flagged.add(task);
      }
    } catch (error) {
      // An unread fail stands as a fail: the Referee removes a comparison, and its absence removes none.
      faults.push(`${solve}: ${errorMessage(error)}`);
    }
  };
  /** Run `jobs`, `concurrency` at a time, until they are done or the round is no longer going. */
  const drain = async (jobs: Job[]): Promise<void> => {
    const worker = async (): Promise<void> => {
      for (let job = jobs.shift(); job !== undefined && going(); job = jobs.shift()) {
        try {
          await run(job);
        } catch (error) {
          thrown ??= asError(error);
          halt.abort();
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, request.concurrency) }, worker));
  };
  /** Throw what stopped the solves, if a solve or a kill did. */
  const settle = () => {
    if (thrown !== null) throw thrown;
    if (kill.aborted) throw new Error("the round was killed; run it again and it goes on from its log");
  };
  return { drain, going, settle, defects, dropped, faults, flagged };
}

/**
 * Step 2. The pool is screened as many tasks at a time as the scored set still lacks, each under
 * both harnesses, and moved to the state `screen` gives it. The parent's side is the latest solves
 * the whole log holds of the task under that harness, and the child's the round's own. A task the
 * parent's solves on record already stop is admitted with no solve: either harness's fails admit,
 * so nothing the child did could change it. Its admission says `carried` when the round had made
 * no solve of the task at all. One whose screening solves did not all end in a pass or
 * a fail, or which a broken harness would have screened, stays as it was and is returned.
 */
async function screenPool(
  request: RoundRequest,
  work: ReturnType<typeof floor>,
  harnesses: { readonly old: Kept; readonly fresh: Kept },
  admitted: () => string[],
): Promise<string[]> {
  const { log, id } = request.session;
  const { old, fresh } = harnesses;
  const { solves, fails } = request.screening;
  const states = taskStates(read(log));
  const settled = movedBy(read(log), id);
  // A task this round already moved is where the round left it when the round is run again.
  const waiting = request.candidates.filter((version) => {
    const state = states.get(version);
    return (state === "held" || state === "admitted") && !settled.has(version);
  });
  const unscreened: string[] = [];
  const had = (events: readonly LogEvent[], task: string) => ({
    task,
    old: endingsOf(events, task, { harness: old.digest, setting: request.setting }).slice(-solves),
    fresh: endingsOf(since(events, id), task, { harness: fresh.digest, setting: request.setting }).slice(
      0,
      solves,
    ),
  });
  while (work.going()) {
    const batch = waiting.splice(0, Math.max(0, request.target - admitted().length));
    if (batch.length === 0) break;
    const before = read(log);
    // The tasks this round has started a solve of. A run of it that was stopped may have left the
    // parent's fails of a task among its own solves, and that task is admitted on them when the
    // round goes on: with no further solve, and not `carried`, which says a task was admitted on
    // solves made before the round and none of its own. On 2026-10-08 a simulated round killed in
    // its screening and run again marked five of its seven admissions so.
    const begun = new Set(versionBySolve(since(before, id)).values());
    const open: string[] = [];
    for (const version of batch) {
      if (standing(had(before, version).old, request.screening) === "stops") {
        append(log, TASK_STATE, {
          version,
          state: "admitted",
          session: id,
          ...keyIfTruthy("carried", !begun.has(version)),
        });
      } else open.push(version);
    }
    await work.drain(
      unsolved(
        open.map((task) => had(before, task)),
        solves,
        old,
        fresh,
      ),
    );
    if (!work.going()) break;
    const after = read(log);
    const live = open.filter((each) => !work.dropped.has(each));
    let broken = 0;
    for (const version of live) {
      const tests = had(after, version);
      try {
        if (tests.old.length < solves || tests.fresh.length < solves) {
          throw new Error("its screening solves did not all end in a pass or a fail");
        }
        const state = screen([tests.old, tests.fresh], fails);
        append(log, TASK_STATE, { version, state, session: id });
      } catch (error) {
        unscreened.push(version);
        work.faults.push(`${version}: ${errorMessage(error)}`);
        const ended = [...tests.old, ...tests.fresh];
        broken += ended.some((each) => each.outcome === "fail" && each.kind === "broken-harness") ? 1 : 0;
      }
    }
    // A harness that broke on every task of a batch will break on the next batch too, at the other
    // harness's full cost a task: the rest of the pool is left as it was.
    if (live.length > 0 && broken === live.length) break;
  }
  return unscreened;
}

export async function round(request: RoundRequest): Promise<RoundReport> {
  const { session, solves } = request;
  const { log, id } = session;
  // A round that reported is finished, and run again it says what it said: a second pass over a
  // finished comparison, topping up a set a dispute thinned, would be a second look at its data.
  const before = reported(read(log), id);
  if (before !== null) return before;
  const old: Kept = { dir: session.parent, digest: (await openHarness(session.parent)).digest };
  refuseUnscorable(request, old.digest);

  // The session is read from the log whether it ran now or in an earlier run of this round.
  if ((await left(read(log), session, old.digest)) === undefined) await (request.builder ?? build)(session);
  const built = await left(read(log), session, old.digest);
  if (built === undefined) throw new Error(`session ${id} ran and left no record in the log`);
  const work = floor(request);
  /** Write the round's own report and return it. */
  const report = (told: Omit<RoundReport, "old" | "fresh" | "counted" | "settled">): RoundReport => {
    const told_: RoundReport = {
      old: old.digest,
      fresh: built.kept?.digest ?? null,
      counted: told.reading,
      settled: null,
      ...told,
    };
    append(log, REPORTED, {
      session: id,
      // The eight truss rounds of 2026-10-08 asked for no scored task, and their logs could not say so.
      target: request.target,
      solves,
      // Gate 5's rule, which chose the scored set and which nothing else in the log holds.
      screening: request.screening,
      level: request.level,
      broken: built.broken,
      reviewFaults: work.faults,
      // A report is strings, numbers and lists and records of them.
      ...asRecord(told_),
    });
    return told_;
  };
  const nothing = {
    scored: null,
    anchor: null,
    versions: [],
    disputed: [],
    flagged: [],
    unflagged: null,
    short: [],
    unscreened: [],
  };
  if (built.kept === null) return report({ ...nothing, reading: "no-change" });
  const fresh = built.kept;
  const counted = () => since(read(log), id);
  /** The scored set as it stands: what this round's screening admitted, and no other round's. */
  const admitted = () => {
    const events = read(log);
    const states = taskStates(events);
    return [...movedBy(events, id)].flatMap(([version, state]) =>
      state === "admitted" && states.get(version) === "admitted" ? [version] : [],
    );
  };

  const practised = new Set(session.tasks.map(({ version }) => version));
  /** The flagged task versions among those `kept` keeps: those this run of the round flagged, and
   *  those the log holds a ruling for on a solve of the round's window. A round that was stopped and
   *  run again keeps the first run's rulings in its log alone, and a report that listed only the
   *  second run's would count a flagged task as clean. The session's Referee rules on practice fails
   *  in the same window, and a practice task is in no comparison. */
  const flagged = (kept: (version: string) => boolean) =>
    [...new Set([...work.flagged, ...flaggedFails(counted()).map(({ version }) => version)])].filter(kept);

  const unscreened = await screenPool(request, work, { old, fresh }, admitted);
  for (let pass = 0; pass < PASSES && work.going(); pass += 1) {
    const { pairs } = pairsOf(counted(), [...admitted(), ...request.anchor], old.digest, fresh.digest);
    await work.drain(unsolved(pairs, solves, old, fresh));
  }
  work.settle();
  if (!work.going()) {
    return report({
      ...nothing,
      disputed: [...work.dropped],
      flagged: flagged((version) => !practised.has(version) && !work.dropped.has(version)),
      unscreened,
      reading: "check-defects",
    });
  }

  const terms: Terms = {
    log,
    id,
    old: old.digest,
    fresh: fresh.digest,
    solves,
    level: request.level,
    anchorLevel: request.anchorLevel,
    anchorFloor: request.anchorFloor,
  };
  return report({
    ...compared(terms, { scored: admitted(), anchor: request.anchor }, (among) =>
      flagged((version) => among.has(version)),
    ),
    disputed: [...work.dropped],
    unscreened,
  });
}

/** The fails of session `id`'s round a person may label, from its log: none when the round has no
 *  report with a scored set. */
export function toLabel(events: readonly LogEvent[], id: string): ToLabel {
  const report = reported(events, id);
  if (report === null) return NOTHING_TO_LABEL;
  if (report.scored === null) return NOTHING_TO_LABEL;
  const window = asReported(events, id);
  const counted = new Set([...report.versions, ...taskSets(window).anchor]);
  const flagged = new Set(
    flaggedFails(window).flatMap(({ solve, version }) => (report.flagged.includes(version) ? [solve] : [])),
  );
  const version = versionBySolve(window);
  const refused = window.flatMap(({ kind, data }) =>
    kind === "verdict" &&
    data.kind === "fail" &&
    isString(data.solve) &&
    Array.isArray(data.blocking) &&
    data.blocking.length > 0 &&
    counted.has(version.get(data.solve) ?? "")
      ? [data.solve]
      : [],
  );
  return { flagged: [...flagged], others: [...new Set(refused)].filter((solve) => !flagged.has(solve)) };
}

/**
 * Settle a round's reading on a person's labels of its fails, and write its report once more.
 *
 * The plan keeps the hand reading as the gate while the Referee advises, and until now that reading
 * left no record. `labels` holds a ruling a solve. Every flagged fail must carry `earned` or
 * `check-defect`: an `unclear` settles nothing. A fail labelled a check defect disputes its task,
 * which leaves every comparison from then on, as a deciding Referee's ruling would have; a flagged
 * fail labelled earned stands, on a person's word over a reviewer's. The two tests are then read
 * again from the same solves, with no task flagged, and logged as the round's last report with
 * what was settled. Run again it returns that report.
 *
 * The round is read as its own report found it (`asReported`), so the labels settle the same
 * reading whether they come at once or after later rounds have taken the round's tasks on.
 */
export function settleReading(log: string, id: string, labels: ReadonlyMap<string, Ruling>): RoundReport {
  const before = read(log);
  const last = before.findLast((event) => event.kind === REPORTED && event.data.session === id)?.data;
  const report = reported(before, id);
  if (last === undefined || report === null) throw new Error(`session ${id} has no report to settle`);
  if (report.settled !== null) return report;
  if (report.scored === null || report.fresh === null) {
    throw new Error(
      `session ${id} reads ${report.reading} and compared nothing, so there is nothing to settle`,
    );
  }
  const { flagged, others } = toLabel(before, id);
  const known = new Set([...flagged, ...others]);
  const stray = [...labels.keys()].find((solve) => !known.has(solve));
  if (stray !== undefined) throw new Error(`${stray} is no refused answer of session ${id}'s comparison`);
  const open = flagged.filter((solve) => labels.get(solve) !== "earned" && labels.get(solve) !== DEFECT);
  const unruled = report.flagged.length > 0 && flagged.length === 0;
  if (open.length > 0 || unruled) {
    throw new Error(
      unruled
        ? `session ${id} flags ${String(report.flagged.length)} task(s) and its log holds no ruling for them`
        : `${String(open.length)} of ${String(flagged.length)} flagged fails are not labelled earned or check-defect: ${open.join(", ")}`,
    );
  }
  const versionOf = versionBySolve(since(before, id));
  const defects = [...labels].flatMap(([solve, label]) => (label === DEFECT ? [solve] : []));
  const disputed: string[] = [];
  for (const solve of defects) {
    const version = versionOf.get(solve) ?? "";
    const state = taskStates(read(log)).get(version);
    if (state === "disputed" || disputed.includes(version)) continue;
    disputed.push(version);
    // A task a later round retired is in no later comparison as it is, and no state follows the
    // one it ended in: it leaves this comparison on the label alone.
    if (!DISPUTABLE.some((from) => from === state)) continue;
    append(log, TASK_STATE, {
      version,
      state: "disputed",
      session: id,
      solve,
      reason: "a person labelled the fail a check defect",
    });
  }
  const scoredAt = before.findLast(
    (event) => event.kind === ANCHOR_SCORED && event.data.session === id,
  )?.data;
  const numbered = (value: unknown, name: string): number => {
    if (!isNumber(value)) throw new Error(`session ${id}'s records hold no ${name}`);
    return value;
  };
  const terms: Terms = {
    log,
    id,
    old: report.old,
    fresh: report.fresh,
    solves: numbered(last.solves, "count of solves"),
    level: numbered(last.level, "level"),
    anchorLevel: numbered(scoredAt?.level, "anchor level"),
    anchorFloor: numbered(scoredAt?.floor, "anchor floor"),
  };
  const settled: RoundReport = {
    old: report.old,
    fresh: report.fresh,
    // The anchor as the round found it: a later draw's tasks were never this round's to solve.
    ...compared(
      terms,
      {
        scored: report.versions.filter((version) => !disputed.includes(version)),
        anchor: [...taskSets(asReported(before, id)).anchor],
      },
      () => [],
    ),
    disputed: [...new Set([...report.disputed, ...disputed])],
    unscreened: report.unscreened,
    settled: { labelled: labels.size, defects: defects.length, disputed },
  };
  // The round's own terms are carried, so the settled report reads alone as the first one did.
  append(log, REPORTED, { ...last, ...asRecord(settled) });
  return settled;
}

/**
 * The plan's three-session rule over the rounds a log holds: the pooled gain of every scored task
 * of every compared session, and whether the experiment stops on it. It stops when at least three
 * sessions were compared, none read a step, and the gain stays under ten points at 90% confidence
 * over at least one scored set's worth of tasks: on fewer, tasks that all tied would bound the gain
 * at nothing with no evidence to speak of. A session that left no changed harness, or a round an
 * outage left with no scored task, counts among the three with no task to pool, and so is never
 * flat by itself: no tasks is no evidence of a flat gain.
 *
 * Each round is read as its own report found it (`asReported`): from the log up to that report, so
 * a task released, admitted again, retired or gone stale since is still the scored task it was,
 * and within the round's own window of solves. A settled round's tasks are its last report's.
 */
export function stopRule(events: readonly LogEvent[]) {
  const reports = lastReports(events).filter(({ data }) => data.reading !== "check-defects");
  const pairs = reports.flatMap(({ session, index, data }) => {
    const versions = Array.isArray(data.versions) ? data.versions.filter(isString) : [];
    if (!isString(data.old) || !isString(data.fresh) || !isNumber(data.solves)) return [];
    const then = asReported(events.slice(0, index + 1), session);
    return whole(pairsOf(then, versions, data.old, data.fresh).pairs, data.solves).pairs;
  });
  const pooled = gain(pairs);
  const stepped = reports.some(({ data }) => data.reading === "step");
  const flat = pairs.length >= STOP_TASKS && pooled.upper < STOP_POINTS;
  return {
    sessions: reports.length,
    tasks: pairs.length,
    ...pooled,
    stop: reports.length >= STOP_SESSIONS && !stepped && flat,
  };
}
