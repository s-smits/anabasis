/**
 * Records and redacts AgentTurnEvent data in the controller.
 *
 * Without this recorder the per-turn event stream is discarded, and nothing records what the agent
 * did between the prompt and its submit; saving the native stream instead would put raw provider
 * payloads, tool arguments and whole tool results into run evidence. So the recorder keeps a third
 * thing: a typed, ordered trace, bounded in size and in what each row retains.
 *
 *  - native `raw` events are counted and dropped, and no `native` field is stored;
 *  - a successful tool call keeps an argument digest and length and nothing else. The digest key is
 *    random and never saved, so a reader holding the trace cannot confirm a guessed value against
 *    it;
 *  - assistant text and tool results survive only as short previews, through the shared diagnostic
 *    redaction owner `redactProviderDiagnostic`. So do the identifiers the provider chooses — the
 *    tool name, the call id and the stop reason — because they are provider-supplied strings
 *    reaching persisted evidence and a model-visible diagnosis prompt, which is the one class that
 *    owner exists for, and because nothing else bounds their length;
 *  - a failed tool call also keeps redacted, bounded argument and result excerpts, because a
 *    failure is the row a diagnosis reader has to read in detail;
 *  - duration is measured here on a monotonic clock, since the recorder is what sees both ends of
 *    every turn and every tool call. A span that never closed stays null rather than reporting the
 *    time until the reader asked, and records how long it had been running as the separate
 *    `observedMs`, so an interrupted solve is not also an untimed one;
 *  - token and cost telemetry is copied from `turn_ended.usage` when the transport reported it
 *    (`pi-usage.ts` reads pi's). Missing usage stays unknown instead of being recorded as zero.
 *
 * The caller supplies the turn number through `beginTurn`, and it is not inferred from
 * `turn_started` events: the solver loop already owns the turn counter, and a backend that emits
 * none or emits duplicates must not be allowed to start a second one. `beginTurn` also starts the
 * clock, so a turn's duration covers the interval from that call to the terminal event, setup
 * included, rather than trusting a provider-reported duration.
 */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import type { AgentTurnEvent, CompactionRecord } from "./backend-types.ts";
import type { BackendKind } from "./resolve.ts";
import { redactProviderDiagnostic } from "./diagnostic-redaction.ts";
import { isString, type JsonValue } from "../meta/json-shape.ts";

/** Readers take this version only and read an earlier trace as unreadable (operator decision), so
 *  `trace-read.ts` compares against this constant rather than carrying a reader per version. Adding or removing a field is therefore a version bump. */
export const CASE_TRACE_SCHEMA = "case-trace/v4";

/** Evidence bounds: a runaway solve must not turn one case's trace into an unbounded file. */
const MAX_TRACE_TURNS = 100;
const MAX_TRACE_TOOL_CALLS = 400;
/** The limit applied when assembling assistant and result previews. Transports truncate before
 *  their events arrive here — a successful pi tool call brings at most `RESULT_PREVIEW_CHARS`, 200,
 *  while a failed one brings up to 2,000 for the separate error excerpt — and this limit stays
 *  separate from those. They apply to different fields at different stages, so merging them would
 *  change recorded evidence rather than tidy up code. */
const PREVIEW_CHARS = 240;
/** Error rows only: how much of the failing call's result and arguments survives into evidence.
 *  Deliberately larger than PREVIEW_CHARS, because a failed call is the one place a reader needs
 *  more than a preview; success rows keep the digest and the preview alone. */
const ERROR_RESULT_CHARS = 2000;
const ERROR_ARGS_CHARS = 1000;

