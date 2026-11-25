import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import type { Api, AssistantMessage, Model, Models, ThinkingLevel } from "@earendil-works/pi-ai";
import { conditionsOf, type Limits } from "../kernel/condition.ts";
import type { Contract } from "../kernel/contract.ts";
import { append, CALL_KINDS, isReferenceChange, type LogEvent, read, TRACE_KINDS } from "../kernel/log.ts";
import { billedParts, priceKey } from "../kernel/meter.ts";
import type { Ending } from "../kernel/solve.ts";
import { type Cap, INTERRUPTED } from "../kernel/reports.ts";
import { ownedBy } from "../kernel/trace.ts";
import { ended as endedSolves, practiceRan, solvesIn } from "../kernel/solves.ts";
import { taskStates } from "../kernel/task.ts";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "../meta/filesystem.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { isString } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { basename, dirname, join } from "../meta/path.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import type { AuditFinding } from "../audit/auditor.ts";
import {
  type CommandSandbox,
  networkReach,
  type SolveDirs,
  solveDirs,
  sandboxBase,
} from "../tools/command.ts";
import type { PublicResource } from "../tools/answer.ts";
import { walledEnv } from "../tools/env.ts";
import { openHarness } from "../harness/open.ts";
import { type PublicTask, publicView } from "../solver/prompt.ts";
import { HARNESS_ACCOUNT } from "../harness/starter.ts";
import { type SolveRequest, solve } from "../solver/run.ts";
import { type AgentRun, type AgentTool, sessionClock, runAgent } from "../agent/session.ts";
import { claimRoot } from "../sandbox/sandbox-root.ts";
import { campaignOf } from "../campaign/summary.ts";
import {
  copyHarness,
  harnessNow,
  type HarnessSnapshot,
  HOME_TOOL_TREE,
  seedSavedHarnesses,
  snapshot,
} from "./store.ts";
import { builderMemoryBlock, keepMemory } from "./memory.ts";
import { formatComparisonHistory, formatPracticeFailures, formatSessionStart } from "./past.ts";
import {
  continuation,
  firstMessage,
  MODE_PROMPTS,
  type Solver,
  systemPrompt,
  type Used,
  usedLine,
} from "./prompt.ts";
import {
  type Bench,
  endingWith,
  finishTool,
  hasPractice,
  listedPractice,
  openingTool,
  practiceLeft,
  practiceTool,
  traceTool,
  walledTools,
} from "./tools.ts";

const BUILD_FINISHED = "build.finished";

const BUILD_STARTED = "build.started";

export interface PracticeTask {
  readonly version: string;
  readonly task: PublicTask;
}

export interface Practised {
  readonly solve: string;
  readonly ending: Ending;
}

interface BuildLimits extends Limits {
  readonly practiceSolves: number;
}

type BuildClock = ReturnType<typeof sessionClock>;

export interface BuildRequest {
  readonly id: string;
  readonly parent: string;
  readonly reference: string;
  readonly states: string;
  readonly memory: string;
  readonly tasks: readonly PracticeTask[];
  readonly contract: Contract;
  readonly resources: readonly PublicResource[];
  readonly model: Model<Api>;
  readonly effort: ThinkingLevel;
  readonly limits: BuildLimits;
  readonly solve: Limits;
  readonly solver: Solver;
  readonly models: (home: string, shutdown: AbortSignal) => Models;
  readonly log: string;
  readonly repoRoot: string;
  readonly otherTrees?: readonly string[] | undefined;
  readonly packRoots?: readonly string[] | undefined;
  readonly practise: (
    task: PracticeTask,
    harness: string,
    digest: string,
    kill: AbortSignal,
  ) => Promise<Practised>;
  readonly referee?:
    | ((solve: string, task: PracticeTask, kill: AbortSignal) => Promise<AuditFinding>)
    | undefined;
  readonly cap?: Cap | undefined;
  readonly kill?: AbortSignal;
  readonly campaign?: (bench: Bench) => {
    readonly tools: AgentTool[];
    readonly hook: () => string;
    readonly halts?: () => void;
    readonly closing?: () => Promise<void>;
    readonly start?: () => Promise<string>;
    readonly unmeasured?: (digest: string) => Promise<string | null>;
  };
}

export interface Built {
  readonly harness: string | null;
  readonly dir: string | null;
  readonly changed: boolean;
  readonly ended: "finished" | "wall" | "turns" | "killed" | "crashed" | "stopped";
}

const ENDINGS = ["finished", "killed", "wall", "crashed", "turns"] as const;

export async function practised(request: SolveRequest): Promise<Practised> {
  const ending = await solve(request);
  const events = read(request.log, TRACE_KINDS);
  const last = endedSolves(solvesIn(events).filter(({ id }) => id.startsWith(`${request.id}-`))).at(-1);
  const named = conditionsOf(events).get(request.condition)?.harness;
  const opened = last?.end.harness;
  if (named !== undefined && isString(opened) && opened !== named) {
    throw new Error(`solve ${last?.id ?? ""} opened harness ${opened} under a condition that names ${named}`);
  }
  return { solve: last?.id ?? request.id, ending };
}

