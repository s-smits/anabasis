/**
 * The case record stores one JSONL row per scheduled case across runs. A row is a structured
 * summary that points to its raw trace files by path and sha256; it does not repeat the traces.
 *
 * A lost row would go unnoticed, because every count derived from the file would lose it alike.
 * Three rules prevent that:
 *
 *  1. One writer. An in-process registry and an O_EXCL `<path>.lock` refuse a second writer for
 *     the same file, and a queue serialises appends.
 *  2. Strict parsing. `readCaseRecord` throws on a malformed or misshapen row instead of skipping it.
 *  3. Completeness against the task set. `assertCompleteRun` compares rows with the task ids the
 *     battery was built from, not with the file itself.
 *
 * `verifyTracePointers` recomputes each trace digest on read and reports a missing or changed
 * trace. Every row carries an `isolation` field; null means isolation is unproven.
 */
import { capturedJsonParse, capturedJsonStringify } from "../meta/json-runtime.ts";
import type { JsonValue } from "../meta/json-shape.ts";
import {
  constants,
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from "../meta/filesystem.ts";
import { isAbsolute, join, resolve } from "../meta/path.ts";
import { containsPath } from "../meta/path-containment.ts";
import type { SessionProfileEvidence } from "../backends/session-isolation.ts";
import type { IsolationProbeEvidence } from "../backends/isolation-evidence.ts";
import { sha256OfFile } from "../meta/digest.ts";
import { type NonResultKind, isNonResultKind } from "./record-events.ts";
import type { IsolationStrength } from "./readiness.ts";
import { isBoolean, isNumber, isRecord, isString } from "../meta/json-shape.ts";
import { runtimeProcess } from "../meta/process.ts";

/** The campaign-relative battery record every reader below opens. */
export const CASE_RECORD_FILE = "case-record.jsonl";
export const CASE_RECORD_SCHEMA = "case-record/v1";

export type CaseOutcome = "pass" | "fail" | "unaccepted" | "non-result";

export type CaseOutcomeFields = {
  acceptedSubmit: boolean;
  pass: boolean | null;
  runtimeNonResult: string | null;
};

/**
 * The five fields that say what a case's outcome is. Exactly one of three shapes holds:
 *  - verified: `acceptedSubmit` true, `truthOk` and `pass` booleans, no non-result;
 *  - unaccepted: `acceptedSubmit` false, `truthOk` null, `pass` false (no bytes reached the
 *    verifier, yet the attempt counts as a difficulty failure);
 *  - non-result: `truthOk` and `pass` null, with `runtimeNonResult` and its machine kind
 *    `runtimeNonResultKind` both set. Null booleans keep an environment failure from being counted
 *    as a product failure.
 */
export type CaseVerdict = CaseOutcomeFields & {
  truthOk: boolean | null;
  runtimeNonResultKind: NonResultKind | null;
};

/** A digest-bound pointer to raw evidence bytes as of the run. */
export type TracePointer = {
  /** Path relative to the record's base directory, resolved by the evidence reader. */
  path: string;
  sha256: string;
};

/** Recorded isolation for the case; a null field means it remains unproven. */
export type CaseIsolationEvidence = {
  strength: IsolationStrength;
  probe?: IsolationProbeEvidence;
  /** The session's activated-profile handshake; physical strength needs it beside the probe. */
  session?: SessionProfileEvidence;
};

/** The recorded run condition, repeated on every case row: its variant, the adviser tools removed
 *  before solving, and a sha256 of the offered tool names (null when no tools-spec was recorded). */
export type RunCondition = {
  variant: string;
  advisorsRemoved: string[];
  toolInterfaceHash: string | null;
};

export type CaseRecordRow = CaseVerdict & {
  schema: typeof CASE_RECORD_SCHEMA;
  /** Paired with `builderId`, so a runId cannot be mistaken for one a model typed. */
  runId: string;
  builderId: string;
  slug: string;
  buildInputsHash: string;
  backendPin: string;
  taskId: string;
  family: string;
  isolation: CaseIsolationEvidence | null;
  /** Null explicitly records that the battery supplied no run condition. */
  condition: RunCondition | null;
  /** Controller instants around the solver call. Telemetry only; scoring never reads them. */
  solverStartedAt?: string;
  solverEndedAt?: string;
  traces: TracePointer[];
};

/** A stored row: the row plus the writer-owned sequence number. */
export interface StoredCaseRow {
  seq: number;
  row: CaseRecordRow;
}

/** In-process second-writer refusal, keyed on the resolved path. */
const openWriters = new Set<string>();

type PointerVerdict =
  | { path: string; state: "intact" }
  | { path: string; state: "missing" }
  | { path: string; state: "drifted"; nowSha256: string };

/** Counts over classified outcomes; the one place the verified, unaccepted and non-result
 *  arithmetic is done. */
export interface OutcomeTally {
  verified: number;
  passed: number;
  failed: number;
  unaccepted: number;
  nonResults: number;
}

/** Classify a validated row. An unaccepted attempt is stored with pass=false but is not verified. */
export function classifyCaseOutcome(row: CaseOutcomeFields): CaseOutcome {
  if (row.runtimeNonResult !== null) return "non-result";
  if (!row.acceptedSubmit) return "unaccepted";
  return row.pass === true ? "pass" : "fail";
}

/** The verdict fields alone. */
export function caseVerdict(row: CaseVerdict): CaseVerdict {
  const { acceptedSubmit, truthOk, pass, runtimeNonResult, runtimeNonResultKind } = row;
  return { acceptedSubmit, truthOk, pass, runtimeNonResult, runtimeNonResultKind };
}

/** Validate the recorded condition name, removed advisers and optional tool-interface hash. */
function conditionDefect(c: JsonValue): string | null {
  if (
    !isRecord(c) ||
    !isString(c.variant) ||
    !Array.isArray(c.advisorsRemoved) ||
    !c.advisorsRemoved.every((name) => isString(name)) ||
    (c.toolInterfaceHash !== null && !isString(c.toolInterfaceHash))
  ) {
    return "stored condition must be {variant, advisorsRemoved: string[], toolInterfaceHash: string|null} or null; variant identifies the comparison variant";
  }
  return null;
}

/** Why a value is none of the three verdict shapes of {@link CaseVerdict}, or null. */
export function caseVerdictDefect(value: unknown): string | null {
  if (!isRecord(value)) return "verdict is not an object";
  const { acceptedSubmit, truthOk, pass, runtimeNonResult, runtimeNonResultKind } = value;
  if (!isBoolean(acceptedSubmit)) return "acceptedSubmit must be a boolean";
  if (isString(runtimeNonResult)) {
    if (!isString(runtimeNonResultKind)) {
      return "a non-result reason without its machine kind is half-shaped evidence";
    }
    if (!isNonResultKind(runtimeNonResultKind)) {
      return `unknown non-result kind "${runtimeNonResultKind}" — the vocabulary is closed (NON_RESULT_KINDS in record-events); an unowned kind would launder a defect into an excused non-result`;
    }
    if (truthOk !== null || pass !== null) return "a non-result row carries no verdict";
    return null;
  }
  if (runtimeNonResult !== null) return "runtimeNonResult must be a string or null";
  if (runtimeNonResultKind !== null) return "a machine kind without its reason is half-shaped evidence";
  if (acceptedSubmit) {
    if (!isBoolean(truthOk) || !isBoolean(pass)) {
      return "a verified row needs boolean truthOk and pass";
    }
    return null;
  }
  if (truthOk !== null) return "an unaccepted row has no truth verdict (truthOk must be null)";
  if (pass !== false) return "an unaccepted row stays in the denominator as a fail (pass must be false)";
  return null;
}

/** Why a value is not a valid case row, or null. */
export function caseRowDefect(value: JsonValue): string | null {
  if (!isRecord(value)) return "row is not an object";
  if (value.schema !== CASE_RECORD_SCHEMA) return `schema is not ${CASE_RECORD_SCHEMA}`;
  for (const key of ["runId", "builderId", "slug", "buildInputsHash", "backendPin", "taskId", "family"]) {
    if (!isString(value[key]) || value[key] === "") return `${key} must be a non-empty string`;
  }
  if (!("isolation" in value)) {
    return "the stored isolation field `isolation` is required: null records UNPROVEN; an absent field records nothing";
  }
  if (value.isolation !== null && !isRecord(value.isolation)) {
    return "the stored isolation field `isolation` must be a evidence object or null";
  }
  if (!("condition" in value)) {
    return "condition is required: null records an undenominated run, absence records nothing";
  }
  if (value.condition !== null) {
    const defect = conditionDefect(value.condition);
    if (defect !== null) return defect;
  }
  for (const key of ["solverStartedAt", "solverEndedAt"]) {
    if (key in value && !isString(value[key])) return `${key} must be a string instant when present`;
  }
  if (!Array.isArray(value.traces)) return "traces must be an array of digest-bound pointers";
  for (const pointer of value.traces) {
    if (!isRecord(pointer) || !isString(pointer.path) || !isString(pointer.sha256)) {
      return "every trace pointer needs path and sha256";
    }
  }
  return caseVerdictDefect(value);
}

/** `caseRowDefect` as a type guard. */
function isCaseRecordRow(value: JsonValue): value is CaseRecordRow {
  return caseRowDefect(value) === null;
}

/** Strict line-set parse shared by the reader and the writer's own open. Throws, never skips. */
function parseRecordText(text: string, path: string): StoredCaseRow[] {
  const rows: StoredCaseRow[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined || line === "") continue;
    let parsed: unknown;
    try {
      parsed = capturedJsonParse(line);
    } catch {
      throw new Error(
        `${path}:${i + 1}: malformed record line — a torn row is a defect, not an absence (B-1)`,
      );
    }
    if (!isRecord(parsed) || !isNumber(parsed.seq) || !("row" in parsed)) {
      throw new Error(`${path}:${i + 1}: not a stored case row`);
    }
    if (!isCaseRecordRow(parsed.row)) {
      throw new Error(`${path}:${i + 1}: ${caseRowDefect(parsed.row) ?? "row is not a case row"}`);
    }
    if (parsed.seq !== rows.length + 1) {
      throw new Error(
        `${path}:${i + 1}: seq ${parsed.seq} breaks the append order (expected ${rows.length + 1})`,
      );
    }
    rows.push({ seq: parsed.seq, row: parsed.row });
  }
  return rows;
}

