/**
 * Records AgentTurnEvent data as a typed, ordered, bounded and redacted trace:
 *
 *  - native `raw` events are counted and dropped;
 *  - successful tool calls keep only an argument digest and length, keyed so a guessed value
 *    cannot be confirmed;
 *  - assistant text and tool results survive only as short previews through
 *    `redactProviderDiagnostic`; failed tool calls also keep bounded argument and result excerpts;
 *  - durations use a monotonic clock; a span that never closed has a null duration and records
 *    how long it had run as `observedMs`;
 *  - token and cost telemetry is copied from `turn_ended.usage`; missing usage stays null.
 *
 * The caller supplies the turn number through `beginTurn`, which also starts the turn's clock;
 * `turn_started` events are ignored, so the solver loop owns the one turn counter.
 */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import type { AgentTurnEvent, BackendId, CompactionRecord } from "./backend-types.ts";
import { redactProviderDiagnostic } from "./diagnostic-redaction.ts";
import { isString, type JsonValue } from "../meta/json-shape.ts";

/** Readers accept this version only. */
export const CASE_TRACE_SCHEMA = "case-trace/v4";

/** Evidence bounds: a runaway solve must not turn one case's trace into an unbounded file. */
const MAX_TRACE_TURNS = 100;
const MAX_TRACE_TOOL_CALLS = 400;
/** Preview limit for assistant text and results; independent of any transport's own truncation. */
const PREVIEW_CHARS = 240;
/** Error rows only: a failed call is the one place a reader needs more than a preview. */
const ERROR_RESULT_CHARS = 2000;
const ERROR_ARGS_CHARS = 1000;

interface TraceToolCall {
  /** Solve-wide capture order (1-based) — total ordering across turns. */
  seq: number;
  /** The solver turn this call happened in (1-based; 0 = before the first beginTurn). */
  turn: number;
  toolName: string;
  toolCallId: string | null;
  /** HMAC-SHA-256 of the JSON args: equality within this solve only, since the key is never
   *  persisted. Null when the backend sent none or they do not serialise. */
  argsDigest: string | null;
  /** JSON length of the args — a size signal that carries no content. */
  argsChars: number | null;
  /** null while started-but-never-ended (an interrupted call is visible as unknown, not success). */
  isError: boolean | null;
  /** Redacted, capped result preview; null until the call ended or when the backend sent none. */
  resultPreview: string | null;
  /** Error rows only: redacted result up to ERROR_RESULT_CHARS. Null on success rows. */
  resultExcerpt: string | null;
  /** Error rows only: redacted JSON of the arguments, up to ERROR_ARGS_CHARS. */
  argsExcerpt: string | null;
  /** Elapsed time from tool_started to tool_ended; null while open or with no observed start. */
  timingMs: number | null;
  /** How long a call that never ended had been running when the trace was taken; null otherwise. */
  observedMs: number | null;
}

interface TraceTurn {
  turn: number;
  assistantChars: number;
  assistantPreview: string;
  stopReason: string | null;
  errorMessage: string | null;
  /** "open" = the turn never reached a terminal event (interrupted mid-stream). */
  status: "ended" | "failed" | "open";
  /** Elapsed time from `beginTurn` to the turn's terminal event; null for a turn that never ended. */
  timingMs: number | null;
  /** How long an open turn had been running when the trace was taken: a floor, not a duration.
   *  Null once the turn ended. */
  observedMs: number | null;
  /** Provider-reported spend from `turn_ended.usage`; null, never zero, when none was reported.
   *  `tokensUsed` is the total. */
  inputTokens: number | null;
  outputTokens: number | null;
  tokensUsed: number | null;
  costUsd: number | null;
  /** Context compactions during the turn, copied from `turn_ended`; empty when none ran. */
  compactions?: CompactionRecord[];
}

export interface CaseTrace {
  schema: typeof CASE_TRACE_SCHEMA;
  backend: BackendId | null;
  turns: TraceTurn[];
  toolCalls: TraceToolCall[];
  /** Backend-native `raw` events observed and dropped. */
  droppedRawEvents: number;
  /** True when a bound was hit; the trace is a prefix, not the whole solve. */
  truncated: boolean;
}

