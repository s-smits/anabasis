/**
 * One Builder session: the agent that changes a Built Harness, and the host around it.
 *
 * The plan's D2 is "one Builder session scored on tasks it never saw", and until this file nothing
 * in v2 could run one. A session is given a copy of the harness it starts from, a walled shell over
 * that copy, practice solves on released tasks, and the two reviewers' readings of what fails there.
 * It ends by freezing what the copy holds as a harness version. It is one session: no loop over
 * sessions, no promotion and no carried memory, which stay behind gate G4. Whether the new harness
 * is better is the comparison's to say (`src/kernel/compare.ts`), on tasks this session never saw.
 *
 * What v1's Builder (harness-builder-v4 at 7af7315) did and this one does not: write tasks and
 * checks, set its solver's limits, and submit through gates on a candidate. The Examiner writes
 * tasks, the checks are fixed, the host owns every limit, and a harness is judged by a comparison
 * rather than gated.
 *
 * The walls, each with the test that holds it:
 * - Practice is on released tasks only. The task fold says which those are, at the session's start
 *   and again at every practice, so an admitted or an anchor task is refused by its state and not by
 *   the caller's care.
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
 * The session ends at `finish`, at its wall, at its turns, or when a practice solve could not be run
 * at all. A solve's turn cap counts prompts, as v1's did; here it counts the model's turns, since a
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
import { REPORTED_COST } from "../backends/claude.ts";
import { conditionsOf, type Limits } from "../kernel/condition.ts";
import type { Contract } from "../kernel/contract.ts";
import { append, read } from "../kernel/log.ts";
import { dollars, freezePrices, priceKey, tokensOf } from "../kernel/meter.ts";
import type { Ending } from "../kernel/solve.ts";
import { taskStates } from "../kernel/task.ts";
import { CORRECTNESS_MODEL_DIR } from "../meta/bundle-layout.ts";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "../meta/filesystem.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { asRecord, isNumber, isString } from "../meta/json-shape.ts";
import { basename, join, resolve } from "../meta/path.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import type { Diagnosis } from "../review/diagnoser.ts";
import type { RefereeFinding } from "../review/referee.ts";
import { stringOf } from "../review/trace.ts";
import { type CommandWall, type SolveDirs, solveDirs } from "../solve/command.ts";
import type { PublicResource } from "../solve/answer.ts";
import { openHarness } from "../solve/harness.ts";
import { type PublicTask, publicView } from "../solve/prompt.ts";
import { loopCompaction, type SolveRequest, solve, traceSink } from "../solve/run.ts";
import { mountDiskCap } from "../verify/disk-cap.ts";
import { solveIsolationPolicy } from "../verify/solve-sandbox.ts";
import { firstMessage, NUDGE, SYSTEM_PROMPT } from "./prompt.ts";
import {
  type Bench,
  finishTool,
  HOME_TOOL_TREE,
  parentToolTree,
  practiceTool,
  record,
  type Snapshot,
  snapshot,
  traceTool,
  walledTools,
} from "./tools.ts";

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
export interface BuildLimits extends Limits {
  readonly practiceSolves: number;
}

export interface BuildRequest {
  /** Names the session in the log. */
  readonly id: string;
  /** The harness state the session starts from, v1's format (`src/solve/harness.ts`). */
  readonly parent: string;
  /** Where a frozen harness is kept, under its digest. The caller's, outside every wall. */
  readonly states: string;
  /** Released tasks, and nothing else. */
  readonly tasks: readonly PracticeTask[];
  readonly contract: Contract;
  /** The public resources each solve's home holds, which the session's home holds as one file. */
  readonly resources: readonly PublicResource[];
  readonly model: Model<Api>;
  readonly effort: ThinkingLevel;
  readonly limits: BuildLimits;
  /** The backends, built on the home the Builder's model process keeps its state in. */
  readonly models: (home: string) => Models;
  readonly log: string;
  /** The repository, closed to every command. */
  readonly repoRoot: string;
  /** One solve of a released task under the test condition, with the harness frozen in `harness`
   *  and digested as `digest`. The caller builds the condition and records it (`recordCondition`),
   *  and hands `kill` to the solve, which the session aborts when it ends. A throw ends the session. */
  readonly practise: (
    task: PracticeTask,
    harness: string,
    digest: string,
    kill: AbortSignal,
  ) => Promise<Practised>;
  /** The reviewers, when the caller has a reader for them. Without a Referee nothing is diagnosed,
   *  since the Diagnoser reads only what the Referee ruled earned. `kill` is for their readers. */
  readonly referee?: (solve: string, task: PracticeTask, kill: AbortSignal) => Promise<RefereeFinding>;
  readonly diagnose?: (solve: string, task: PracticeTask, kill: AbortSignal) => Promise<Diagnosis>;
  /** Aborts when the run is killed. */
  readonly kill?: AbortSignal;
}

