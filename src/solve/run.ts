/**
 * One solve, start to ending: a capped home seeded with the public task, pi's coding tools on the
 * command wall with the harness's tools and `submit` beside them, pi's agent loop under the host's
 * wall and turn cap, then the ending typed and logged with the trace and the meter. A non-result from the solve's side is run
 * again, up to three times with backoff; one from the task's own check is returned for the caller to
 * drop the task, and one from the verifier stops the run.
 *
 * The loop runs in this process and so does the model's own process: under the Claude backend,
 * Claude Code runs on the host with a home of its own outside the command wall. v1 confined the
 * model process too (`src/backends/pi-built-child.ts` at 7af7315); here only the commands are walled:
 * the solver's bash, its file tools and every harness tool call alike (`command.ts`).
 *
 * The loop is v1's (`src/backends/pi-built-child.ts:476-498` at 7af7315): tools run one at a time, a
 * model that stops without submitting is nudged, and the turn cap counts the prompts, the opening one
 * and each nudge. Departures, beside those named in the tools and the prompt:
 * - No submit at the wall: a solve the wall ends is a wall-ended fail.
 * - A limit on the model's own turns, where the condition names one (`Limits.modelTurns`): the
 *   solver is told it and how many it has used, and the loop ends after the last one.
 * - A failed model turn ends the attempt as the provider's non-result, which `solve` runs again whole;
 *   v1 nudged once more into the same session unless the failure repeated (`pi-built-child.ts:344-363`).
 */
import {
  type AgentEvent,
  type AgentMessage,
  type AgentToolResult,
  type PrepareRequest,
  runAgentLoop,
  type StreamFn,
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
  type Usage,
} from "@earendil-works/pi-ai";
import { CLAUDE_COMPACTED, REPORTED_COST } from "../backends/claude.ts";
import { CALL_RETRIED } from "../backends/models.ts";
import { type Compacted, compactBeforeRequest } from "../backends/pi-compaction.ts";
import type { Limits } from "../kernel/condition.ts";
import { answerFormatFault, type Contract } from "../kernel/contract.ts";
import { append } from "../kernel/log.ts";
import { dollars, freezePrices, priceKey, tokensOf } from "../kernel/meter.ts";
import type { Ending } from "../kernel/solve.ts";
import type { Task, Verifier } from "../kernel/verify.ts";
import { boundText } from "../meta/bounded-text.ts";
import { lstatSync, mkdirSync, rmSync } from "../meta/filesystem.ts";
import { asRecord, isNumber, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { availableParallelism, loadavg } from "../meta/os.ts";
import { join } from "../meta/path.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { mountDiskCap, type ReleaseDiskCap } from "../verify/disk-cap.ts";
import { solveIsolationPolicy } from "../verify/solve-sandbox.ts";
import {
  createToolDefinitionFromAgentTool,
  wrapToolDefinitions,
} from "../../vendor/pi-coding-agent/core/tools/tool-definition-wrapper.ts";
import { type Desk, openDesk, type PublicResource, submitTool } from "./answer.ts";
import { codingTools, selectedCodingTools, type SolverTool, wallExec } from "./coding-tools.ts";
import { type CommandWall, type SolveClock, solveDirs, usedSeconds } from "./command.ts";
import { type Harness, harnessTools, openHarness, pathsUnder } from "./harness.ts";
import { firstTurn, installedPrograms, NUDGE, type PublicTask, seedHome, systemPrompt } from "./prompt.ts";

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
  /** The comparison the solve is made for, by its id, which every attempt's start then names. A
   *  comparison counts the solves that name it and no other (`src/kernel/compare.ts`); a practice
   *  solve names none. */
  readonly comparison?: string;
  /** Aborts when the run is killed. */
  readonly kill?: AbortSignal;
}

/** Whose trace a log holds: a solve's, a Builder's session, an Examiner's that writes tasks, or
 *  the one in which it drafts the exam. The word prefixes the event kinds (`draft.turn`). */