/** Strict read: any malformed, misshapen, or out-of-order line throws. */
export function readCaseRecord(path: string): StoredCaseRow[] {
  if (!existsSync(path)) return [];
  return parseRecordText(readFileSync(path, "utf8"), path);
}

export class CaseRecord {
  private queue: Promise<unknown> = Promise.resolve();
  private count: number;
  private closed = false;

  private constructor(
    readonly path: string,
    private readonly lockPath: string,
    existingRows: number,
  ) {
    this.count = existingRows;
  }

  /**
   * Open the sole writer for a record file, refusing a second one in this or another process.
   * Existing rows are validated first, so a damaged record is repaired before anything is appended.
   */
  static open(path: string): CaseRecord {
    const key = resolve(path);
    if (openWriters.has(key)) {
      throw new Error(
        `${path}: a CaseRecord writer is already open in this process — the record has ONE writer`,
      );
    }
    const existing = readCaseRecord(path);
    const lockPath = `${key}.lock`;
    let fd: number;
    try {
      fd = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o644);
    } catch {
      throw new Error(
        `${path}: another writer holds ${lockPath} — the record has ONE writer (a stale lock after a crash must be removed by the operator, not silently stolen)`,
      );
    }
    try {
      writeSync(fd, `${runtimeProcess.pid}\n`);
    } finally {
      closeSync(fd);
    }
    openWriters.add(key);
    return new CaseRecord(key, lockPath, existing.length);
  }

  /** Serialise appends: validate the row, assign the next sequence and write one intact line. */
  append(row: CaseRecordRow): Promise<number> {
    const result = this.queue.then(() => {
      if (this.closed) throw new Error(`${this.path}: appended after close`);
      const defect = caseRowDefect(row);
      if (defect !== null) throw new Error(`${this.path}: refused row for ${row?.taskId} — ${defect}`);
      const seq = this.count + 1;
      const line = `${capturedJsonStringify({ seq, row })}\n`;
      const fd = openSync(
        this.path,
        constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW,
        0o644,
      );
      try {
        writeSync(fd, line);
      } finally {
        closeSync(fd);
      }
      this.count = seq;
      return seq;
    });
    // The chain survives a refused row: later appends still run, the caller still sees the throw.
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Releases the lock. The file stays; the writer identity ends here. */
  async close(): Promise<void> {
    await this.queue;
    if (this.closed) return;
    this.closed = true;
    openWriters.delete(this.path);
    try {
      unlinkSync(this.lockPath);
    } catch {
      // an already-removed lock changes nothing about the rows on disk
    }
  }
}

