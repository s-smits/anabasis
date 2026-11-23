/**
 * The log: one append-only JSONL file, one event per line. Every state and every report is a view
 * over it, and nothing else is stored as truth.
 */
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  lockExclusiveSync,
  openSync,
  readSync,
  writeSync,
} from "../meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "../meta/json-runtime.ts";
import { asRecord, isFunction, type JsonObject, type JsonValue, isString } from "../meta/json-shape.ts";
import { foldsEvent, taskStates } from "./task.ts";

/** The kinds of event a log holds. A kind that no command writes any more stays in the list where a
 *  log may hold it, since a log is evidence and has to read; a kind no log holds is none.
 *  `comparison.started` fixes a comparison's terms before its first solve: the harnesses, the
 *  setting and the scored tasks (`src/campaign/round.ts`). `solve.turn` and `solve.call` are a
 *  solve's trace, one per model turn and one per tool call, so the trace is in the log rather than
 *  in a file beside it. `condition.recorded` holds a condition under the id its solves name
 *  (`condition.ts`), so a comparison can be checked from the log alone. The four `build.*` kinds are a Builder session's: what it was given, its own
 *  turns and calls, and how it ended (`src/builder/session.ts`). `build.checkpoint` keeps a
 *  harness snapshot inside a live Builder conversation, before a comparison. `solve.compacted`,
 *  `build.compacted` and `exam.compacted` are a compaction in pi's own loop, and what its summary
 *  spent (`src/agent/backends/compaction.ts`). The `exam.*` kinds are an Examiner session's: the same
 *  four (`src/examiner/session.ts`). `checker.read` is what a campaign's check program was seen to
 *  do, by the version it was read at (`acceptance.ts`); `contract.frozen` is the operator's word
 *  that the contract and that version stand, and a campaign whose own differ from it does not open.
 *  `campaign.setting` is who solves a campaign's tasks, what a solve is held to and which tasks are
 *  scored, recorded once and not changed (`tools/d2/setting.ts`).
 *  `harness.promoted` is the operator's word that a kept harness is the reference harness from
 *  there on (`tools/d2/promote.ts`), and `harness.imported` the operator's word that a harness
 *  built elsewhere is one the campaign keeps, with where it came from (`tools/d2/import.ts`).
 *  `stop.overridden` is the operator's reason for a comparison begun after the plan's stop rule
 *  had stopped the campaign (`src/campaign/admission.ts`).
 *  The four `campaign.*` kinds beside the setting are the Harness Builder's
 *  (`tools/d2/harness-builder.ts`): `campaign.opened` is what a campaign runs by, its total budget
 *  and its seats; `campaign.move` is a move it made, written as the move began, with the code of
 *  the row of its decision table that chose it and its reason (`src/campaign/decide.ts`), the host's load; and
 *  `campaign.ended` is how the campaign ended, which is its last event. `campaign.word` is a word
 *  the operator left for a running campaign (`tools/d2/word.ts`): to stop, to have other tasks
 *  written, another total budget or the cause of an A/A that read a step. It is read at the next
 *  move's boundary, and the event that acts on it names it. `campaign.waited` is a solve that
 *  waited for a loaded host before it started (`tools/d2/host.ts`): its task and harness, the load
 *  and how long.
 *  The `draft.*` kinds are the session in which an Examiner drafts a campaign's exam from the
 *  operator's prompt (`src/examiner/draft.ts`), the same five as an Examiner session's, and
 *  `exam.drafted` holds the draft that stood, whole: its rules with their sources, its answer
 *  format, its check program's source, its example tasks and its control answers. A campaign opened from
 *  a prompt reads its exam from that event and from no file beside the log.
 *  `task.feasible` is a task an author's answer passed the checks on, under its own id once its task admission
 *  passed or in a `try_answer` after that, by version and never the answer, or one a stored pack's
 *  accepted answer passes today's checks on (`tools/d2/prepare.ts`), by version and sweep. An
 *  optional `objective` holds the contract's quantity, its direction and the answer's measure: the
 *  Examiner's two paths write it where the contract declares an objective (`measureOf`,
 *  `src/examiner/write.ts`), and `prepare.ts` never does. `referee.refused` is a rejection ruling
 *  the host refused the Referee for want of its evidence (`src/referee/referee.ts`);
 *  `referee.draft.refused` is the matching refusal for an upstream draft-audit verdict
 *  (`src/referee/draft-audit.ts`). */