type Traced = "solve" | "build" | "exam" | "draft";

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
  /** The CPU time of the solve's commands, the solver's and the harness's (`command.ts`). */
  readonly cpu: { readonly seconds: number; readonly unmeasured: number };
  readonly turns: readonly AssistantMessage[];
  /** The prompts the solver was given: the opening one and each nudge. It is what the turn cap
   *  counts (`Limits.turns`), where `turns` holds the model's own turns, of which one prompt may
   *  take many. */
  readonly prompts: number;
  /** What each compaction's summary spent (`pi-compaction.ts`). */
  readonly summaries: readonly Usage[];
  readonly submitted: JsonValue | undefined;
  readonly wallEnded: boolean;
  /** Whether the model used every turn it was given, where it was given a number of them. */
  readonly turnsEnded: boolean;
  readonly moved: boolean;
  readonly homeBytes: number | null;
}

const RERUNS = 3;
/** The text of a result or a turn the trace keeps: more than pi's own tools return of an output
 *  (50 KB), so the trace holds what the solver read. At 4 KB it held the head of a long result, and
 *  whoever read a fail afterwards, a person or the Diagnoser, read less than the solver had. v1 cut
 *  its traces the same way and its own investigation named that as a loss. */
const TRACE_TEXT_BYTES = 64 * 1024;
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
    limits: request.limits,
    // The load with the cores it is a load on: a wall counts the clock, and 30 runnable processes
    // are another host on 12 cores than on 64. Until 2026-10-09 a log held the load alone.
    load: loadavg(),
    cores: availableParallelism(),
    ...keyIfDefined("comparison", request.comparison),
  });
  const played = await play(request, id);
  const ending = await judge(request, id, played);
  const tokens = tokensOf([...played.turns.map((turn) => turn.usage), ...played.summaries]);
  const reported = played.turns
    .flatMap((turn) => turn.diagnostics ?? [])
    .findLast((diagnostic) => diagnostic.type === REPORTED_COST)?.details;
  const reportedCost = asRecord(reported)?.totalCostUsd;
  append(log, "solve.finished", {
    solve: id,
    ending,
    turns: played.turns.length,
    prompts: played.prompts,
    tokens: { ...tokens },
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
  const summaries: Usage[] = [];
  const desk = openDesk();
  const before = treeStamp(request.harness);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let release: ReleaseDiskCap | null = null;
  let homeBytes: number | null;
  let crash: string | null = null;
  let broken: string | null = null;
  let digest: string | null = null;
  const cpu = { seconds: 0, unmeasured: 0 };
  let prompts = 0;
  try {
    release = await mountDiskCap({ root: dirs.root, bytes: limits.diskBytes });
    for (const dir of [dirs.home, dirs.runs, dirs.host]) mkdirSync(dir, { recursive: true });
    const base = solveIsolationPolicy({
      repoRoot: request.repoRoot,
      cap: { root: dirs.root, bytes: limits.diskBytes },
    });
    if ("unsupported" in base) throw new Error(`this host cannot wall a solve: ${base.unsupported}`);
    const resources = seedHome(dirs.home, request.task, request.resources, request.contract.answerFormat);
    const harness = await openHarness(request.harness).catch(brokenHarness);
    digest = harness.digest;
    const clock: SolveClock = { started: null, seconds: limits.wallSeconds };
    const commandWall: CommandWall = { base, dirs, toolTree: harness.toolTree, limits, cpu, clock };
    const defined = await solverTools(request, harness, commandWall, desk).catch(brokenHarness);
    const prompt = systemPrompt({
      tools: defined,
      home: dirs.home,
      guide: harness.guide,
      wallSeconds: limits.wallSeconds,
      limits,
      resources,
      programs: installedPrograms(harness.toolTree),
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
        // After a turn's tool calls have run, so an answer submitted in the last turn is held.
        finishTurn: ({ message }) => {
          if (message.role === "assistant") turns.push(message);
          return spent(turns, limits) ? { action: "end" } : undefined;
        },
        getFollowUpMessages: async () => {
          if (desk.submitted !== undefined || prompts >= limits.turns) return [];
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
    // Read apart from the loop, before the volume goes: a walk that fails voids no solve.
    homeBytes = bytesUnder(dirs.home);
    await release?.();
    rmSync(dirs.host, { recursive: true, force: true });
  }
  return {
    crash,
    broken,
    harness: digest,
    cpu,
    turns,
    prompts,
    summaries,
    submitted: desk.submitted,
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
 * error, and the turn it is in where its turns are limited. Until 2026-10-09 a solver had no clock and was told so. In the two live rounds of that
 * day, five of the six practice solves that failed had submitted an answer the solver's own check
 * had refused, stopping early or out of time, by the operator's account of them
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
 * extension's custom tools are; then `submit`. Every description is the tool's own. Until
 * 2026-10-09 each was led by its authority, "Role: reader." and the like, as v1's prompt named a
 * tool's kind; a solver is told what a tool does and by which name.
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

/** What the provider said when it failed a session's last turn, or null. pi's loop ends there
 *  without a throw, and what the session made before it is half a session, as a crash's is. A turn
 *  the session's own wall, kill or halt cut ends the same way and is not that: the caller says. */
export function failedTurn(turns: readonly AssistantMessage[]): string | null {
  const last = turns.at(-1);
  return last?.stopReason === "error" ? (last.errorMessage ?? "the provider failed the turn") : null;
}

/** Every model turn and every tool call into the log, as they end: a solve's as `solve.turn` and
 *  `solve.call` under `solve`, a Builder's or an Examiner's session as `build.`, `exam.` or
 *  `draft.turn` and `.call` under `session`. */
export function traceSink(log: string, of: Traced, id: string, turn: () => number) {
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
      const { stopReason, errorMessage: error, responseModel, usage, content, diagnostics } = event.message;
      // Claude Code compacts in its own CLI, before the turn; its summary is in the query's cost.
      for (const { type, details } of diagnostics ?? []) {
        if (type !== CLAUDE_COMPACTED) continue;
        // SAFETY: the backend's own diagnostic, numbers and null.
        append(log, `${of}.compacted`, { ...named, ...(details as JsonObject), usages: [], error: null });
      }
      append(log, `${of}.turn`, {
        ...named,
        turn: turn(),
        stopReason,
        error: error ?? null,
        responseModel: responseModel ?? null,
        usage: { ...usage },
        text: traceText(content),
        // `retried`, on a turn whose call a pi-served provider made again (`CALL_RETRIED`).
        ...diagnostics?.find(({ type }) => type === CALL_RETRIED)?.details,
      });
    }
  };
}

/** The `prepareRequest` that compacts pi's own loop through `stream` (`pi-compaction.ts`): each
 *  compaction into the log as `<of>.compacted`, between the turns it came between, and its
 *  summary's usage into `summaries`, which the session's spend counts. */
export function loopCompaction(
  log: string,
  of: Traced,
  id: string,
  stream: StreamFn,
  summaries: Usage[],
): PrepareRequest {
  return compactBeforeRequest(stream, ({ usages, ...compacted }: Compacted) => {
    summaries.push(...usages);
    append(log, `${of}.compacted`, {
      ...(of === "solve" ? { solve: id } : { session: id }),
      ...compacted,
      usages: usages.map((usage) => ({ ...usage })),
    });
  });
}

function traceText(content: readonly { type: string; text?: string }[]): string {
  const text = content.flatMap((block) => (block.type === "text" ? [block.text ?? ""] : [])).join("\n");
  return boundText(text, TRACE_TEXT_BYTES).text;
}

/** The ending of what was played. A kill or a harness that moved voids it; otherwise an answer the
 *  host holds is judged whatever failed after it was submitted, as v1's close rule had it. The
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
    const fault = answerFormatFault(request.contract, played.submitted);
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
  if (played.crash !== null) return { outcome: "non-result", kind: "sandbox-crash", reason: played.crash };
  if (played.broken !== null) return { outcome: "fail", kind: "broken-harness", reason: played.broken };
  if (played.wallEnded) return { outcome: "fail", kind: "wall-ended" };
  if (played.turnsEnded) return { outcome: "fail", kind: "turns-ended" };
  const last = played.turns.at(-1);
  if (last !== undefined && (last.stopReason === "length" || isContextOverflow(last))) {
    return { outcome: "fail", kind: "context-ended" };
  }
  if (last?.stopReason === "error") {
    return {
      outcome: "non-result",
      kind: "provider",
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

/** The bytes under `dir`, or null when the walk fails, as it does when a file goes during it. */
function bytesUnder(dir: string): number | null {
  try {
    return entries(dir).reduce((total, { size }) => total + size, 0);
  } catch {
    return null;
  }
}
