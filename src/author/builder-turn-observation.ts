/**
 * What the running turn has already done. Tool events are counted as they arrive, so a checkpoint
 * taken mid-turn, or a killed turn, still shows the calls made; the completed turn's final counts
 * replace these when it settles.
 *
 * Each failed call also gets a bounded row with its tool, time, and redacted request and response
 * excerpts, null when the transport carried nothing.
 */
import type { AgentTurnEvent } from "../backends/backend-types.ts";
import { redactTokens } from "../backends/diagnostic-redaction.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import type { JsonValue } from "../meta/json-shape.ts";

/** Failure rows kept per session; later failures are only counted. */
const MAX_FAILED_CALL_ROWS = 50;
/** Characters kept per excerpt, after redaction. */
const MAX_FAILED_CALL_CHARS = 200;
/** Bound on in-flight calls whose arguments are held for their end event. */
const MAX_OPEN_CALL_ARGS = 256;

export interface BuilderFailedCall {
  /** 1-based ordinal among all of this session's failures, including those beyond the row bound. */
  ordinal: number;
  /** The session turn the failure was observed in. */
  turn: number;
  /** The tool name exactly as the transport reported it, matching the `failedByName` keys. */
  tool: string;
  /** Wall-clock time of the failure, for joining against host logs and provider rollouts. */
  at: string;
  /** Milliseconds from session start, for joining against the record's other rows. */
  atMs: number;
  /** Redacted, bounded excerpt of the call's arguments; null when the transport reported none. */
  request: string | null;
  /** Redacted, bounded excerpt of what the tool returned; null when there was no result text. */
  error: string | null;
}

export interface BuilderTurnToolTally {
  total: number;
  failed: number;
  byName: Record<string, number>;
  failedByName: Record<string, number>;
}

interface BuilderFailedCallSnapshot {
  rows: BuilderFailedCall[];
  omitted: number;
}

type ToolEvent = Extract<AgentTurnEvent, { type: "tool_started" | "tool_ended" }>;

function emptyTally(): BuilderTurnToolTally {
  return { total: 0, failed: 0, byName: {}, failedByName: {} };
}

/** Sum two count maps into a new one; neither input is changed. */
export function mergeCounts(left: Record<string, number>, right: Record<string, number>) {
  const merged = { ...left };
  for (const [name, count] of Object.entries(right)) merged[name] = (merged[name] ?? 0) + count;
  return merged;
}

/** Redacts credential-shaped content and bounds the text. Home paths are kept on purpose, since
 *  the path a failing command names is what an investigation reads. */
function excerpt(text: string | undefined): string | null {
  if (text === undefined) return null;
  const redacted = redactTokens(text).replace(/\s+/g, " ").trim();
  if (redacted.length === 0) return null;
  return redacted.length <= MAX_FAILED_CALL_CHARS
    ? redacted
    : `${redacted.slice(0, MAX_FAILED_CALL_CHARS - 1)}…`;
}

export class BuilderTurnObservation {
  private tally = emptyTally();
  private readonly failedRows: BuilderFailedCall[] = [];
  private readonly openArgs = new Map<string, Record<string, JsonValue>>();
  private failures = 0;
  private omitted = 0;

  constructor(private readonly since: () => number) {}

  /** Counts one starting call and holds its arguments for the end event, only when the call has
   *  an id to match it by. */
  started(event: Extract<ToolEvent, { type: "tool_started" }>): void {
    this.tally.total += 1;
    this.tally.byName[event.toolName] = (this.tally.byName[event.toolName] ?? 0) + 1;
    if (event.args === undefined || event.toolCallId === undefined) return;
    if (this.openArgs.size >= MAX_OPEN_CALL_ARGS) return;
    this.openArgs.set(event.toolCallId, event.args);
  }

  /** Fold one ending call. A success only releases the held arguments; a failure also takes its
   *  row, using whichever of the two events carried the arguments. */
  ended(event: Extract<ToolEvent, { type: "tool_ended" }>, turn: number): void {
    const held = event.toolCallId === undefined ? undefined : this.openArgs.get(event.toolCallId);
    if (event.toolCallId !== undefined) this.openArgs.delete(event.toolCallId);
    if (!event.isError) return;
    this.tally.failed += 1;
    this.tally.failedByName[event.toolName] = (this.tally.failedByName[event.toolName] ?? 0) + 1;
    this.failures += 1;
    if (this.failedRows.length >= MAX_FAILED_CALL_ROWS) {
      this.omitted += 1;
      return;
    }
    const args = event.args ?? held;
    this.failedRows.push({
      ordinal: this.failures,
      turn,
      tool: event.toolName,
      at: new Date().toISOString(),
      atMs: this.since(),
      request: excerpt(args === undefined ? undefined : capturedJsonStringify(args)),
      error: excerpt(event.resultPreview),
    });
  }

  /** A copy of the running turn's tally so far. */
  turnTally(): BuilderTurnToolTally {
    return {
      total: this.tally.total,
      failed: this.tally.failed,
      byName: { ...this.tally.byName },
      failedByName: { ...this.tally.failedByName },
    };
  }

  /** Closes the running turn, whose settled tally replaces this one, and releases held arguments. */
  turnSettled(): void {
    this.tally = emptyTally();
    this.openArgs.clear();
  }

  failedCalls(): BuilderFailedCallSnapshot {
    return { rows: this.failedRows.map((row) => ({ ...row })), omitted: this.omitted };
  }
}