const EVENT_KINDS = [
  "campaign.opened",
  "campaign.setting",
  "campaign.move",
  "campaign.word",
  "campaign.waited",
  "campaign.ended",
  "checker.read",
  "contract.frozen",
  "condition.recorded",
  "harness.version",
  "harness.promoted",
  "harness.imported",
  "build.started",
  "build.checkpoint",
  "build.turn",
  "build.call",
  "build.compacted",
  "build.finished",
  "draft.started",
  "draft.turn",
  "draft.call",
  "draft.compacted",
  "draft.finished",
  "exam.drafted",
  "exam.started",
  "exam.turn",
  "exam.call",
  "exam.compacted",
  "exam.finished",
  "task.proposed",
  "task.feasible",
  "task.gate",
  "task.state",
  "solve.started",
  "solve.turn",
  "solve.call",
  "solve.compacted",
  "solve.finished",
  "verdict",
  "referee.turn",
  "referee.call",
  "referee.compacted",
  "referee.finding",
  "referee.refused",
  "referee.draft",
  "referee.draft.refused",
  "diagnosis.recorded",
  "comparison.started",
  "comparison.reported",
  "stop.overridden",
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

/** The file a campaign's log is, under the campaign's folder. The module that reads and appends
 *  the file owns its name, since five files that joined it onto a folder of their own were what
 *  `no-unowned-identity` reported. */
export const LOG_FILE = "log.jsonl";

const [NEWLINE, QUOTE, CHUNK, EMPTY] = [0x0a, 0x22, 256 * 1024, Buffer.alloc(0)];
/** Where `{"at":"<24 characters>` ends and `","kind":"` begins, in every line `append` writes. */
const [AT_END, KIND_BYTES] = [31, Buffer.from(`","kind":"`, "utf8")];

export interface LogEvent {
  /** ISO 8601, as the host's clock read it at the append. */
  readonly at: string;
  readonly kind: EventKind;
  readonly data: JsonObject;
}

type KindFilter = ReadonlySet<EventKind> | ((kind: EventKind) => boolean);

const KINDS: ReadonlySet<string> = new Set(EVENT_KINDS);
export const isKind = (value: unknown): value is EventKind => isString(value) && KINDS.has(value);

export function append(path: string, kind: EventKind, data: JsonObject): LogEvent {
  const event: LogEvent = { at: new Date().toISOString(), kind, data };
  const fd = openSync(path, "a+");
  try {
    lockExclusiveSync(fd);
    if (foldsEvent(kind)) taskStates([...read(path, (each) => !foldsEvent(each)), event]);
    const size = wholeSize(fd);
    if (size !== fstatSync(fd).size) ftruncateSync(fd, size);
    const line = Buffer.from(`${capturedJsonStringify(event)}\n`, "utf8");
    let written = 0;
    try {
      written = writeSync(fd, line);
    } finally {
      if (written !== line.length) ftruncateSync(fd, size);
    }
    if (written !== line.length) throw new Error(`${path}: the log line was not written whole`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return event;
}

/** The log's size up to its last whole line, read back from its end a block at a time through the
 *  locked descriptor, so the cut is of the file the lock holds whatever its path names by then. */
function wholeSize(fd: number): number {
  const block = Buffer.alloc(65_536);
  let end = fstatSync(fd).size;
  while (end > 0) {
    const from = Math.max(0, end - block.length);
    const newline = block.subarray(0, readSync(fd, block, 0, end - from, from)).lastIndexOf(NEWLINE);
    if (newline !== -1) return from + newline + 1;
    end = from;
  }
  return 0;
}

/** Every event in append order. Missing logs are empty; kinds matched by `without` are skipped
 *  straight from fixed byte chunks without decoding or parsing. */
export function read(path: string, without?: KindFilter): LogEvent[] {
  if (!existsSync(path)) return [];
  const skip =
    without === undefined ? null : isFunction(without) ? without : (kind: EventKind) => without.has(kind);
  const events: LogEvent[] = [];
  const [block, fd] = [Buffer.allocUnsafe(CHUNK), openSync(path, "r")];
  let [carry, lineNo] = [EMPTY, 0];
  try {
    for (let got = readSync(fd, block, 0, CHUNK, null); got > 0; got = readSync(fd, block, 0, CHUNK, null)) {
      const chunk =
        carry.length === 0 ? block.subarray(0, got) : Buffer.concat([carry, block.subarray(0, got)]);
      let start = 0;
      for (let nl = chunk.indexOf(NEWLINE); nl !== -1; nl = chunk.indexOf(NEWLINE, start)) {
        const from = start;
        start = nl + 1;
        lineNo += 1;
        if (skip !== null && skipAt(chunk, from, nl, skip)) continue;
        const event = asRecord(parsed(chunk.toString("utf8", from, nl)));
        const kind = isKind(event?.kind) ? event.kind : undefined;
        const data = asRecord(event?.data);
        if (!isString(event?.at) || kind === undefined || data === null) {
          throw new Error(`${path}:${lineNo} is not a log event`);
        }
        if (skip === null || !skip(kind)) events.push({ at: event.at, kind, data });
      }
      carry = start < chunk.length ? Buffer.from(chunk.subarray(start)) : EMPTY;
    }
  } finally {
    closeSync(fd);
  }
  return events;
}

function skipAt(chunk: Buffer, start: number, end: number, skip: (kind: EventKind) => boolean): boolean {
  const [at, from] = [start + AT_END, start + AT_END + KIND_BYTES.length];
  if (end <= from || chunk.compare(KIND_BYTES, 0, KIND_BYTES.length, at, from) !== 0) return false;
  const close = chunk.indexOf(QUOTE, from);
  const kind = close > from && close < end ? chunk.toString("utf8", from, close) : "";
  return isKind(kind) && skip(kind);
}

function parsed(line: string): JsonValue | undefined {
  try {
    return capturedJsonParse(line);
  } catch {
    return undefined;
  }
}
