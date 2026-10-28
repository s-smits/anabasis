/**
 * One Builder session: the agent that changes a Built Harness, and the host around it.
 * Continuations share finish's counted practice evidence for the current exact digest, including
 * states restored after a different harness snapshot was frozen.
 *
 * The plan's D2 is "one Builder session scored on tasks it never saw". A session is given a copy of
 * the harness it starts from, a walled shell over that copy, practice solves on released tasks,
 * and the Referee's ruling of what fails there. It ends by freezing what the copy holds as a
 * harness version. In the campaign command, the same agent also calls campaign tools without
 * ending its conversation; the host supplies advice from `decide.ts` and checks each move.
 * Whether the new harness is better is the comparison's to say
 * (`src/kernel/compare.ts`), on tasks this session never saw.
 *
 * What v1's Builder (harness-builder-v4 at 7af7315) did and this one does not: write tasks and
 * checks, set its solver's limits, and submit a candidate through checks. The Examiner writes
 * tasks, the checks are fixed, the host owns every limit, and a harness is judged by a comparison
 * rather than refused at submission.
 *
 * The walls, each with the test that holds it:
 * - Practice is on released tasks only. The task fold says which those are, at the session's start
 *   and again at every practice, so a held-out task is refused by its state and not by the caller's
 *   care.
 * - The Builder's shell is the solver's command wall (`build`), so the repository, the operator's
 *   home and other solves' scratch are closed by the operating system.
 * - The installed programs are the session's own copy of the parent's, and nothing it installs
 *   reaches the parent. A harness in which a link or a script names the home is not frozen
 *   (`tools.ts`), since it runs from elsewhere.
 * - What the Builder reads of a solve is the paged trace (`src/kernel/trace.ts`) and an ending's
 *   outcome and kind. A verdict's checks and the Referee's reasons never reach a tool result.
 * - The log records what the session saw: `build.started` lists the practice task versions, and
 *   every practice solve runs under a recorded condition, so "never saw" can be checked afterwards.
 *
 * The session's own turns and calls are logged as `build.turn` and `build.call`. What catches a
 * Builder that went wrong is a reader of that record, and the model's own transcript is deleted
 * with the session's scratch.
 *
 * The session ends at `finish`, at its deadline, session turn limit or dollar cap, or when a
 * practice solve could not be run. A solve's prompt limit counts prompts, as v1's did; the session
 * turn limit counts model turns, since a Builder that keeps calling tools would otherwise have
 * only its deadline. The deadline, kill and halt reach a practice solve in flight, so the session
 * ends when they fall rather than a solve's whole time limit later. A solve still waiting in the
 * solve queue leaves on them unstarted, which is
 * the session's end and no host fault. A practice solve that throws anything else is the verifier
 * failing to decide, which stops a run: the session writes its record, freezes what it has, and
 * throws it again.
 */
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import {
  type Api,
  type AssistantMessage,
  type Model,
  type Models,
  type ThinkingLevel,
} from "@earendil-works/pi-ai";
import { conditionsOf, type Limits } from "../kernel/condition.ts";
import type { Contract } from "../kernel/contract.ts";
import { append, type LogEvent, read } from "../kernel/log.ts";
import { priceKey } from "../kernel/meter.ts";
import type { Ending } from "../kernel/solve.ts";
import { type Cap } from "../kernel/reports.ts";
import { billedParts, ownedBy } from "../kernel/trace.ts";
import { ended as endedSolves, practiceRan, solvesIn } from "../kernel/solves.ts";
import { taskStates } from "../kernel/task.ts";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "../meta/filesystem.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { isString } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { basename, dirname, join } from "../meta/path.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import type { RefereeFinding } from "../referee/referee.ts";
import { type CommandWall, networkReach, type SolveDirs, solveDirs, walledBase } from "../tools/command.ts";
import type { PublicResource } from "../tools/answer.ts";
import { walledEnv } from "../tools/env.ts";
import { openHarness } from "../harness/open.ts";
import { type PublicTask, publicView } from "../solver/prompt.ts";
import { HARNESS_ACCOUNT } from "../harness/starter.ts";
import { type SolveRequest, solve } from "../solver/run.ts";
import { type Sat, type SeatTool, sit } from "../agent/session.ts";
import { claimRoot } from "../wall/seat-root.ts";
import { campaignOf } from "../campaign/handover.ts";
import { copyHarness, seedKept } from "./kept.ts";
import { builderMemoryBlock, keepMemory, lastKept, memoryOverCapNotice, seedMemory } from "./memory.ts";
import { comparisonsTold, failsTold, startTold } from "./past.ts";
import {
  continuation,
  firstMessage,
  SAID,
  type Solver,
  systemPrompt,
  type Used,
  usedLine,
} from "./prompt.ts";
import {
  type Bench,
  endingWith,
  finishTool,
  harnessNow,
  hasPractice,
  HOME_TOOL_TREE,
  openingTool,
  practiceLeft,
  practiceTool,
  record,
  type HarnessSnapshot,
  snapshot,
  traceTool,
  walledTools,
} from "./tools.ts";