export interface Built {
  /** The digest of what the session left; null when a solve could not open it. */
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
  const last = events.findLast(
    ({ kind, data }) => kind === "solve.finished" && stringOf(data.solve).startsWith(`${request.id}-`),
  );
  // The condition says which harness the solve ran, and the solve says which it opened. A harness
  // whose digest moved with where it sat once made the two differ, and a comparison counted by the
  // first would have scored solves of the second.
  const named = conditionsOf(events).get(request.condition)?.harness;
  const opened = last?.data.harness;
  if (named !== undefined && isString(opened) && opened !== named) {
    throw new Error(
      `solve ${stringOf(last?.data.solve)} opened harness ${opened} under a condition that names ${named}`,
    );
  }
  return { solve: stringOf(last?.data.solve) || request.id, ending };
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
  if (before.some(({ kind, data }) => kind === "build.started" && data.session === request.id)) {
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
  for (const { task } of request.tasks) {
    writeFileSync(
      join(dirs.home, "practice", `${task.taskId.replace(/[^A-Za-z0-9._-]+/g, "-")}.json`),
      `${capturedJsonStringify(publicView(task), null, 2)}\n`,
    );
  }
  append(log, "build.started", {
    session: request.id,
    parent: parent.digest,
    tasks: request.tasks.map(({ version }) => version),
    model: priceKey(model),
    effort: request.effort,
    limits: { ...limits },
  });
  const bench: Bench = {
    request,
    home: dirs.home,
    parent: parent.digest,
    tree: null,
    spent: 0,
    disputed: new Set(),
    faulty: new Set(),
    faults: [],
    lists: null,
    halt: new AbortController(),
    fatal: null,
    note: null,
  };
  const tools = [...walled(bench), practiceTool(bench), traceTool(bench), finishTool(bench)];
  const recorded = read(log);
  const opening = firstMessage(
    request.contract,
    request.tasks.map(({ version, task }) => ({
      taskId: task.taskId,
      family: task.family,
      ...record(recorded, version, parent.digest),
    })),
    limits,
  );
  const wall = new AbortController();
  // Aborted when the loop returns, whatever returned it, so the model's own process is closed.
  const done = new AbortController();
  const signal = AbortSignal.any([
    wall.signal,
    done.signal,
    bench.halt.signal,
    ...(request.kill ? [request.kill] : []),
  ]);
  const turns: AssistantMessage[] = [];
  const summaries: Usage[] = [];
  const user = (content: string): AgentMessage => ({ role: "user", content, timestamp: Date.now() });
  const system = createInitialSystemMessage(SYSTEM_PROMPT, tools.map(toToolDeclaration));
  const models = request.models(join(dirs.host, "model"));
  const stream: StreamFn = (asked, context, options) => models.streamSimple(asked, context, options);
  let crash: string | null = null;
  const timer = setTimeout(() => wall.abort(), limits.wallSeconds * 1000);
  try {
    await runAgentLoop(
      [user(opening)],
      { messages: system === undefined ? [] : [system], tools },
      {
        model,
        reasoning: request.effort,
        sessionId: request.id,
        convertToLlm: (messages) => messages,
        toolExecution: "sequential",
        finishTurn: ({ message }) => {
          if (message.role === "assistant") turns.push(message);
          // `finish` ends the session even beside another call in its turn, where pi would go on.
          return bench.note !== null || turns.length >= limits.turns ? { action: "end" } : undefined;
        },
        getFollowUpMessages: async () => (bench.note === null ? [user(NUDGE)] : []),
        prepareRequest: loopCompaction(log, "build", request.id, stream, summaries),
      },
      traceSink(log, "build", request.id, () => turns.length),
      signal,
      stream,
    );
  } catch (error) {
    crash = errorMessage(error);
  } finally {
    clearTimeout(timer);
    done.abort();
  }
  crash ??= bench.fatal?.message ?? null;
  // A turn the provider failed ends pi's loop without a throw, and what was built before it is half
  // a session, as a crash's is. A turn the session's own wall, kill or halt cut is not that.
  const last = turns.at(-1);
  const cut = wall.signal.aborted || bench.halt.signal.aborted || request.kill?.aborted === true;
  if (last?.stopReason === "error" && !cut) crash ??= last.errorMessage ?? "the provider failed the turn";
  // Whatever ended the session, what `harness/` holds is frozen: a session cut at its wall still
  // made its edits, and the comparison is what says whether they count.
  let frozen: Snapshot | null = null;
  let broken: string | null = null;
  try {
    frozen = await snapshot(bench);
  } catch (error) {
    broken = errorMessage(error);
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
  const tokens = tokensOf([...turns.map((turn) => turn.usage), ...summaries]);
  const reported = asRecord(
    turns.flatMap((turn) => turn.diagnostics ?? []).findLast((d) => d.type === REPORTED_COST)?.details,
  )?.totalCostUsd;
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
    reportedCost: isNumber(reported) ? reported : null,
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

/** One session under the solver's command wall and disk cap: mount, run, tear down. The Builder's
 *  home is the capped root's, as a solve's is, so its edits last between commands and are closed to
 *  every other solve. */
export async function build(request: BuildRequest): Promise<Built> {
  const dirs = solveDirs(`build-${request.id}`);
  // Before the try: a claim refused because another round's session holds this id cleans up nothing.
  const release = await mountDiskCap({ root: dirs.root, bytes: request.limits.diskBytes });
  try {
    for (const dir of [dirs.home, dirs.runs, dirs.host]) mkdirSync(dir, { recursive: true });
    const base = solveIsolationPolicy({
      repoRoot: request.repoRoot,
      cap: { root: dirs.root, bytes: request.limits.diskBytes },
    });
    if ("unsupported" in base) throw new Error(`this host cannot wall a Builder: ${base.unsupported}`);
    const wall: CommandWall = {
      base,
      dirs,
      toolTree: join(dirs.home, HOME_TOOL_TREE),
      limits: request.limits,
      cpu: { seconds: 0, unmeasured: 0 },
    };
    return await session(request, dirs, (bench) => walledTools(bench, wall));
  } finally {
    await release();
    rmSync(dirs.host, { recursive: true, force: true });
  }
}
