// The controller's own transcript of each Builder session, and the pointer that names it.
//
// A pi session holds its history in memory and drops it on dispose, so the controller writes a
// bounded event record of each session while it runs. Run 65 was killed while authoring and nothing
// in the campaign named its transcript; the pointer is therefore written as the session opens and
// rewritten at settlement. A continued session's rounds append to its one events file, each round
// under a pointer of its own.
//
// `verifyWrittenTranscript` is copied from pi-claude-bridge's session-verify.ts without its
// record-count clause: a reader watching a file that is still being appended to cannot know the
// count. The remaining checks hold while the file grows: it exists, it is readable, and its first
// and last records both name the expected sessionId.

import { existsSync, readFileSync, statSync, mkdirSync, appendFileSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { parseJsonAs, capturedJsonStringify } from "../meta/json-runtime.ts";
import { sha256OfFile } from "../meta/digest.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { isString, type JsonValue } from "../meta/json-shape.ts";
import { hasText } from "../meta/text.ts";
import { writeJsonFile } from "../meta/completed-json.ts";
import type { CompactionRecord } from "../backends/backend-types.ts";

export const BUILDER_TRANSCRIPT_POINTER_FILE = "builder-transcript.json";

/** A controller-event transcript is not the provider's own session file, and it must never claim
 *  to be: `source` names what produced it so a reader never mistakes reconstructed events for a
 *  provider-native transcript. */
export interface BuilderTranscriptPointerV2 {
  schema: "builder-transcript-pointer/v2";
  source: "controller-events";
  transport: string;
  sessionId: string;
  cwd: string;
  path: string;
  sha256: string | null;
  warnings: string[];
  openedAt: string;
  settledAt: string | null;
}

const PROMPT_RECORD_CAP_CHARS = 4_000;
const TEXT_RECORD_CAP_CHARS = 1_000;

/** The bounded record vocabulary a controller-event transcript holds. */
type ControllerTranscriptRecord =
  | { kind: "prompt"; turn: number; text: string }
  | { kind: "assistant_text"; turn: number; text: string }
  | { kind: "tool_started"; turn: number; tool: string; command?: string }
  | { kind: "tool_ended"; turn: number; tool: string; threw: boolean }
  | { kind: "compaction"; turn: number; tokensBefore: number; compacted: boolean }
  | { kind: "turn_result"; turn: number; status: string; errors?: string[] };

interface TranscriptToolEvents {
  started(turn: number, tool: string, args: Record<string, JsonValue> | undefined): void;
  ended(turn: number, tool: string, threw: boolean): void;
}

/** One pointer per Builder round, like the execution records: the first round owns the bare name,
 *  each later round takes the next free numbered name. A single epoch-level path
 *  could not hold a multi-session epoch — a repair or rebuild session's pointer overwrote the
 *  opening build's, and that session's provider transcript was the one evidence naming it. */
function claimPointerPath(epochDir: string): string {
  let path = join(epochDir, BUILDER_TRANSCRIPT_POINTER_FILE);
  for (let session = 2; existsSync(path); session += 1) {
    path = join(epochDir, `builder-transcript-${String(session).padStart(2, "0")}.json`);
  }
  return path;
}

export function verifyWrittenTranscript(jsonlPath: string, expectedSessionId: string): string[] {
  const warnings: string[] = [];
  let st;
  try {
    st = statSync(jsonlPath);
  } catch (e) {
    warnings.push(
      `transcript missing — path=${jsonlPath} err=${/* SAFETY: `statSync` throws an Error; a value without a message renders as undefined in the warning rather than changing a verdict. */ (e as Error).message}`,
    );
    return warnings;
  }
  let content;
  try {
    content = readFileSync(jsonlPath, "utf8");
  } catch (e) {
    warnings.push(
      `transcript unreadable — path=${jsonlPath} size=${st.size} err=${/* SAFETY: `readFileSync` throws an Error; a value without a message renders as undefined in the warning rather than changing a verdict. */ (e as Error).message}`,
    );
    return warnings;
  }
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  // Pi returned here on a record-count mismatch; the count is gone, but an empty file still has to
  // be named, or the first-and-last comparison below reports it as a drift to `undefined`.
  if (lines.length === 0) {
    warnings.push(`transcript empty — path=${jsonlPath} bytes=${content.length}`);
    return warnings;
  }
  try {
    const firstRec = parseJsonAs<{ sessionId?: unknown }>(
      /* SAFETY: the check above returned when `lines.length === 0`, so index 0 exists. */ lines[0] as string,
    );
    const lastRec = parseJsonAs<{ sessionId?: unknown }>(
      /* SAFETY: the check above returned when `lines.length === 0`, so index lines.length - 1 exists. */ lines.at(
        -1,
      ) as string,
    );
    if (firstRec.sessionId !== expectedSessionId || lastRec.sessionId !== expectedSessionId) {
      warnings.push(
        `sessionId drift — expected=${expectedSessionId} first=${String(firstRec.sessionId)} last=${String(lastRec.sessionId)}`,
      );
    }
  } catch (e) {
    warnings.push(
      `malformed JSONL — path=${jsonlPath} err=${/* SAFETY: the JSONL walk throws a SyntaxError; a value without a message renders as undefined in the warning rather than changing a verdict. */ (e as Error).message}`,
    );
  }
  return warnings;
}

function bounded(text: string, cap: number): string {
  return text.length <= cap ? text : `${text.slice(0, cap)}…[truncated, ${text.length} chars]`;
}

/**
 * The controller's own record of one Builder session: a pi session holds its history in memory and
 * drops it on dispose. Records are bounded by construction — prompt and text fields are capped,
 * tool records carry intent-level detail plus at most a bounded bash command — because this file is
 * recorded campaign evidence first and a debugging aid second.
 *
 * Records buffer until `open`, then append in place; `seq` continues from the records an earlier
 * round of the same session left. The pointer records a digest on opening and again at settlement;
 * a mid-session stop can leave newer transcript bytes than the pointer's digest.
 */
export class ControllerEventTranscript {
  private readonly lines: string[] = [];
  /** Records an earlier round of this session already appended. */
  private readonly earlier: number;
  private readonly jsonlPath: string | null;
  private pointerPath: string | null = null;
  private openedAt: string | null = null;
  private settled = false;

  constructor(
    private readonly sessionId: string,
    private readonly transport: string,
    dir: string | undefined,
    private readonly cwd: string,
  ) {
    this.jsonlPath = dir === undefined ? null : join(dir, `builder-events-${sessionId}.jsonl`);
    const { jsonlPath } = this;
    this.earlier =
      jsonlPath !== null && existsSync(jsonlPath)
        ? readFileSync(jsonlPath, "utf8")
            .split("\n")
            .filter((line) => line.trim().length > 0).length
        : 0;
  }

  private push(entry: ControllerTranscriptRecord): void {
    if (this.jsonlPath === null || this.settled) return;
    const line = capturedJsonStringify({
      sessionId: this.sessionId,
      seq: this.earlier + this.lines.length + 1,
      at: new Date().toISOString(),
      ...entry,
    });
    this.lines.push(line);
    if (this.openedAt !== null) appendFileSync(this.jsonlPath, `${line}\n`);
  }

  prompt(turn: number, text: string): void {
    this.push({ kind: "prompt", turn, text: bounded(text, PROMPT_RECORD_CAP_CHARS) });
  }

  assistantText(turn: number, text: string): void {
    if (text.trim() === "") return;
    this.push({ kind: "assistant_text", turn, text: bounded(text, TEXT_RECORD_CAP_CHARS) });
  }

  toolStarted(turn: number, tool: string, args?: Record<string, JsonValue>): void {
    // SAFETY: isString proved args.command holds text; the assertion only restores that fact to
    // the compiler, and the value is bounded before it enters the record.
    const command = isString(args?.command)
      ? bounded(/* SAFETY: narrowed by isString above. */ args.command, 200)
      : undefined;
    this.push({ kind: "tool_started", turn, tool, ...keyIfDefined("command", command) });
  }

  toolEnded(turn: number, tool: string, outcome: "threw" | "returned"): void {
    this.push({ kind: "tool_ended", turn, tool, threw: outcome === "threw" });
  }

  compaction(turn: number, record: CompactionRecord): void {
    this.push({ kind: "compaction", turn, tokensBefore: record.tokensBefore, compacted: record.compacted });
  }

  turnResult(turn: number, status: string, errorMessages?: readonly string[]): void {
    const errors =
      errorMessages === undefined
        ? undefined
        : errorMessages.map((message) => bounded(message, TEXT_RECORD_CAP_CHARS));
    this.push({
      kind: "turn_result",
      turn,
      status,
      ...keyIfDefined("errors", errors === undefined || errors.length === 0 ? undefined : errors),
    });
  }

  /** Flush buffered records and write the v2 pointer once an identity exists. Later calls are
   *  no-ops: the pointer name was claimed here and settle rewrites it in place. */
  open(epochDir: string): void {
    if (this.openedAt !== null || this.jsonlPath === null) return;
    mkdirSync(epochDir, { recursive: true });
    if (this.lines.length > 0) appendFileSync(this.jsonlPath, `${this.lines.join("\n")}\n`);
    this.openedAt = new Date().toISOString();
    this.pointerPath = claimPointerPath(epochDir);
    this.writePointer();
  }

  settle(): void {
    if (!hasText(this.openedAt) || this.settled) return;
    this.settled = true;
    this.writePointer();
  }

  private writePointer(): void {
    if (this.pointerPath === null || this.jsonlPath === null) return;
    const { jsonlPath } = this;
    let sha256: string | null = null;
    try {
      sha256 = sha256OfFile(jsonlPath);
    } catch {
      // An unreadable file reports through warnings below instead of blocking the pointer.
    }
    const pointer: BuilderTranscriptPointerV2 = {
      schema: "builder-transcript-pointer/v2",
      source: "controller-events",
      transport: this.transport,
      sessionId: this.sessionId,
      cwd: this.cwd,
      path: jsonlPath,
      sha256,
      warnings:
        sha256 === null
          ? ["event transcript unreadable"]
          : verifyWrittenTranscript(jsonlPath, this.sessionId),
      // Both callers guard on open() having run, so the opened timestamp is present here.
      openedAt: this.openedAt ?? new Date().toISOString(),
      settledAt: this.settled ? new Date().toISOString() : null,
    };
    writeJsonFile(this.pointerPath, pointer);
  }
}

/** The per-session wiring around one writer: holds what the round records before the transcript
 *  opens, opens it with the session, and settles on every exit path. Keeps the session loop free of
 *  transcript mechanics. */
export class SessionTranscriptSink {
  private impl: ControllerEventTranscript | null = null;
  private readonly pending: Array<(t: ControllerEventTranscript) => void> = [];
  private opened = false;

  emit(write: (t: ControllerEventTranscript) => void): void {
    if (this.impl !== null) write(this.impl);
    else if (!this.opened) this.pending.push(write);
  }

  /** Open the transcript as the session opens, so a run killed inside its first turn still leaves
   *  a pointer naming it (run 65). Without a directory nothing is recorded. */
  open(sessionId: string, transport: string, dir: string | undefined, cwd: string): void {
    if (this.opened) return;
    this.opened = true;
    const pending = this.pending.splice(0);
    if (dir === undefined) return;
    this.impl = new ControllerEventTranscript(sessionId, transport, dir, cwd);
    // Replay first, so the pointer open writes digests the records the round already made.
    for (const write of pending) write(this.impl);
    this.impl.open(dir);
  }

  /** The dispatch-event handlers withCustomToolReceipts forwards to. */
  toolEvents(): TranscriptToolEvents {
    return {
      started: (turn, tool, args) => this.emit((t) => t.toolStarted(turn, tool, args)),
      ended: (turn, tool, threw) => this.emit((t) => t.toolEnded(turn, tool, threw ? "threw" : "returned")),
    } satisfies TranscriptToolEvents;
  }

  prompt(turn: number, text: string): void {
    this.emit((t) => t.prompt(turn, text));
  }

  turnCompleted(
    turn: number,
    result: {
      assistantText?: string;
      status: string;
      errorMessages?: readonly string[];
      compactions?: readonly CompactionRecord[];
    },
  ): void {
    for (const record of result.compactions ?? []) this.emit((t) => t.compaction(turn, record));
    this.emit((t) => t.assistantText(turn, result.assistantText ?? ""));
    this.emit((t) => t.turnResult(turn, result.status, result.errorMessages));
  }

  settle(): void {
    this.impl?.settle();
  }
}
