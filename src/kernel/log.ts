import {
  closeSync,
  detachHardlink,
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

const EXAM_REVISED = "exam.revised";
const COMPARISON_STARTED = "comparison.started";

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
  "harness.reverted",
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
  EXAM_REVISED,
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
  "referee.brief",
  "referee.pair",
  "diagnosis.recorded",
  COMPARISON_STARTED,
  "comparison.reported",
  "stop.overridden",
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

export const LOG_FILE = "log.jsonl";

const [NEWLINE, QUOTE, CHUNK] = [0x0a, 0x22, 256 * 1024];
const [AT_END, KIND_BYTES] = [31, Buffer.from(`","kind":"`, "utf8")];

export interface LogEvent {
  readonly at: string;
  readonly kind: EventKind;
  readonly data: JsonObject;
}

type KindFilter = ReadonlySet<EventKind> | ((kind: EventKind) => boolean);

const KINDS: ReadonlySet<string> = new Set(EVENT_KINDS);
export const CALL_KINDS: ReadonlySet<EventKind> = new Set(
  EVENT_KINDS.filter((kind) => kind.endsWith(".call")),
);
export const TRACE_KINDS: ReadonlySet<EventKind> = new Set(
  EVENT_KINDS.filter((kind) => kind.endsWith(".call") || kind.endsWith(".turn")),
);
interface IndexedEvent {
  readonly index: number;
  readonly event: LogEvent;
}
interface KindCache {
  readonly length: number;
  readonly last: LogEvent | undefined;
  readonly map: Map<EventKind, IndexedEvent[]>;
}
const BY_KIND = new WeakMap<readonly LogEvent[], KindCache>();
export const isKind = (value: unknown): value is EventKind => isString(value) && KINDS.has(value);
export const isReferenceChange = (kind: EventKind): boolean =>
  kind === "harness.promoted" || kind === "harness.reverted";

const REVISION_LOCK_KINDS: ReadonlySet<EventKind> = new Set([
  EXAM_REVISED,
  COMPARISON_STARTED,
  "comparison.reported",
]);

function checkRevisionLock(path: string, kind: EventKind): void {
  if (kind !== EXAM_REVISED && kind !== COMPARISON_STARTED) return;
  const seen = read(path, (each) => !REVISION_LOCK_KINDS.has(each));
  const revised = seen.some((event) => event.kind === EXAM_REVISED);
  if (revised) {
    throw new Error(
      kind === EXAM_REVISED
        ? "exam has already been revised in this campaign"
        : "cannot start a comparison after exam.revised; continue in the successor campaign",
    );
  }
  if (kind !== EXAM_REVISED) return;
  const reported = new Set(
    seen.flatMap((event) =>
      event.kind === "comparison.reported" && isString(event.data.session) ? [event.data.session] : [],
    ),
  );
  const openSession = seen.flatMap((event) =>
    event.kind === COMPARISON_STARTED &&
    event.data.ladder !== true &&
    isString(event.data.session) &&
    !reported.has(event.data.session)
      ? [event.data.session]
      : [],
  )[0];
  if (openSession !== undefined) {
    throw new Error(`cannot revise exam while comparison ${openSession} is open`);
  }
}

export function append(path: string, kind: EventKind, data: JsonObject): LogEvent {
  const event: LogEvent = { at: new Date().toISOString(), kind, data };
  const fd = openSync(path, "a+");
  try {
    lockExclusiveSync(fd);
    if (foldsEvent(kind)) taskStates([...read(path, (each) => !foldsEvent(each)), event]);
    checkRevisionLock(path, kind);
    const full = fstatSync(fd).size;
    const size = wholeSize(fd, full);
    if (size !== full) ftruncateSync(fd, size);
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

function wholeSize(fd: number, total: number): number {
  const block = Buffer.alloc(65_536);
  let end = total;
  while (end > 0) {
    const from = Math.max(0, end - block.length);
    const newline = block.subarray(0, readSync(fd, block, 0, end - from, from)).lastIndexOf(NEWLINE);
    if (newline !== -1) return from + newline + 1;
    end = from;
  }
  return 0;
}

export function truncatePartial(path: string): number {
  const fd = openSync(path, "r");
  let stat: ReturnType<typeof fstatSync>;
  let size: number;
  try {
    stat = fstatSync(fd);
    size = wholeSize(fd, stat.size);
  } finally {
    closeSync(fd);
  }
  if (size === stat.size) return size;
  if (stat.nlink > 1) detachHardlink(path);
  const writable = openSync(path, "r+");
  try {
    ftruncateSync(writable, size);
  } finally {
    closeSync(writable);
  }
  return size;
}

export function eachEvent(
  path: string,
  visit: (event: LogEvent, index: number) => void,
  without: KindFilter | null = null,
): void {
  if (!existsSync(path)) return;
  const skip =
    without === null ? null : isFunction(without) ? without : (kind: EventKind) => without.has(kind);
  const fd = openSync(path, "r");
  let buf = Buffer.allocUnsafe(CHUNK);
  let [len, lineNo] = [0, 0];
  try {
    for (;;) {
      if (len === buf.length) {
        const grown = Buffer.allocUnsafe(buf.length * 2);
        buf.copy(grown, 0, 0, len);
        buf = grown;
      }
      const got = readSync(fd, buf, len, buf.length - len, null);
      if (got === 0) break;
      len += got;
      const view = buf.subarray(0, len);
      let start = 0;
      for (let nl = view.indexOf(NEWLINE); nl !== -1; nl = view.indexOf(NEWLINE, start)) {
        const from = start;
        start = nl + 1;
        lineNo += 1;
        if (skip !== null && skipAt(view, from, nl, skip)) continue;
        const raw = asRecord(parsed(view.toString("utf8", from, nl)));
        const data = asRecord(raw?.data);
        if (raw === null || !isString(raw.at) || !isKind(raw.kind) || data === null) {
          throw new Error(`${path}:${lineNo} is not a log event`);
        }
        if (skip === null || !skip(raw.kind)) visit({ at: raw.at, kind: raw.kind, data }, lineNo - 1);
      }
      const tail = len - start;
      if (tail > 0) buf.copyWithin(0, start, len);
      len = tail;
    }
  } finally {
    closeSync(fd);
  }
}

export function read(path: string, without: KindFilter | null = null): LogEvent[] {
  const events: LogEvent[] = [];
  eachEvent(path, (event) => events.push(event), without);
  return events;
}

export function eventsOf(
  events: readonly LogEvent[],
  kinds: EventKind | readonly EventKind[],
  upTo = events.length - 1,
): readonly IndexedEvent[] {
  const last = events.at(-1);
  let cached = BY_KIND.get(events);
  if (cached?.length !== events.length || cached.last !== last) {
    const map = new Map<EventKind, IndexedEvent[]>();
    for (const [index, event] of events.entries()) {
      const list = map.get(event.kind);
      if (list === undefined) map.set(event.kind, [{ index, event }]);
      else list.push({ index, event });
    }
    cached = { length: events.length, last, map };
    BY_KIND.set(events, cached);
  }
  const list = isString(kinds)
    ? (cached.map.get(kinds) ?? [])
    : kinds.flatMap((kind) => cached.map.get(kind) ?? []).toSorted((a, b) => a.index - b.index);
  return upTo >= events.length - 1 ? list : list.filter(({ index }) => index <= upTo);
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
