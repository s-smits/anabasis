import { BACKGROUND_CONTEXT, type Context } from "@earendil-works/chord/context";
import type { Api, AssistantMessage, Message, Model, Models, ThinkingLevel } from "@earendil-works/pi-ai";
import { isContextOverflow } from "@earendil-works/pi-ai/utils/overflow";
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
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import { CLAUDE_COMPACTED, claudeLedger, claudeSpendNow } from "./backends/claude.ts";
import { retryPolicy } from "./backends/models.ts";
import { compactionPolicy, compactionTrace } from "./backends/compaction.ts";
import { append } from "../kernel/log.ts";
import { durableSpend, seatMeter, type Spent } from "../kernel/meter.ts";
import { type Seat as SeatKind, traceKind, whose } from "../kernel/trace.ts";
import { boundText } from "../meta/bounded-text.ts";
import { Cancellation } from "../kernel/solve.ts";
import { isString, type JsonObject } from "../meta/json-shape.ts";
import { keysIf } from "../meta/optional-key.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { hostScratch } from "../sandbox/policy.ts";
import { releaseRoot } from "../sandbox/sandbox-root.ts";

export type AgentTool = ToolRegistration;

export type SeatModels = (home: string, shutdown: AbortSignal, cwd?: string, seat?: string) => Models;

export interface AgentSpec {
  readonly models: SeatModels;
  readonly home?: string;
  readonly cwd?: string;
  readonly id: string;
  readonly model: Model<Api>;
  readonly effort: ThinkingLevel;
  readonly system: string;
  readonly opening: string;
  readonly tools: readonly AgentTool[];
  readonly env?: ExecutionEnv;
  readonly trace?: { readonly log: string; readonly of: SeatKind; readonly as?: () => string };
  readonly before?: () => void | Promise<void>;
  readonly turns: AssistantMessage[];
  readonly most?: number | undefined;
  readonly over?: () => boolean;
  readonly next?: () => Promise<string | null>;
  readonly onTurn?: (message: AssistantMessage) => void;
  readonly onTool?: (phase: "start" | "end", callId: string, tool: string) => void;
  readonly onCompact?: () => void;
  readonly stops: readonly (AbortSignal | undefined)[];
  readonly spending?: (now: () => Promise<Spent>) => void;
  readonly steer?: (send: (content: string) => Promise<void>) => void;
}

export interface AgentRun {
  readonly cut: boolean;
  readonly thrown: string | null;
  readonly crash: string | null;
  readonly spent: Spent;
}

const TRACE_TEXT_BYTES = 64 * 1024;

const HARNESS_WRITTEN: ReadonlySet<string> = new Set([
  "tool_unavailable",
  "invalid_arguments",
  "blocked",
  "interrupted",
  "restart_limit",
  "aborted",
  "abandoned",
]);

