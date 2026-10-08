/**
 * One round: a Builder session, then the comparison of the harness it left with the one it started
 * from, on tasks it never saw. This is the plan's D2 from its first event to its reading, and until
 * this file its parts had no caller that ran them in order.
 *
 * A round is four steps over one log.
 * 1. The session (`session.ts`): it practises on released tasks and freezes a harness.
 * 2. Screening, the task's gate 5: candidates are solved under both harnesses, and one that either
 *    harness fails often enough is admitted (`screen`). Admission is symmetric and comes after the
 *    session, since it needs the new harness, and before any scoring solve, which counts only from
 *    the admission on. Candidates are taken in the caller's order, as many at a time as the scored
 *    set still lacks, so no more are screened than the set needs.
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
 * flagged, for the person who reads the fails before the reading is read. A check that could not
 * run disputes its task either way. A disputed task is neither admitted nor compared. The Referee
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
 * change, with why.
 *
 * A scored task is never diagnosed and its trace never shown: the Diagnoser's reading goes to the
 * Builder, and a reading of a scored fail would carry the task to it.
 *
 * The round decides nothing. `reading` says how the plan's rules read the tallies, and `stopRule`
 * how its three-session rule reads the rounds so far; promotion and a next session are the
 * operator's, behind gate G4.
 */
import { anchor, gain, type Paired, pairsOf, scored, solveSeconds } from "../kernel/compare.ts";
import { conditionsOf } from "../kernel/condition.ts";
import { append, type LogEvent, read } from "../kernel/log.ts";
import type { Counted } from "../kernel/solve.ts";
import { screen, taskStates } from "../kernel/task.ts";
import { asRecord, isNumber, isString } from "../meta/json-shape.ts";
import { join } from "../meta/path.ts";
import { asError, errorMessage } from "../meta/runtime-values.ts";
import type { RefereeFinding } from "../review/referee.ts";
import { openHarness } from "../solve/harness.ts";
import { type BuildRequest, type Built, build, type Practised } from "./session.ts";

export interface RoundRequest {
  /** The session, as `build` takes it. Its id names the round in the log. */
  readonly session: BuildRequest;
  /** Runs the session: `build`, unless a caller without a command wall stands in for it. */
  readonly builder?: (request: BuildRequest) => Promise<Built>;
  /** Task versions admitted by another route, scored as they stand. */
  readonly scored: readonly string[];
  /** Feasible task versions still held, screened in this order until the scored set is full. */
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
  /** The Referee, when the caller has a reader for it. */
  readonly referee?: (solve: string, version: string, kill: AbortSignal) => Promise<RefereeFinding>;
  /** Whether a check-defect ruling disputes its task, or only flags it for a person to read. */
  readonly refereeDecides: boolean;
}

/**
 * How the plan's rules read a round. A step is the scored set's test clearing its level with the
 * anchor held. An anchor too thin to test is named apart, since not tested is not held, and whether
 * a step may rest on it is the operator's. `check-defects` is the round stopped on its disputes, and
 * `no-change` a session that left the harness it started from.
 */
export type RoundReading =
  | "step"
  | "no-step"
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
  readonly short: readonly string[];
  readonly unscreened: readonly string[];
  readonly reading: RoundReading;
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
/** The pooled gain, in points, below which the plan's three-session rule stops the experiment. */
const STOP_POINTS = 10;
const STOP_SESSIONS = 3;
/** The fewest pooled tasks the rule's bound is trusted on: one scored set of the plan's size. */
const STOP_TASKS = 24;
const REPORTED = "comparison.reported";
/** A report's fields, as its event carries them beside the round's own. */
const REPORT_KEYS = [
  "old",
  "fresh",
  "scored",
  "anchor",
  "versions",
  "disputed",
  "flagged",
  "short",
  "unscreened",
  "reading",
] as const satisfies readonly (keyof RoundReport)[];
/** The kinds of fail a solver owns outright, as `solve.ts` types them. */
const FAILS = ["rejected", "wall-ended", "context-ended", "no-answer"] as const;