/** The event a session starts with, which names its parent and what it practises on. */
const BUILD_STARTED = "build.started";

/** A released task the Builder may practise on: its version, and what a solver is shown of it. */
export interface PracticeTask {
  readonly version: string;
  readonly task: PublicTask;
}

/** One practice solve: the id its events carry in the log, and how it ended. */
export interface Practised {
  readonly solve: string;
  readonly ending: Ending;
}

/** The host's limits on a session: its deadline, session turn limit, shell limits and practice solves.
 *  `turns` caps the model's turns, where a solve's caps its
 *  prompts. `concurrency` is how many practice solves run at once. */
interface BuildLimits extends Limits {
  readonly practiceSolves: number;
}

interface BuildClock {
  readonly began: number;
  readonly signal: AbortSignal;
  readonly seconds: () => number;
  readonly arm: () => void;
  readonly close: () => void;
}

export interface BuildRequest {
  /** Names the session in the log. */
  readonly id: string;
  /** The harness state the session starts from, v1's format (`src/harness/open.ts`). */
  readonly parent: string;
  /** The reference harness's kept state: what the harness the session leaves is compared with,
   *  and what a practice solve may run under on request. */
  readonly reference: string;
  /** Where a frozen harness is kept, under its digest. The caller's, outside every wall. */
  readonly states: string;
  /** Where the campaign keeps each session's notes, a folder a session (`memory.ts`). The
   *  caller's, outside every wall. */
  readonly memory: string;
  /** Released tasks, and nothing else. */
  readonly tasks: readonly PracticeTask[];
  readonly contract: Contract;
  /** The public resources each solve's home holds, which the session's home holds as one file. */
  readonly resources: readonly PublicResource[];
  readonly model: Model<Api>;
  readonly effort: ThinkingLevel;
  readonly limits: BuildLimits;
  /** What a practice solve is held to, which `preview_harness` shows a solver being told. The
   *  session's own deadline, session turn limit and command limits are `limits`. */
  readonly solve: Limits;
  /** Who solves with the harness, in practice and in every comparison: the campaign's setting, as a
   *  condition names the model. The opening tells it, since a guide that serves one solver well can
   *  leave another short (`firstMessage`). */
  readonly solver: Solver;
  /** The backends, built on the home the Builder's model process keeps its state in. */
  readonly models: (home: string, shutdown: AbortSignal) => Models;
  readonly log: string;
  /** The repository, closed to every command, and its other worktrees and the stored pack, closed
   *  with it (`Walled`). */
  readonly repoRoot: string;
  readonly otherTrees?: readonly string[] | undefined;
  readonly packRoots?: readonly string[] | undefined;
  /** One solve of a released task under the test condition, with the harness frozen in `harness`
   *  and digested as `digest`. The caller builds the condition and records it (`recordCondition`),
   *  and hands `kill` to the solve, which the session aborts when it ends. A throw ends the session. */
  readonly practise: (
    task: PracticeTask,
    harness: string,
    digest: string,
    kill: AbortSignal,
  ) => Promise<Practised>;
  /** The Referee, when the caller has a reader for it. `kill` is for its reader. */
  readonly referee?:
    | ((solve: string, task: PracticeTask, kill: AbortSignal) => Promise<RefereeFinding>)
    | undefined;
  /** The dollar cap the session's spend is held to, where its solves are paid for: a round's own,
   *  or the session's where it runs with no comparison after it. No practice solve starts that a
   *  reserve for it would take past the cap (`practiceTool`), and no request of the Builder's own
   *  once what the session billed has reached it (`before`). */
  readonly cap?: Cap | undefined;
  /** Aborts when the run is killed. */
  readonly kill?: AbortSignal;
  /** Campaign tools and advice, supplied by the host. The Builder remains the only build-side agent. */
  readonly campaign?: (bench: Bench) => {
    readonly tools: SeatTool[];
    readonly hook: () => string;
    /** Halts the conversation where the campaign has ended, as `hook` does, and renders nothing:
     *  before each model request, where a status would be discarded (plan item 6.4, 14 October). */
    readonly halts?: () => void;
    /** Settles once no action of the campaign's runs: an Examiner session writing beside the
     *  conversation ends on record before the conversation does, however the conversation ended. */
    readonly closing?: () => Promise<void>;
    /** A move the host makes as the conversation opens, and what it said of it, which the opening
     *  message carries, or nothing: the campaign's first Examiner session (14 October). */
    readonly start?: () => Promise<string>;
    /** What `finish` tells the Builder where no comparison has read harness `digest` against the
     *  reference, or null (`finishNotice`, `tools.ts`). */
    readonly unmeasured?: (digest: string) => Promise<string | null>;
  };
}

