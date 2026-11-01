/**
 * The log: one append-only JSONL file, one event per line. Every state and every report is a view
 * over it, and nothing else is stored as truth.
 *
 * An append is written and synced before it returns, so an event the host acted on survives a crash.
 * A read refuses a torn or unknown line instead of skipping it: a view over a log with a hole in it
 * would be a view over a different history. A torn last line is a crash inside an append; nothing
 * cuts it, since a log is never edited (AGENTS.md section 5).
 *
 * An append refuses, writing nothing, an event that would make the log unreadable: any event after a
 * torn last line, and an event the task states read when folding it onto the log so far throws. A
 * reviewer's probe appended a second `task.proposed` and every later read threw. Only those events
 * can break the fold, so solves, verdicts and traces, the frequent ones, skip the read.
 * On 26 October the two-process transition test reproduced a release validated against held while
 * a dispute was appended, leaving an unreadable history. One exclusive descriptor lock now covers
 * validation, the complete line's write and its sync. Closing the descriptor releases it on every
 * path, and a short write throws instead of reporting an event the log does not hold whole. It also
 * cuts the file back to its size before the write, under the same lock: those bytes were never an
 * event, and until 30 October they tore the last line, after which every read and append refused.
 */
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  lockExclusiveSync,
  openSync,
  readFileSync,
  readSync,
  writeSync,
} from "../meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "../meta/json-runtime.ts";
import { asRecord, type JsonObject, type JsonValue, isString } from "../meta/json-shape.ts";
import { foldsEvent, taskStates } from "./task.ts";

/** The kinds of event a log holds. A kind that no command writes any more stays in the list where a
 *  log may hold it, since a log is evidence and has to read; a kind no log holds is none.
 *  `comparison.started` fixes a comparison's terms before its first solve: the harnesses, the
 *  setting and the scored tasks (`src/campaign/round.ts`). `anchor.drawn`, `anchor.scored` and
 *  `exam.word` are written by no command since 9 October and are kinds still, so that a log
 *  written before then reads: the anchor's draw and its test, and the word an Examiner was told of
 *  a task. `solve.turn` and `solve.call` are a solve's trace, one per model turn and one per tool
 *  call, so the trace is in the log rather than in a file beside it. `condition.recorded` holds a
 *  condition under the id its solves name (`condition.ts`), so a comparison can be checked from
 *  the log alone. The four `build.*` kinds are a Builder session's: what it was given, its own
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
 *  a prompt reads its exam from that event and from no file beside the log. The `repair.*` kinds
 *  were a session in which the Examiner repaired its own check program or its control answers between
 *  comparisons, retired on 13 October; they stay so that a log of before still reads, as
 *  `pass.labelled` does, a person's label of a pass, which the settled report holds since 12 October.
 *  `task.feasible` is a task an author's answer passed the checks on, under its own id once its task admission
 *  passed or in a `try_answer` after that, by version and never the answer, or one a stored pack's
 *  accepted answer passes today's checks on (`tools/d2/prepare.ts`), by version and sweep. An
 *  optional `objective` holds the contract's quantity, its direction and the answer's measure: the
 *  Examiner's two paths write it where the contract declares an objective (since 19 October,
 *  `measureOf`, `src/examiner/write.ts`), and `prepare.ts` never does. `referee.refused` is a
 *  ruling the host refused the Referee for want of its evidence, with why (`src/referee/referee.ts`),
 *  written since 19 October. */
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
  "repair.started",
  "repair.turn",
  "repair.call",
  "repair.compacted",
  "repair.finished",
  "exam.started",
  "exam.turn",
  "exam.call",
  "exam.compacted",
  "exam.word",
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
  "diagnosis.recorded",
  "comparison.started",
  "comparison.reported",
  "stop.overridden",
  "anchor.drawn",
  "anchor.scored",
  "pass.labelled",
  "diagnosis.labelled",
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

/** The file a campaign's log is, under the campaign's folder. The module that reads and appends
 *  the file owns its name, since five files that joined it onto a folder of their own were what
 *  `identity-without-owner` reported. */
export const LOG_FILE = "log.jsonl";

const NEWLINE = 0x0a;
/** Where `{"at":"<24 characters>` ends and `","kind":"` begins, in every line `append` writes. */
const [AT_END, KIND_AT] = [31, `","kind":"`];

export interface LogEvent {
  /** ISO 8601, as the host's clock read it at the append. */
  readonly at: string;
  readonly kind: EventKind;
  readonly data: JsonObject;
}

const KINDS: ReadonlySet<string> = new Set(EVENT_KINDS);
const isKind = (value: unknown): value is EventKind => isString(value) && KINDS.has(value);

export function append(path: string, kind: EventKind, data: JsonObject): LogEvent {
  const event: LogEvent = { at: new Date().toISOString(), kind, data };
  const fd = openSync(path, "a+");
  try {
    lockExclusiveSync(fd);
    if (foldsEvent(kind)) taskStates([...read(path), event]);
    const size = fstatSync(fd).size;
    const last = Buffer.alloc(1);
    if (size > 0 && readSync(fd, last, 0, 1, size - 1) === 1 && last[0] !== NEWLINE) {
      throw new Error(`${path}: the last line is torn, so nothing is appended`);
    }
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

/** Every event in append order. A missing log is an empty history. A reader that reads no event of
 *  some kinds names them in `without`, and their lines are passed over unparsed: on 30 October the
 *  calls of solves and sessions were 72% of the bytes of 145 campaign logs, and reading the table of
 *  runs without them took 0.9 s instead of 2.6 s. `append` writes `at` first, a fixed 24 characters,
 *  and `kind` next, so the kind is read at its place. */
export function read(path: string, without?: ReadonlySet<EventKind>): LogEvent[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  if (text.length > 0 && !text.endsWith("\n")) throw new Error(`${path}: the last line is torn`);
  const events: LogEvent[] = [];
  for (const [index, line] of text.split("\n").slice(0, -1).entries()) {
    const passed = without === undefined ? undefined : kindAt(line);
    if (passed !== undefined && without?.has(passed) === true) continue;
    const event = asRecord(parsed(line));
    const kind = isKind(event?.kind) ? event.kind : undefined;
    const data = asRecord(event?.data);
    if (!isString(event?.at) || kind === undefined || data === null) {
      throw new Error(`${path}:${index + 1} is not a log event`);
    }
    // A line written in another order is parsed whole, and left out all the same.
    if (without?.has(kind) !== true) events.push({ at: event.at, kind, data });
  }
  return events;
}

function kindAt(line: string): EventKind | undefined {
  if (!line.startsWith(KIND_AT, AT_END)) return undefined;
  const from = AT_END + KIND_AT.length;
  const kind = line.slice(from, line.indexOf(`"`, from));
  return isKind(kind) ? kind : undefined;
}

function parsed(line: string): JsonValue | undefined {
  try {
    return capturedJsonParse(line);
  } catch {
    return undefined;
  }
}
