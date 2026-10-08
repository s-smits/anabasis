/**
 * The log: one append-only JSONL file, one event per line. Every state and every report is a view
 * over it, and nothing else is stored as truth.
 *
 * An append is written and synced before it returns, so an event the host acted on survives a crash.
 * A read refuses a torn or unknown line instead of skipping it: a view over a log with a hole in it
 * would be a view over a different history. A torn last line is a crash inside an append, and
 * `repair` cuts it.
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
  ftruncateSync,
  openSync,
  readFileSync,
  readSync,
  writeSync,
} from "../meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "../meta/json-runtime.ts";
import { asRecord, type JsonObject, type JsonValue, isString } from "../meta/json-shape.ts";
import { foldsEvent, taskStates } from "./task.ts";

/** The plan's events, and nineteen that are not among them. `anchor.drawn` names the task versions the
 *  anchor drew, which are never released, and a task may be released straight from held only once
 *  it is drawn, so the draw is an event the task states can see. `solve.turn` and `solve.call` are
 *  a solve's trace, one per model turn and one per tool call, so the trace is in the log rather than
 *  in a file beside it. `condition.recorded` holds a condition under the id its solves name
 *  (`condition.ts`), so a comparison can be checked from the log alone. The four `build.*` kinds are
 *  a Builder session's: what it was given, its own turns and calls, and how it ended
 *  (`src/builder/session.ts`). `solve.compacted`, `build.compacted` and `exam.compacted` are a compaction
 *  in pi's own loop, and what its summary spent (`src/backends/pi-compaction.ts`). The five `exam.*` kinds are an Examiner session's: the same four,
 *  and `exam.word`, the one word a task's author is told of it, with the solves it rests on
 *  (`src/examiner/session.ts`). `checker.read` is what a campaign's check program was seen to do, by
 *  the version it was read at (`acceptance.ts`); `contract.frozen` is the operator's word that the
 *  contract and that version stand, and a campaign whose own differ from it does not open. It may be
 *  logged again: the last one is the campaign's checker, and each later one opens a checker epoch
 *  (`epoch.ts`). `checker.adopted` closes an epoch's adoption with what it carried, and
 *  `verdict.regraded` is a stored solve under the adopted checker: its answer's verdict there, and
 *  the task version it stands for where the solver was asked the same thing (`ladder.ts`). */
export const EVENT_KINDS = [
  "world.accepted",
  "checker.read",
  "contract.frozen",
  "checker.adopted",
  "condition.recorded",
  "harness.version",
  "build.started",
  "build.turn",
  "build.call",
  "build.compacted",
  "build.finished",
  "exam.started",
  "exam.turn",
  "exam.call",
  "exam.compacted",
  "exam.word",
  "exam.finished",
  "task.proposed",
  "task.gate",
  "task.state",
  "solve.started",
  "solve.turn",
  "solve.call",
  "solve.compacted",
  "solve.finished",
  "verdict",
  "verdict.regraded",
  "referee.finding",
  "referee.dispute",
  "diagnosis.recorded",
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

/** An event before it is appended: the log's clock gives it its time. */
export interface Entry {
  readonly kind: EventKind;
  readonly data: JsonObject;
}

export function append(path: string, kind: EventKind, data: JsonObject): LogEvent {
  const event: LogEvent = { at: new Date().toISOString(), kind, data };
  if (foldsEvent(kind)) taskStates([...read(path), event]);
  written(path, [event]);
  return event;
}

/**
 * Several events as one append: folded together onto the log so far, written in one write and
 * synced once. An adoption of a changed checker carries every live task at a time (`epoch.ts`),
 * some hundreds of task events, and appended one by one each would read the whole log to fold it.
 * A crash inside the write leaves whole lines and at most one torn one, as any append does, so
 * what a batch must not leave half done it closes with an event of its own.
 */
export function appendAll(path: string, entries: readonly Entry[]): LogEvent[] {
  const at = new Date().toISOString();
  const events = entries.map(({ kind, data }): LogEvent => ({ at, kind, data }));
  if (events.some(({ kind }) => foldsEvent(kind))) taskStates([...read(path), ...events]);
  written(path, events);
  return events;
}

/** The lines of `events` at the end of the log, synced before it returns. */
function written(path: string, events: readonly LogEvent[]): void {
  const fd = openSync(path, "a+");
  try {
    const size = fstatSync(fd).size;
    const last = Buffer.alloc(1);
    if (size > 0 && readSync(fd, last, 0, 1, size - 1) === 1 && last[0] !== NEWLINE) {
      throw new Error(`${path}: the last line is torn, so nothing is appended`);
    }
    writeSync(fd, events.map((event) => `${capturedJsonStringify(event)}\n`).join(""));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
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

/**
 * Cuts a torn last line and returns its text, or null when the log ends whole. Cutting is safe: an
 * append returns only after its line is synced, so the host acted on no event the torn part held.
 */
export function repair(path: string): string | null {
  if (!existsSync(path)) return null;
  const bytes = readFileSync(path);
  if (bytes.length === 0 || bytes.at(-1) === NEWLINE) return null;
  const kept = bytes.lastIndexOf(NEWLINE) + 1;
  const fd = openSync(path, "r+");
  try {
    ftruncateSync(fd, kept);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return bytes.subarray(kept).toString("utf8");
}

function parsed(line: string): JsonValue | undefined {
  try {
    return capturedJsonParse(line);
  } catch {
    return undefined;
  }
}