export interface Built {
  /** The digest of what the session left, or of the last state it practised with when what it
   *  left does not open; null when it has neither. */
  readonly harness: string | null;
  /** Where the frozen harness is kept; null when nothing changed or nothing opens. */
  readonly dir: string | null;
  readonly changed: boolean;
  /** How the session ended: by `finish`, at a limit, or otherwise. A session a practice solve
   *  halted is logged as crashed and returns nothing: it throws. */
  readonly ended: "finished" | "wall" | "turns" | "killed" | "crashed" | "stopped";
}

/** A practice solve by the runner, with the id of the attempt that ended it: the id its trace and its
 *  verdict carry in the log, which the reviewers and `read_trace` are asked for. */
export async function practised(request: SolveRequest): Promise<Practised> {
  const ending = await solve(request);
  const events = read(request.log);
  const last = endedSolves(solvesIn(events).filter(({ id }) => id.startsWith(`${request.id}-`))).at(-1);
  // The condition says which harness the solve ran, and the solve says which it opened. A harness
  // whose digest moved with where it sat once made the two differ, and a comparison counted by the
  // first would have scored solves of the second.
  const named = conditionsOf(events).get(request.condition)?.harness;
  const opened = last?.end.harness;
  if (named !== undefined && isString(opened) && opened !== named) {
    throw new Error(`solve ${last?.id ?? ""} opened harness ${opened} under a condition that names ${named}`);
  }
  return { solve: last?.id ?? request.id, ending };
}

/** How a session may end, the first that holds winning: `finish` over a limit that fell in the same turn. */
const ENDINGS = ["finished", "killed", "wall", "crashed", "turns"] as const;

function endedBy(by: Record<(typeof ENDINGS)[number], boolean>): Built["ended"] {
  return ENDINGS.find((reason) => by[reason]) ?? "stopped";
}

/** Keep the state an interrupted session's own practice solve last ran on as a harness snapshot, once,
 *  where it changed the parent and its saved state opens. A cut harness is passed over
 *  (`latestBuilt`) as one left half way through an edit, but a practised state is no half-edit: on
 *  13 October buffer-149's b-1 crashed with a harness it had practised three of three on, and b-2
 *  rebuilt it from b-1's notes for 25 turns. Until 20 October only a crash kept it, and a session a
 *  stop cut was ended as killed with nothing kept: esp32-r2's and recode's b-2 began from the
 *  starter (whole-run investigations of 20 October). */
