/**
 * One solve, start to ending: a home seeded with the public task, pi's coding tools on the
 * command wall with the harness's tools and `submit` beside them, pi's agent loop under the host's
 * wall and turn cap, then the ending typed and logged with the trace and the meter. A non-result from the solve's side is run
 * again, up to three times with backoff; named provider resets are waited out here without using a
 * rerun. On 21 October, 128 gate solves refused 43 of 1,396 drafts in 30 campaigns at such resets.
 * A task's check non-result returns to its caller; a verifier non-result stops the run.
 *
 * The loop runs in this process and so does the model's own process: under the Claude backend,
 * Claude Code runs on the host with a home of its own outside the command wall. v1 confined the
 * model process too; here only the commands are walled: the solver's bash, its file tools and every
 * harness tool call alike (`command.ts`).
 *
 * The loop is v1's: tools run one at a time, a
 * model that stops without submitting is nudged, and the turn cap counts the prompts, the opening one
 * and each nudge. Departures, beside those named in the tools and the prompt:
 * - No submit at the wall: a solve the wall ends is a wall-ended fail.
 * - A limit on the model's own turns, where the condition names one (`Limits.modelTurns`): the
 *   solver is told it and how many it has used, and the loop ends after the last one.
 * - A failed model turn ends the attempt as the provider's non-result, which `solve` runs again whole;
 *   v1 nudged once more into the same session unless the failure repeated.
 */
import { type AgentMessage, runAgentLoop, type StreamFn } from "@earendil-works/pi-agent-core";
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
import { resetOf } from "../backends/claude.ts";
import type { Limits } from "../kernel/condition.ts";
import { answerFormatFault, type Contract } from "../kernel/contract.ts";
import { append } from "../kernel/log.ts";
import { priceKey } from "../kernel/meter.ts";
import { type Ending, unanswered } from "../kernel/solve.ts";
import type { Task, Verifier } from "../kernel/verify.ts";
import { lstatSync, rmSync } from "../meta/filesystem.ts";
import type { JsonValue } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { availableParallelism, loadavg } from "../meta/os.ts";
import { join } from "../meta/path.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { claimRoot, type ReleaseRoot } from "../verify/seat-root.ts";
import {
  createToolDefinitionFromAgentTool,
  wrapToolDefinitions,
} from "../../vendor/pi-coding-agent/core/tools/tool-definition-wrapper.ts";
import { type Desk, openDesk, type PublicResource, submitTool } from "./answer.ts";
import { codingTools, selectedCodingTools, type SolverTool, wallExec } from "./coding-tools.ts";
import {
  type CommandWall,
  networkReach,
  type SolveClock,
  solveDirs,
  usedSeconds,
  walledBase,
} from "./command.ts";
import { type Harness, harnessTools, openHarness, pathsUnder } from "./harness.ts";
import { installedPrograms } from "./programs.ts";
import { firstTurn, NUDGE, type PublicTask, seedHome, systemPrompt } from "./prompt.ts";
import { loopCompaction, spentBy, traceSink } from "./seat.ts";

export interface SolveRequest {
  /** Names the solve in the log; each attempt is `<id>-<attempt>`. */
  readonly id: string;
  /** The condition's id (`conditionId`), which every attempt's log names. */
  readonly condition: string;
  readonly task: Task;
  readonly contract: Contract;
  /** The harness state's directory, v1's format (`harness.ts`). */
  readonly harness: string;
  readonly resources: readonly PublicResource[];
  readonly model: Model<Api>;
  readonly effort: ThinkingLevel;
  readonly limits: Limits;
  /** The backends, built for one solve on the home its model process keeps its state in. */
  readonly models: (home: string) => Models;
  readonly verify: Verifier;
  readonly log: string;
  /** The repository, closed to every command, and its other worktrees and the stored pack, closed
   *  with it (`Walled`). */
  readonly repoRoot: string;
  readonly otherTrees?: readonly string[] | undefined;
  readonly packRoots?: readonly string[] | undefined;
  /** The comparison the solve is made for, by its id, which every attempt's start then names. A
   *  comparison counts the solves that name it and no other (`src/kernel/compare.ts`); a practice
   *  solve names none. */
  readonly comparison?: string;
  /** Aborts when the run is killed. */
  readonly kill?: AbortSignal;
}

