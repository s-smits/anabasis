/**
 * The append-only record of every path decision an isolated Builder capability made. The guard
 * decides and the operating-system child enforces, and this stream is where both halves meet: a
 * row carries the requested and resolved path, the policy and profile digests in force, and an
 * `enforcement` naming the layer that settled it. Keeping only the guard's ruling would show a
 * path Seatbelt refused after the guard had allowed it as an ordinary allow, which is the one
 * disagreement the isolation evidence exists to surface.
 *
 * The rows outlive the session that wrote them: `tools/outcome/builder-tools.ts` folds the stream
 * back into a per-run reading, so a row must stay parseable and ordered long afterwards.
 */
import type { JsonValue } from "../meta/json-shape.ts";
import { appendFileSync, existsSync, readFileSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { capturedJsonParse, capturedJsonStringify } from "../meta/json-runtime.ts";
import { plainRecord } from "../meta/json-evidence.ts";
import { CANDIDATE_ISOLATION_GUARD_ID, type IsolationMode } from "./candidate-isolation.ts";
import { isString } from "../meta/json-shape.ts";

/** The row fields a recorded path decision must carry as strings to be readable at all. */
const REQUIRED_STRINGS = ["at", "sessionId", "capability", "guardId", "policyDigest", "requested", "reason"];

export type PathRecordRow = {
  seq: number;
  at: string;
  sessionId: string;
  capability: string;
  mode: IsolationMode;
  guardId: string;
  policyDigest: string;
  profileDigest: string | null;
  requested: string;
  resolved: string | null;
  decision: "allow" | "deny";
  reason: string;
  /** Which layer settled the access: `guard-denied` for a path `guardPath` refused before any
   *  child ran, `os-refused` for one the guard allowed and the sandbox then visibly refused, and
   *  `os-allowed` for a command the sandbox let through. The middle value is a disagreement
   *  between the two layers, and `candidate-isolation-runtime.ts` turns it into a refusal that
   *  stops the build; only Darwin can produce it, because Bubblewrap shows a denied path as an
   *  absent one and the vm workshop cell therefore records every run it made as `os-allowed`. */
  enforcement: "guard-denied" | "os-refused" | "os-allowed";
  bytes: number | null;
};

export interface PathRecord {
  readonly path: string;
  readonly sessionId: string;
  append(row: Omit<PathRecordRow, "seq" | "at" | "sessionId" | "guardId">): PathRecordRow;
  count(): number;
}

/** The epoch-relative file `openPathRecord` appends to, read back by the outcome tools. */
export const PATH_RECORD_FILE = "builder-path-record.jsonl";

function pathRecordRow(value: JsonValue): PathRecordRow | null {
  const row = plainRecord(value);
  if (row === null) return null;
  if (REQUIRED_STRINGS.some((key) => !isString(row[key]))) return null;
  if (row.mode !== "read" && row.mode !== "write" && row.mode !== "exec") return null;
  if (row.decision !== "allow" && row.decision !== "deny") return null;
  if (
    row.enforcement !== "guard-denied" &&
    row.enforcement !== "os-refused" &&
    row.enforcement !== "os-allowed"
  ) {
    return null;
  }
  if (
    !Number.isInteger(row.seq) ||
    /* SAFETY: reached only when `!Number.isInteger(row.seq)` does not hold. */ (row.seq as number) < 1
  ) {
    return null;
  }
  if (row.profileDigest !== null && !isString(row.profileDigest)) return null;
  if (row.resolved !== null && !isString(row.resolved)) return null;
  if (
    row.bytes !== null &&
    (!Number.isInteger(row.bytes) ||
      /* SAFETY: reached only when `row.bytes !== null`. */ (row.bytes as number) < 0)
  ) {
    return null;
  }
  return /* SAFETY: `row` is `value` itself, so the field checks above are the evidence for narrowing the parsed line once. */ row as PathRecordRow;
}

/** Parse the append-only JSONL stream and refuse malformed or non-increasing evidence. A row that
 *  fails its field checks, or whose sequence number does not advance, says the file was rewritten
 *  or written by two hands at once, and a fold over it would report a reading of something that is
 *  no longer the record. Refusing with the line number keeps the damage locatable; dropping the bad
 *  line would leave a shorter stream that still looks whole. */
export function readPathRecordRows(path: string): PathRecordRow[] {
  let prior = 0;
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line, index) => {
      let row: PathRecordRow | null = null;
      try {
        row = pathRecordRow(capturedJsonParse(line));
      } catch {
        // a malformed row leaves `row` null, which the check below reports with its line
      }
      if (row === null || row.seq <= prior) {
        throw new Error(`${path}:${index + 1}: malformed path record row`);
      }
      prior = row.seq;
      return row;
    });
}

/** Opens the stream for one session of a composition that may have had several. The sequence
 *  resumes from the file's last row, so numbers stay unique across the whole record, while
 *  `count()` reports this session's own appends: a session that opened the record and was refused
 *  its first capability has appended nothing, and that is what the isolation tests assert on. */
export function openPathRecord(epochDir: string, sessionId: string): PathRecord {
  const path = join(epochDir, PATH_RECORD_FILE);
  const existing = existsSync(path) ? readPathRecordRows(path) : [];
  let seq = existing.at(-1)?.seq ?? 0;
  let appended = 0;
  return {
    path,
    sessionId,
    append(partial) {
      const row: PathRecordRow = {
        seq: ++seq,
        at: new Date().toISOString(),
        sessionId,
        guardId: CANDIDATE_ISOLATION_GUARD_ID,
        ...partial,
      };
      appendFileSync(path, `${capturedJsonStringify(row)}\n`);
      appended += 1;
      return row;
    },
    count: () => appended,
  };
}