export async function keepPractised(log: string, id: string, states: string): Promise<void> {
  const events = read(log);
  const mine = events.filter(ownedBy(events, id));
  // Practice under the parent or reference is not this session's edit (`under`, `tools.ts`): every session's
  // parent and every harness promoted stand before this session's own. One that ran before the
  // session's last harness snapshot ran a harness that snapshot already keeps or supersedes.
  const earlierHarnesses = new Set(
    events.flatMap(({ kind, data }) =>
      kind === BUILD_STARTED ? [data.parent] : kind === "harness.promoted" ? [data.harness] : [],
    ),
  );
  const since = mine.findLastIndex(({ kind }) => kind === "build.checkpoint");
  const harness = practiceRan(mine).findLast(
    ({ started, under }) => started > since && !earlierHarnesses.has(under.harness),
  )?.under.harness;
  if (harness === undefined) return;
  if (mine.some(({ kind, data }) => kind === "build.checkpoint" && data.harness === harness)) return;
  try {
    if ((await openHarness(join(states, harness))).digest !== harness) return;
  } catch {
    return;
  }
  append(log, "build.checkpoint", { session: id, harness });
}

/** Keep the notes of session `id`, cut by a stop or a lost process, from its home while the home
 *  stands, as its own end would have (`keepMemory`). Until 27 October only a session that ended
 *  itself kept them: a stop released the home with the notes in it, and PR377-m1-air's b-2 opened
 *  on the starter's (lane 33 of the investigation of 27 October). */
export function keepCutNotes(log: string, id: string): void {
  const { home } = sessionDirs(log, id);
  if (existsSync(home)) keepMemory(home, join(dirname(log), "memory"), id);
}

/** The released tasks' public parts as `practice/<task>.json` of a Builder's home, laid afresh. A
 *  session lays them as it opens and a campaign again after a release, so a link a Builder left
 *  there is removed, never written through. */
export function layPractice(home: string, tasks: readonly PracticeTask[]): void {
  const folder = join(home, "practice");
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  for (const { task } of tasks) {
    writeFileSync(
      join(folder, `${task.taskId.replace(/[^A-Za-z0-9._-]+/g, "-")}.json`),
      `${capturedJsonStringify(publicView(task), null, 2)}\n`,
    );
  }
}

/**
 * The session over a home and a host-only folder that already exist. `walled` supplies the tools
 * that need the command wall, so that everything else here runs, and is tested, without one.
 */
export async function session(
  request: BuildRequest,
  dirs: Pick<SolveDirs, "home" | "host">,
  walled: (bench: Bench) => SeatTool[],
  env?: ExecutionEnv,
): Promise<Built> {
  const { log, limits, model } = request;
  const began = performance.now();
  const parent = await openHarness(request.parent);
  const before = read(log);
  if (before.some(({ kind, data }) => kind === BUILD_STARTED && data.session === request.id)) {
    throw new Error(`session ${request.id} is in the log already; a session's id names one session`);
  }
  const states = taskStates(before);
  const exam = request.tasks.find(({ version }) => states.get(version) !== "released");
  if (exam !== undefined) {
    throw new Error(
      `task ${exam.task.taskId} is ${states.get(exam.version) ?? "not proposed"}, and a Builder practises on released tasks only`,
    );
  }
  copyHarness(request.parent, join(dirs.home, "harness"));
  layPractice(dirs.home, request.tasks);
  writeFileSync(join(dirs.home, "resources.json"), `${capturedJsonStringify(request.resources, null, 2)}\n`);
  // The account of a harness's files is this host's, whichever harness the session forks.
  writeFileSync(join(dirs.home, "HARNESS.md"), HARNESS_ACCOUNT);
  // The Builder's own notes: what the last session to leave any left, and v1's starters otherwise.
  const earlier = before.flatMap(({ kind, data }) =>
    kind === BUILD_STARTED && isString(data.session) ? [data.session] : [],
  );
  seedMemory(dirs.home, request.memory, lastKept(request.memory, earlier));
  seedKept(dirs.home, request.states, before, parent.digest);
  append(log, BUILD_STARTED, {
    session: request.id,
    parent: parent.digest,
    tasks: request.tasks.map(({ version }) => version),
    model: priceKey(model),
    effort: request.effort,
    limits: { ...limits },
  });
  const deadline = new AbortController();
  // The deadline counts the Builder's own time: its clock stops while a campaign action runs, which is
  // the host's time (`Bench.within`), and `aside` is what the actions took.
  let aside = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ownSeconds = () => (performance.now() - began - aside) / 1000;
  // One timer at a time: until 14 October the opening's `within` armed one that the session's own
  // arming overwrote, and it cut main0_5_1's Builder four hours on, a comparison in flight.
  let closed = false;
  const arm = () => {
    clearTimeout(timer);
    if (closed) return;
    timer = setTimeout(() => deadline.abort(), (limits.wallSeconds - ownSeconds()) * 1000);
  };
  const bench: Bench = {
    request,
    said: SAID[request.campaign === undefined ? "host" : "builder"],
    tasks: request.tasks,
    reference: request.reference,
    home: dirs.home,
    parent: parent.digest,
    tree: null,
    opened: null,
    told: new Set(),
    spent: 0,
    disputed: new Set(),
    faulty: new Set(),
    faults: [],
    lists: null,
    halt: new AbortController(),
    fatal: null,
    note: null,
    within: async (action) => {
      clearTimeout(timer);
      const since = performance.now();
      try {
        return await action();
      } finally {
        aside += performance.now() - since;
        arm();
      }
    },
  };
  return await converse(
    bench,
    dirs.host,
    {
      began,
      signal: deadline.signal,
      seconds: ownSeconds,
      arm,
      close: () => {
        closed = true;
        clearTimeout(timer);
      },
    },
    walled,
    env,
  );
}