export async function keepPractised(log: string, id: string, states: string): Promise<void> {
  const events = read(log, TRACE_KINDS);
  const mine = events.filter(ownedBy(events, id));
  const earlierHarnesses = new Set(
    events.flatMap(({ kind, data }) =>
      kind === BUILD_STARTED ? [data.parent] : isReferenceChange(kind) ? [data.harness] : [],
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

export function keepCutNotes(log: string, id: string): void {
  const { home } = sessionDirs(log, id);
  if (existsSync(home)) keepMemory(home, join(dirname(log), "memory"), id);
}

export function layPractice(home: string, tasks: readonly PracticeTask[]): void {
  const [folder, next, old] = [
    join(home, "practice"),
    join(home, ".practice-next"),
    join(home, ".practice-old"),
  ];
  for (const path of [next, old]) rmSync(path, { recursive: true, force: true });
  mkdirSync(next, { recursive: true });
  for (const { task } of tasks) {
    writeFileSync(
      join(next, `${task.taskId.replaceAll(/[^A-Za-z0-9._-]+/g, "-")}.json`),
      `${capturedJsonStringify(publicView(task), null, 2)}\n`,
    );
  }
  if (existsSync(folder)) renameSync(folder, old);
  rmSync(folder, { force: true });
  renameSync(next, folder);
  rmSync(old, { recursive: true, force: true });
}

export async function session(
  request: BuildRequest,
  dirs: Pick<SolveDirs, "home" | "host">,
  walled: (bench: Bench) => AgentTool[],
  env?: ExecutionEnv,
): Promise<Built> {
  const { log, limits, model } = request;
  const began = performance.now();
  const parent = await openHarness(request.parent);
  const before = read(log, TRACE_KINDS);
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
  writeFileSync(join(dirs.home, "HARNESS.md"), HARNESS_ACCOUNT);
  seedSavedHarnesses(dirs.home, request.states, before, parent.digest);
  append(log, BUILD_STARTED, {
    session: request.id,
    parent: parent.digest,
    tasks: request.tasks.map(({ version }) => version),
    model: priceKey(model),
    effort: request.effort,
    limits: { ...limits },
  });
  const clock = sessionClock(began, limits.wallSeconds);
  const bench: Bench = {
    request,
    modePrompts: MODE_PROMPTS[request.campaign === undefined ? "host" : "builder"],
    tasks: request.tasks,
    reference: { dir: request.reference, harness: await openHarness(request.reference) },
    home: dirs.home,
    parent: parent.digest,
    tree: null,
    opened: null,
    told: new Map(),
    spent: 0,
    faulty: new Set(),
    faults: [],
    halt: new AbortController(),
    fatal: null,
    note: null,
    within: clock.within,
  };
  return await converse(bench, dirs.host, clock, walled, env);
}

function openingFor(bench: Bench): string {
  const { request } = bench;
  const recorded = read(request.log, CALL_KINDS);
  const campaign = campaignOf(recorded);
  const began = recorded.findLastIndex(
    ({ kind, data }) => kind === BUILD_STARTED && data.session === request.id,
  );
  const moved = recorded.slice(began).some(({ kind }) => isReferenceChange(kind))
    ? " The reference harness has changed since this conversation began."
    : "";
  return firstMessage(
    request.contract,
    listedPractice(
      recorded,
      bench.tasks,
      { parent: bench.parent, reference: bench.reference.harness.digest },
      request.contract,
    ),
    {
      ...request.limits,
      practiceSolves: practiceLeft(bench, recorded),
      solver: request.solver,
      solve: request.solve,
    },
    {
      start: `${formatSessionStart(campaign, bench.parent, request.id)}${moved}`,
      fails: formatPracticeFailures(
        campaign.fails,
        new Map(bench.tasks.map(({ version, task }) => [version, task.taskId])),
      ),
      comparisons: formatComparisonHistory(campaign.steps),
      memory: builderMemoryBlock(
        request.memory,
        recorded
          .slice(0, began)
          .flatMap(({ kind, data }) =>
            kind === BUILD_STARTED && isString(data.session) ? [data.session] : [],
          ),
      ),
    },
  );
}

async function converse(
  bench: Bench,
  host: string,
  clock: BuildClock,
  walled: (bench: Bench) => AgentTool[],
  env: ExecutionEnv | undefined,
): Promise<Built> {
  const { request } = bench;
  const { log, limits, model } = request;
  const opening = () => openingFor(bench);
  const campaign = request.campaign?.(bench);
  const first = opening();
  const turns: AssistantMessage[] = [];
  const used = (moment: "during-tools" | "between-turns" = "between-turns"): Used => ({
    turns: turns.length - (moment === "during-tools" ? 1 : 0),
    seconds: clock.seconds(),
    practiceLeft: practiceLeft(
      bench,
      request.cap === undefined && campaign === undefined ? [] : read(log, CALL_KINDS),
    ),
    practised: bench.opened?.harness.digest ?? null,
  });
  let told = false;
  let compacted = false;
  const footer = () => {
    if (told) return "";
    told = true;
    const cue = compacted ? " Context compacted; read_opening holds the opening record and limits." : "";
    return `${usedLine(used("during-tools"), limits)}${cue}`;
  };
  const tools = [
    ...walled(bench),
    practiceTool(bench),
    traceTool(bench),
    openingTool(() => {
      compacted = false;
      return campaign === undefined ? first : opening();
    }, bench.modePrompts.opening),
    finishTool(bench, campaign?.unmeasured),
    ...(campaign?.tools ?? []),
  ].map((each) => endingWith(each, footer));
  const halted = () => {
    campaign?.halts?.();
    if (
      campaign === undefined &&
      request.cap !== undefined &&
      billedParts(read(log, CALL_KINDS), request.id).session >= request.cap.dollars
    ) {
      bench.halt.abort();
    }
    if (bench.halt.signal.aborted) throw new Error("The session has ended at a bound.");
  };
  const started = (await campaign?.start?.()) ?? "";
  const sat = await runAgent({
    models: request.models,
    home: join(host, "model"),
    id: request.id,
    model,
    effort: request.effort,
    system: systemPrompt(bench.modePrompts, request.contract.objective),
    opening: [first, started, campaign?.hook() ?? ""].filter((part) => part !== "").join("\n\n"),
    tools,
    ...keyIfDefined("env", env),
    trace: { log, of: "build" },
    before: halted,
    turns,
    most: limits.turns,
    over: () => bench.note !== null || bench.fatal !== null,
    next: async () => {
      if (bench.note !== null) return null;
      const harness = await harnessNow(bench);
      const practice =
        isString(harness) && hasPractice(bench, read(log, TRACE_KINDS), harness) ? "counted" : "uncounted";
      return [continuation(used(), limits, harness, bench.modePrompts, practice), campaign?.hook() ?? ""]
        .filter((part) => part !== "")
        .join("\n\n");
    },
    onTurn: () => {
      told = false;
    },
    onCompact: () => {
      compacted = true;
    },
    stops: [clock.signal, bench.halt.signal, request.kill],
  });
  clock.close();
  await campaign?.closing?.();
  return await finishSession(bench, sat, clock, turns.length);
}

async function finishSession(bench: Bench, sat: AgentRun, clock: BuildClock, turns: number): Promise<Built> {
  const { request } = bench;
  const { log, limits } = request;
  const crash = (sat.cut ? null : sat.thrown) ?? bench.fatal?.message ?? sat.crash;
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
  const by: Record<(typeof ENDINGS)[number], boolean> = {
    finished: bench.note !== null,
    killed: request.kill?.aborted === true,
    wall: clock.signal.aborted,
    crashed: crash !== null,
    turns: turns >= limits.turns,
  };
  const ended: Built["ended"] =
    bench.fatal === null ? (ENDINGS.find((reason) => by[reason]) ?? "stopped") : "crashed";
  if (INTERRUPTED.has(ended)) await keepPractised(log, request.id, request.states);
  keepMemory(bench.home, request.memory, request.id);
  append(log, BUILD_FINISHED, {
    session: request.id,
    ended,
    harness: frozen?.harness.digest ?? null,
    changed,
    broken,
    crash,
    ...sat.spent,
    practiceSolves: bench.spent,
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

export function spent(events: readonly LogEvent[], id: string): string | null {
  const mine = events.filter(({ data }) => data.session === id);
  if (!mine.some(({ kind }) => kind === BUILD_STARTED)) return null;
  const ended = mine.findLast(({ kind }) => kind === BUILD_FINISHED)?.data.ended;
  if (ended === undefined) {
    return `session ${id} started and never finished; a round does not run a second session under one id`;
  }
  return INTERRUPTED.has(ended)
    ? `session ${id} ${ended === "killed" ? "was killed" : "crashed"}, so what it froze is not compared; a round under a new session id starts again`
    : null;
}

async function left(events: readonly LogEvent[], request: BuildRequest, parent: string) {
  const mine = events.filter(({ data }) => data.session === request.id);
  const started = mine.find(({ kind }) => kind === BUILD_STARTED)?.data;
  const finished = mine.findLast(({ kind }) => kind === BUILD_FINISHED)?.data;
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

export async function sessionOnce(
  request: BuildRequest,
  builder?: (request: BuildRequest) => Promise<Built>,
) {
  const parent = (await openHarness(request.parent)).digest;
  if ((await left(read(request.log, TRACE_KINDS), request, parent)) === undefined) {
    await (builder ?? build)(request);
  }
  const built = await left(read(request.log, TRACE_KINDS), request, parent);
  if (built === undefined) throw new Error(`session ${request.id} ran and left no record in the log`);
  return built;
}

export const sessionDirs = (log: string, id: string): SolveDirs =>
  solveDirs(`build-${basename(dirname(log))}-${id}`);

export async function build(request: BuildRequest): Promise<Built> {
  const dirs = sessionDirs(request.log, request.id);
  const release = await claimRoot(dirs.root);
  try {
    const wall: CommandSandbox = {
      base: await sandboxBase(
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
  }
}
