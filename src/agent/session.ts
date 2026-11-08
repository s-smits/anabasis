/**
 * One model session of any seat: the Solver's solve, a Builder's or an Examiner's session, and a
 * Referee's ruling. `sit` runs pi-durable's in-memory Harness on the seat's backends, with its system
 * prompt and tools declared and its opening message, and owns everything the four seats share
 * around it: the model's turns and the cap on them, the end of the loop when the seat's work is
 * over, the seat's next prompt after a turn with no call, one signal over the seat's stops that is
 * aborted when the loop returns (which closes a backend's own process: a Claude Code query stays
 * open until its signal fires), the home the model's process keeps its state in, the trace and the
 * compactions in the log, the crash, and the one sum of the spend the seat's end records. The seat
 * keeps what is its own: its tools, its prompt, its events and its ending's name, and how long its
 * deadline runs and what pauses it, on the one timer `sessionClock` keeps.
 *
 * Until 21 October the trace and the spend lived in the solve's runner, which the Builder's and the
 * Examiner's sessions imported for them; until 22 October each of the four spelled the loop's
 * wiring for itself; and until 23 October each spelled this frame around it. `src/kernel/trace.ts`
 * reads back what this writes.
 * The session's bill is its backend's own ledger at the host's frozen prices (`src/kernel/meter.ts`):
 * Claude Code's last result, or pi-durable's `pi.usage` for every other backend, a retried attempt
 * and a compaction summary included. Each turn is still priced as it ends, for the cap a seat reads
 * while it runs and for a seat that never ended: at the model that served it, as its provider's
 * catalogue lists it, and at the requested model's otherwise. Until 25 October every turn was billed
 * at the requested model: recode's seats
 * asked for claude-opus-5-5 and Claude Code answered all 1,898 recorded turns of one campaign as
 * claude-opus-5, a quarter dearer per input and output token and two and a half times per cache
 * read, so calculated spend on recode's three campaigns ran 31 to 35% under what Claude Code reported
 * for the same endings, and the cap, the score bills and the reports with it. Priced at the served
 * model, the same endings come within 3 to 7% of Claude Code's totals.
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Api, AssistantMessage, Message, Model, Models, ThinkingLevel } from "@earendil-works/pi-ai";
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
  type UsageState,
} from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import { CLAUDE_COMPACTED, claudeLedger } from "./backends/claude.ts";
import { retryPolicy } from "./backends/models.ts";
import { compactionPolicy, compactionTrace } from "./backends/compaction.ts";
import { append } from "../kernel/log.ts";
import { durableSpend, seatMeter, type Spent } from "../kernel/meter.ts";
import { type Seat as SeatKind, traceKind, whose } from "../kernel/trace.ts";
import { boundText } from "../meta/bounded-text.ts";
import { Cancellation } from "../kernel/solve.ts";
import { rmSync } from "../meta/filesystem.ts";
import { isString, type JsonObject } from "../meta/json-shape.ts";
import { keysIf } from "../meta/optional-key.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { hostScratch } from "../wall/policy.ts";

/** A tool as a seat registers one with pi-durable (`defineTool`): its result's `output` is what the
 *  model reads, and `control.terminate` asks that the run end after the round. */
export type SeatTool = ToolRegistration;

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
  /** Where the seat's turns, calls and compactions are logged, under its kind, and under `as` at
   *  each write where the seat's work is named apart from its conversation: an Examiner's ask. */
  readonly trace?: { readonly log: string; readonly of: SeatKind; readonly as?: () => string };
  /** Before every model request and every compaction: holds them to the seat's own bounds. A throw
   *  ends the session with what it threw. */
  readonly before?: () => void | Promise<void>;
  /** Where the session's model turns are pushed as they end, metered and traced before their tools
   *  run, which the seat reads its count from while it runs. */
  readonly turns: AssistantMessage[];
  /** The model turn limit; none where absent. */
  readonly most?: number | undefined;
  /** Whether the seat's work is done: no model request follows the round, whatever else it called. */
  readonly over?: () => boolean;
  /** What the seat says when a turn ends with no call; none, and the session ends. */
  readonly next?: () => Promise<string | null>;
  /** Each model turn, once it is pushed, metered and traced and before its tools run. */
  readonly onTurn?: (message: AssistantMessage) => void;
  /** Each tool call as it starts and as it ends. */
  readonly onTool?: (phase: "start" | "end", callId: string, tool: string) => void;
  /** What ends the session from outside: its deadline, a kill, a bound. */
  readonly stops: readonly (AbortSignal | undefined)[];
}

