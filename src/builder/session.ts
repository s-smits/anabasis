/**
 * One Builder session: the agent that changes a Built Harness, and the host around it.
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
 * checks, set its solver's limits, and submit through gates on a candidate. The Examiner writes
 * tasks, the checks are fixed, the host owns every limit, and a harness is judged by a comparison
 * rather than gated.
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
 * - What the Builder reads of a solve is the paged trace (`src/review/trace.ts`) and an ending's
 *   outcome and kind. A verdict's checks and the Referee's reasons never reach a tool result.
 * - The log records what the session saw: `build.started` lists the practice task versions, and
 *   every practice solve runs under a recorded condition, so "never saw" can be checked afterwards.
 *
 * The session's own turns and calls are logged as `build.turn` and `build.call`. What catches a
 * Builder that went wrong is a reader of that record, and the model's own transcript is deleted
 * with the session's scratch.
 *
 * The session ends at `finish`, at its wall, at its turns, at its dollar cap, or when a practice solve
 * could not be run at all. A solve's turn cap counts prompts, as v1's did; here it counts the model's turns, since a
 * Builder that never stops calling tools would otherwise have no cap but its wall. The wall, the
 * kill and the halt reach a practice solve in flight, so the session ends when they fall and not a
 * solve's whole wall later. A practice solve that throws is the verifier failing to decide, which
 * stops a run: the session writes its record, freezes what it has, and throws it again.
 */
import {
  type AgentMessage,
  type AgentTool,
  runAgentLoop,
  type StreamFn,
} from "@earendil-works/pi-agent-core";
import {
  type Api,
  type AssistantMessage,
  createInitialSystemMessage,
  type Model,
  type Models,
  type ThinkingLevel,
  toToolDeclaration,
  type Usage,
} from "@earendil-works/pi-ai";
import { reportedCost } from "../backends/claude.ts";
import { conditionsOf, type Limits } from "../kernel/condition.ts";
import type { Contract } from "../kernel/contract.ts";
import { append, type LogEvent, read } from "../kernel/log.ts";
import { dollars, freezePrices, priceKey, tokensOf } from "../kernel/meter.ts";
import type { Ending } from "../kernel/solve.ts";
import { billedParts, type Cap } from "../kernel/reports.ts";
import { ended as endedSolves, solvesIn } from "../kernel/solves.ts";
import { taskStates } from "../kernel/task.ts";
import { CORRECTNESS_MODEL_DIR } from "../meta/bundle-layout.ts";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "../meta/filesystem.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { isString } from "../meta/json-shape.ts";
import { basename, dirname, join, resolve } from "../meta/path.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import type { RefereeFinding } from "../review/referee.ts";
import { type CommandWall, networkReach, type SolveDirs, solveDirs, walledBase } from "../solve/command.ts";
import type { PublicResource } from "../solve/answer.ts";
import { openHarness } from "../solve/harness.ts";
import { type PublicTask, publicView } from "../solve/prompt.ts";
import { HARNESS_ACCOUNT } from "../solve/starter.ts";
import { failedTurn, loopCompaction, type SolveRequest, solve, traceSink } from "../solve/run.ts";
import { mountDiskCap } from "../verify/disk-cap.ts";
import { campaignOf } from "./handover.ts";
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
  HOME_TOOL_TREE,
  openingTool,
  parentToolTree,
  practiceLeft,
  practiceTool,
  record,
  type Snapshot,
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

/** The host's limits on a session: a solve's, read for the Builder's own wall, turns and shell, and
 *  the practice solves it may spend. `turns` caps the model's turns, where a solve's caps its
 *  prompts. `concurrency` is how many practice solves run at once. */
interface BuildLimits extends Limits {
  readonly practiceSolves: number;
}