/** What session `id` left, from the log: undefined when it never ran, and otherwise the harness to
 *  compare, null when it left none, with why when what it left does not open. A session whose last
 *  state does not open leaves the last state it practised with, when it has one (`session.ts`), so
 *  a harness and a `broken` may come back together. */
async function left(events: readonly LogEvent[], request: BuildRequest, old: string) {
  const mine = events.filter(({ data }) => data.session === request.id);
  const started = mine.find(({ kind }) => kind === "build.started")?.data;
  const finished = mine.findLast(({ kind }) => kind === "build.finished")?.data;
  if (started === undefined) return undefined;
  if (started.parent !== old) {
    throw new Error(`session ${request.id} started from another harness than ${request.parent}`);
  }
  if (finished === undefined) {
    throw new Error(
      `session ${request.id} started and never finished; a round does not run a second session under one id`,
    );
  }
  const { ended } = finished;
  if (ended === "killed" || ended === "crashed") {
    throw new Error(
      `session ${request.id} ${ended === "killed" ? "was killed" : "crashed"}, so what it froze is not compared; a round under a new session id starts again`,
    );
  }
  const broken = isString(finished.broken) ? finished.broken : null;
  if (finished.changed !== true || !isString(finished.harness)) return { kept: null, broken };
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
 * round's, and neither are a later round's when this one is read again.
 */
function since(events: readonly LogEvent[], session: string): LogEvent[] {
  const starts = (index: number, mine: boolean) => {
    const event = events[index];
    return event?.kind === "build.started" && (event.data.session === session) === mine;
  };
  const began = events.findIndex((_event, index) => starts(index, true));
  const next = events.findIndex((_event, index) => index > began && starts(index, false));
  const until = next === -1 ? events.length : next;
  return events.filter(({ kind }, index) => !kind.startsWith("solve.") || (index >= began && index < until));
}

/** A task version's counted test-side solves under one harness, as their endings. */
function endingsOf(events: readonly LogEvent[], version: string, harness: string): Counted[] {
  const conditions = conditionsOf(events);
  const ran = new Set(
    events.flatMap(({ kind, data }) => {
      const condition = conditions.get(isString(data.condition) ? data.condition : "");
      return kind === "solve.started" &&
        isString(data.solve) &&
        condition?.task === version &&
        condition.harness === harness &&
        condition.side === "test"
        ? [data.solve]
        : [];
    }),
  );
  return events.flatMap(({ kind, data }): Counted[] => {
    const ending = asRecord(data.ending);
    if (kind !== "solve.finished" || !isString(data.solve) || !ran.has(data.solve)) return [];
    if (ending?.outcome === "pass") return [{ outcome: "pass" }];
    if (ending?.outcome !== "fail") return [];
    if (ending.kind === "broken-harness") {
      return [
        { outcome: "fail", kind: "broken-harness", reason: isString(ending.reason) ? ending.reason : "" },
      ];
    }
    const failed = FAILS.find((known) => known === ending.kind);
    return failed === undefined ? [] : [{ outcome: "fail", kind: failed }];
  });
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
      kind === "task.state" && data.session === id && isString(data.version) && isString(data.state)
        ? [[data.version, data.state]]
        : [],
    ),
  );
}

/** The report a round already wrote for session `id`, or null: a round that reported is finished. */
function reported(events: readonly LogEvent[], id: string): RoundReport | null {
  const data = events.findLast((event) => event.kind === REPORTED && event.data.session === id)?.data;
  if (data === undefined) return null;
  // SAFETY: only `round` writes this event, from the report it returns.
  return Object.fromEntries(REPORT_KEYS.map((key) => [key, data[key]])) as unknown as RoundReport;
}