/**
 * Require exactly one row per task the battery was built from and no other task ids. The error
 * lists every missing, duplicated and foreign id.
 */
export function assertCompleteRun(
  rows: readonly StoredCaseRow[],
  runId: string,
  taskIds: readonly string[],
): void {
  const seen = new Map<string, number>();
  for (const { row } of rows) {
    if (row.runId !== runId) continue;
    seen.set(row.taskId, (seen.get(row.taskId) ?? 0) + 1);
  }
  const expected = new Set(taskIds);
  const missing = taskIds.filter((id) => !seen.has(id));
  const duplicated = seen
    .entries()
    .filter(([, n]) => n > 1)
    .map(([id]) => id)
    .toArray();
  const foreign = [...seen.keys()].filter((id) => !expected.has(id));
  if (missing.length > 0 || duplicated.length > 0 || foreign.length > 0) {
    throw new Error(
      `${runId}: case rows are not the task set — missing [${missing.join(", ")}], duplicated [${duplicated.join(", ")}], foreign [${foreign.join(", ")}]`,
    );
  }
}

/** A pointer carrying the digest of the file's current bytes. */
export function tracePointer(baseDir: string, relPath: string): TracePointer {
  return { path: relPath, sha256: sha256OfFile(join(baseDir, relPath)) };
}