export interface BuildRequest {
  /** Names the session in the log. */
  readonly id: string;
  /** The harness state the session starts from, v1's format (`src/solve/harness.ts`). */
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
   *  session's own wall, turns and command limits are `limits`. */
  readonly solve: Limits;
  /** Who solves with the harness, in practice and in every comparison: the campaign's setting, as a
   *  condition names the model. The opening tells it, since a guide that serves one solver well can
   *  leave another short (`firstMessage`). */
  readonly solver: Solver;
  /** The backends, built on the home the Builder's model process keeps its state in. */
  readonly models: (home: string) => Models;
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
   *  once what the session billed has reached it (`prepareRequest`). */
  readonly cap?: Cap | undefined;
  /** Aborts when the run is killed. */
  readonly kill?: AbortSignal;
  /** Campaign tools and advice, supplied by the host. The Builder remains the only build-side agent. */
  readonly campaign?: (bench: Bench) => {
    readonly tools: AgentTool[];
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
     *  reference, or null (`standing`, `tools.ts`). */
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

/**
 * The session over a home and a host-only folder that already exist. `walled` supplies the tools
 * that need the command wall, so that everything else here runs, and is tested, without one.
 */
export async function session(
  request: BuildRequest,
  dirs: Pick<SolveDirs, "home" | "host">,
  walled: (bench: Bench) => AgentTool[],
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
  // A kept state's tool tree is a link to the copy kept of it, so the tree is copied from where it is.
  // A v1 state carries its correctness model, whose battery holds every task's hidden values, at its
  // root and again in each `.bundle-snapshots` entry; no harness reads it, and the checks are the
  // host's, so the Builder is given no copy of it at any depth.
  const toolTree = parentToolTree(request.parent);
  const copy = { recursive: true, verbatimSymlinks: true } as const;
  const ownTree = resolve(request.parent, ".toolchain");
  const battery = basename(CORRECTNESS_MODEL_DIR);
  cpSync(request.parent, join(dirs.home, "harness"), {
    ...copy,
    filter: (source) => resolve(source) !== ownTree && basename(source) !== battery,
  });
  if (toolTree !== null) cpSync(toolTree, join(dirs.home, HOME_TOOL_TREE), copy);
  mkdirSync(join(dirs.home, "practice"), { recursive: true });
  writeFileSync(join(dirs.home, "resources.json"), `${capturedJsonStringify(request.resources, null, 2)}\n`);
  // The account of a harness's files is this host's, whichever harness the session forks.
  writeFileSync(join(dirs.home, "HARNESS.md"), HARNESS_ACCOUNT);
  // The Builder's own notes: what the last session to leave any left, and v1's starters otherwise.
  const earlier = before.flatMap(({ kind, data }) =>
    kind === BUILD_STARTED && isString(data.session) ? [data.session] : [],
  );
  seedMemory(dirs.home, request.memory, lastKept(request.memory, earlier));
  for (const { task } of request.tasks) {
    writeFileSync(
      join(dirs.home, "practice", `${task.taskId.replace(/[^A-Za-z0-9._-]+/g, "-")}.json`),
      `${capturedJsonStringify(publicView(task), null, 2)}\n`,
    );
  }
  append(log, BUILD_STARTED, {
    session: request.id,
    parent: parent.digest,
    tasks: request.tasks.map(({ version }) => version),
    model: priceKey(model),
    effort: request.effort,
    limits: { ...limits },
  });
  const wall = new AbortController();
  // The wall counts the Builder's own time: its clock stops while a campaign action runs, which is
  // the host's time (`Bench.within`), and `aside` is what the actions took.
  let aside = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ownSeconds = () => (performance.now() - began - aside) / 1000;
  // One timer at a time: until 14 October the opening's `within` armed one that the session's own
  // arming overwrote, and it cut main0_5_1's Builder four hours on, a comparison in flight.
  const arm = () => {
    clearTimeout(timer);
    if (done.signal.aborted) return;
    timer = setTimeout(() => wall.abort(), (limits.wallSeconds - ownSeconds()) * 1000);
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
  const opening = () => {
    const recorded = read(log);
    const campaign = campaignOf(recorded);
    return firstMessage(
      request.contract,
      bench.tasks.map(({ version, task }) => ({
        taskId: task.taskId,
        family: task.family,
        ...record(recorded, version, parent.digest),
      })),
      // The count it opens with is the one `practice` holds it to: its own, or its cap's where fewer.
      {
        ...limits,
        practiceSolves: practiceLeft(bench, recorded),
        solver: request.solver,
        solve: request.solve,
      },
      {
        start: startTold(campaign, parent.digest, request.id),
        fails: failsTold(
          campaign.fails,
          new Map(bench.tasks.map(({ version, task }) => [version, task.taskId])),
        ),
        comparisons: comparisonsTold(campaign.steps),
        memory: builderMemoryBlock(dirs.home),
      },
    );
  };
  const campaign = request.campaign?.(bench);
  const first = opening();
  const turns: AssistantMessage[] = [];
  // What the session has used of its limits, as every turn's tool results and every continuation
  // say it. A session under a cap reads what its practice solves billed from the log. A campaign's
  // session counts a turn as its message ends, before its tools run (below), so while they run its
  // count holds the turn they belong to: until 14 October a led Builder was told the next turn.
  const used = (during = false): Used => ({
    turns: turns.length - (during && campaign !== undefined ? 1 : 0),
    seconds: ownSeconds(),
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
    openingTool(campaign === undefined ? first : opening, bench.said),
    finishTool(bench, campaign?.unmeasured),
    ...(campaign?.tools ?? []),
  ].map((each) => endingWith(each, footer));
  // Aborted when the loop returns, whatever returned it, so the model's own process is closed.
  const done = new AbortController();
  const signal = AbortSignal.any([
    wall.signal,
    done.signal,
    bench.halt.signal,
    ...(request.kill ? [request.kill] : []),
  ]);
  const summaries: Usage[] = [];
  const user = (content: string): AgentMessage => ({ role: "user", content, timestamp: Date.now() });
  const system = createInitialSystemMessage(systemPrompt(bench.said), tools.map(toToolDeclaration));
  const models = request.models(join(dirs.host, "model"));
  const stream: StreamFn = (asked, context, options) => models.streamSimple(asked, context, options);
  const compact = loopCompaction(log, "build", request.id, stream, summaries);
  const trace = traceSink(log, "build", request.id, () => turns.length);
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
  let crash: string | null = null;
  const started = (await campaign?.start?.()) ?? "";
  arm();
  try {
    await runAgentLoop(
      [user([first, started, campaign?.hook() ?? ""].filter((part) => part !== "").join("\n\n"))],
      { messages: system === undefined ? [] : [system], tools },
      {
        model,
        reasoning: request.effort,
        sessionId: request.id,
        convertToLlm: (messages) => messages,
        toolExecution: "sequential",
        finishTurn: ({ message }) => {
          if (campaign === undefined && message.role === "assistant") turns.push(message);
          // `finish` ends the session even beside another call in its turn, where pi would go on.
          return bench.note !== null || turns.length >= limits.turns ? { action: "end" } : undefined;
        },
        // v1's continuation carried the same notice: a file over its limit is cut on the next read.
        getFollowUpMessages: async () =>
          bench.note === null
            ? [
                user(
                  [
                    continuation(used(), limits, await harnessNow(bench), bench.said),
                    memoryOverCapNotice(dirs.home) ?? "",
                    campaign?.hook() ?? "",
                  ]
                    .filter((part) => part !== "")
                    .join("\n\n"),
                ),
              ]
            : [],
        // A led session's bounds are the campaign's, asked of the table (`halts`), and a session the
        // host ran is held to its dollar cap, before a request and again after a compaction, which
        // bills too. Until 19 October the cap held practice alone: a session the host ran opened on
        // what was left of a campaign's total and could bill turns past it until its finish, its
        // turns or its wall, as two reviews of the host-led loop found (#202, closed). A led
        // session's cap is what was left when it opened, and the operator's word can raise the
        // total after: the table's reading of the budget is the one that holds it, as `practiceLeft`
        // already has it.
        prepareRequest: async (context, kill) => {
          halted();
          const update = await compact(context, kill);
          halted();
          return update ?? undefined;
        },
      },
      (event) => {
        if (event.type === "message_end" && event.message.role === "assistant") told = false;
        // Meter a campaign's model turn before its tool can spend on another seat.
        if (campaign !== undefined && event.type === "message_end" && event.message.role === "assistant") {
          turns.push(event.message);
          trace({ type: "turn_end", message: event.message, toolResults: [] });
        } else if (campaign === undefined || event.type !== "turn_end") {
          trace(event);
        }
      },
      signal,
      stream,
    );
  } catch (error) {
    if (!signal.aborted) crash = errorMessage(error);
  } finally {
    clearTimeout(timer);
    done.abort();
  }
  await campaign?.closing?.();
  const cut = wall.signal.aborted || bench.halt.signal.aborted || request.kill?.aborted === true;
  crash ??= bench.fatal?.message ?? (cut ? null : failedTurn(turns));
  // Whatever ended the session, what `harness/` holds is frozen: a session cut at its wall still
  // made its edits, and the comparison is what says whether they count.
  //
  // Where what it holds does not open, the session is not lost with it: the last state it
  // practised with is what is measured, and `broken` says why the final one was not. That a harness
  // opens is all that is left of v1's submit gate, and there a round that ended refused measured
  // nothing: 13 firmware rounds, 3,803 minutes, by v1 #113's count. A session cut at its wall half way
  // through an edit ends so, and the state before it was one real solves ran on. A session that
  // never practised has no such state, and leaves none.
  let frozen: Snapshot | null;
  let broken: string | null = null;
  const lastPractised = bench.opened?.harness.digest ?? null;
  try {
    frozen = await snapshot(bench);
  } catch (error) {
    broken = errorMessage(error);
    frozen = bench.opened;
  }
  const changed = frozen !== null && frozen.harness.digest !== parent.digest;
  if (frozen !== null && changed) {
    append(log, "harness.version", {
      version: frozen.harness.digest,
      parent: parent.digest,
      session: request.id,
      note: bench.note,
    });
  }
  const ended =
    bench.fatal === null
      ? endedBy({
          finished: bench.note !== null,
          killed: request.kill?.aborted === true,
          wall: wall.signal.aborted,
          crashed: crash !== null,
          turns: turns.length >= limits.turns,
        })
      : "crashed";
  // A crashed session's harness is passed over (`latestBuilt`), as one it may have left half way
  // through an edit. The state its own practice solve last ran on is no half-edit, and is kept as
  // a checkpoint, whether or not edits followed it: on 13 October buffer-149's b-1 crashed on a
  // provider error with a harness it had practised three of three on, and b-2 rebuilt it from
  // b-1's notes for 25 turns. Until 14 October only a crash with no edit after that solve kept it,
  // so one more line written before the crash lost every practised version of the session.
  if (ended === "crashed" && changed && lastPractised !== null && lastPractised !== parent.digest) {
    append(log, "build.checkpoint", { session: request.id, harness: lastPractised });
  }
  const tokens = tokensOf([...turns.map((turn) => turn.usage), ...summaries]);
  // Kept before the session is recorded as ended, so a session on record as ended has its notes.
  keepMemory(dirs.home, request.memory, request.id);
  append(log, "build.finished", {
    session: request.id,
    ended,
    harness: frozen?.harness.digest ?? null,
    changed,
    broken,
    crash,
    turns: turns.length,
    practiceSolves: bench.spent,
    disputed: [...bench.disputed],
    faultyChecks: [...bench.faulty],
    reviewFaults: bench.faults,
    tokens: { ...tokens },
    ...dollars(freezePrices([model]), priceKey(model), tokens),
    reportedCost: await reportedCost(request.id, turns),
    seconds: (performance.now() - began) / 1000,
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
 * what it left, and the whole of a session run with no comparison after it: the plan's checkpoint
 * is several sessions and then one comparison (`docs/plan.md`, Phase 5).
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
 *  its root stayed mounted, and the claim on a root is how a second session under one id is refused. */
export const sessionDirs = (log: string, id: string): SolveDirs =>
  solveDirs(`build-${basename(dirname(log))}-${id}`);

/** One session under the solver's command wall and disk cap: mount, run, tear down. The Builder's
 *  home is the capped root's, as a solve's is, so its edits last between commands and are closed to
 *  every other solve. */
export async function build(request: BuildRequest): Promise<Built> {
  const dirs = sessionDirs(request.log, request.id);
  // Before the try: a claim refused because another round's session holds this id cleans up nothing.
  const release = await mountDiskCap({ root: dirs.root, bytes: request.limits.diskBytes });
  try {
    const wall: CommandWall = {
      base: await walledBase(
        dirs,
        {
          repoRoot: request.repoRoot,
          otherTrees: request.otherTrees,
          packRoots: request.packRoots,
          diskBytes: request.limits.diskBytes,
        },
        "a Builder",
      ),
      dirs,
      toolTree: join(dirs.home, HOME_TOOL_TREE),
      limits: request.limits,
    };
    const network = await networkReach(wall);
    return await session(request, dirs, (bench) => walledTools(bench, wall, network));
  } finally {
    await release();
    rmSync(dirs.host, { recursive: true, force: true });
  }
}