interface TraceRecorder {
  /** Wire this as RunTurnOptions.onEvent — safe to pass as a detached function reference. */
  onEvent: (event: AgentTurnEvent) => void;
  /** The solver calls this before each runTurn with its own turn number. */
  beginTurn(turn: number): void;
  /** Build the immutable trace evidence — every call returns a fresh object. */
  trace(): CaseTrace;
}

interface OpenToolCall extends TraceToolCall {
  /** Raw preview buffer, redacted only at trace() time. */
  rawPreview: string | null;
  /** Bounded raw args JSON buffer; dropped at trace() time unless the call ended in error. */
  rawArgs: string | null;
  /** Monotonic reading at tool_started; absent for a call created at tool_ended. */
  startedAt: number | undefined;
}

export function createTraceRecorder(opts?: {
  backend?: BackendId;
  /** Monotonic milliseconds; injected only by tests. */
  now?: () => number;
}): TraceRecorder {
  const now = opts?.now ?? (() => performance.now());
  const elapsed = (from: number | undefined): number | null =>
    from === undefined ? null : Math.max(0, Math.round(now() - from));
  const turns: Array<TraceTurn & { rawAssistant: string; startedAt: number }> = [];
  const calls: OpenToolCall[] = [];
  let currentTurn = 0;
  let droppedRawEvents = 0;
  let truncated = false;
  let seq = 0;
  // A random, never-persisted key, so a trace holder cannot confirm a guessed argument by hashing it.
  const digestKey = crypto.getRandomValues(new Uint8Array(32));

  const digestArgs = (args: Record<string, JsonValue> | undefined) => {
    if (args === undefined) return { digest: null, chars: null, raw: null };
    let json: string | undefined;
    try {
      json = capturedJsonStringify(args);
    } catch {
      json = undefined;
    }
    if (!isString(json)) return { digest: null, chars: null, raw: null };
    return {
      digest: new Bun.CryptoHasher("sha256", digestKey).update(json).digest("hex"),
      chars: json.length,
      raw: json.slice(0, ERROR_ARGS_CHARS * 2),
    };
  };

  const turnRecord = (): (TraceTurn & { rawAssistant: string; startedAt: number }) | null => {
    const existing = turns.find((t) => t.turn === currentTurn);
    if (existing) return existing;
    if (turns.length >= MAX_TRACE_TURNS) {
      truncated = true;
      return null;
    }
    const fresh: TraceTurn & { rawAssistant: string; startedAt: number } = {
      turn: currentTurn,
      assistantChars: 0,
      assistantPreview: "",
      stopReason: null,
      errorMessage: null,
      status: "open",
      timingMs: null,
      observedMs: null,
      inputTokens: null,
      outputTokens: null,
      tokensUsed: null,
      costUsd: null,
      compactions: [],
      rawAssistant: "",
      startedAt: now(),
    };
    turns.push(fresh);
    return fresh;
  };

  const pushCall = (call: Omit<OpenToolCall, "seq">): OpenToolCall | null => {
    if (calls.length >= MAX_TRACE_TOOL_CALLS) {
      truncated = true;
      return null;
    }
    seq += 1;
    const record = { ...call, seq };
    calls.push(record);
    return record;
  };

  const endToolCall = (event: Extract<AgentTurnEvent, { type: "tool_ended" }>): void => {
    // Match the started record by id, else the oldest same-name call still open in this turn, so a
    // dangling earlier call cannot take a later id-less completion. Otherwise create the record here.
    const open =
      (event.toolCallId === undefined
        ? undefined
        : calls.find((c) => c.toolCallId === event.toolCallId && c.isError === null)) ??
      calls.find((c) => c.toolName === event.toolName && c.isError === null && c.turn === currentTurn);
    const args = digestArgs(event.args);
    if (open) {
      open.isError = event.isError;
      open.rawPreview = event.resultPreview ?? null;
      open.timingMs = elapsed(open.startedAt);
      if (open.argsDigest === null) {
        Object.assign(open, {
          argsDigest: args.digest,
          argsChars: args.chars,
          rawArgs: args.raw,
        } satisfies Partial<OpenToolCall>);
      }
    } else {
      pushCall({
        turn: currentTurn,
        toolName: event.toolName,
        toolCallId: event.toolCallId ?? null,
        argsDigest: args.digest,
        argsChars: args.chars,
        isError: event.isError,
        resultPreview: null,
        resultExcerpt: null,
        argsExcerpt: null,
        // No start was observed, so neither the duration nor the elapsed time is knowable.
        timingMs: null,
        observedMs: null,
        rawPreview: event.resultPreview ?? null,
        rawArgs: args.raw,
        startedAt: undefined,
      });
    }
  };

  const onEvent = (event: AgentTurnEvent): void => {
    if (event.type === "raw") {
      droppedRawEvents += 1; // counted, never captured — no field of `native` is read
      return;
    }
    if (event.type === "turn_started") return; // turn identity is beginTurn's, not the stream's
    if (event.type === "reasoning_text" || event.type === "message_text") return; // Builder prose log evidence
    if (event.type === "assistant_text") {
      const turn = turnRecord();
      if (!turn) return;
      turn.assistantChars += event.delta.length;
      if (turn.rawAssistant.length < PREVIEW_CHARS * 2) turn.rawAssistant += event.delta;
      return;
    }
    if (event.type === "tool_started") {
      const args = digestArgs(event.args);
      pushCall({
        turn: currentTurn,
        toolName: event.toolName,
        toolCallId: event.toolCallId ?? null,
        argsDigest: args.digest,
        argsChars: args.chars,
        isError: null,
        resultPreview: null,
        resultExcerpt: null,
        argsExcerpt: null,
        timingMs: null,
        observedMs: null,
        rawPreview: null,
        rawArgs: args.raw,
        startedAt: now(),
      });
      return;
    }
    if (event.type === "tool_ended") {
      endToolCall(event);
      return;
    }
    const turn = turnRecord();
    if (!turn) return;
    if (event.type === "turn_failed") {
      turn.status = "failed";
      turn.timingMs = elapsed(turn.startedAt);
      turn.errorMessage = redactProviderDiagnostic(event.errorMessage, PREVIEW_CHARS);
      return;
    }
    turn.status = "ended";
    turn.timingMs = elapsed(turn.startedAt);
    turn.stopReason = event.stopReason ?? null;
    if (event.usage !== undefined) {
      turn.inputTokens = event.usage.inputTokens;
      turn.outputTokens = event.usage.outputTokens;
      turn.tokensUsed = event.usage.totalTokens;
      turn.costUsd = event.usage.costUsd;
    }
    if (event.compactions !== undefined) turn.compactions = event.compactions;
    if (event.errorMessage !== undefined) {
      turn.errorMessage = redactProviderDiagnostic(event.errorMessage, PREVIEW_CHARS);
    }
  };

  return {
    onEvent,
    beginTurn(turn: number): void {
      currentTurn = turn;
      turnRecord();
    },
    trace(): CaseTrace {
      // An open span has no duration; `observedMs` says how long it has run so far.
      const taken = now();
      const observed = (startedAt: number | undefined, closed: boolean): number | null =>
        startedAt === undefined || closed ? null : taken - startedAt;
      return {
        schema: CASE_TRACE_SCHEMA,
        backend: opts?.backend ?? null,
        turns: turns.map(({ rawAssistant, startedAt, ...turn }) => ({
          ...turn,
          observedMs: observed(startedAt, turn.status !== "open"),
          assistantPreview: rawAssistant ? redactProviderDiagnostic(rawAssistant, PREVIEW_CHARS) : "",
        })),
        toolCalls: calls.map(({ rawPreview, rawArgs, startedAt, ...call }) => ({
          ...call,
          observedMs: observed(startedAt, call.isError !== null),
          resultPreview: rawPreview === null ? null : redactProviderDiagnostic(rawPreview, PREVIEW_CHARS),
          // Error rows keep the actual bytes (redacted, bounded); success rows drop both buffers.
          resultExcerpt:
            call.isError === true && rawPreview !== null
              ? redactProviderDiagnostic(rawPreview, ERROR_RESULT_CHARS)
              : null,
          argsExcerpt:
            call.isError === true && rawArgs !== null
              ? redactProviderDiagnostic(rawArgs, ERROR_ARGS_CHARS)
              : null,
        })),
        droppedRawEvents,
        truncated,
      };
    },
  };
}
