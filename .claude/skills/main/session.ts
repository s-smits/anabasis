/**
 * A Claude Code session read from outside it: its registry record, whether that record's process
 * still exists, and its transcript.
 *
 * Claude Code keeps one record per running process at `<config dir>/sessions/<pid>.json`, carrying
 * the session id, a `status` of busy, idle or waiting, and `waitingFor` while a question or a
 * permission prompt holds the turn open on the operator. A resumed session leaves the earlier
 * process's record behind, so the record whose process still exists is the session. The transcript
 * sits under the slug of the directory the session started in, which need not be where it works
 * now, so it is found by its session id rather than by a directory.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import {
  asRecord,
  isNumber,
  isString,
  type JsonObject,
  type JsonValue,
  textOrNull,
} from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { errorCode } from "#src/meta/runtime-values.ts";

export interface ClaudeSession {
  sessionId: string;
  /** The process of the record read, or null when no record names the session. */
  pid: number | null;
  live: boolean;
  name: string | null;
  /** The directory the session started in. */
  cwd: string | null;
  /** The record's `status` as Claude Code last wrote it: busy, idle or waiting. */
  status: string | null;
  statusUpdatedAt: string | null;
  /** What holds a waiting turn open, such as "input needed"; null unless the status is waiting. */
  waitingFor: string | null;
  transcript: string | null;
  /** Seconds since the transcript last grew. */
  quietSeconds: number | null;
}

/**
 * Whether a process with this id exists. `kill(pid, 0)` sends no signal. A refusal for permission
 * means the process exists and this caller may not signal it: it belongs to another user, or the
 * caller runs inside a sandbox that refuses every process outside its wall, the operator's own
 * included (`test/darwin-seatbelt.test.ts`). So only ESRCH says it is gone.
 */
export function processExists(pid: JsonValue | undefined): boolean {
  if (!isNumber(pid) || !Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    runtimeProcess.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== "ESRCH";
  }
}

/** Every record naming the session. A record torn by a concurrent rewrite is passed over, since the
 *  process writing it rewrites it again on its next change of state. */
function recordsFor(configDir: string, sessionId: string): JsonObject[] {
  const dir = join(configDir, "sessions");
  if (!existsSync(dir)) return [];
  const records: JsonObject[] = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
    let record: JsonObject | null;
    try {
      record = asRecord(capturedJsonParse(readFileSync(join(dir, file), "utf8")));
    } catch {
      continue;
    }
    if (record?.sessionId === sessionId) records.push(record);
  }
  return records;
}

/** The session's transcript, the most recently written when more than one project holds it. */
function transcriptOf(configDir: string, sessionId: string): { path: string; mtimeMs: number } | null {
  const projects = join(configDir, "projects");
  if (!existsSync(projects)) return null;
  let found: { path: string; mtimeMs: number } | null = null;
  for (const slug of readdirSync(projects)) {
    const path = join(projects, slug, `${sessionId}.jsonl`);
    let mtimeMs: number;
    try {
      ({ mtimeMs } = statSync(path));
    } catch {
      // No transcript under this slug, or it was removed after the listing.
      continue;
    }
    if (found === null || mtimeMs > found.mtimeMs) found = { path, mtimeMs };
  }
  return found;
}

/** When the record last changed state, as epoch milliseconds or an ISO string; null when absent or
 *  not a date. */
function updatedAt(value: JsonValue | undefined): string | null {
  if (!isNumber(value) && !isString(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** The record whose process still exists, otherwise the one that changed state last. */
function currentRecord(records: JsonObject[]): JsonObject | null {
  const live = records.find((entry) => processExists(entry.pid));
  if (live !== undefined) return live;
  const stamp = (entry: JsonObject): number => Date.parse(updatedAt(entry.statusUpdatedAt) ?? "") || 0;
  return records.toSorted((a, b) => stamp(b) - stamp(a))[0] ?? null;
}

export function readClaudeSession(configDir: string, sessionId: string, now = Date.now()): ClaudeSession {
  const record = currentRecord(recordsFor(configDir, sessionId));
  const pid = isNumber(record?.pid) ? record.pid : null;
  const status = textOrNull(record?.status);
  const transcript = transcriptOf(configDir, sessionId);
  return {
    sessionId,
    pid,
    live: processExists(pid ?? undefined),
    name: textOrNull(record?.name),
    cwd: textOrNull(record?.cwd),
    status,
    statusUpdatedAt: updatedAt(record?.statusUpdatedAt),
    waitingFor: status === "waiting" ? (textOrNull(record?.waitingFor) ?? "unknown") : null,
    transcript: transcript?.path ?? null,
    quietSeconds: transcript === null ? null : Math.max(0, Math.round((now - transcript.mtimeMs) / 1000)),
  };
}