/** What a solve has used of its limits, as its tools are told to say it. */
export interface Used {
  readonly clock: SolveClock;
  /** The model's turns that have ended. A tool call runs inside the turn after them. */
  readonly turns: () => number;
  /** The turns the solve is given; undefined where they are not limited. */
  readonly modelTurns: number | undefined;
}

/** What one attempt left behind for its ending to be read from. */
export interface Played {
  readonly crash: string | null;
  /** Why the harness's tools could not be bundled or listed; null when they were. */
  readonly broken: string | null;
  /** The harness's digest, null when it did not open. */
  readonly harness: string | null;
  readonly turns: readonly AssistantMessage[];
  /** The prompts the solver was given: the opening one and each nudge. It is what the turn cap
   *  counts (`Limits.turns`), where `turns` holds the model's own turns, of which one prompt may
   *  take many. */
  readonly prompts: number;
  /** What each compaction's summary spent (`pi-compaction.ts`). */
  readonly summaries: readonly Usage[];
  readonly submitted: JsonValue | undefined;
  readonly flagged: string | undefined;
  readonly wallEnded: boolean;
  /** Whether the model used every turn it was given, where it was given a number of them. */
  readonly turnsEnded: boolean;
  readonly moved: boolean;
  readonly homeBytes: number | null;
}

