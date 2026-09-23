/**
 * What the turn currently running has already done.
 *
 * Counting tool calls only when a turn returns its final result means a turn that never returns
 * contributes nothing. A session killed inside its first turn then records `turns: 0`,
 * `toolCalls.total: 0`, an empty `byName` and a null usage, however many controller-hosted calls
 * it actually made: the transport emitted every one of them as an event, and nothing counted them
 * until the turn finished.
 *
 * So this recorder counts the events as they arrive, and a checkpoint written during a turn
 * includes the calls already made. The completed turn's final counts then replace these running
 * ones, and clearing them at that point is what keeps the same calls from being counted twice.
 *
 * It also identifies failed calls. Per-name counts alone say "28 failed commandExecution" and
 * leave the execution record unable to explain any of them. A bounded row per failure records the
 * tool, the time, the request and the response, which is enough for an investigation to see what
 * failed. Both excerpts are redacted and cut, and both are null when the transport carried
 * nothing, rather than an empty string that would read as "nothing was asked".
 */
import type { AgentTurnEvent } from "../backends/backend-types.ts";
import { redactTokens } from "../backends/diagnostic-redaction.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import type { JsonValue } from "../meta/json-shape.ts";

/** Failure rows kept per session. Repeated failures can fill a session, so the first rows are
 *  retained for diagnosis and later failures are counted without storing more excerpts. */
const MAX_FAILED_CALL_ROWS = 50;
/** Characters kept per excerpt, after redaction. Long enough for a command line and a first error
 *  line, short enough that 50 rows cannot bloat the record. */
const MAX_FAILED_CALL_CHARS = 200;
/** In-flight calls whose arguments are held for their end event. A transport that never ends a
 *  call would otherwise grow this map for the whole session. */
const MAX_OPEN_CALL_ARGS = 256;

export interface BuilderFailedCall {
  /** 1-based ordinal among this session's failures, the ones beyond the row bound included, so a
   *  bounded list still says which failure each row is. */
  ordinal: number;
  /** The session turn the failure was observed in. */
  turn: number;
  /** The tool name exactly as the transport reported it, matching the `failedByName` keys. */
  tool: string;
  /** Wall-clock time of the failure, for joining against host logs and provider rollouts. */
  at: string;
  /** Milliseconds from session start, for joining against the record's other rows. */
  atMs: number;
  /** Redacted, bounded excerpt of the call's arguments — the command or the file the tool was
   *  asked for. Null when the transport reported no arguments, as Codex carries none on its tool
   *  events, and never an empty string. */
  request: string | null;
  /** Redacted, bounded excerpt of what the tool returned. Null when the transport reported no
   *  result text. */
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

/** Credential-shaped content is removed before anything is kept. The wider provider-diagnostic
 *  redaction is deliberately not used here, because it also removes home paths, and the path a
 *  failing command names is the part an investigation reads. */
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

  /** Count one starting call and hold its arguments for the end event. Only a call the transport
   *  identified is held: an id-less pair cannot be matched, and guessing by name would attach one
   *  call's command to another's failure. */
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

  /** The running turn's tally so far. Copied, because a checkpoint snapshot must not keep growing
   *  after it was written. */
  turnTally(): BuilderTurnToolTally {
    return {
      total: this.tally.total,
      failed: this.tally.failed,
      byName: { ...this.tally.byName },
      failedByName: { ...this.tally.failedByName },
    };
  }

  /** Close the running turn: its settled accumulator tally replaces this one. The held arguments
   *  are released too, since no later event can end a call from a turn that has returned. */
  turnSettled(): void {
    this.tally = emptyTally();
    this.openArgs.clear();
  }

  failedCalls(): BuilderFailedCallSnapshot {
    return { rows: this.failedRows.map((row) => ({ ...row })), omitted: this.omitted };
  }
}