/** Rebuilt from public facts, including tasks released while the conversation stays open. */
function openingFor(bench: Bench): string {
  const { request } = bench;
  const recorded = read(request.log);
  const campaign = campaignOf(recorded);
  return firstMessage(
    request.contract,
    bench.tasks.map(({ version, task }) => ({
      taskId: task.taskId,
      family: task.family,
      ...record(recorded, version, bench.parent),
    })),
    // The count it opens with is the one `practice` holds it to (`practiceLeft`).
    {
      ...request.limits,
      practiceSolves: practiceLeft(bench, recorded),
      solver: request.solver,
      solve: request.solve,
    },
    {
      start: startTold(campaign, bench.parent, request.id),
      fails: failsTold(
        campaign.fails,
        new Map(bench.tasks.map(({ version, task }) => [version, task.taskId])),
      ),
      comparisons: comparisonsTold(campaign.steps),
      memory: builderMemoryBlock(bench.home),
    },
  );
}

/** The live conversation; its clock pauses while a campaign action owns the host. */
async function converse(
  bench: Bench,
  host: string,
  clock: BuildClock,
  walled: (bench: Bench) => SeatTool[],
  env: ExecutionEnv | undefined,
): Promise<Built> {
  const { request } = bench;
  const { log, limits, model } = request;
  const opening = () => openingFor(bench);
  const campaign = request.campaign?.(bench);
  const first = opening();
  const turns: AssistantMessage[] = [];
  // What the session has used of its limits, as every turn's tool results and every continuation
  // say it. A session under a cap reads what its practice solves billed from the log. Every
  // session counts a turn before its tools run, so while they run its count holds the turn they
  // belong to. `usedLine` adds one to the completed-turn count it is given.
  const used = (during = false): Used => ({
    turns: turns.length - (during ? 1 : 0),
    seconds: clock.seconds(),
    practiceLeft: practiceLeft(bench, request.cap === undefined && campaign === undefined ? [] : read(log)),
    practised: bench.opened?.harness.digest ?? null,
  });
  // The line goes under the first result of each turn, once a turn: until 14 October a turn of six
  // calls read it six times, and then the last call carried it, which a call pi refuses before it
  // runs (a tool the session lacks, arguments its schema refuses) never reaches, so such a turn
  // read nothing of its limits. A result is a result whichever call made it.
  let told = false;
  const footer = () => {
    if (told) return "";
    told = true;
    return usedLine(used(true), limits);
  };
  const tools = [
    ...walled(bench),
    practiceTool(bench),
    traceTool(bench),
    openingTool(campaign === undefined ? first : opening, bench.said.opening),
    finishTool(bench, campaign?.unmeasured),
    ...(campaign?.tools ?? []),
  ].map((each) => endingWith(each, footer));
  const halted = () => {
    campaign?.halts?.();
    if (
      campaign === undefined &&
      request.cap !== undefined &&
      billedParts(read(log), request.id).session >= request.cap.dollars
    ) {
      bench.halt.abort();
    }
    if (bench.halt.signal.aborted) throw new Error("The session has ended at a bound.");
  };
  const started = (await campaign?.start?.()) ?? "";
  clock.arm();
  const sat = await sit({
    models: request.models,
    home: join(host, "model"),
    id: request.id,
    model,
    effort: request.effort,
    system: systemPrompt(bench.said),
    opening: [first, started, campaign?.hook() ?? ""].filter((part) => part !== "").join("\n\n"),
    tools,
    ...keyIfDefined("env", env),
    trace: { log, of: "build" },
    // A led session's bounds are the campaign's, asked of the table (`halts`), and a session the
    // host ran is held to its dollar cap, before a request and again after a compaction, which
    // bills too. Until 19 October the cap held practice alone: a session the host ran opened on
    // what was left of a campaign's total and could bill turns past it until its finish, its
    // session turn limit or its deadline, as two reviews of the host-led loop found (#202, closed). A led
    // session's cap is what was left when it opened, and the operator's word can raise the
    // total after: the table's reading of the budget is the one that holds it, as `practiceLeft`
    // already has it.
    before: halted,
    turns,
    most: limits.turns,
    // A finish or a host fault ends after the round, even beside another call in that round.
    over: () => bench.note !== null || bench.fatal !== null,
    // v1's continuation carried the same notice: a file over its limit is cut on the next read.
    next: async () => {
      if (bench.note !== null) return null;
      const harness = await harnessNow(bench);
      const practice = isString(harness) && hasPractice(bench, read(log), harness) ? "counted" : "uncounted";
      return [
        continuation(used(), limits, harness, bench.said, practice),
        memoryOverCapNotice(bench.home) ?? "",
        campaign?.hook() ?? "",
      ]
        .filter((part) => part !== "")
        .join("\n\n");
    },
    onTurn: () => {
      told = false;
    },
    stops: [clock.signal, bench.halt.signal, request.kill],
  });
  clock.close();
  await campaign?.closing?.();
  return await finishSession(bench, sat, clock, turns.length);
}

