/**
 * The Builder's own words, recorded beside its execution record.
 *
 * Four kinds of row: the assistant text a turn returned (`message`), a reasoning summary the
 * transport surfaced while the turn ran (`reasoning`), the prompt the controller sent to open a
 * turn (`prompt`), and a context compaction inside a turn (`compaction`), whose text names the
 * tokens it started from. Nothing here is model-visible and nothing here decides a pass, a claim
 * or a promotion. The rows exist so an investigation can read how a
 * session was reasoning at each submit instead of inferring it from tool counts. Without these
 * rows the only copy of that prose is the provider's own rollout, under a private Codex home, with
 * nothing in the campaign pointing at it.
 */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { existsSync } from "../meta/filesystem.ts";
import { basename, join } from "../meta/path.ts";
import { writeAtomic } from "../meta/completed-json.ts";
import { boundText } from "../meta/bounded-text.ts";

const BUILDER_PROSE_FILE = "builder-prose.jsonl";
const BUILDER_PROSE_SCHEMA = "builder-prose/v2";
const BUILDER_PROSE_CAPTURE_SCHEMA = "builder-prose-capture/v1";

/** Rows beyond this are counted in `proseOmitted` and dropped; the count stays exact. */
const MAX_PROSE_ROWS = 4000;
/** Bytes kept per row, about 1024 tokens. A longer row is cut and marked, not dropped. */
const MAX_PROSE_BYTES = 4000;
/** A compaction row carries the summary the model wrote of everything before it, and the summary is
 *  the reason the row exists, so it keeps far more than a message row before it is cut. */
const MAX_COMPACTION_BYTES = 64_000;

export interface BuilderProseRow {
  schema: typeof BUILDER_PROSE_SCHEMA;
  sequence: number;
  turn: number;
  /** Milliseconds from session start, the execution record's clock. */
  atMs: number;
  kind: "message" | "reasoning" | "prompt" | "compaction";
  /** The text's full length before truncation, retained even when only its start is stored. */
  chars: number;
  truncated: boolean;
  text: string;
}

interface BuilderProseSnapshot {
  rows: BuilderProseRow[];
  omitted: number;
}

/** Reference stored in the execution record. It identifies the prose file without hashing
 *  protected prose, whose digest would expose equality across otherwise separate runs. */
export interface BuilderProseCapture {
  schema: typeof BUILDER_PROSE_CAPTURE_SCHEMA;
  captureId: string;
  file: string;
  rows: number;
  omitted: number;
}

interface BuilderProseHeader extends BuilderProseCapture {
  executionFile: string;
}

/** The bound one row kind is cut to, shared with every reader that holds a row to it. */
export function proseRowCap(kind: BuilderProseRow["kind"]): number {
  return kind === "compaction" ? MAX_COMPACTION_BYTES : MAX_PROSE_BYTES;
}

export class BuilderProseLog {
  private readonly rows: BuilderProseRow[] = [];
  private omitted = 0;

  constructor(private readonly since: () => number) {}

  push(kind: BuilderProseRow["kind"], text: string, turn: number): void {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    if (this.rows.length >= MAX_PROSE_ROWS) {
      this.omitted += 1;
      return;
    }
    const bounded = boundText(trimmed, proseRowCap(kind));
    this.rows.push({
      schema: BUILDER_PROSE_SCHEMA,
      sequence: this.rows.length + 1,
      turn,
      atMs: this.since(),
      kind,
      chars: trimmed.length,
      truncated: bounded.truncated,
      text: bounded.text,
    });
  }

  /** Copy the rows so a saved checkpoint does not grow when a later turn adds text. */
  snapshot(): BuilderProseSnapshot {
    return { rows: this.rows.map((row) => ({ ...row })), omitted: this.omitted };
  }
}

/** The sidecar name that pairs with one execution record: `builder-execution.json` owns
 *  `builder-prose.jsonl`, and every numbered execution keeps its complete decimal suffix. */
export function proseSidecarPath(executionPath: string): string {
  const suffix = /-(\d+)\.json$/.exec(executionPath)?.[1];
  const dir = executionPath.slice(0, executionPath.lastIndexOf("/"));
  return join(dir, suffix === undefined ? BUILDER_PROSE_FILE : `builder-prose-${suffix}.jsonl`);
}

/** Rewrite the sidecar in full and publish it atomically. The matching execution record is written
 *  only after this rename, so it never claims prose bytes that were not completed. */
export function writeBuilderProse(
  executionPath: string,
  snapshot: BuilderProseSnapshot,
  captureId: string,
): BuilderProseCapture {
  const path = proseSidecarPath(executionPath);
  const capture: BuilderProseCapture = {
    schema: BUILDER_PROSE_CAPTURE_SCHEMA,
    captureId,
    file: basename(path),
    rows: snapshot.rows.length,
    omitted: snapshot.omitted,
  };
  const header: BuilderProseHeader = { ...capture, executionFile: basename(executionPath) };
  const bytes = [header, ...snapshot.rows].map((row) => `${capturedJsonStringify(row)}\n`).join("");
  writeAtomic(path, bytes);
  return capture;
}

export function proseSidecarExists(executionPath: string): boolean {
  return existsSync(proseSidecarPath(executionPath));
}
