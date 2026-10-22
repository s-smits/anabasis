/**
 * One model session of any seat: the Solver's solve, a Builder's or an Examiner's session, and a
 * Referee's ruling. `sit` runs pi's agent loop on the backends the seat was handed, with its system
 * prompt and tools declared and its opening message, and owns everything the four seats share
 * around it: the model's turns and the cap on them, the end of the loop when the seat's work is
 * over, the seat's next prompt after a turn with no call, one signal over the seat's stops that is
 * aborted when the loop returns (which closes a backend's own process: a Claude Code query stays
 * open until its signal fires), the home the model's process keeps its state in, the trace and the
 * compactions in the log, the crash, and the one sum of the spend the seat's end records. The seat
 * keeps what is its own: its tools, its prompt, its wall, its events and its ending's name.
 *
 * Until 21 October the trace and the spend lived in the solve's runner, which the Builder's and the
 * Examiner's sessions imported for them; until 22 October each of the four spelled the loop's
 * wiring for itself; and until 23 October each spelled this frame around it. `src/kernel/trace.ts`
 * reads back what this writes.
 */
import {
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
  type AgentToolResult,
  type PrepareRequest,
  runAgentLoop,
  type StreamFn,
} from "@earendil-works/pi-agent-core";
import {
  type Api,
  type AssistantMessage,
  createInitialSystemMessage,
  type Model,
  type ThinkingLevel,
  toToolDeclaration,
  type Usage,
} from "@earendil-works/pi-ai";
import { CLAUDE_COMPACTED, reportedCost } from "./backends/claude.ts";
import { CALL_RETRIED } from "./backends/models.ts";
import { type Compacted, compactBeforeRequest } from "./backends/pi-compaction.ts";
import { append } from "../kernel/log.ts";
import { dollars, freezePrices, priceKey, tokensOf } from "../kernel/meter.ts";
import { type Seat as SeatKind, traceKind, whose } from "../kernel/trace.ts";
import { boundText } from "../meta/bounded-text.ts";
import { rmSync } from "../meta/filesystem.ts";
import type { JsonObject, JsonValue } from "../meta/json-shape.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { hostScratch } from "../wall/policy.ts";

/** What a seat hands `sit`. */
export interface Seat {
  /** The backends, built on the home the model's process keeps its state in. `shutdown` aborts when
   *  the session ends or a stop cuts it, and closes what the backend keeps live for it. */
  readonly models: (home: string, shutdown: AbortSignal) => { readonly streamSimple: StreamFn };
  /** That home, where the seat has one; a scratch of the host's own is made and removed otherwise,
   *  which every wall closes (`policy.ts`), since the model's process keeps what it was sent. */
  readonly home?: string;
  /** Keys the backend's live state (a Claude Code query, a Codex WebSocket and its prompt cache)
   *  and the seat's trace. */
  readonly id: string;
  readonly model: Model<Api>;
  readonly effort: ThinkingLevel;
  readonly system: string;
  readonly opening: string;
  readonly tools: readonly AgentTool[];
  /** Where the seat's turns, calls and compactions are logged, under its kind. */
  readonly trace?: { readonly log: string; readonly of: Traced };
  /** Holds each request to the seat's own bounds around its compaction. */
  readonly guard?: (compact: PrepareRequest) => PrepareRequest;
  /** Where the session's model turns are pushed as they end, which the seat reads its count from
   *  while it runs. */
  readonly turns: AssistantMessage[];
  /** The most model turns; none where absent. */
  readonly most?: number | undefined;
  /** Whether the seat's work is done: the loop ends at the end of the turn, whatever else it called. */
  readonly over?: () => boolean;
  /** What the seat says when a turn ends with no call; none, and the loop ends. */
  readonly next?: () => Promise<string | null>;
  /** Meter each turn as its message ends, before its tools run, so that its spend is in the log
   *  before a tool can spend on another seat. */
  readonly early?: boolean;
  readonly emit?: (event: AgentEvent) => void;
  /** Awaited once the loop has returned, before its signal closes the model's process. */
  readonly settle?: () => Promise<void>;
  /** What ends the session from outside: its wall, a kill, a bound. */
  readonly stops: readonly (AbortSignal | undefined)[];
}

/** What a session left: whether one of its stops cut it; what threw out of its loop; its crash,
 *  which is what threw or a last turn the provider failed, and none where a stop cut it; and its
 *  spend. */
export interface Sat {
  readonly cut: boolean;
  readonly thrown: string | null;
  readonly crash: string | null;
  readonly spent: Awaited<ReturnType<typeof spentBy>>;
}

/** Whose trace a log holds: a solve's, a Builder's session, an Examiner's that writes tasks, or
 *  the one in which it drafts the exam. The word prefixes the event kinds (`draft.turn`), which
 *  `src/kernel/trace.ts` reads. */
type Traced = Exclude<SeatKind, "repair">;

/** The text of a result or a turn the trace keeps: more than pi's own tools return of an output
 *  (50 KB), so the trace holds what the solver read. At 4 KB, as v1 cut its traces, it held the
 *  head of a long result, and whoever read a fail afterwards read less than the solver had. */
const TRACE_TEXT_BYTES = 64 * 1024;

/** Every model turn and every tool call into the log, as they end: a solve's as `solve.turn` and
 *  `solve.call` under `solve`, a Builder's or an Examiner's session as `build.`, `exam.` or
 *  `draft.turn` and `.call` under `session`. */