/** What a session left: whether one of its stops cut it; what threw out of its loop; its crash,
 *  which is what threw or a last turn the provider failed, and none where a stop cut it; and its
 *  spend. */
export interface Sat {
  readonly cut: boolean;
  readonly thrown: string | null;
  readonly crash: string | null;
  readonly spent: Spent;
}

/** The text of a result or a turn the trace keeps: more than pi's own tools return of an output
 *  (50 KB), so the trace holds what the solver read. At 4 KB, as v1 cut its traces, it held the
 *  head of a long result, and whoever read a fail afterwards read less than the solver had. */
const TRACE_TEXT_BYTES = 64 * 1024;

/** The trace writer used by durable hooks and by trace-reader fixtures. */
export function traceSink(log: string, of: SeatKind, id: string | (() => string), turn: () => number) {
  const named = () => ({ [whose(of)]: isString(id) ? id : id() });
  // A call is traced under the session it started in: an Examiner's `finish` rests its ask inside
  // the call and wakes in the next, whose id the trace would otherwise give it (5 November).
  const calls = new Map<string, { at: number; whose: ReturnType<typeof named> }>();
  return {
    beforeTool: (call: ToolHookCall) => {
      calls.set(call.id, { at: performance.now(), whose: named() });
    },
    afterTool: (call: ToolHookCall, result: ToolExecutionResult) => {
      const started = calls.get(call.id);
      calls.delete(call.id);
      append(log, traceKind(of, "call"), {
        ...(started?.whose ?? named()),
        toolCallId: call.id,
        turn: turn(),
        tool: call.name,
        args: call.arguments,
        isError: result.isError ?? false,
        text: traceText([
          ...(result.output ?? []),
          ...(result.diagnostics ?? []).map(({ message }) => ({ type: "text", text: message })),
        ]),
        ms: started === undefined ? null : performance.now() - started.at,
      });
    },
    turn: (message: AssistantMessage, retried: readonly string[] = []) => {
      const { stopReason, errorMessage: error, responseModel, usage, content, diagnostics } = message;
      for (const { type, details } of diagnostics ?? []) {
        if (type !== CLAUDE_COMPACTED) continue;
        // SAFETY: the backend's own diagnostic, numbers and null.
        append(log, traceKind(of, "compacted"), {
          ...named(),
          ...(details as JsonObject),
          usages: [],
          error: null,
        });
      }
      append(log, traceKind(of, "turn"), {
        ...named(),
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

/** One session of `seat`, on one in-memory Harness and one conversation. */
export async function sit(seat: Seat): Promise<Sat> {
  const home = seat.home ?? hostScratch("claude-cli-seat-");
  const meter = seatMeter(seat.model);
  const stops = seat.stops.filter((stop) => stop !== undefined);
  const done = new AbortController();
  const shutdown = AbortSignal.any([...stops, done.signal]);
  const halt = Promise.withResolvers<void>();
  const frame = sessionHooks(seat, halt.resolve, meter);
  // Each summary's spend is traced at its price, one usage a model; the session's bill holds it
  // through the backend's ledger, so it is priced here for the trace alone.
  const compactions = compactionTrace(({ spent, ...event }) => {
    if (seat.trace === undefined) return;
    append(seat.trace.log, traceKind(seat.trace.of, "compacted"), {
      [whose(seat.trace.of)]: seat.trace.as?.() ?? seat.id,
      ...event,
      usages: meter.rows(spent),
    });
  });
  let harness: Harness | undefined;
  let usage: UsageState | null;
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
    const models = seat.models(home, shutdown);
    meter.catalogue(models);
    harness = await Harness.open(
      new MemoryStorage(),
      {
        models,
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
    done.abort();
    // pi-durable's ledger is read before the close, which drops it.
    usage = (await harness?.usage(BACKGROUND_CONTEXT).catch(() => null)) ?? null;
    await harness?.close(BACKGROUND_CONTEXT);
    shutdown.removeEventListener("abort", wakeOnStop);
    if (seat.home === undefined) rmSync(home, { recursive: true, force: true });
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
    // Claude Code's last result where a query of this process served the seat, else pi-durable's.
    spent: meter.spent(
      seat.turns,
      (await claudeLedger(seat.id)) ?? (usage === null ? null : durableSpend(usage)),
    ),
  };
}

/** Hooks cannot throw to end a run: durable reports a hook error and continues. A fence instead
 * wakes sit, which aborts from outside the invocation, then releases the hook's wait by its signal. */
function sessionHooks(seat: Seat, halt: () => void, meter: ReturnType<typeof seatMeter>) {
  const sink =
    seat.trace === undefined
      ? undefined
      : traceSink(seat.trace.log, seat.trace.of, seat.trace.as ?? seat.id, () => seat.turns.length);
  const tools = toolHooks(seat, sink);
  const retry = retryPolicy(seat.model.provider);
  const retried: string[] = [];
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
    committed: tools.committed,
    hooks: [
      hook(GenerationTask, {
        beforeRequest: before,
        afterResponse: async (message, api, context) => {
          try {
            // An error durable is about to retry is no model turn, as a retry inside the stream was
            // none before this migration: a solver's turns are its budget. The turn that follows
            // carries `retried`; the attempt's spend is in durable's own ledger, which the session's
            // bill reads (`sit`), and in no turn's.
            const attempt =
              (await api.snapshot(LiveDoc, api.conversationId, context))?.generation?.attempt ?? 1;
            if (
              message.stopReason === "error" &&
              retry.enabled &&
              attempt <= retry.maxRetries &&
              isRetryableAssistantError(message)
            ) {
              retried.push(message.errorMessage ?? "provider failure");
              return;
            }
            message.usage.cost = { ...message.usage.cost, total: meter.turn(message) };
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

/** A seat's own deadline, one timer that pauses while the host works (`within`): the Builder's while a
 *  campaign action runs. Overlapping waits share one interval; the last to end arms the remaining
 *  allowance, unless the owner has closed it. Until 28 October the Builder and the Examiner each
 *  kept a copy, and the Builder's neither nested nor named its cancellation; until 1 November the
 *  Examiner's paused while it awaited its gate's room solves; a drafting session's pauses while the
 *  host reads a draft, and a writing session's while the reference harness tries an instance. */
export function sessionClock(began: number, seconds: number) {
  const deadline = new AbortController();
  let aside = 0;
  let since = 0;
  let depth = 0;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hostMilliseconds = () => aside + (depth === 0 ? 0 : performance.now() - since);
  const ownSeconds = () => (performance.now() - began - hostMilliseconds()) / 1000;
  const arm = () => {
    clearTimeout(timer);
    if (closed || deadline.signal.aborted) return;
    timer = setTimeout(
      () => deadline.abort(new Cancellation("session-wall")),
      Math.max(0, (seconds - ownSeconds()) * 1000),
    );
  };
  arm();
  return {
    began,
    signal: deadline.signal,
    seconds: ownSeconds,
    within: async <T>(action: () => Promise<T>): Promise<T> => {
      if (depth === 0) {
        if (ownSeconds() >= seconds) deadline.abort(new Cancellation("session-wall"));
        clearTimeout(timer);
        since = performance.now();
      }
      depth += 1;
      try {
        return await action();
      } finally {
        depth -= 1;
        if (depth === 0) {
          aside += performance.now() - since;
          arm();
        }
      }
    },
    close: () => {
      closed = true;
      clearTimeout(timer);
    },
  };
}

/** The text items of a message's or a tool result's content, in order; an image carries none. A
 *  trace, a seat tool's bounded result and a campaign action's opening read them here. */
export function textsOf(content: readonly { readonly type: string; readonly text?: string }[]): string[] {
  return content.flatMap((part) => (part.type === "text" ? [part.text ?? ""] : []));
}

function traceText(content: readonly { type: string; text?: string }[]): string {
  return boundText(textsOf(content).join("\n"), TRACE_TEXT_BYTES).text;
}
