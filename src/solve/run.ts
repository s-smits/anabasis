/**
 * One solve, start to ending: a capped home seeded with the public task, the harness's tools beside
 * the host's answer tools and its bash, pi's agent loop under the host's wall and turn cap, then the
 * ending typed and logged with the trace and the meter. A non-result from the solve's side is run
 * again, up to three times with backoff; one from the task's own check is returned for the caller to
 * drop the task, and one from the verifier stops the run.
 *
 * The loop runs in this process and so does the model's own process: under the Claude backend,
 * Claude Code runs on the host with a home of its own outside the command wall. v1 confined the
 * model process too (`src/backends/pi-built-child.ts` at 7af7315); here only the commands are walled,
 * the solver's bash and every harness tool call alike (`command.ts`).
 *
 * The loop is v1's (`src/backends/pi-built-child.ts:476-498` at 7af7315): tools run one at a time, a
 * model that stops without submitting is nudged, and the turn cap counts the prompts, the opening one
 * and each nudge. Departures, beside those named in the tools and the prompt:
 * - No submit at the wall: a solve the wall ends is a wall-ended fail.
 * - A failed model turn ends the attempt as the provider's non-result, which `solve` runs again whole;
 *   v1 nudged once more into the same session unless the failure repeated (`pi-built-child.ts:344-363`).
 */
import {
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
  type AgentToolResult,
  runAgentLoop,
} from "@earendil-works/pi-agent-core";
import {
  type Api,
  type AssistantMessage,
  createInitialSystemMessage,
  isContextOverflow,
  type Model,
  type Models,
  type ThinkingLevel,
  toToolDeclaration,
} from "@earendil-works/pi-ai";
import { REPORTED_COST } from "../backends/claude.ts";
import type { Limits } from "../kernel/condition.ts";
import { answerFormatFault, type Contract } from "../kernel/contract.ts";
import { append } from "../kernel/log.ts";
import { dollars, freezePrices, priceKey, tokensOf } from "../kernel/meter.ts";
import type { Ending } from "../kernel/solve.ts";
import type { Task, Verifier } from "../kernel/verify.ts";
import { boundText } from "../meta/bounded-text.ts";
import { lstatSync, mkdirSync, rmSync } from "../meta/filesystem.ts";
import { asRecord, isNumber, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import { loadavg } from "../meta/os.ts";
import { join } from "../meta/path.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { mountDiskCap, type ReleaseDiskCap } from "../verify/disk-cap.ts";
import { solveIsolationPolicy } from "../verify/solve-sandbox.ts";
import {
  type Desk,
  deskTools,
  openDesk,
  type PublicResource,
  publicResourcesTool,
  recordTool,
} from "./answer.ts";
import { type CommandWall, solveDirs } from "./command.ts";
import { type Harness, harnessTools, openHarness, pathsUnder } from "./harness.ts";
import { firstTurn, NUDGE, seedHome, systemPrompt } from "./prompt.ts";
import { shellTool } from "./shell.ts";

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
  /** The repository, closed to every command. */
  readonly repoRoot: string;
  /** Aborts when the run is killed. */
  readonly kill?: AbortSignal;
}

/** What one attempt left behind for its ending to be read from. */
export interface Played {
  readonly crash: string | null;
  /** Why the harness's tools could not be bundled or listed; null when they were. */
  readonly broken: string | null;
  /** The harness's digest, null when it did not open. */
  readonly harness: string | null;
  /** The CPU time of the solve's commands, the solver's and the harness's (`command.ts`). */
  readonly cpu: { readonly seconds: number; readonly unmeasured: number };
  readonly turns: readonly AssistantMessage[];
  readonly submitted: JsonValue | undefined;
  readonly wallEnded: boolean;
  readonly moved: boolean;
  readonly homeBytes: number | null;
}

const RERUNS = 3;
/** The text of a result or a turn the trace keeps: more than pi's own tools return of an output
 *  (50 KB), so the trace holds what the solver read. At 4 KB it held the head of a long result, and
 *  whoever read a fail afterwards, a person or the Diagnoser, read less than the solver had. v1 cut
 *  its traces the same way and its own investigation named that as a loss. */
const TRACE_TEXT_BYTES = 64 * 1024;
/** Each tool's authority, as v1's prompt named it (built-starter.ts:518-522, built-presets.ts:20-24). */
const ROLES: Readonly<Record<string, string>> = {
  read_public_resources: "reader",
  bash: "writer",
  save_candidate: "reader",
  restore_candidate: "writer",
  inspect_draft: "reader",
  preview_artifact: "reader",
  submit: "submission",
};