export function traceSink(log: string, of: Traced, id: string, turn: () => number) {
  const named = { [whose(of)]: id };
  const calls = new Map<string, { args: JsonValue; at: number }>();
  return (event: AgentEvent) => {
    if (event.type === "tool_execution_start") {
      // SAFETY: arguments a provider parsed from JSON.
      calls.set(event.toolCallId, { args: event.args as JsonValue, at: performance.now() });
    } else if (event.type === "tool_execution_end") {
      const call = calls.get(event.toolCallId);
      calls.delete(event.toolCallId);
      append(log, traceKind(of, "call"), {
        ...named,
        toolCallId: event.toolCallId,
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
        append(log, traceKind(of, "compacted"), {
          ...named,
          ...(details as JsonObject),
          usages: [],
          error: null,
        });
      }
      append(log, traceKind(of, "turn"), {
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

/** What a seat's model turns and its compactions' summaries spent, as its end records it: its
 *  turns, its tokens, their dollars at `model`'s price, and what Claude Code reported for them.
 *  The one sum a solve's, a Builder's and an Examiner's end carry, which the log's own sum over
 *  the turns of a seat that never ended matches (`unfinished`, `src/kernel/reports.ts`). */
export async function spentBy(
  model: Model<Api>,
  id: string,
  turns: readonly AssistantMessage[],
  summaries: readonly Usage[],
) {
  const tokens = tokensOf([...turns.map((turn) => turn.usage), ...summaries]);
  return {
    turns: turns.length,
    tokens: { ...tokens },
    ...dollars(freezePrices([model]), priceKey(model), tokens),
    reportedCost: await reportedCost(id, turns),
  };
}

/** One session of `seat`, to its end. */
export async function sit(seat: Seat): Promise<Sat> {
  const { id, trace, turns } = seat;
  const home = seat.home ?? hostScratch("claude-cli-seat-");
  const summaries: Usage[] = [];
  const stops = seat.stops.filter((stop) => stop !== undefined);
  const done = new AbortController();
  const shutdown = AbortSignal.any([...stops, done.signal]);
  const traced = trace && traceSink(trace.log, trace.of, id, () => turns.length);
  let thrown: string | null = null;
  try {
    const models = seat.models(home, shutdown);
    // Bound, since pi's `Models` reads its providers through `this`.
    const stream = models.streamSimple.bind(models);
    // Each compaction of pi's own loop (`pi-compaction.ts`) goes into the log as `<of>.compacted`,
    // between the turns it came between, and its summary's usage into the seat's spend.
    const prepare =
      trace &&
      compactBeforeRequest(stream, ({ usages, ...compacted }: Compacted) => {
        summaries.push(...usages);
        append(trace.log, traceKind(trace.of, "compacted"), {
          [whose(trace.of)]: id,
          ...compacted,
          usages: usages.map((usage) => ({ ...usage })),
        });
      });
    const head = createInitialSystemMessage(seat.system, seat.tools.map(toToolDeclaration));
    await runAgentLoop(
      [userTurn(seat.opening)],
      { messages: head === undefined ? [] : [head], tools: [...seat.tools] },
      {
        model: seat.model,
        reasoning: seat.effort,
        toolExecution: "sequential",
        sessionId: id,
        convertToLlm: (messages) => messages,
        ...(prepare && { prepareRequest: seat.guard?.(prepare) ?? prepare }),
        finishTurn: ({ message }) => {
          if (seat.early !== true && message.role === "assistant") turns.push(message);
          const capped = seat.most !== undefined && turns.length >= seat.most;
          return seat.over?.() === true || capped ? { action: "end" } : undefined;
        },
        getFollowUpMessages: async () => {
          const said = (await seat.next?.()) ?? null;
          return said === null ? [] : [userTurn(said)];
        },
      },
      (event) => {
        seat.emit?.(event);
        if (seat.early === true && event.type === "message_end" && event.message.role === "assistant") {
          turns.push(event.message);
          traced?.({ type: "turn_end", message: event.message, toolResults: [] });
        } else if (seat.early !== true || event.type !== "turn_end") {
          traced?.(event);
        }
      },
      shutdown,
      stream,
    );
  } catch (error) {
    thrown = errorMessage(error);
  } finally {
    try {
      await seat.settle?.();
    } finally {
      done.abort();
      if (seat.home === undefined) rmSync(home, { recursive: true, force: true });
    }
  }
  const cut = stops.some((stop) => stop.aborted);
  const last = turns.at(-1);
  return {
    cut,
    thrown,
    // pi's loop ends on a turn the provider failed without a throw, and what the session made
    // before it is half a session, as a crash's is. A turn a stop cut ends the same way and is not.
    crash: cut
      ? null
      : (thrown ??
        (last?.stopReason === "error" ? (last.errorMessage ?? "the provider failed the turn") : null)),
    spent: await spentBy(seat.model, id, turns, summaries),
  };
}

/** A user message, as a seat's loop opens on one and prompts it again. */
function userTurn(content: string): AgentMessage {
  return { role: "user", content, timestamp: Date.now() };
}

function traceText(content: readonly { type: string; text?: string }[]): string {
  const text = content.flatMap((block) => (block.type === "text" ? [block.text ?? ""] : [])).join("\n");
  return boundText(text, TRACE_TEXT_BYTES).text;
}
