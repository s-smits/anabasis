/**
 * The log: one append-only JSONL file, one event per line. Every state and every report is a view
 * over it, and nothing else is stored as truth.
 *
 * An append is written and synced before it returns, so an event the host acted on survives a crash.
 * A read refuses a torn or unknown line instead of skipping it: a view over a log with a hole in it
 * would be a view over a different history.
 *
 * An append refuses, writing nothing, an event that would make the log unreadable: any event after a
 * torn last line, and an event the task states read when folding it onto the log so far throws. A
 * reviewer's probe appended a second `task.proposed` and every later read threw. Only those events
 * can break the fold, so solves, verdicts and traces, the frequent ones, skip the read.
 */
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  openSync,
  readFileSync,
  readSync,
  writeSync,
} from "../meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "../meta/json-runtime.ts";
import { asRecord, type JsonObject, type JsonValue, isString } from "../meta/json-shape.ts";
import { foldsEvent, taskStates } from "./task.ts";

/** The plan's events, and `anchor.drawn`, which is not among them: it names the task versions the
 *  anchor drew, which are never released, and a task may be released straight from held only once
 *  it is drawn, so the draw is an event the task states can see. */
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
  "anchor.drawn",
  "anchor.scored",
  "task.released",
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

const NEWLINE = 0x0a;

export interface LogEvent {
  /** ISO 8601, as the host's clock read it at the append. */
  readonly at: string;
  readonly kind: EventKind;
  readonly data: JsonObject;
}

export function append(path: string, kind: EventKind, data: JsonObject): LogEvent {
  const event: LogEvent = { at: new Date().toISOString(), kind, data };
  if (foldsEvent(kind)) taskStates([...read(path), event]);
  const fd = openSync(path, "a+");
  try {
    const size = fstatSync(fd).size;
    const last = Buffer.alloc(1);
    if (size > 0 && readSync(fd, last, 0, 1, size - 1) === 1 && last[0] !== NEWLINE) {
      throw new Error(`${path}: the last line is torn, so nothing is appended`);
    }
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