const RERUNS = 3;
/** Sleep, including an injected sleep, ends at the request's kill. */
async function waiting(ms: number, kill?: AbortSignal, wait?: (ms: number) => Promise<void>) {
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

/**
 * Whether the campaign waited out the provider limit `said` names, an ending's reason, a throw or a
 * crash's words: where its reset is still ahead, the wait is on record (`for: "provider"`) and slept
 * to a minute past it, however far on, or until `kill`. Until 15 October a week's reset was the
 * environment's ending, and nothing reran buffer-159-opus for 7 h 10 min on 14 October; a long wait
 * is the operator's, or a keeper's (`tools/runs/keep.ts`), to move to another login.
 */
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

/**
 * Solve until an ending that is not the solve side's non-result, or until the reruns run out. A
 * provider's named reset waits without spending a rerun. Every attempt keeps its own id, and a
 * kill during either wait returns the ending and starts nothing.
 */
export async function solve(request: SolveRequest, wait?: (ms: number) => Promise<void>): Promise<Ending> {
  for (let attempt = 1, reruns = 0; ; attempt++) {
    const ending = await attemptSolve(request, `${request.id}-${String(attempt)}`);
    const solveSide = ending.outcome === "non-result" && ending.kind !== "check";
    if (!solveSide) return ending;
    if (
      ending.kind === "provider" &&
      (await waitOut(request.log, ending.reason, wait, new Date(), request.kill))
    ) {
      if (request.kill?.aborted === true) return ending;
      continue;
    }
    if (reruns === RERUNS) return ending;
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
    // The load with the cores it is a load on: a wall counts the clock, and 30 runnable processes
    // are another host on 12 cores than on 64.
    load: loadavg(),
    cores: availableParallelism(),
    ...keyIfDefined("comparison", request.comparison),
  });
  const played = await play(request, id);
  const ending = await judge(request, id, played);
  append(log, "solve.finished", {
    solve: id,
    ending,
    ...(await spentBy(model, id, played.turns, played.summaries)),
    prompts: played.prompts,
    responseModels: [...new Set(played.turns.flatMap((turn) => turn.responseModel ?? []))],
    harness: played.harness,
    homeBytes: played.homeBytes,
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

/** A harness whose tools could not be bundled or listed. */
class BrokenHarness extends Error {}
const brokenHarness = (error: unknown): never => {
  throw new BrokenHarness(errorMessage(error));
};

/** Mount, seed, run the loop, tear down. Anything that throws on the way is the sandbox's crash,
 *  except the harness's opening and listing, which are its own. */
async function play(request: SolveRequest, id: string): Promise<Played> {
  const { limits } = request;
  const dirs = solveDirs(id);
  const wall = new AbortController();
  const done = new AbortController();
  const signal = AbortSignal.any([wall.signal, done.signal, ...(request.kill ? [request.kill] : [])]);
  const turns: AssistantMessage[] = [];
  const summaries: Usage[] = [];
  const desk = openDesk();
  const before = treeStamp(request.harness);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let release: ReleaseRoot | null = null;
  let homeBytes: number | null;
  let crash: string | null = null;
  let broken: string | null = null;
  let digest: string | null = null;
  let prompts = 0;
  try {
    release = claimRoot(dirs.root);
    const base = await walledBase(
      dirs,
      { repoRoot: request.repoRoot, otherTrees: request.otherTrees, packRoots: request.packRoots },
      "a solve",
    );
    const resources = seedHome(dirs.home, request.task, request.resources, request.contract.answerFormat);
    const harness = await openHarness(request.harness).catch(brokenHarness);
    digest = harness.digest;
    const clock: SolveClock = { started: null, seconds: limits.wallSeconds };
    const commandWall: CommandWall = { base, dirs, toolTree: harness.toolTree, limits, clock };
    const defined = await solverTools(request, harness, commandWall, desk).catch(brokenHarness);
    const prompt = systemPrompt({
      tools: defined,
      home: dirs.home,
      guide: harness.guide,
      wallSeconds: limits.wallSeconds,
      limits,
      resources,
      programs: installedPrograms(harness.toolTree),
      network: await networkReach(commandWall),
    });
    const used = { clock, turns: () => turns.length, modelTurns: limits.modelTurns };
    const tools = wrapToolDefinitions(defined.map((tool) => timed(tool, used)));
    const system = createInitialSystemMessage(prompt, tools.map(toToolDeclaration));
    const models = request.models(join(dirs.host, "model"));
    const stream: StreamFn = (model, context, options) => models.streamSimple(model, context, options);
    const user = (content: string): AgentMessage => ({ role: "user", content, timestamp: Date.now() });
    prompts = 1;
    // The wall is the solver's time, so it starts with the first turn rather than the setup.
    clock.started = performance.now();
    timer = setTimeout(() => wall.abort(), limits.wallSeconds * 1000);
    await runAgentLoop(
      [user(firstTurn(request.task))],
      { messages: system === undefined ? [] : [system], tools },
      {
        model: request.model,
        reasoning: request.effort,
        sessionId: id,
        convertToLlm: (messages) => messages,
        toolExecution: "sequential",
        // After a turn's tool calls have run, so an answer submitted in the last turn is held. An
        // accepted submit ends the solve here as its description says, and not only through its
        // `terminate`, which pi heeds when every call of the turn returns it: on esp32 (12 October)
        // 3 of 238 turns sent a submit beside a shell call, and the model was asked on.
        finishTurn: ({ message }) => {
          if (message.role === "assistant") turns.push(message);
          return spent(turns, limits) || desk.submitted !== undefined ? { action: "end" } : undefined;
        },
        getFollowUpMessages: async () => {
          if (desk.submitted !== undefined || desk.flagged !== undefined || prompts >= limits.turns) {
            return [];
          }
          prompts += 1;
          return [user(NUDGE)];
        },
        prepareRequest: loopCompaction(request.log, "solve", id, stream, summaries),
      },
      traceSink(request.log, "solve", id, () => turns.length),
      signal,
      stream,
    );
  } catch (error) {
    if (error instanceof BrokenHarness) broken = error.message;
    else crash = errorMessage(error);
  } finally {
    clearTimeout(timer);
    done.abort();
    // Read apart from the loop, before the root goes: a walk that fails voids no solve.
    homeBytes = bytesUnder(dirs.home);
    await release?.();
    rmSync(dirs.host, { recursive: true, force: true });
  }
  return {
    crash,
    broken,
    harness: digest,
    turns,
    prompts,
    summaries,
    submitted: desk.submitted,
    flagged: desk.flagged,
    wallEnded: wall.signal.aborted,
    turnsEnded: spent(turns, limits),
    moved: treeStamp(request.harness) !== before,
    homeBytes,
  };
}

/** `m:ss`, as the solve's clock is told. */
export function clockText(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, "0")}`;
}

/** Whether the model has used every turn the condition gives it; never, where it names no number. */
function spent(turns: readonly AssistantMessage[], { modelTurns }: Pick<Limits, "modelTurns">): boolean {
  return modelTurns !== undefined && turns.length >= modelTurns;
}

/**
 * A solver's tool with the solve time used as the last line of whatever it returns, a result or an
 * error, and the turn it is in where its turns are limited. When a solver had no clock, in two live
 * rounds of 9 October, five of the six practice solves that failed had submitted an answer the
 * solver's own check had refused, stopping early or out of time, by the operator's account of them
 * (`docs/transfer.md`). What a solver does with its time is its own to decide; this says what the
 * time is.
 */
export function timed(tool: SolverTool, { clock, turns, modelTurns }: Used): SolverTool {
  const line = () =>
    `[Solve time used: ${clockText(usedSeconds(clock) ?? 0)} of ${clockText(clock.seconds)}${
      modelTurns === undefined ? "" : `. Turn ${String(turns() + 1)} of ${String(modelTurns)}`
    }]`;
  return {
    ...tool,
    execute: async (...call) => {
      try {
        const result = await tool.execute(...call);
        return { ...result, content: [...result.content, { type: "text", text: line() }] };
      } catch (error) {
        throw new Error(`${errorMessage(error)}\n\n${line()}`, { cause: error });
      }
    },
  };
}

/**
 * What a solver is given, in the order pi gives a coding agent its tools: pi's own coding tools, as
 * many as the harness's presets select; then the harness's domain tools, which are to pi what an
 * extension's custom tools are; then `submit`. Every description is the tool's own, and none is led
 * by the tool's kind, as v1's prompt led it: a solver is told what a tool does and by which name.
 */
export async function solverTools(
  request: { readonly task: PublicTask; readonly contract: Contract },
  harness: Harness,
  wall: CommandWall,
  desk: Desk,
): Promise<SolverTool[]> {
  const coding = codingTools(wall, selectedCodingTools(harness.presets));
  const domain = (await harnessTools(harness, request.task, wall)).map(createToolDefinitionFromAgentTool);
  return [...coding, ...domain, submitTool(desk, request.contract, wall.dirs.home, wallExec(wall))];
}

/** The ending of what was played. A kill or a harness that moved voids it; otherwise an answer the
 *  host holds is judged whatever failed after it was submitted, as v1's close rule had it, a flag
 *  the host holds ends it flagged, and a last turn the provider failed is a non-result. The
 *  answer is checked against the contract's format by the host before any check reads it, then
 *  judged; a verdict is logged either way, with the answer, so that a fail can be read and regraded
 *  from the log alone. */
export async function judge(request: SolveRequest, id: string, played: Played): Promise<Ending> {
  if (request.kill?.aborted === true) {
    return { outcome: "non-result", kind: "killed", reason: "the run was killed" };
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
    const verdict = fault === null ? await request.verify(request.task, played.submitted) : null;
    append(request.log, "verdict", {
      solve: id,
      task: request.task.taskId,
      answer: played.submitted,
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
  // A flag the host holds stands as an answer does, whatever failed after it.
  if (played.flagged !== undefined) return { outcome: "flagged", reason: played.flagged };
  if (played.crash !== null) return { outcome: "non-result", kind: "sandbox-crash", reason: played.crash };
  if (played.broken !== null) return { outcome: "fail", kind: "broken-harness", reason: played.broken };
  return unanswered({
    wallEnded: played.wallEnded,
    turnsEnded: played.turnsEnded,
    last: played.turns.at(-1),
  });
}

/** Each entry under `dir` by path, size and modification time, links unfollowed. */
function entries(dir: string) {
  return pathsUnder(dir).map((path) => {
    const stat = lstatSync(join(dir, path));
    return { path, size: stat.size, mtime: stat.mtimeMs };
  });
}

/** What moved-files compares: a file added, removed, resized or rewritten changes it. */
function treeStamp(dir: string): string {
  return hashJsonValue(entries(dir));
}

/** The bytes under `dir`, or null when the walk fails, as it does when a file goes during it. */
function bytesUnder(dir: string): number | null {
  try {
    return entries(dir).reduce((total, { size }) => total + size, 0);
  } catch {
    return null;
  }
}