/** The absolute path of a canonical relative pointer that stays under its evidence root after
 *  resolving symlinks, or null. */
export function tracePointerPath(baseDir: string, path: string): string | null {
  if (
    isAbsolute(path) ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    return null;
  }
  const abs = join(baseDir, path);
  try {
    return containsPath(realpathSync(abs), realpathSync(baseDir)) ? abs : null;
  } catch {
    return null;
  }
}

/** Recompute each pointer's digest and report it intact, drifted or missing. */
export function verifyTracePointers(row: { traces: TracePointer[] }, baseDir: string): PointerVerdict[] {
  return row.traces.map((pointer) => {
    const abs = tracePointerPath(baseDir, pointer.path);
    if (abs === null) return { path: pointer.path, state: "missing" };
    const now = sha256OfFile(abs);
    return now === pointer.sha256
      ? { path: pointer.path, state: "intact" }
      : { path: pointer.path, state: "drifted", nowSha256: now };
  });
}

export function outcomeTally(outcomes: readonly CaseOutcome[]): OutcomeTally {
  const count = (wanted: readonly CaseOutcome[]) =>
    outcomes.filter((outcome) => wanted.includes(outcome)).length;
  return {
    verified: count(["pass", "fail"]),
    passed: count(["pass"]),
    failed: count(["fail"]),
    unaccepted: count(["unaccepted"]),
    nonResults: count(["non-result"]),
  };
}

/** {@link outcomeTally} per family, with each family's total. */
export function familyTally(
  rows: Iterable<CaseOutcomeFields & { family: string }>,
): Map<string, OutcomeTally & { total: number }> {
  const byFamily = new Map<string, CaseOutcome[]>();
  for (const row of rows) {
    const outcomes = byFamily.get(row.family) ?? [];
    byFamily.set(row.family, outcomes);
    outcomes.push(classifyCaseOutcome(row));
  }
  return new Map(
    [...byFamily].map(([family, outcomes]) => [
      family,
      { total: outcomes.length, ...outcomeTally(outcomes) },
    ]),
  );
}