/** Freeze and record whatever the bounded session left, including its last usable practice state. */
async function finishSession(bench: Bench, sat: Sat, clock: BuildClock, turns: number): Promise<Built> {
  const { request } = bench;
  const { log, limits } = request;
  const crash = (sat.cut ? null : sat.thrown) ?? bench.fatal?.message ?? sat.crash;
  // Whatever ended the session, what `harness/` holds is frozen: a session cut at its deadline still
  // made its edits, and the comparison is what says whether they count.
  //
  // Where what it holds does not open, the session is not lost with it: the last state it
  // practised with is what is measured, and `broken` says why the final one was not. That a harness
  // opens is all that is left of v1's submission check, and there a round that ended refused measured
  // nothing: 13 firmware rounds, 3,803 minutes, by v1 #113's count. A session cut at its deadline half way
  // through an edit ends so, and the state before it was one real solves ran on. A session that
  // never practised has no such state, and leaves none.
  let frozen: HarnessSnapshot | null;
  let broken: string | null = null;
  try {
    frozen = await snapshot(bench);
  } catch (error) {
    broken = errorMessage(error);
    frozen = bench.opened;
  }
  const changed = frozen !== null && frozen.harness.digest !== bench.parent;
  if (frozen !== null && changed) {
    append(log, "harness.version", {
      version: frozen.harness.digest,
      parent: bench.parent,
      session: request.id,
      note: bench.note,
    });
  }
  const ended =
    bench.fatal === null
      ? endedBy({
          finished: bench.note !== null,
          killed: request.kill?.aborted === true,
          wall: clock.signal.aborted,
          crashed: crash !== null,
          turns: turns >= limits.turns,
        })
      : "crashed";
  if (ended === "crashed" || ended === "killed") await keepPractised(log, request.id, request.states);
  // Kept before the session is recorded as ended, so a session on record as ended has its notes.
  keepMemory(bench.home, request.memory, request.id);
  append(log, "build.finished", {
    session: request.id,
    ended,
    harness: frozen?.harness.digest ?? null,
    changed,
    broken,
    crash,
    ...sat.spent,
    practiceSolves: bench.spent,
    disputed: [...bench.disputed],
    faultyChecks: [...bench.faulty],
    reviewFaults: bench.faults,
    seconds: (performance.now() - clock.began) / 1000,
  });
  if (bench.fatal !== null) throw bench.fatal;
  return {
    harness: frozen?.harness.digest ?? null,
    dir: changed ? (frozen?.dir ?? null) : null,
    changed,
    ended,
  };
}

