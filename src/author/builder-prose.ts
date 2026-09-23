/**
 * The Builder's own words, recorded beside its execution record.
 *
 * Two kinds of row: the assistant text a turn returned (`message`) and a reasoning summary the
 * transport surfaced while the turn ran (`reasoning`). Nothing here is model-visible and nothing
 * here decides a pass, a claim or a promotion. The rows exist so an investigation can read how a
 * session was reasoning at each submit instead of inferring it from tool counts. The epoch used to
 * record no Builder prose at all: on 2026-08-22 the only copy lived in a provider rollout under a
 * private Codex home, with nothing in the campaign pointing at it.
 */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { existsSync } from "../meta/filesystem.ts";
import { basename, join } from "../meta/path.ts";
import { writeAtomic } from "../meta/completed-json.ts";

const BUILDER_PROSE_FILE = "builder-prose.jsonl";
const BUILDER_PROSE_SCHEMA = "builder-prose/v1";
const BUILDER_PROSE_CAPTURE_SCHEMA = "builder-prose-capture/v1";

/** Rows beyond this are counted in `proseOmitted` and dropped; the count stays exact. */
const MAX_PROSE_ROWS = 4000;
/** Characters kept per row, about 1024 tokens. A longer row is cut and marked, not dropped. */
export const MAX_PROSE_CHARS = 4000;

export interface BuilderProseRow {
  schema: typeof BUILDER_PROSE_SCHEMA;
  sequence: number;
  turn: number;
  /** Milliseconds from session start, the execution record's clock. */
  atMs: number;
  kind: "message" | "reasoning";
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
    this.rows.push({
      schema: BUILDER_PROSE_SCHEMA,
      sequence: this.rows.length + 1,
      turn,
      atMs: this.since(),
      kind,
      chars: trimmed.length,
      truncated: trimmed.length > MAX_PROSE_CHARS,
      text: trimmed.slice(0, MAX_PROSE_CHARS),
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