interface TraceToolCall {
  /** Solve-wide capture order (1-based) — total ordering across turns. */
  seq: number;
  /** The solver turn this call happened in (1-based; 0 = before the first beginTurn). */
  turn: number;
  toolName: string;
  toolCallId: string | null;
  /** A run-keyed HMAC-SHA-256 over the args' JSON — an equality classifier inside this one solve,
   *  and not a public hash to check guesses against, because the key is random per recorder and
   *  never persisted. Null when the backend sent no arguments, when they do not serialise, and on
   *  a row the recorder first saw at the completion, which is after the arguments went past. */
  argsDigest: string | null;
  /** JSON length of the args — a size signal that carries no content. */
  argsChars: number | null;
  /** null while started-but-never-ended (an interrupted call is visible as unknown, not success). */
  isError: boolean | null;
  /** Redacted, capped result preview; null until the call ended or when the backend sent none. */
  resultPreview: string | null;
  /** Error rows only: redacted result up to ERROR_RESULT_CHARS. Null on success rows. */
  resultExcerpt: string | null;
  /** Error rows only: the redacted JSON of the arguments the agent sent, up to ERROR_ARGS_CHARS.
   *  Success rows keep the digest and length alone. */
  argsExcerpt: string | null;
  /** Elapsed time from tool_started to tool_ended. Null while the call is still open, and null for
   *  a call a backend created at tool_ended with no start to measure from. */
  timingMs: number | null;
  /** How long a call that never ended had been running when the trace was taken — the different
   *  fact `timingMs` refuses to report as a duration. Null for a call that ended, whose duration is
   *  `timingMs`, and for one with no observed start. */
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
  /** Elapsed time from `beginTurn` to the turn's terminal event. Null for a turn that never
   *  reached one, because an interrupted turn's duration is unknown and the time until `trace()`
   *  was called is a different fact. */
  timingMs: number | null;
  /** That different fact: how long an open turn had been running when the trace was taken. The
   *  turn may have gone on afterwards, so this is a floor rather than a duration — but without it a
   *  wall-stopped solve records no elapsed time at all. Null once the turn reaches a terminal
   *  event, where `timingMs` is the answer. */
  observedMs: number | null;
  /** What the provider reported it spent on this turn, copied from `turn_ended.usage`. Every field
   *  is null when the transport reported nothing, because a missing value must never read as a
   *  plausible zero. `tokensUsed` keeps its v1 name and means the total. */
  inputTokens: number | null;
  outputTokens: number | null;
  tokensUsed: number | null;
  costUsd: number | null;
  /** Context compactions during the turn, copied from `turn_ended`. Every turn this recorder opens
   *  carries the field, empty when none ran, which is why it is required rather than optional. */
  compactions: CompactionRecord[];
}

/** What the recorder holds while a turn runs, and the three fields it strips on the way out:
 *  the accumulating preview buffer, the clock the turn opened on, and whether any of its words
 *  arrived as streamed deltas. None of them is evidence; each decides how the next event is
 *  read. Named here because the shape was spelled out at all three of its uses. */
type RecordingTurn = TraceTurn & { rawAssistant: string; startedAt: number; streamed: boolean };

