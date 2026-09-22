/**
 * The case record stores one JSONL row per scheduled case across runs (§4 rank-1). Rows give
 * triage and the issue register structured summaries, with paths and content digests pointing
 * to the detailed trace files. They do not repeat the traces or determine who may read them;
 * the consuming reader and its access restrictions control that. The Meta-Harness comparison
 * motivated retaining raw evidence: scores alone reached 34.6, scores plus summaries 34.9,
 * and filesystem access to raw traces 50.0. Summaries did not recover the missing information.
 *
 * B-1 protects against incomplete records. Concurrent JSONL appends beyond PIPE_BUF can
 * interleave. If a tolerant reader skips the malformed line, both counts derived from that
 * file lose the same row: `n === verified` still holds and the loss goes undetected. Therefore:
 *
 *  1. Allow one writer. An in-process registry and an on-disk `<path>.lock` opened with
 *     O_EXCL refuse a second CaseRecord for the same file; an instance queue serialises appends.
 *  2. Parse strictly. `readCaseRecord` throws on malformed JSON or an invalid row shape,
 *     reporting the damaged row so the reader cannot silently omit it.
 *  3. Count expected cases from the task set. `assertCompleteRun` compares rows with the task
 *     ids used to build the battery, independently of the record file being checked.
 *
 * Trace pointers store the sha256 computed during the run (SLSA resolvedDependencies[].digest).
 * `verifyTracePointers` calculates it again when reading. A missing or changed trace is
 * reported as such, preventing a later file from being accepted as the original evidence.
 *
 * Every row must include the isolation field (§7.1). `isolation: null` means isolation remains
 * unproven; an absent probe cannot establish even the contractual isolation classification.
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
 * The five fields that say what a case is, and nothing about which case it was.
 *
 * Exactly one of three shapes holds. **Verified**: `acceptedSubmit` true, `truthOk` and `pass`
 * booleans, `runtimeNonResult` null. **Unaccepted**: `acceptedSubmit` false, `truthOk` null and
 * `pass` false — a real attempt with no accepted submission left no captured bytes, so no truth
 * verdict exists, and it counts as a difficulty failure. **Non-result**: `truthOk` and `pass`
 * null, `runtimeNonResult` a string and `runtimeNonResultKind` its machine classification, which
 * is null exactly when `runtimeNonResult` is. Interrupted is not failed: writing `false` for both
 * booleans in the last shape would make every consumer that forgot to also read
 * `runtimeNonResult` count an environment failure as a product failure.
 *
 * Four spellings carried this contract — `CaseRecordRow` below, `CaseRecord` in
 * `src/truth/battery-record.ts`, `CaseEvidence` in the iteration analysis, and the projection the
 * outcome query wrote out. A fourth spelling is a fourth chance to get the nulls wrong, which is
 * the whole of what the paragraph above is defending.
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
  /** The verified session construction's activated-profile handshake (U0.7) — physical strength
   *  requires this check beside the mechanism probe; its absence is visible in the evidence. */
  session?: SessionProfileEvidence;
};

/** The recorded run condition (U0.4): its `variant` value, the adviser tools removed before
 *  solving, and a sha256 of the offered tool names (tools-spec names minus removed advisers).
 *  The hash is null for trees from before tools-spec persistence. The evaluation runner writes
 *  this condition to battery.json and repeats it unchanged on every case row, so readers can
 *  establish which capabilities differed between compared conditions. */
export type RunCondition = {
  variant: string;
  advisorsRemoved: string[];
  toolInterfaceHash: string | null;
};

export type CaseRecordRow = CaseVerdict & {
  schema: typeof CASE_RECORD_SCHEMA;
  /** SLSA pairing: a runId with no builder identity is indistinguishable from one a model typed. */
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
  /** Controller instants around the solver call, restated from the recorded battery case so
   *  cross-run duration reads need no per-run battery.json open. The run driver writes both on
   *  every row; they stay optional because the case record is append-only and `bun run outcome`
   *  reads a campaign's whole history, rows from before 2026-08-23 included. Telemetry only —
   *  never consulted by scoring or classification. */
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

/** One count over classified outcomes, so the verified/unaccepted/non-result arithmetic cannot
 *  drift between the run summary, the controller terminal and the outcome views. Exported for the
 *  last of those three: the campaign scorecard restated all five fields, which is the drift the
 *  sentence above was written to prevent. */
export interface OutcomeTally {
  verified: number;
  passed: number;
  failed: number;
  unaccepted: number;
  nonResults: number;
}

/** Classify a row admitted by the producer or strict reader. Unaccepted attempts are stored
 *  with pass=false, but are not verified because no accepted artifact reached the correctness model. */
export function classifyCaseOutcome(row: CaseOutcomeFields): CaseOutcome {
  if (row.runtimeNonResult !== null) return "non-result";
  if (!row.acceptedSubmit) return "unaccepted";
  return row.pass === true ? "pass" : "fail";
}

/** The verdict alone, for a reader that publishes it beside identity or evidence of its own. */
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

/** The three allowed verdict shapes: a typed non-result with no verdict, a verified row
 *  with both booleans, or an unaccepted row stored with pass=false and no truth verdict. */
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

/**
 * Validate the row and require exactly one of these outcome shapes:
 *  verified    — acceptedSubmit true, truthOk/pass booleans, no non-result;
 *  unaccepted  — acceptedSubmit false, truthOk null, pass false (a real attempt with no
 *                accepted bytes has no truth verdict and is stored with pass=false);
 *  non-result  — truthOk/pass null, with both a reason string and a recognised kind
 *                (either one without the other is refused, as in the run-events producer).
 */
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

/** Use the row validator as a type guard. `caseRowDefect` supplies a reason for the reader's
 *  error message; this wrapper narrows the value after successful validation. Both use the
 *  same implementation so a type assertion cannot admit a row the validator would refuse. */
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
   * Open the sole writer for a record file. The registry refuses a second writer in this
   * process; an O_EXCL lock file prevents another process from opening one. Validate existing
   * rows before opening, so a damaged record must be repaired before more rows are appended.
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
 * B-1 completeness rule: a run needs exactly one row for each task used to build its battery,
 * with no extra task ids. Compare against the original task set, independently of the record
 * file being checked. Report every missing, duplicate and unexpected task id in the error.
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

/** Builds a digest-bound pointer at write time — the digest is computed from the bytes, here. */
export function tracePointer(baseDir: string, relPath: string): TracePointer {
  return { path: relPath, sha256: sha256OfFile(join(baseDir, relPath)) };
}

/** A pointer is a canonical relative path under its evidence root, including after symlinks.
 * This also guards root discovery's existence probe before any trace bytes are read. */
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

/** Recalculate each pointer's digest and report intact, changed or missing evidence. Callers
 *  can then refuse to rely on traces that no longer match the run. Accepts any object carrying
 *  trace pointers, including a full row or an individual case's evidence record. */
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

/** The same count, family by family. Two readers kept a copy each — the outcome metrics and the
 *  rebuild advice packet — and the advice copy spelled `passed` as `truthOk === true` inside its
 *  own verified branch. That is the same set today, because a case row carries
 *  `pass: acceptedSubmit && truthOk`, but it is the kind of restatement that stops being the same
 *  set the day one of the two is corrected. Each caller projects the fields it already published:
 *  the advice packet's row is a condition identity, and neither reader gains `failed` here. */
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
