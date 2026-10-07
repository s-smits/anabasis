/**
 * The log: one append-only JSONL file, one event per line. Every state and every report is a view
 * over it, and nothing else is stored as truth.
 *
 * An append is written and synced before it returns, so an event the host acted on survives a crash.
 * A read refuses a torn or unknown line instead of skipping it: a view over a log with a hole in it
 * would be a view over a different history.
 */
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from "../meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "../meta/json-runtime.ts";
import { asRecord, type JsonObject, type JsonValue, isString } from "../meta/json-shape.ts";

export const EVENT_KINDS = [
  "world.accepted",
  "contract.frozen",
  "harness.version",
  "task.proposed",
  "task.gate",
  "task.state",
  "solve.started",
  "solve.finished",
  "verdict",
  "referee.finding",
  "referee.dispute",
  "comparison.reported",
  "anchor.scored",
  "task.released",
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

export interface LogEvent {
  /** ISO 8601, as the host's clock read it at the append. */
  readonly at: string;
  readonly kind: EventKind;
  readonly data: JsonObject;
}

export function append(path: string, kind: EventKind, data: JsonObject): LogEvent {
  const event: LogEvent = { at: new Date().toISOString(), kind, data };
  const fd = openSync(path, "a");
  try {
    writeSync(fd, `${capturedJsonStringify(event)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return event;
}

/** Every event in append order. A missing log is an empty history. */
export function read(path: string): LogEvent[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  if (text.length > 0 && !text.endsWith("\n")) throw new Error(`${path}: the last line is torn`);
  return text
    .split("\n")
    .slice(0, -1)
    .map((line, index) => {
      const event = asRecord(parsed(line));
      const kind = EVENT_KINDS.find((known) => known === event?.kind);
      const data = asRecord(event?.data);
      if (!isString(event?.at) || kind === undefined || data === null) {
        throw new Error(`${path}:${index + 1} is not a log event`);
      }
      return { at: event.at, kind, data };
    });
}

function parsed(line: string): JsonValue | undefined {
  try {
    return capturedJsonParse(line);
  } catch {
    return undefined;
  }
}
