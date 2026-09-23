/**
 * The turn contract every model slot reports through: the Builder and the review slot through
 * their host sessions (pi-session.ts), the Built worker through its wire protocol.
 *
 * `runTurn` receives a prompt, emits events and returns the result of one agent turn -- one turn
 * and nothing more. Everything across turns belongs to the caller: continuation prompts, stop
 * conditions, the overall time limit and persistent state, which is what lets each harness keep its
 * own rules for when a task is complete without this contract knowing any of them.
 *
 * This file declares types only; pi-session.ts supplies the runtime behind them.
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

/** The context size, in tokens, at which every slot compacts: through the pi session
 *  (pi-session.ts), or natively in the Claude CLI under `claude-ss`. It sits well below a 1M
 *  window because the CLI's own default never fires inside one -- a session reaches its spend limit
 *  several hundred thousand tokens in with no compaction having happened at all. */
export const CONTEXT_COMPACT_WINDOW = 300_000;

/** Who compacts the Claude slots' context, named by `CLAUDE_COMPACTION`. `claude-ss`, the default,
 *  leaves it to the Claude CLI, which compacts its own session as it did before the pi layer
 *  existed; `pi` compacts through the pi session instead, the way the HTTP transports always do.
 *  TODO(codex compaction): `codex-ss`, OpenAI's server-side compaction; see openPiModel. */
export const COMPACTION_MODES = ["pi", "claude-ss"] as const;
export type CompactionMode = (typeof COMPACTION_MODES)[number];

/** One context compaction a transport ran during a turn: the context size before it and whether
 *  the summary replaced the older history (false when the summary call failed or was refused). */
export interface CompactionRecord {
  tokensBefore: number;
  compacted: boolean;
}

/**
 * A shared turn event. Each backend converts its own native event stream into these types, so a
 * caller can record or display the shared fields without depending on provider-specific messages.
 * The `raw` variant keeps the native events that have no shared shape, rather than forcing one.
 */
export type AgentTurnEvent =
  | { type: "turn_started" }
  | { type: "assistant_text"; delta: string; final?: boolean }
  /** A reasoning summary the transport surfaced while the turn ran: Codex summary text, a Claude
   *  thinking block. It is evidence for the Builder prose log and never model-visible, because it
   *  is the model's own draft thinking rather than anything it chose to say. */
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
  /** Backend-native richness a caller may forward verbatim -- a Codex subagent item, file-change
   *  counts -- without this contract growing one case per provider. A caller that does not
   *  recognise the payload ignores it, which is why nothing here is required to parse it. */
  | { type: "raw"; backend: BackendId; native: unknown };

export interface AgentTurnResult {
  status: "completed" | "failed" | "aborted";
  /** The provider's stop reason for the last assistant message, or null when none arrived. */
  stopReason?: string | null;
  /** Concatenated final assistant text for this turn, when any. */
  assistantText?: string;
  /** Provider/runtime error strings observed this turn. */
  errorMessages?: string[];
  /** Per-tool call tally for this turn. `failedByName` splits `failed` the way `byName` splits
   *  `total`, so the totals say how many calls failed and the names say which tools they were --
   *  two questions a single map could not answer at once. */
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
  /** Streamed turn events. Optional, because the returned result carries the same turn once it
   *  settles; a caller only needs these to see the turn while it is still running. */
  onEvent?: (event: AgentTurnEvent) => void;
  /** Time limit for this turn; the session aborts the turn when it elapses. The caller still owns
   *  the across-turn deadline and passes a shrinking value each turn, because this contract knows
   *  nothing about how many turns are left. */
  turnTimeoutMs?: number;
  /** Cooperative cancellation from the caller (e.g. a Next request signal). */
  signal?: AbortSignal;
}

/**
 * A live agent session: one conversation that runs repeated turns and keeps its context between
 * them. `runTurn` resolves only after the prompt's retries and compactions have settled, which is
 * what lets a caller's stop predicate run on a finished turn rather than on half-written state.
 */
export interface AgentSession {
  readonly backend: BackendId;
  runTurn(opts: RunTurnOptions): Promise<AgentTurnResult>;
  /** Release the session and whatever its transport holds (the Claude CLI's config directory). */
  dispose(): Promise<void>;
}