/** A whole number of at least `least`, which a count read from a command line may not be. */
function counts(value: number, least: number): boolean {
  return Number.isInteger(value) && value >= least;
}

/** Refuse, before a session is spent, a request whose sets could not be screened or scored. */
function refuseUnscorable(request: RoundRequest, old: string): void {
  const { session, screening } = request;
  const versions = [...request.scored, ...request.candidates, ...request.anchor];
  const twice = versions.find((version, index) => versions.indexOf(version) !== index);
  if (twice !== undefined) {
    throw new Error(`task ${twice} is listed twice among the scored, candidate and anchor tasks`);
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
  const states = taskStates(events);
  const mine = movedBy(events, session.id);
  for (const [listed, state, name] of [
    [request.scored, "admitted", "a scored"],
    [request.candidates, "held", "a candidate"],
    [request.anchor, "held", "an anchor"],
  ] as const) {
    // A disputed task is in no comparison, whoever disputed it, and a task this round already moved
    // is where the round left it when the round is run again.
    const settled = (version: string) =>
      states.get(version) === state || states.get(version) === "disputed" || mine.has(version);
    const wrong = listed.find((version) => !settled(version));
    if (wrong !== undefined) {
      throw new Error(
        `task ${wrong} is ${states.get(wrong) ?? "not proposed"}, and ${name} task is ${state}`,
      );
    }
  }
  // The log is asked what it would refuse of the sets it can already name: an anchor task never
  // drawn. It is asked without its solves, which are other rounds' and may rest on other conditions.
  const bare = events.filter(({ kind }) => !kind.startsWith("solve."));
  pairsOf(bare, [...request.scored, ...request.anchor], old, old);
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
  const anchored = new Set([
    ...request.anchor,
    ...read(log).flatMap(({ kind, data }) =>
      kind === "anchor.drawn" && Array.isArray(data.tasks) ? data.tasks.filter(isString) : [],
    ),
  ]);
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
    append(log, "task.state", { version, state: "disputed", session: id, solve, reason });
  };
  const run = async ({ task, under }: Job): Promise<void> => {
    if (dropped.has(task)) return;
    const { solve, ending } = await request.solve(task, under.dir, under.digest, kill);
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
 * Step 2. Candidates are screened as many at a time as the scored set still lacks, each under both
 * harnesses, and moved to the state `screen` gives them. One whose screening solves did not all end
 * in a pass or a fail, or which a broken harness would have screened, stays held and is returned.
 */
async function screenCandidates(
  request: RoundRequest,
  work: ReturnType<typeof floor>,
  harnesses: { readonly old: Kept; readonly fresh: Kept },
  admitted: () => string[],
): Promise<string[]> {
  const { log, id } = request.session;
  const { old, fresh } = harnesses;
  const { solves, fails } = request.screening;
  const waiting = request.candidates.filter((version) => taskStates(read(log)).get(version) === "held");
  const unscreened: string[] = [];
  const had = (events: readonly LogEvent[], task: string) => ({
    task,
    old: endingsOf(events, task, old.digest).slice(0, solves),
    fresh: endingsOf(events, task, fresh.digest).slice(0, solves),
  });
  while (work.going()) {
    const batch = waiting.splice(0, Math.max(0, request.target - admitted().length));
    if (batch.length === 0) break;
    const before = since(read(log), id);
    await work.drain(
      unsolved(
        batch.map((task) => had(before, task)),
        solves,
        old,
        fresh,
      ),
    );
    if (!work.going()) break;
    const after = since(read(log), id);
    const live = batch.filter((each) => !work.dropped.has(each));
    let broken = 0;
    for (const version of live) {
      const tests = had(after, version);
      try {
        if (tests.old.length < solves || tests.fresh.length < solves) {
          throw new Error("its screening solves did not all end in a pass or a fail");
        }
        const state = screen([tests.old, tests.fresh], fails);
        append(log, "task.state", { version, state, session: id });
      } catch (error) {
        unscreened.push(version);
        work.faults.push(`${version}: ${errorMessage(error)}`);
        const ended = [...tests.old, ...tests.fresh];
        broken += ended.some((each) => each.outcome === "fail" && each.kind === "broken-harness") ? 1 : 0;
      }
    }
    // A harness that broke on every task of a batch will break on the next batch too, at the other
    // harness's full cost a task: the rest of the candidates are left held.
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
  /** Write the round's one report and return it. */
  const report = (told: Omit<RoundReport, "old" | "fresh">): RoundReport => {
    const told_: RoundReport = { old: old.digest, fresh: built.kept?.digest ?? null, ...told };
    append(log, REPORTED, {
      session: id,
      solves,
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
    short: [],
    unscreened: [],
  };
  if (built.kept === null) return report({ ...nothing, reading: "no-change" });
  const fresh = built.kept;
  const counted = () => since(read(log), id);
  /** The scored set as it stands: the caller's, and what this round's screening admitted. */
  const admitted = () => {
    const events = read(log);
    const states = taskStates(events);
    const here = movedBy(events, id)
      .entries()
      .flatMap(([version, state]) => (state === "admitted" ? [version] : []));
    return [...new Set([...request.scored, ...here])].filter((version) => states.get(version) === "admitted");
  };

  const unscreened = await screenCandidates(request, work, { old, fresh }, admitted);
  for (let pass = 0; pass < PASSES && work.going(); pass += 1) {
    const { pairs } = pairsOf(counted(), [...admitted(), ...request.anchor], old.digest, fresh.digest);
    await work.drain(unsolved(pairs, solves, old, fresh));
  }
  work.settle();
  if (!work.going()) {
    return report({
      ...nothing,
      disputed: [...work.dropped],
      flagged: [...work.flagged],
      unscreened,
      reading: "check-defects",
    });
  }

  const events = counted();
  const setOf = (listed: readonly string[]) => {
    const { pairs, disputed } = pairsOf(events, listed, old.digest, fresh.digest);
    return { ...whole(pairs, solves), disputed };
  };
  const test = setOf(admitted());
  const guard = setOf(request.anchor);
  const tested = { ...scored(test.pairs), ...gain(test.pairs), seconds: solveSeconds(test.pairs) };
  const guarded = anchor(guard.pairs, request.anchorLevel, request.anchorFloor);
  append(log, "anchor.scored", {
    session: id,
    old: old.digest,
    fresh: fresh.digest,
    solves,
    level: request.anchorLevel,
    floor: request.anchorFloor,
    ...guarded,
    tasks: guard.pairs.length,
    disputed: guard.disputed,
    short: guard.short,
  });
  return report({
    scored: tested,
    anchor: guarded,
    versions: test.pairs.map(({ task }) => task),
    disputed: [...work.dropped],
    flagged: [...work.flagged].filter((version) => !work.dropped.has(version)),
    short: [...test.short, ...guard.short],
    unscreened,
    reading: readingOf(tested.p, request.level, guarded.reading),
  });
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
 * Each round is read as its report found it: from the log up to that report, so a task released or
 * gone stale since is still the scored task it was, and within the round's own window of solves.
 */
export function stopRule(events: readonly LogEvent[]) {
  const last = new Map<string, number>();
  for (const [index, { kind, data }] of events.entries()) {
    if (kind === REPORTED && isString(data.session)) last.set(data.session, index);
  }
  const reports = [...last.entries()].flatMap(([session, index]) => {
    const data = events[index]?.data;
    return data === undefined || data.reading === "check-defects" ? [] : [{ session, index, data }];
  });
  const pairs = reports.flatMap(({ session, index, data }) => {
    const versions = Array.isArray(data.versions) ? data.versions.filter(isString) : [];
    if (!isString(data.old) || !isString(data.fresh) || !isNumber(data.solves)) return [];
    const then = since(events.slice(0, index + 1), session);
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