export interface CaseTrace {
  schema: typeof CASE_TRACE_SCHEMA;
  backend: BackendKind | null;
  turns: TraceTurn[];
  toolCalls: TraceToolCall[];
  /** Backend-native `raw` events observed and dropped. The count is what proves the sink saw them
   *  and left their contents out on purpose, rather than never receiving them. */
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
  backend?: BackendKind;
  /** Monotonic milliseconds. Injected only by tests; production reads the process clock, which a
   *  calendar-clock adjustment cannot move backwards. */
  now?: () => number;
}): TraceRecorder {
  const now = opts?.now ?? (() => performance.now());
  const elapsed = (from: number | undefined): number | null =>
    from === undefined ? null : Math.max(0, Math.round(now() - from));
  const turns: RecordingTurn[] = [];
  const calls: OpenToolCall[] = [];
  let currentTurn = 0;
  let droppedRawEvents = 0;
  let truncated = false;
  let seq = 0;
  // Run-keyed digesting. A plain SHA-256 over the arguments exposes a hash anyone holding the
  // trace can test a guessed secret against. This key is random per recorder and never persisted,
  // so the digest classifies equality inside this one solve and nothing more, and a dictionary
  // attack has no stable target to aim at.
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

  const turnRecord = (): RecordingTurn | null => {
    const existing = turns.find((t) => t.turn === currentTurn);
    if (existing) return existing;
    if (turns.length >= MAX_TRACE_TURNS) {
      truncated = true;
      return null;
    }
    const fresh: RecordingTurn = {
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
      /** Did this turn see a streamed delta? Internal to the recorder: it decides whether the
       *  completed message is a duplicate of what is already here, and is stripped at projection. */
      streamed: false,
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
    // A completion closes the call carrying its id and no other. The transports all send one, so
    // there is nothing to match a completion by its name for, and matching by name would close a
    // second call of that name with the first one's result the moment an id arrived twice.
    // A completion the recorder saw no start for writes its own record here, and that record holds
    // no arguments at all: the arguments arrive on `tool_started` and a completion never carries
    // them, so a null digest is the whole of what a completion-only row can honestly say.
    const open =
      event.toolCallId === undefined
        ? undefined
        : calls.find((c) => c.toolCallId === event.toolCallId && c.isError === null);
    if (open) {
      open.isError = event.isError;
      open.rawPreview = event.resultPreview ?? null;
      open.timingMs = elapsed(open.startedAt);
    } else {
      pushCall({
        turn: currentTurn,
        toolName: event.toolName,
        toolCallId: event.toolCallId ?? null,
        argsDigest: null,
        argsChars: null,
        isError: event.isError,
        resultPreview: null,
        resultExcerpt: null,
        argsExcerpt: null,
        // No start was observed, so neither the duration nor the elapsed time is knowable.
        timingMs: null,
        observedMs: null,
        rawPreview: event.resultPreview ?? null,
        rawArgs: null,
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
    if (event.type === "reasoning_text") return; // the model's own draft thinking, never a case trace
    if (event.type === "assistant_text") {
      const turn = turnRecord();
      if (!turn) return;
      turn.streamed = true;
      turn.assistantChars += event.delta.length;
      if (turn.rawAssistant.length < PREVIEW_CHARS * 2) turn.rawAssistant += event.delta;
      return;
    }
    // The same words the deltas above carry, arriving once at the end of the message. A backend
    // that streams sends both, so taking this unconditionally would count every turn's prose twice;
    // a backend that does not stream sends only this, and dropping it recorded nothing at all. Both
    // shapes are live: pi emits `assistant_text` from a `text_delta` alone, and codex does not send
    // one, so across 3,100 recorded traces claude turns carry prose 1,101 times in 1,110 while codex
    // manages 76 in 2,108 -- and codex is what an unpinned slot runs. So prefer the deltas and fall
    // back to the completed message, which leaves a streaming backend's bytes exactly as they were.
    if (event.type === "message_text") {
      const turn = turnRecord();
      if (!turn || turn.streamed) return;
      turn.assistantChars += event.text.length;
      if (turn.rawAssistant.length < PREVIEW_CHARS * 2) turn.rawAssistant += event.text;
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
      // The one place the reader's clock may be read. A span that is still open has no duration,
      // and saying how long it has run is a different statement from claiming it ended now.
      const taken = now();
      // Rounded the way `elapsed` rounds a closed span's duration: the two report the same kind of
      // fact, and a reading straight off `performance.now()` publishes nanoseconds it does not know.
      const observed = (startedAt: number | undefined, closed: boolean): number | null =>
        startedAt === undefined || closed ? null : Math.max(0, Math.round(taken - startedAt));
      // Identifiers redact at projection, never at capture, because `endToolCall` matches a
      // completion against the stored id and would otherwise compare a redacted string against the
      // raw one the next event carries.
      const identifier = (text: string | null): string | null =>
        text === null ? null : redactProviderDiagnostic(text, PREVIEW_CHARS);
      return {
        schema: CASE_TRACE_SCHEMA,
        backend: opts?.backend ?? null,
        turns: turns.map(({ rawAssistant, startedAt, streamed, ...turn }) => ({
          ...turn,
          observedMs: observed(startedAt, turn.status !== "open"),
          stopReason: identifier(turn.stopReason),
          assistantPreview: rawAssistant ? redactProviderDiagnostic(rawAssistant, PREVIEW_CHARS) : "",
        })),
        toolCalls: calls.map(({ rawPreview, rawArgs, startedAt, ...call }) => ({
          ...call,
          observedMs: observed(startedAt, call.isError !== null),
          toolName: redactProviderDiagnostic(call.toolName, PREVIEW_CHARS),
          toolCallId: identifier(call.toolCallId),
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
