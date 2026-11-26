import type { Api, AssistantMessage, Model, Models, ThinkingLevel } from "@earendil-works/pi-ai";
import { resetOf } from "../agent/backends/claude.ts";
import type { Limits } from "../kernel/condition.ts";
import { answerFormatFault, type Contract } from "../kernel/contract.ts";
import { type AnswerFile, keepAnswerFiles } from "../kernel/answer-files.ts";
import { append } from "../kernel/log.ts";
import { NOTHING_SPENT, priceKey } from "../kernel/meter.ts";
import {
  Cancellation,
  checkCouldNotRun,
  type Ending,
  nonRetryableProvider,
  unanswered,
} from "../kernel/solve.ts";
import type { Task, Verifier } from "../kernel/verify.ts";
import { lstatSync } from "../meta/filesystem.ts";
import type { JsonValue } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { availableParallelism, loadavg } from "../meta/os.ts";
import { join } from "../meta/path.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { type AgentRun, type AgentTool, runAgent } from "../agent/session.ts";
import { claimRoot, type ReleaseRoot } from "../sandbox/sandbox-root.ts";
import { type Desk, openDesk, type PublicResource, submitTool } from "../tools/answer.ts";
import { codingTools, selectedCodingTools, wallExec } from "../tools/coding.ts";
import { walledEnv } from "../tools/env.ts";
import {
  type CommandSandbox,
  type NetworkReach,
  networkReach,
  type SolveClock,
  solveDirs,
  usedSeconds,
  sandboxBase,
} from "../tools/command.ts";
import { type Harness, openHarness, pathsUnder, treeStamp } from "../harness/open.ts";
import { installedPrograms } from "../harness/programs.ts";
import { firstTurn, NUDGE, seedHome, systemPrompt } from "./prompt.ts";

export interface SolveRequest {
  readonly id: string;
  readonly condition: string;
  readonly task: Task;
  readonly contract: Contract;
  readonly harness: string;
  readonly resources: readonly PublicResource[];
  readonly model: Model<Api>;
  readonly effort: ThinkingLevel;
  readonly limits: Limits;
  readonly models: (home: string, shutdown: AbortSignal, cwd?: string) => Models;
  readonly verify: Verifier;
  readonly log: string;
  readonly repoRoot: string;
  readonly otherTrees?: readonly string[] | undefined;
  readonly packRoots?: readonly string[] | undefined;
  readonly comparison?: string;
  readonly kill?: AbortSignal;
}

export interface Wall {
  readonly signal: AbortSignal;
  readonly onTurn: () => void;
  readonly onTool: (phase: "start" | "end") => void;
  readonly silentSeconds: number;
  readonly lower: () => void;
}

export interface WallClock {
  readonly now: () => number;
  readonly after: (ms: number, fall: () => void) => () => void;
}

interface Used {
  readonly clock: SolveClock;
  readonly turns: () => number;
  readonly modelTurns: number | undefined;
}

export interface Played {
  readonly crash: string | null;
  readonly broken: string | null;
  readonly harness: string | null;
  readonly turns: readonly AssistantMessage[];
  readonly prompts: number;
  readonly submitted: JsonValue | undefined;
  readonly files?: readonly AnswerFile[];
  readonly flagged: string | undefined;
  readonly wallEnded: boolean;
  readonly silentSeconds: number;
  readonly turnsEnded: boolean;
  readonly moved: boolean;
  readonly homeBytes: number | null;
  readonly network?: NetworkReach;
}

const RERUNS = 3;
export async function waiting(ms: number, kill?: AbortSignal, wait?: (ms: number) => Promise<void>) {
  if (kill?.aborted === true) return;
  const stopped = Promise.withResolvers<void>();
  const abort = () => stopped.resolve();
  kill?.addEventListener("abort", abort, { once: true });
  const timer = wait === undefined ? setTimeout(abort, ms) : undefined;
  try {
    await Promise.race([wait?.(ms) ?? stopped.promise, stopped.promise]);
  } finally {
    clearTimeout(timer);
    kill?.removeEventListener("abort", abort);
  }
}

export async function waitOut(
  log: string,
  said: unknown,
  wait?: (ms: number) => Promise<void>,
  now = new Date(),
  kill?: AbortSignal,
): Promise<boolean> {
  const reset = resetOf(errorMessage(said), now);
  const ms = reset === null ? 0 : reset.getTime() - now.getTime() + 60_000;
  if (reset === null || ms <= 0 || kill?.aborted === true) return false;
  console.log(
    `the provider's limit resets at ${reset.toISOString()}: the campaign waits for it, then goes on`,
  );
  append(log, "campaign.waited", { for: "provider", until: reset.toISOString(), ms });
  await waiting(ms, kill, wait);
  return true;
}

