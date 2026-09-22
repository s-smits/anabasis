/**
 * The turn contract every model slot reports through: the Builder and the review slot through
 * their host sessions (pi-session.ts), the Built worker through its wire protocol.
 *
 * `runTurn` runs one agent turn. The caller owns everything across turns: continuation prompts,
 * stop conditions, the overall time limit and persistent state.
 */
import type { JsonValue } from "../meta/json-shape.ts";
import type { RuntimeModelIdentity } from "../claim/runtime-model-identity.ts";

/** Which engine ran a turn. */
export type BackendId = "codex" | "openrouter" | "claude";

/** Provider-reported per-turn spend. Null means the transport reported none, never zero. */
export interface TurnUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
}

/** The context size, in tokens, at which every slot compacts, through the pi session or natively
 *  in the Claude CLI under `claude-ss`. Well below a 1M window, whose CLI default fires too late. */
export const CONTEXT_COMPACT_WINDOW = 300_000;

/** Who compacts the Claude slots' context, named by `CLAUDE_COMPACTION`: `claude-ss` (default) the
 *  Claude CLI itself, `pi` the pi session, as for the HTTP transports.
 *  TODO(codex compaction): `codex-ss`, OpenAI's server-side compaction; see openPiModel. */
export const COMPACTION_MODES = ["pi", "claude-ss"] as const;
export type CompactionMode = (typeof COMPACTION_MODES)[number];

/** One context compaction a transport ran during a turn: the context size before it and whether
 *  the summary replaced the older history (false when the summary call failed or was refused). */
export interface CompactionRecord {
  tokensBefore: number;
  compacted: boolean;
}

/** A provider-neutral turn event; `raw` carries a native event a caller may forward. */
export type AgentTurnEvent =
  | { type: "turn_started" }
  | { type: "assistant_text"; delta: string; final?: boolean }
  /** A reasoning summary the transport surfaced; Builder prose-log evidence, never model-visible. */
  | { type: "reasoning_text"; text: string }
  /** One completed assistant message, whole, however it was streamed. */
  | { type: "message_text"; text: string }
  | { type: "tool_started"; toolName: string; toolCallId?: string; args?: Record<string, JsonValue> }
  | {
      type: "tool_ended";
      toolName: string;
      toolCallId?: string;
      isError: boolean;
      args?: Record<string, JsonValue>;
      /** Short text preview of the tool result (truncated) for UI logging. */
      resultPreview?: string;
    }
  | {
      type: "turn_ended";
      stopReason?: string;
      errorMessage?: string | undefined;
      /** What the provider reported it spent on this turn; absent when it reported nothing. */
      usage?: TurnUsage;
      /** Context compactions inside this turn, in order; absent when the transport reports none. */
      compactions?: CompactionRecord[];
    }
  | { type: "turn_failed"; errorMessage: string; usage?: TurnUsage }
  /** A backend-native event a caller may forward verbatim or ignore. */
  | { type: "raw"; backend: BackendId; native: unknown };

export interface AgentTurnResult {
  status: "completed" | "failed" | "aborted";
  /** The provider's stop reason for the last assistant message, or null when none arrived. */
  stopReason?: string | null;
  /** Concatenated final assistant text for this turn, when any. */
  assistantText?: string;
  /** Provider/runtime error strings observed this turn. */
  errorMessages?: string[];
  /** Per-tool call tally; `failedByName` splits `failed` as `byName` splits `total`. */
  toolCalls?: {
    byName: Record<string, number>;
    failedByName: Record<string, number>;
    failed: number;
    total: number;
  };
  /** The provider identity of a completed turn; callers making model-identity claims require it. */
  runtimeIdentity?: RuntimeModelIdentity;
  /** Context compactions inside this turn, whatever its status; absent when there were none. */
  compactions?: CompactionRecord[];
}

export interface RunTurnOptions {
  /** The prompt for THIS turn — the first task prompt, a nudge, or a continuation. */
  prompt: string;
  /** Streamed turn events. */
  onEvent?: (event: AgentTurnEvent) => void;
  /** Time limit for this turn; the caller owns the across-turn deadline. */
  turnTimeoutMs?: number;
  /** Cooperative cancellation from the caller (e.g. a Next request signal). */
  signal?: AbortSignal;
}

/**
 * One conversation that keeps its context between turns. `runTurn` resolves only after retries
 * and compactions settle, so a caller's stop predicate never reads half-written state.
 */
export interface AgentSession {
  readonly backend: BackendId;
  runTurn(opts: RunTurnOptions): Promise<AgentTurnResult>;
  /** Release the session and whatever its transport holds (the Claude CLI's config directory). */
  dispose(): Promise<void>;
}