export function traceSink(log: string, of: SeatKind, id: string | (() => string), turn: () => number) {
  const named = () => ({ [whose(of)]: isString(id) ? id : id() });
  const calls = new Map<string, { at: number; whose: ReturnType<typeof named> }>();
  return {
    beforeTool: (call: ToolHookCall) => {
      calls.set(call.id, { at: performance.now(), whose: named() });
    },
    afterTool: (call: ToolHookCall, result: ToolExecutionResult) => {
      const started = calls.get(call.id);
      calls.delete(call.id);
      const woke = started !== undefined && started.whose[whose(of)] !== named()[whose(of)];
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
        ms: started === undefined || woke ? null : performance.now() - started.at,
      });
    },
    steer: (text: string, refused: boolean) => {
      append(log, traceKind(of, "call"), {
        ...named(),
        turn: turn(),
        tool: "steer",
        args: {},
        isError: refused,
        text,
      });
    },
    turn: (message: AssistantMessage, retried: readonly string[] = []) => {
      const { stopReason, errorMessage: error, responseModel, usage, content, diagnostics } = message;
      for (const { type, details } of diagnostics ?? []) {
        if (type !== CLAUDE_COMPACTED) continue;
        // SAFETY: `details` comes from the Claude backend's own compaction diagnostic (numbers and `null`).
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

const STEER = { type: "input", whenBusy: "steer", whenIdle: "reject" } as const;

export async function runAgent(seat: AgentSpec): Promise<AgentRun> {
  const home = seat.home ?? hostScratch("claude-cli-seat-");
  const meter = seatMeter(seat.model);
  const stops = seat.stops.filter((stop) => stop !== undefined);
  const done = new AbortController();
  const shutdown = AbortSignal.any([...stops, done.signal]);
  const halt = Promise.withResolvers<void>();
  const frame = sessionHooks(seat, halt.resolve, meter);
  const compactions = compactionTrace(({ spent, ...event }) => {
    seat.onCompact?.();
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
    const registry = createRegistry<AgentTool>();
    registry.install(
      defineExtension({
        name: "seat",
        tools: seat.tools,
        sections: [section("seat", () => seat.system, { tag: false })],
        hooks: [...frame.hooks, hook(CompactionTask, { beforeCompact: frame.before }), compactions.hook],
      }),
    );
    const models = seat.models(home, shutdown, seat.cwd, seat.id);
    meter.catalogue(models);
    harness = await Harness.open(
      new MemoryStorage(),
      {
        models,
        registry,
        env: () => seat.env,
        settings: {
          toolExecution: "sequential",
          steeringMode: "all",
          retry: retryPolicy(seat.model.provider),
          compaction: compactionPolicy(seat.model),
        },
        onReport: ({ error }) => frame.fail(error),
      },
      BACKGROUND_CONTEXT,
    );
    harness.observeCommits({
      advance: (publication) => {
        compactions.committed(publication);
        frame.committed(publication);
      },
      end: () => undefined,
    });
    const open = harness;
    seat.spending?.(async () =>
      meter.spent(
        seat.turns,
        (await claudeSpendNow(seat.id)) ?? durableSpend(await open.usage(BACKGROUND_CONTEXT)),
      ),
    );
    const conversation = await harness.root(BACKGROUND_CONTEXT, {
      agent: { model: { provider: seat.model.provider, modelId: seat.model.id }, thinkingLevel: seat.effort },
      init: async (tx, id) => {
        (await tx.doc(ProviderDoc, id)).sessionId = seat.id;
      },
    });
    seat.steer?.(async (content) => {
      const [sent] = await Promise.allSettled([
        conversation.submit({ ...STEER, content }, BACKGROUND_CONTEXT),
      ]);
      frame.steer(content, sent?.status === "rejected");
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
    usage = (await harness?.usage(BACKGROUND_CONTEXT).catch(() => null)) ?? null;
    await harness?.close(BACKGROUND_CONTEXT);
    shutdown.removeEventListener("abort", wakeOnStop);
  }
  let ledger: Awaited<ReturnType<typeof claudeLedger>>;
  try {
    ledger = await claudeLedger(seat.id);
  } finally {
    if (seat.home === undefined) await releaseRoot(home);
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
    spent: meter.spent(seat.turns, ledger ?? (usage === null ? null : durableSpend(usage))),
  };
}

function sessionHooks(seat: AgentSpec, halt: () => void, meter: ReturnType<typeof seatMeter>) {
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
    over,
    before,
    steer: (text: string, refused: boolean) => sink?.steer(text, refused),
    committed: tools.committed,
    hooks: [
      hook(GenerationTask, {
        beforeRequest: before,
        afterResponse: async (message, api, context) => {
          try {
            const attempt =
              (await api.snapshot(LiveDoc, api.conversationId, context))?.generation?.attempt ?? 1;
            if (
              message.stopReason === "error" &&
              !isContextOverflow(message) &&
              isRetryableAssistantError(message) &&
              retry.enabled &&
              attempt <= retry.maxRetries
            ) {
              retried.push(message.errorMessage ?? "provider failure");
              return;
            }
            message.usage.cost = { ...message.usage.cost, total: meter.turn(message) };
            tools.reset();
            seat.turns.push(message);
            sink?.turn(message, retried);
            if (message.diagnostics?.some(({ type }) => type === CLAUDE_COMPACTED) === true) {
              seat.onCompact?.();
            }
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

function toolHooks(seat: AgentSpec, sink: ReturnType<typeof traceSink> | undefined) {
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
      afterTool: (call, result) =>
        result.diagnostics?.some(({ code }) => code !== undefined && HARNESS_WRITTEN.has(code)) === true
          ? undefined
          : ended(call, result),
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

export function textsOf(content: readonly { readonly type: string; readonly text?: string }[]): string[] {
  return content.flatMap((part) => (part.type === "text" ? [part.text ?? ""] : []));
}

function traceText(content: readonly { type: string; text?: string }[]): string {
  return boundText(textsOf(content).join("\n"), TRACE_TEXT_BYTES).text;
}