export async function solve(request: SolveRequest, wait?: (ms: number) => Promise<void>): Promise<Ending> {
  for (let attempt = 1, reruns = 0; ; attempt++) {
    const ending = await attemptSolve(request, `${request.id}-${String(attempt)}`);
    const solveSide = ending.outcome === "non-result" && !checkCouldNotRun(ending);
    if (!solveSide) return ending;
    if (
      ending.kind === "provider" &&
      (await waitOut(request.log, ending.reason, wait, new Date(), request.kill))
    ) {
      if (request.kill?.aborted === true) return ending;
      continue;
    }
    if (reruns === RERUNS || (ending.kind === "provider" && nonRetryableProvider(ending.reason))) {
      return ending;
    }
    await waiting(30_000 * 2 ** reruns++, request.kill, wait);
    if (request.kill?.aborted === true) return ending;
  }
}

async function attemptSolve(request: SolveRequest, id: string): Promise<Ending> {
  const { log, model } = request;
  const started = performance.now();
  append(log, "solve.started", {
    solve: id,
    condition: request.condition,
    task: request.task.taskId,
    model: priceKey(model),
    effort: request.effort,
    limits: request.limits,
    load: loadavg(),
    cores: availableParallelism(),
    ...keyIfDefined("comparison", request.comparison),
  });
  const played = await play(request, id);
  const [ending] = await Promise.all([judge(request, id, played), played.released]);
  append(log, "solve.finished", {
    solve: id,
    ending,
    ...played.spent,
    prompts: played.prompts,
    responseModels: [...new Set(played.turns.flatMap((turn) => turn.responseModel ?? []))],
    harness: played.harness,
    homeBytes: played.homeBytes,
    ...keyIfDefined("network", played.network),
    seconds: (performance.now() - started) / 1000,
    load: loadavg(),
  });
  if (ending.outcome === "non-result" && ending.kind === "verifier") {
    throw new Error(
      `the verifier could not decide ${request.task.taskId}, so the run stops: ${ending.reason}`,
    );
  }
  return ending;
}

class BrokenHarness extends Error {}
const brokenHarness = (error: unknown): never => {
  throw new BrokenHarness(errorMessage(error));
};

async function play(
  request: SolveRequest,
  id: string,
): Promise<Played & { readonly spent: AgentRun["spent"]; readonly released: Promise<void> }> {
  const { limits } = request;
  const dirs = solveDirs(id);
  let deadline: Wall | null = null;
  const desk = openDesk();
  const before = treeStamp(request.harness);
  const turns: AssistantMessage[] = [];
  let spentOn: AgentRun["spent"] | null = null;
  let release: ReleaseRoot | null = null;
  let homeBytes: number | null;
  let released: Promise<void> = Promise.resolve();
  let crash: string | null = null;
  let broken: string | null = null;
  let digest: string | null = null;
  let network: NetworkReach | undefined;
  let prompts = 0;
  try {
    release = await claimRoot(dirs.root);
    const base = await sandboxBase(
      dirs,
      { repoRoot: request.repoRoot, otherTrees: request.otherTrees, packRoots: request.packRoots },
      "a solve",
    );
    const seeded = seedHome(dirs.home, request.task, request.resources, request.contract.answerFormat);
    const harness = await openHarness(request.harness).catch(brokenHarness);
    digest = harness.digest;
    const clock: SolveClock = { started: null, seconds: limits.wallSeconds };
    const commandWall: CommandSandbox = { base, dirs, toolTree: harness.toolTree, limits, clock };
    const defined = await Promise.resolve()
      .then(() => solverTools(request, harness, commandWall, desk))
      .catch(brokenHarness);
    network = await networkReach(commandWall, {
      ...keyIfDefined("comparison", request.comparison),
    });
    const prompt = systemPrompt({
      tools: defined,
      home: dirs.home,
      guide: harness.guide,
      wallSeconds: limits.wallSeconds,
      limits,
      ...seeded,
      programs: installedPrograms(harness.toolTree),
      network,
    });
    prompts = 1;
    clock.started = performance.now();
    const raised = raiseWall(limits.wallSeconds);
    deadline = raised;
    const used = { clock, turns: () => turns.length, modelTurns: limits.modelTurns };
    const tools = defined.map((tool) => timed(tool, used));
    const sat = await runAgent({
      models: request.models,
      home: join(dirs.host, "model"),
      cwd: dirs.home,
      id,
      model: request.model,
      effort: request.effort,
      system: prompt,
      opening: firstTurn(request.task),
      tools,
      env: walledEnv(commandWall),
      trace: { log: request.log, of: "solve" },
      turns,
      most: limits.modelTurns,
      onTurn: raised.onTurn,
      onTool: raised.onTool,
      over: () => desk.submitted !== undefined || desk.flagged !== undefined,
      next: async () => {
        if (desk.submitted !== undefined || desk.flagged !== undefined || prompts >= limits.turns) {
          return null;
        }
        prompts += 1;
        return NUDGE;
      },
      stops: [raised.signal, request.kill],
    });
    crash = sat.thrown;
    spentOn = sat.spent;
  } catch (error) {
    if (error instanceof BrokenHarness) broken = error.message;
    else crash = errorMessage(error);
  } finally {
    deadline?.lower();
    homeBytes = bytesUnder(dirs.home);
    if (release !== null) released = release();
  }
  return {
    crash,
    broken,
    harness: digest,
    turns,
    prompts,
    spent: spentOn ?? NOTHING_SPENT,
    submitted: desk.submitted,
    ...keyIfDefined("files", desk.files),
    flagged: desk.flagged,
    wallEnded: deadline?.signal.aborted ?? false,
    silentSeconds: deadline?.silentSeconds ?? 0,
    turnsEnded: limits.modelTurns !== undefined && turns.length >= limits.modelTurns,
    moved: treeStamp(request.harness) !== before,
    homeBytes,
    ...keyIfDefined("network", network),
    released,
  };
}

