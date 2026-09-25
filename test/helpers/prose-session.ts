import { writeFileSync } from "../../src/meta/filesystem.ts";
import { join } from "../../src/meta/path.ts";
import { BUILDER_EXECUTION_SCHEMA } from "../../src/author/builder-execution.ts";
import { CLASSES } from "../../.claude/skills/whole-run-investigation/classifier/prose-classify.mjs";

export interface ProseRow {
  turn: number;
  atMs: number;
  /** `prompt` and `compaction` rows record what the controller sent and what the transport did. */
  kind?: "message" | "reasoning" | "prompt" | "compaction";
  text: string;
}

export interface SessionSubmit {
  kind: string;
  turn: number;
  atMs: number;
  outcome: string;
  stage?: string | null;
}

/** The execution-record fields a test sets; the session outcome decides whether its rows count as evidence. */
export interface SessionExecution {
  outcome?: string;
  backend?: string;
  writtenAt?: string;
  durationMs?: number;
  submits?: SessionSubmit[];
}

const CLASS_ENTRIES: Array<[string, string[]]> = Object.entries(CLASSES);

export const CLASS_NAMES = CLASS_ENTRIES.map(([name]) => name);

const ANCHOR_CLASS = new Map(CLASS_ENTRIES.flatMap(([name, anchors]) => anchors.map((text) => [text, name])));

/** The one-hot vector of a posture class. */
export function axis(name: string): number[] {
  return CLASS_NAMES.map((candidate) => (candidate === name ? 1 : 0));
}

/** The model stand-in's first rule: a class anchor lands on its own class axis. */
export function anchorVector(text: string): number[] | undefined {
  const name = ANCHOR_CLASS.get(text);
  return name === undefined ? undefined : axis(name);
}

/**
 * One Builder session in an epoch directory, written the way the recorder writes it: the prose
 * capture with its header, and the execution record that names that capture. Session 1 takes the
 * bare file names and a later one the `-NN` suffix, which is how a shared epoch holds several.
 */
export function writeSession(
  epoch: string,
  n: number,
  rows: ProseRow[],
  execution: SessionExecution = {},
): void {
  const suffix = n === 1 ? "" : `-${String(n).padStart(2, "0")}`;
  const captureId = `6f1d2c3b-4a5e-4f60-8b71-9c0d1e2f3a4${String(n)}`;
  const file = `builder-prose${suffix}.jsonl`;
  const executionFile = `builder-execution${suffix}.json`;
  const capture = { schema: "builder-prose-capture/v1", captureId, file, rows: rows.length, omitted: 0 };
  const lines = rows.map((row, index) => ({
    schema: "builder-prose/v2",
    sequence: index + 1,
    kind: "message",
    ...row,
    chars: row.text.length,
    truncated: false,
  }));
  const text = [{ ...capture, executionFile }, ...lines].map((line) => JSON.stringify(line)).join("\n");
  writeFileSync(join(epoch, file), `${text}\n`);
  writeFileSync(
    join(epoch, executionFile),
    JSON.stringify({
      schema: BUILDER_EXECUTION_SCHEMA,
      proseCapture: capture,
      proseOmitted: 0,
      submits: [],
      ...execution,
    }),
  );
}
