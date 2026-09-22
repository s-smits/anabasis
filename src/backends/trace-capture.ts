/**
 * Records and redacts AgentTurnEvent data in the controller (steering 2026-07-11 item 4).
 *
 * Without this recorder, discarding the per-turn event stream would leave no record of
 * what the agent did between prompt and submit. Saving the native stream would include raw
 * provider payloads, tool arguments and full tool results in run evidence. This recorder
 * instead produces a typed, ordered trace with limits on its size and on the content retained.
 * It applies these rules:
 *
 *  - native `raw` events are counted and dropped; no `native` field is stored;
 *  - successful tool calls retain only an argument digest and length. The digest key is random
 *    and never saved, preventing readers from checking guessed values against it;
 *  - assistant text and tool results survive only as short previews through the shared
 *    diagnostic redaction owner (`redactProviderDiagnostic`);
 *  - failed tool calls also retain redacted, bounded argument and result excerpts for diagnosis;
 *  - duration is measured here with a monotonic clock, because the recorder sees both
 *    ends of every turn and every tool call; a span that never closed stays `null` rather than
 *    reporting the time until the reader asked, and records how long it had been running as the
 *    separate `observedMs` instead, so an interrupted solve is not also an untimed one;
 *  - token and cost telemetry is copied from `turn_ended.usage` when the transport reported it
 *    (Claude and Codex use `turn-usage.ts`; Pi uses `pi-usage.ts`). Missing usage remains
 *    unknown rather than being recorded as zero.
 *
 * The caller supplies the turn number through `beginTurn`; it is not inferred from `turn_started`
 * events: the solver loop already owns the turn counter, and a backend that emits zero or
 * duplicate turn_started events must not create a second turn counter. `beginTurn`
 * also starts the clock, so duration covers the interval from that call to the terminal event,
 * including any setup in that interval, rather than relying on provider-reported duration.
 */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import type { AgentTurnEvent, BackendId, CompactionRecord } from "./backend-types.ts";
import { redactProviderDiagnostic } from "./diagnostic-redaction.ts";
import { isString, type JsonValue } from "../meta/json-shape.ts";

/** v2 adds `timingMs` on turns and tool calls, and per-turn provider usage. v3 adds
 *  `resultExcerpt` and `argsExcerpt` on failed tool calls only, so a diagnosis reader can see
 *  more of the arguments and tool error than the 200-character preview (2026-08-27, from the
 *  AutoSaddler in-depth-diagnosis finding). v4 adds `observedMs` on turns and tool calls that
 *  never closed (2026-09-20): a whole-solve wall leaves the running turn open, and its duration —
 *  6 h 27 m in one recorded truss turn — was the one fact no reader could recover. Readers take
 *  v4 only and read an earlier trace as unreadable (operator decision 2026-09-22). */
export const CASE_TRACE_SCHEMA = "case-trace/v4";

/** Evidence bounds: a runaway solve must not turn one case's trace into an unbounded file. */
const MAX_TRACE_TURNS = 100;
const MAX_TRACE_TOOL_CALLS = 400;
/** Limit applied when assembling assistant and result previews. Transports may truncate results
 *  before they arrive here: successful Pi tool calls, for example, provide at most 200 characters,
 *  while failed calls provide up to 2,000 for the separate error excerpt. Keep this limit separate
 *  from those transport limits (Sol review, run-16 review): they apply to different fields and
 *  stages. Combining them would change recorded evidence, not merely reorganise code.
 */
const PREVIEW_CHARS = 240;
/** Error rows only: how much of the failing call's result and arguments survives into evidence.
 *  Distinct from PREVIEW_CHARS on purpose — a failed call is the one place a reader
 *  needs more than a preview. Success rows keep digest-and-preview only. */
const ERROR_RESULT_CHARS = 2000;
const ERROR_ARGS_CHARS = 1000;

interface TraceToolCall {
  /** Solve-wide capture order (1-based) — total ordering across turns. */
  seq: number;
  /** The solver turn this call happened in (1-based; 0 = before the first beginTurn). */
  turn: number;
  toolName: string;
  toolCallId: string | null;
  /** Run-keyed HMAC-sha256 over JSON.stringify(args) — an equality classifier within this one
   *  solve, without a public hash for checking guesses (the key is random and never persisted, so a guessed value
   *  cannot be confirmed against it). Null when the backend sent none or they don't serialize. */
  argsDigest: string | null;
  /** JSON length of the args — a size signal that carries no content. */
  argsChars: number | null;
  /** null while started-but-never-ended (an interrupted call is visible as unknown, not success). */
  isError: boolean | null;
  /** Redacted, capped result preview; null until the call ended or when the backend sent none. */
  resultPreview: string | null;
  /** Error rows only: redacted result up to ERROR_RESULT_CHARS. Null on success rows. */
  resultExcerpt: string | null;
  /** Error rows only: redacted JSON of the arguments the agent sent, up to ERROR_ARGS_CHARS.
   *  Success rows keep digest-and-length only. */
  argsExcerpt: string | null;
  /** Elapsed time from tool_started to tool_ended. Null while the call is still open, and null for
   *  a call a backend created at tool_ended with no start to measure from. */
  timingMs: number | null;
  /** How long a call that never ended had been running when the trace was taken — the different
   *  fact `timingMs` refuses to report as a duration. Null for a call that ended, whose duration
   *  is `timingMs`, and for one with no observed start. */
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
  /** Elapsed time from `beginTurn` to the turn's terminal event. Null for a turn that never reached
   *  one: an interrupted turn's duration is unknown, and the time until trace() was called is a
   *  different fact. */
  timingMs: number | null;
  /** That different fact: how long an open turn had been running when the trace was taken. The
   *  turn may have gone on afterwards, so this is a floor, not a duration — but a wall-stopped
   *  solve otherwise records no elapsed time at all. Null once the turn reaches a terminal
   *  event, where `timingMs` is the answer. */
  observedMs: number | null;
  /** What the provider reported it spent on this turn, copied from `turn_ended.usage`. Every
   *  field is null when the transport reported nothing — a missing value must never appear as a
   *  plausible zero. `tokensUsed` keeps its v1 name and means the total. */
  inputTokens: number | null;
  outputTokens: number | null;
  tokensUsed: number | null;
  costUsd: number | null;
  /** Context compactions during the turn, copied from `turn_ended`. Absent in traces written
   *  before compaction was recorded; empty when none ran. */
  compactions?: CompactionRecord[];
}

export interface CaseTrace {
  schema: typeof CASE_TRACE_SCHEMA;
  backend: BackendId | null;
  turns: TraceTurn[];
  toolCalls: TraceToolCall[];
  /** Backend-native `raw` events observed and dropped — the count proves the sink saw them
   *  and deliberately omitted their contents. */
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
  /** Monotonic milliseconds. Injected only by tests; production reads the process clock, which
   *  calendar-clock adjustments cannot move backwards. */
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
  // Run-keyed digesting (steering 2026-07-12 §2): a plain SHA-256 over arguments exposes a hash
  // — anyone holding the trace can confirm a guessed secret value by hashing the guess. The key
  // is random per recorder and never persisted, so the digest is an equality classifier within
  // this one solve and nothing more; the dictionary attack has no stable target.
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
    // Match the started record by id, else the oldest same-name call still open in this turn
    // (steering 2026-07-12 §2: a dangling call from an earlier turn must not consume a later
    // turn's id-less completion); a backend that emits only tool_ended writes the record here.
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
      // The one place the reader's clock may be read: a span that is still open has no duration,
      // and saying how long it has run is a different statement from claiming it ended now.
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
