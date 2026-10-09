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

/** The kinds of event a log holds. A kind that no command writes any more stays in the list where a
 *  log may hold it, since a log is evidence and has to read. A kind no log holds is none: three
 *  were in this list until 2026-10-09 that no command wrote (two never, one for ten minutes of
 *  8 October's history) and that none of the 25 campaign logs kept then held.
 *  `comparison.started` fixes a
 *  comparison's terms before its first solve: the harnesses, the setting and the scored tasks
 *  (`src/builder/round.ts`). `anchor.drawn`, `anchor.scored` and `exam.word` are written by no
 *  command since 2026-10-09 and are kinds still, so that a log written before then reads: the
 *  anchor's draw and its test, and the word an Examiner was told of a task. `solve.turn` and `solve.call` are
 *  a solve's trace, one per model turn and one per tool call, so the trace is in the log rather than
 *  in a file beside it. `condition.recorded` holds a condition under the id its solves name
 *  (`condition.ts`), so a comparison can be checked from the log alone. The four `build.*` kinds are
 *  a Builder session's: what it was given, its own turns and calls, and how it ended
 *  (`src/builder/session.ts`). `solve.compacted`, `build.compacted` and `exam.compacted` are a compaction
 *  in pi's own loop, and what its summary spent (`src/backends/pi-compaction.ts`). The `exam.*` kinds are an Examiner session's: the same four
 *  (`src/examiner/session.ts`). `checker.read` is what a campaign's check program was seen to do, by
 *  the version it was read at (`acceptance.ts`); `contract.frozen` is the operator's word that the
 *  contract and that version stand, and a campaign whose own differ from it does not open.
 *  `campaign.setting` is who solves a campaign's tasks, what a solve is held to and which tasks are
 *  scored, recorded once and again only on the operator's word (`tools/d2/setting.ts`).
 *  `harness.promoted` is the operator's word that a kept harness is the reference harness from
 *  there on (`tools/d2/promote.ts`).
 *  `stop.overridden` is the operator's reason for a comparison begun after the plan's stop rule
 *  had stopped the campaign (`src/builder/admission.ts`). */
export const EVENT_KINDS = [
  "campaign.setting",
  "checker.read",
  "contract.frozen",
  "condition.recorded",
  "harness.version",
  "harness.promoted",
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
  "referee.finding",
  "diagnosis.recorded",
  "comparison.started",
  "comparison.reported",
  "stop.overridden",
  "anchor.drawn",
  "anchor.scored",
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