const PROCESS_CLOCK: WallClock = {
  now: () => performance.now(),
  after: (ms, fall) => {
    const timer = setTimeout(fall, ms);
    return () => clearTimeout(timer);
  },
};

export function raiseWall(seconds: number, clock: WallClock = PROCESS_CLOCK): Wall {
  const fall = new AbortController();
  const raised = clock.now();
  let heard = raised;
  let running = 0;
  let silentSeconds = 0;
  const arm = (ms: number): (() => void) =>
    clock.after(ms, () => {
      const left = seconds * 1000 - (clock.now() - raised);
      if (left > 0) {
        lower = arm(left);
        return;
      }
      if (running === 0) silentSeconds = (clock.now() - heard) / 1000;
      fall.abort();
    });
  let lower = arm(seconds * 1000);
  return {
    signal: fall.signal,
    onTurn: () => {
      heard = clock.now();
    },
    onTool: (phase) => {
      running += phase === "start" ? 1 : -1;
      heard = clock.now();
    },
    get silentSeconds() {
      return silentSeconds;
    },
    lower: () => lower(),
  };
}

export function clockText(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, "0")}`;
}

export function timed(tool: AgentTool, { clock, turns, modelTurns }: Used): AgentTool {
  const line = () =>
    `[Solve time used: ${clockText(usedSeconds(clock) ?? 0)} of ${clockText(clock.seconds)}${
      modelTurns === undefined ? "" : `. Turn ${String(turns())} of ${String(modelTurns)}`
    }]`;
  return {
    ...tool,
    execute: async (args, api, context) => {
      try {
        const result = await tool.execute(args, api, context);
        if (result.output === undefined) {
          api.output(`\n${line()}`);
          return result;
        }
        return { ...result, output: [...result.output, { type: "text", text: line() }] };
      } catch (error) {
        api.output(`\n${line()}`);
        throw error;
      }
    },
  };
}

function solverTools(
  request: { readonly contract: Contract },
  harness: Harness,
  wall: CommandSandbox,
  desk: Desk,
): AgentTool[] {
  return [
    ...codingTools(wall, selectedCodingTools(harness.presets)),
    submitTool(desk, request.contract, wall.dirs.home, wallExec(wall)),
  ];
}

export async function judge(request: SolveRequest, id: string, played: Played): Promise<Ending> {
  if (request.kill?.aborted === true) {
    const reason: unknown = request.kill.reason;
    return {
      outcome: "non-result",
      kind: "killed",
      reason: "the solve was cancelled",
      cancelledBy: reason instanceof Cancellation ? reason.cancelledBy : "caller",
    };
  }
  if (played.moved) {
    return {
      outcome: "non-result",
      kind: "moved-files",
      reason: `${request.harness} changed during the solve`,
    };
  }
  if (played.submitted !== undefined) {
    const fault = answerFormatFault(request.contract.answerFormat, played.submitted);
    const verdict =
      fault === null ? await request.verify(request.task, played.submitted, undefined, played.files) : null;
    append(request.log, "verdict", {
      solve: id,
      task: request.task.taskId,
      answer: played.submitted,
      ...keyIfDefined(
        "files",
        played.files === undefined
          ? undefined
          : keepAnswerFiles(request.log, played.files).map((file) => ({ ...file })),
      ),
      ...(verdict ?? { kind: "fail", fault }),
    });
    if (verdict?.kind === "non-result") {
      return { outcome: "non-result", kind: "verifier", reason: verdict.reason };
    }
    if (verdict?.kind === "faulty") {
      return { outcome: "non-result", kind: "check", reason: `${verdict.check}: ${verdict.reason}` };
    }
    return verdict?.kind === "pass" ? { outcome: "pass" } : { outcome: "fail", kind: "rejected" };
  }
  if (played.flagged !== undefined) return { outcome: "flagged", reason: played.flagged };
  if (played.crash !== null) return { outcome: "non-result", kind: "sandbox-crash", reason: played.crash };
  if (played.broken !== null) return { outcome: "fail", kind: "broken-harness", reason: played.broken };
  return unanswered({
    wallEnded: played.wallEnded,
    silentSeconds: played.silentSeconds,
    turnsEnded: played.turnsEnded,
    last: played.turns.at(-1),
  });
}

function bytesUnder(dir: string): number | null {
  try {
    return pathsUnder(dir).reduce((total, path) => total + lstatSync(join(dir, path)).size, 0);
  } catch {
    return null;
  }
}
