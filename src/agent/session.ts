/**
 * One model session of any seat: the Solver's solve, a Builder's or an Examiner's session, and a
 * Referee's ruling. `sit` runs pi-durable's in-memory Harness on the seat's backends, with its system
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
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  type Api,
  type AssistantMessage,
  type Message,
  type Model,
  type Models,
  type ThinkingLevel,
  type Usage,
} from "@earendil-works/pi-ai";
import { isRetryableAssistantError } from "@earendil-works/pi-ai/utils/retry";
import {
  CompactionTask,
  createRegistry,
  defineExtension,
  GenerationTask,
  Harness,
  hook,
  LiveDoc,
  MemoryStorage,
  ProviderDoc,
  section,
  ToolTask,
  type ToolHookCall,
  type ToolExecutionResult,
  type ToolRegistration,
  type HookApi,
  type CommitPublication,
} from "@earendil-works/pi-durable";
import type { Context, JsonValue } from "@earendil-works/chord";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import type { TSchema } from "typebox";
import { CLAUDE_COMPACTED, reportedCost } from "./backends/claude.ts";
import { retryPolicy } from "./backends/models.ts";
import { compactionPolicy, compactionTrace } from "./backends/compaction.ts";
import { append } from "../kernel/log.ts";
import { dollars, freezePrices, priceKey, tokensOf, type PriceTable } from "../kernel/meter.ts";
import { type Seat as SeatKind, traceKind, whose } from "../kernel/trace.ts";
import { boundText } from "../meta/bounded-text.ts";
import { rmSync } from "../meta/filesystem.ts";
import { isString, type JsonObject } from "../meta/json-shape.ts";
import { keysIf } from "../meta/optional-key.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { hostScratch } from "../wall/policy.ts";

/** A tool as a seat registers one with pi-durable (`defineTool`): its result's `output` is what the
 *  model reads, and `control.terminate` asks that the run end after the round. */
export type SeatTool = ToolRegistration<TSchema, JsonValue>;