const backoff = (rerun: number) => Bun.sleep(30_000 * 2 ** (rerun - 1));

/** Solve until an ending that is not the solve side's non-result, or until the reruns run out. */
export async function solve(request: SolveRequest, wait = backoff): Promise<Ending> {
  for (let attempt = 1; ; attempt++) {
    const ending = await attemptSolve(request, `${request.id}-${String(attempt)}`);
    const solveSide = ending.outcome === "non-result" && ending.kind !== "check";
    if (!solveSide || attempt > RERUNS || request.kill?.aborted === true) return ending;
    await wait(attempt);
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
    // SAFETY: the limits are plain numbers.
    limits: request.limits as unknown as JsonObject,
    load: loadavg(),
  });
  const played = await play(request, id);
  const ending = await judge(request, id, played);
  const tokens = tokensOf(played.turns.map((turn) => turn.usage));
  const reported = played.turns
    .flatMap((turn) => turn.diagnostics ?? [])
    .findLast((diagnostic) => diagnostic.type === REPORTED_COST)?.details;
  const reportedCost = asRecord(reported)?.totalCostUsd;
  append(log, "solve.finished", {
    solve: id,
    ending,
    turns: played.turns.length,
    // SAFETY: the token classes are numbers.
    tokens: tokens as unknown as JsonObject,
    ...dollars(freezePrices([model]), priceKey(model), tokens),
    reportedCost: isNumber(reportedCost) ? reportedCost : null,
    responseModels: [...new Set(played.turns.flatMap((turn) => turn.responseModel ?? []))],
    harness: played.harness,
    cpu: played.cpu,
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
  const desk = openDesk();
  const before = treeStamp(request.harness);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let release: ReleaseDiskCap | null = null;
  let homeBytes: number | null = null;
  let crash: string | null = null;
  let broken: string | null = null;
  let digest: string | null = null;
  const cpu = { seconds: 0, unmeasured: 0 };
  try {
    release = await mountDiskCap({ root: dirs.root, bytes: limits.diskBytes });
    for (const dir of [dirs.home, dirs.runs, dirs.host]) mkdirSync(dir, { recursive: true });
    const base = solveIsolationPolicy({
      repoRoot: request.repoRoot,
      cap: { root: dirs.root, bytes: limits.diskBytes },
    });
    if ("unsupported" in base) throw new Error(`this host cannot wall a solve: ${base.unsupported}`);
    const files = seedHome(dirs.home, request.task, request.resources);
    const harness = await openHarness(request.harness).catch(brokenHarness);
    digest = harness.digest;
    const commandWall: CommandWall = { base, dirs, toolTree: harness.toolTree, limits, cpu };
    const tools = await solverTools(request, harness, commandWall, desk, files).catch(brokenHarness);
    const prompt = systemPrompt(
      limits.wallSeconds,
      tools.map(({ name }) => name),
      harness.guide,
    );
    const system = createInitialSystemMessage(prompt, tools.map(toToolDeclaration));
    const models = request.models(join(dirs.host, "model"));
    const user = (content: string): AgentMessage => ({ role: "user", content, timestamp: Date.now() });
    let prompts = 1;
    // The wall is the solver's time, so it starts with the first turn rather than the setup.
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
        finishTurn: ({ message }) => {
          if (message.role === "assistant") turns.push(message);
        },
        getFollowUpMessages: async () =>
          desk.submitted !== undefined || prompts++ >= limits.turns ? [] : [user(NUDGE)],
      },
      traceSink(request.log, "solve", id, () => turns.length),
      signal,
      (model, context, options) => models.streamSimple(model, context, options),
    );
    homeBytes = bytesUnder(dirs.home);
  } catch (error) {
    if (error instanceof BrokenHarness) broken = error.message;
    else crash = errorMessage(error);
  } finally {
    clearTimeout(timer);
    done.abort();
    await release?.();
    rmSync(dirs.host, { recursive: true, force: true });
  }
  return {
    crash,
    broken,
    harness: digest,
    cpu,
    turns,
    submitted: desk.submitted,
    wallEnded: wall.signal.aborted,
    moved: treeStamp(request.harness) !== before,
    homeBytes,
  };
}

/** The harness's domain tools, its artifact-writer bound to the contract, then the host's own, each
 *  description led by its authority as v1's prompt gave it (built-starter.ts:120-153). */