/**
 * Why no command will go on with session `id` from this log, or null when it never started, or
 * ended whole. A command asks before it starts the session, and a stop to say what it cut. One
 * that started and never finished is refused, since its harness is gone and a second session under
 * one id would be a second try. So is one that was killed or that crashed: what it froze is half a
 * session's work.
 */
export function spent(events: readonly LogEvent[], id: string): string | null {
  const mine = events.filter(({ data }) => data.session === id);
  if (!mine.some(({ kind }) => kind === BUILD_STARTED)) return null;
  const ended = mine.findLast(({ kind }) => kind === "build.finished")?.data.ended;
  if (ended === undefined) {
    return `session ${id} started and never finished; a round does not run a second session under one id`;
  }
  return ended === "killed" || ended === "crashed"
    ? `session ${id} ${ended === "killed" ? "was killed" : "crashed"}, so what it froze is not compared; a round under a new session id starts again`
    : null;
}

/** What session `id` left, from the log: undefined when it never ran, and otherwise the harness to
 *  compare, null when it left none, with why when what it left does not open. A session whose last
 *  state does not open leaves the last state it practised with, when it has one, so a harness and
 *  a `broken` may come back together. */
async function left(events: readonly LogEvent[], request: BuildRequest, parent: string) {
  const mine = events.filter(({ data }) => data.session === request.id);
  const started = mine.find(({ kind }) => kind === BUILD_STARTED)?.data;
  const finished = mine.findLast(({ kind }) => kind === "build.finished")?.data;
  if (started === undefined) return undefined;
  if (started.parent !== parent) {
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
 * Run session `request.id` once, and say what it left. A session the log already holds is not run
 * again: it is read from the log, whether it ran now or in an earlier run of the command, and one
 * that did not end whole is refused (`spent`). It is the session of a round, which then compares
 * what it left, and the whole of a session run with no comparison after it: the plan measures
 * several sessions together in one standalone comparison (`7f0add79:docs/plan.md`, Phase 5).
 */
export async function sessionOnce(
  request: BuildRequest,
  builder?: (request: BuildRequest) => Promise<Built>,
) {
  const parent = (await openHarness(request.parent)).digest;
  if ((await left(read(request.log), request, parent)) === undefined) await (builder ?? build)(request);
  const built = await left(read(request.log), request, parent);
  if (built === undefined) throw new Error(`session ${request.id} ran and left no record in the log`);
  return built;
}

/** The directories of session `id` of the campaign whose log is `log`, named for both. Named for
 *  the id alone, a session stopped on one campaign refused its id to every campaign on the host:
 *  its root stayed, and the claim on a root is how a second session under one id is refused. */
export const sessionDirs = (log: string, id: string): SolveDirs =>
  solveDirs(`build-${basename(dirname(log))}-${id}`);

/** One session under the solver's command wall: claim its root, run, tear down. The Builder's
 *  home is in its root, as a solve's is, so its edits last between commands and are closed to
 *  every other solve. */
export async function build(request: BuildRequest): Promise<Built> {
  const dirs = sessionDirs(request.log, request.id);
  // Before the try: a claim refused because another round's session holds this id cleans up nothing.
  const release = claimRoot(dirs.root);
  try {
    const wall: CommandWall = {
      base: await walledBase(
        dirs,
        { repoRoot: request.repoRoot, otherTrees: request.otherTrees, packRoots: request.packRoots },
        "a Builder",
      ),
      dirs,
      toolTree: join(dirs.home, HOME_TOOL_TREE),
      limits: request.limits,
    };
    const network = await networkReach(wall);
    return await session(request, dirs, (bench) => walledTools(bench, wall, network), walledEnv(wall));
  } finally {
    await release();
    rmSync(dirs.host, { recursive: true, force: true });
  }
}