/** What a seat hands `sit`. */
export interface Seat {
  /** The backends, built on the home the model's process keeps its state in. `shutdown` aborts when
   *  the session ends or a stop cuts it, and closes what the backend keeps live for it. */
  readonly models: (home: string, shutdown: AbortSignal) => Models;
  /** That home, where the seat has one; a scratch of the host's own is made and removed otherwise,
   *  which every wall closes (`policy.ts`), since the model's process keeps what it was sent. */
  readonly home?: string;
  /** Keys the backend's live state (a Claude Code query, a Codex WebSocket and its prompt cache)
   *  and the seat's trace. */
  readonly id: string;
  readonly model: Model<Api>;
  readonly effort: ThinkingLevel;
  /** The system prompt, whole, as one untagged section. */
  readonly system: string;
  readonly opening: string;
  readonly tools: readonly SeatTool[];
  /** Where every file operation and command of the seat's tools runs, behind its wall
   *  (`walledEnv`, `src/tools/env.ts`); none for a seat whose tools reach no disk. */
  readonly env?: ExecutionEnv;
  /** Where the seat's turns, calls and compactions are logged, under its kind. */
  readonly trace?: { readonly log: string; readonly of: Traced };
  /** Before every model request and every compaction: holds them to the seat's own bounds. A throw
   *  ends the session with what it threw. */
  readonly before?: () => void | Promise<void>;
  /** Where the session's model turns are pushed as they end, metered and traced before their tools
   *  run, which the seat reads its count from while it runs. */
  readonly turns: AssistantMessage[];
  /** The most model turns; none where absent. */
  readonly most?: number | undefined;
  /** Whether the seat's work is done: no model request follows the round, whatever else it called. */
  readonly over?: () => boolean;
  /** What the seat says when a turn ends with no call; none, and the session ends. */
  readonly next?: () => Promise<string | null>;
  /** Each model turn, once it is pushed, metered and traced and before its tools run. */
  readonly onTurn?: (message: AssistantMessage) => void;
  /** Each tool call as it starts and as it ends. */
  readonly onTool?: (phase: "start" | "end", callId: string, tool: string) => void;
  /** Awaited once the session's last round is over, before its signal closes the model's process. */
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
 *  the one in which it drafts the exam, or a Referee ruling. The word prefixes the event kinds
 *  (`draft.turn`), which `src/kernel/trace.ts` reads. */
type Traced = Exclude<SeatKind, "repair">;

/** The text of a result or a turn the trace keeps: more than pi's own tools return of an output
 *  (50 KB), so the trace holds what the solver read. At 4 KB, as v1 cut its traces, it held the
 *  head of a long result, and whoever read a fail afterwards read less than the solver had. */
const TRACE_TEXT_BYTES = 64 * 1024;

/** The trace writer used by durable hooks and by trace-reader fixtures. */
export function traceSink(log: string, of: Traced, id: string, turn: () => number) {
  const named = { [whose(of)]: id };
  const calls = new Map<string, number>();
  return {
    beforeTool: (call: ToolHookCall) => {
      calls.set(call.id, performance.now());
    },
    afterTool: (call: ToolHookCall, result: ToolExecutionResult) => {
      const at = calls.get(call.id);
      calls.delete(call.id);
      append(log, traceKind(of, "call"), {
        ...named,
        toolCallId: call.id,
        turn: turn(),
        tool: call.name,
        args: call.arguments,
        isError: result.isError ?? false,
        text: traceText([
          ...(result.output ?? []),
          ...(result.diagnostics ?? []).map(({ message }) => ({ type: "text", text: message })),
        ]),
        ms: at === undefined ? null : performance.now() - at,
      });
    },
    turn: (message: AssistantMessage, retried: readonly string[] = []) => {
      const { stopReason, errorMessage: error, responseModel, usage, content, diagnostics } = message;
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
        ...keysIf(retried.length > 0, () => ({ retried: [...retried] })),
      });
    },
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

/** One session of `seat`, on one in-memory Harness and one conversation. */
export async function sit(seat: Seat): Promise<Sat> {
  const home = seat.home ?? hostScratch("claude-cli-seat-");
  const summaries: Usage[] = [];
  const prices = freezePrices([seat.model]);
  const stops = seat.stops.filter((stop) => stop !== undefined);
  const done = new AbortController();
  const shutdown = AbortSignal.any([...stops, done.signal]);
  const halt = Promise.withResolvers<void>();
  const frame = sessionHooks(seat, halt.resolve, prices);
  const compactions = compactionTrace(({ usages, ...event }) => {
    const priced = usages.map((usage) => ({
      ...usage,
      cost: { ...usage.cost, total: dollars(prices, priceKey(seat.model), tokensOf([usage])).billed },
    }));
    summaries.push(...priced);
    if (seat.trace !== undefined) {
      append(seat.trace.log, traceKind(seat.trace.of, "compacted"), {
        [whose(seat.trace.of)]: seat.id,
        ...event,
        usages: priced.map((usage) => ({ ...usage })),
      });
    }
  });
  let harness: Harness | undefined;
  const wakeOnStop = () => halt.resolve();
  shutdown.addEventListener("abort", wakeOnStop, { once: true });
  try {
    const registry = createRegistry<SeatTool>();
    registry.install(
      defineExtension({
        name: "seat",
        tools: seat.tools,
        sections: [section("seat", () => seat.system, { tag: false })],
        hooks: [...frame.hooks, hook(CompactionTask, { beforeCompact: frame.before }), compactions.hook],
      }),
    );
    harness = await Harness.open(
      new MemoryStorage(),
      {
        models: seat.models(home, shutdown),
        registry,
        env: () => seat.env,
        settings: {
          toolExecution: "sequential",
          retry: retryPolicy(seat.model.provider),
          compaction: compactionPolicy(seat.model),
        },
        onReport: (error) => {
          frame.fail(error);
        },
      },
      BACKGROUND_CONTEXT,
    );
    harness.subscribeCommits(compactions.committed);
    harness.subscribeCommits(frame.committed);
    const conversation = await harness.root(BACKGROUND_CONTEXT, {
      agent: { model: { provider: seat.model.provider, modelId: seat.model.id }, thinkingLevel: seat.effort },
      init: async (tx, id) => {
        (await tx.doc(ProviderDoc, id)).sessionId = seat.id;
      },
    });
    if (!shutdown.aborted) {
      const input = await conversation.submit({ type: "input", content: seat.opening }, BACKGROUND_CONTEXT);
      await Promise.race([conversation.waitForIdle(BACKGROUND_CONTEXT), halt.promise]);
      const status = await input.status(BACKGROUND_CONTEXT);
      if (
        status.status === "unanswered" &&
        status.reason === "model_error" &&
        seat.turns.at(-1)?.stopReason !== "error"
      ) {
        frame.fail(new Error(isString(status.detail) ? status.detail : "the model run failed"));
      }
    }
    await conversation.abort(BACKGROUND_CONTEXT);
  } catch (error) {
    frame.fail(error);
  } finally {
    try {
      await seat.settle?.();
    } finally {
      done.abort();
      await harness?.close(BACKGROUND_CONTEXT);
      shutdown.removeEventListener("abort", wakeOnStop);
      if (seat.home === undefined) rmSync(home, { recursive: true, force: true });
    }
  }
  const cut = stops.some((stop) => stop.aborted);
  const last = seat.turns.at(-1);
  return {
    cut,
    thrown: frame.thrown,
    crash: cut
      ? null
      : (frame.thrown ??
        (last?.stopReason === "error" ? (last.errorMessage ?? "the provider failed the turn") : null)),
    spent: await spentBy(seat.model, seat.id, seat.turns, [...summaries, ...frame.carried]),
  };
}

/** Hooks cannot throw to end a run: durable reports a hook error and continues. A fence instead
 * wakes sit, which aborts from outside the invocation, then releases the hook's wait by its signal. */
function sessionHooks(seat: Seat, halt: () => void, prices: PriceTable) {
  const sink =
    seat.trace === undefined
      ? undefined
      : traceSink(seat.trace.log, seat.trace.of, seat.id, () => seat.turns.length);
  const tools = toolHooks(seat, sink);
  const retry = retryPolicy(seat.model.provider);
  const retried: string[] = [];
  const carried: Usage[] = [];
  let billedUpTo = 0;
  let thrown: string | null = null;
  const frame = {
    get thrown(): string | null {
      return thrown;
    },
    fail: (error: unknown) => {
      thrown ??= errorMessage(error);
      halt();
    },
  };
  const over = () => seat.over?.() === true || (seat.most !== undefined && seat.turns.length >= seat.most);
  const fence = async (context: Context): Promise<never> => {
    halt();
    const signal = context.abortSignal;
    if (signal === undefined) throw new Error("durable supplied no invocation signal");
    await new Promise<void>((resolve) => {
      if (signal.aborted) resolve();
      else signal.addEventListener("abort", () => resolve(), { once: true });
    });
    throw new Error("the session round ended");
  };
  const before = async (
    _event: { readonly messages: readonly Message[] },
    _api: HookApi,
    context: Context,
  ): Promise<undefined> => {
    try {
      if (over()) return await fence(context);
      await seat.before?.();
      return undefined;
    } catch (error) {
      if (context.abortSignal?.aborted === true) throw error;
      frame.fail(error);
      return await fence(context);
    }
  };
  return Object.assign(frame, {
    before,
    carried,
    committed: tools.committed,
    hooks: [
      hook(GenerationTask, {
        beforeRequest: before,
        afterResponse: async (message, api, context) => {
          try {
            // An error durable is about to retry is no model turn, as a retry inside the stream was
            // none before this migration: a solver's turns are its budget. Its dollars are billed on
            // the turn that follows, which carries `retried`, so the turns' sum stays the session's
            // bill; its tokens stay off that turn, whose usage durable reads as the context's size.
            const attempt =
              (await api.snapshot(LiveDoc, api.conversationId, context))?.generation?.attempt ?? 1;
            if (
              message.stopReason === "error" &&
              retry.enabled &&
              attempt <= retry.maxRetries &&
              isRetryableAssistantError(message)
            ) {
              carried.push(message.usage);
              retried.push(message.errorMessage ?? "provider failure");
              return;
            }
            const owed = carried.slice(billedUpTo);
            billedUpTo = carried.length;
            const billed = dollars(prices, priceKey(seat.model), tokensOf([...owed, message.usage])).billed;
            message.usage.cost = { ...message.usage.cost, total: billed };
            tools.reset();
            seat.turns.push(message);
            sink?.turn(message, retried);
            retried.length = 0;
            seat.onTurn?.(message);
            if (message.stopReason === "error" && over()) await fence(context);
          } catch (error) {
            if (context.abortSignal?.aborted === true) throw error;
            frame.fail(error);
            await fence(context);
          }
        },
        afterTools: async (_assistant, _results, _api, context) => {
          if (over()) await fence(context);
        },
        onYield: async (_message, _api, context) => {
          if (over()) return undefined;
          try {
            const said = await seat.next?.();
            return said === undefined || said === null ? undefined : { continue: said };
          } catch (error) {
            frame.fail(error);
            await fence(context);
            return undefined;
          }
        },
      }),
      tools.hook,
    ],
  });
}

/** Durable bypasses tool hooks for unavailable tools and invalid arguments. Their committed
 * result messages are still calls the model made; record those once, beside executed calls. */
function toolHooks(seat: Seat, sink: ReturnType<typeof traceSink> | undefined) {
  const recorded = new Set<string>();
  const ended = (call: ToolHookCall, result: ToolExecutionResult) => {
    recorded.add(call.id);
    sink?.afterTool(call, result);
    seat.onTool?.("end", call.id, call.name);
    return undefined;
  };
  return {
    reset: () => recorded.clear(),
    hook: hook(ToolTask, {
      beforeTool: (call) => {
        sink?.beforeTool(call);
        seat.onTool?.("start", call.id, call.name);
      },
      afterTool: ended,
    }),
    committed: ({ changes }: CommitPublication) => {
      for (const change of changes) {
        if (change.type !== "entry") continue;
        for (const message of change.value.model ?? []) {
          if (message.role !== "toolResult" || recorded.has(message.toolCallId)) continue;
          const call = seat.turns
            .at(-1)
            ?.content.find((block) => block.type === "toolCall" && block.id === message.toolCallId);
          if (call?.type !== "toolCall") continue;
          seat.onTool?.("start", call.id, call.name);
          ended(call, { output: message.content, isError: message.isError });
        }
      }
    },
  };
}

function traceText(content: readonly { type: string; text?: string }[]): string {
  return boundText(
    content.flatMap((block) => (block.type === "text" ? [block.text ?? ""] : [])).join("\n"),
    TRACE_TEXT_BYTES,
  ).text;
}