export async function solverTools(
  request: Pick<SolveRequest, "task" | "contract" | "resources">,
  harness: Harness,
  wall: CommandWall,
  desk: Desk,
  files: number,
): Promise<AgentTool[]> {
  const other = harness.presets.filter((preset) => preset !== "shell");
  if (other.length > 0) throw new Error(`a v2 solve serves the shell preset alone, not ${other.join(", ")}`);
  const domain = (await harnessTools(harness, request.task, wall)).map(({ kind, tool }) => ({
    role: kind,
    tool: kind === "artifact-writer" ? recordTool(tool, request.contract, desk) : tool,
  }));
  const host = [
    ...(request.resources.length > 0 ? [publicResourcesTool(request.resources)] : []),
    ...(harness.presets.includes("shell") ? [shellTool(wall, files)] : []),
    ...deskTools(desk),
  ].map((tool) => ({ role: ROLES[tool.name], tool }));
  return [...domain, ...host].map(({ role, tool }) => ({
    ...tool,
    description: `Role: ${String(role)}. ${tool.description}`,
  }));
}

/** Every model turn and every tool call into the log, as they end: a solve's as `solve.turn` and
 *  `solve.call` under `solve`, a Builder session's as `build.turn` and `build.call` under `session`. */
export function traceSink(log: string, of: "solve" | "build", id: string, turn: () => number) {
  const named = of === "solve" ? { solve: id } : { session: id };
  const calls = new Map<string, { args: JsonValue; at: number }>();
  return (event: AgentEvent) => {
    if (event.type === "tool_execution_start") {
      // SAFETY: arguments a provider parsed from JSON.
      calls.set(event.toolCallId, { args: event.args as JsonValue, at: performance.now() });
    } else if (event.type === "tool_execution_end") {
      const call = calls.get(event.toolCallId);
      calls.delete(event.toolCallId);
      append(log, `${of}.call`, {
        ...named,
        turn: turn(),
        tool: event.toolName,
        args: call?.args ?? null,
        isError: event.isError,
        // SAFETY: pi passes the tool's result, or the error result it built for the call.
        text: traceText((event.result as AgentToolResult).content),
        ms: call === undefined ? null : performance.now() - call.at,
      });
    } else if (event.type === "turn_end" && event.message.role === "assistant") {
      const { stopReason, errorMessage: error, responseModel, usage, content } = event.message;
      append(log, `${of}.turn`, {
        ...named,
        turn: turn(),
        stopReason,
        error: error ?? null,
        responseModel: responseModel ?? null,
        // SAFETY: pi's usage is numbers.
        usage: usage as unknown as JsonObject,
        text: traceText(content),
      });
    }
  };
}

function traceText(content: readonly { type: string; text?: string }[]): string {
  const text = content.flatMap((block) => (block.type === "text" ? [block.text ?? ""] : [])).join("\n");
  return boundText(text, TRACE_TEXT_BYTES).text;
}

/** The ending of what was played. A submitted answer is checked against the contract's format by
 *  the host before any check reads it, then judged; a verdict is logged either way, with the answer,
 *  so that a fail can be read and regraded from the log alone. */
export async function judge(request: SolveRequest, id: string, played: Played): Promise<Ending> {
  if (played.crash !== null) return { outcome: "non-result", kind: "sandbox-crash", reason: played.crash };
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
    const fault = answerFormatFault(request.contract, played.submitted);
    const verdict = fault === null ? await request.verify(request.task, played.submitted) : null;
    // SAFETY: a verdict is strings alone.
    const logged = (verdict ?? { kind: "fail", fault }) as unknown as JsonObject;
    append(request.log, "verdict", {
      solve: id,
      task: request.task.taskId,
      answer: played.submitted,
      ...logged,
    });
    if (verdict?.kind === "non-result") {
      return { outcome: "non-result", kind: "verifier", reason: verdict.reason };
    }
    if (verdict?.kind === "faulty") {
      return { outcome: "non-result", kind: "check", reason: `${verdict.check}: ${verdict.reason}` };
    }
    return verdict?.kind === "pass" ? { outcome: "pass" } : { outcome: "fail", kind: "rejected" };
  }
  if (played.broken !== null) return { outcome: "fail", kind: "broken-harness", reason: played.broken };
  if (played.wallEnded) return { outcome: "fail", kind: "wall-ended" };
  const last = played.turns.at(-1);
  if (last !== undefined && (last.stopReason === "length" || isContextOverflow(last))) {
    return { outcome: "fail", kind: "context-ended" };
  }
  if (last?.stopReason === "error") {
    return {
      outcome: "non-result",
      kind: "refusal",
      reason: last.errorMessage ?? "the provider failed the turn",
    };
  }
  return { outcome: "fail", kind: "no-answer" };
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

function bytesUnder(dir: string): number {
  return entries(dir).reduce((total, { size }) => total + size, 0);
}
