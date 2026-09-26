/**
 * The case record stores one JSONL row per scheduled case across runs. A row is a structured
 * summary that points to its raw trace files by path and sha256; it does not repeat the traces,
 * and it does not decide who may read them — that belongs to the consuming reader and its own
 * access rules. The summaries point at the traces rather than replacing them because a summary does
 * not recover what the raw evidence carries: a reader given the scores and a per-case summary
 * arrives at much the same reading as one given the scores alone, while a reader that can open the
 * traces themselves does markedly better.
 *
 * A lost row is the failure this file is built around, and it is dangerous precisely because it
 * is quiet. Concurrent JSONL appends longer than PIPE_BUF can interleave and tear a line, and a
 * tolerant reader that skipped the wreckage would drop the same row from every count derived from
 * that file at once, so `n === verified` would still hold and the loss would never surface. Three
 * rules prevent it (B-1):
 *
 *  1. One writer. An in-process registry and an O_EXCL `<path>.lock` refuse a second writer for
 *     the same file, and a queue serialises appends.
 *  2. Strict parsing. `readCaseRecord` throws on a malformed or misshapen row and names the
 *     damaged line, so a reader cannot quietly omit it.
 *  3. Completeness against the task set. `assertCompleteRun` compares rows with the task ids the
 *     battery was built from, which is an independent count rather than the file checking itself.
 *
 * Trace pointers store the sha256 computed during the run, and `verifyTracePointers` recomputes it
 * on read, so a trace that is missing or no longer matches is reported as such instead of a later
 * file being accepted as the original evidence. Every row carries an `isolation` field, where null
 * means isolation is unproven: an absent probe cannot establish even the contractual
 * classification.
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
 * The five fields that say what a case's outcome is, and nothing about which case it was.
 *
 * Exactly one of three shapes holds. **Verified**: `acceptedSubmit` true, `truthOk` and `pass`
 * booleans, `runtimeNonResult` null. **Unaccepted**: `acceptedSubmit` false, `truthOk` null and
 * `pass` false, because a real attempt that submitted no accepted bytes left the verifier nothing
 * to judge, so no truth verdict exists, and the attempt still counts as a difficulty failure.
 * **Non-result**: `truthOk` and `pass` both null, with `runtimeNonResult` carrying the reason and
 * `runtimeNonResultKind` its machine classification, which is null exactly when `runtimeNonResult`
 * is.
 *
 * Interrupted is not failed, which is why the last shape nulls both booleans rather than writing
 * `false`: every consumer that read `pass` without remembering to also read `runtimeNonResult`
 * would otherwise count an environment failure as a product failure.
 *
 * `CaseRecord` in `src/correctness-bundle/battery-record.ts` and `CaseEvidence` in the iteration analysis
 * both extend this type rather than restating its fields, because each restatement is another chance
 * to get the nulls wrong, and the nulls are the whole of what the paragraph above defends.
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
  /** The verified session construction's activated-profile handshake. Physical strength requires
   *  this beside the mechanism probe, because a probe alone shows the wall exists and not that
   *  this session ran behind it; where it is absent, the absence is visible in the evidence. */
  session?: SessionProfileEvidence;
};

/** The recorded run condition: its `variant` value, the adviser tools removed before solving, and
 *  a sha256 of the offered tool names, which is the tools-spec names minus those removed advisers.
 *  The hash is null when no tools-spec was recorded. The evaluation runner writes this condition
 *  to battery.json and then repeats it unchanged on every case row, so a reader comparing two
 *  conditions can establish which capabilities differed without opening a second file. */
export type RunCondition = {
  variant: string;
  advisorsRemoved: string[];
  toolInterfaceHash: string | null;
};

export type CaseRecordRow = CaseVerdict & {
  schema: typeof CASE_RECORD_SCHEMA;
  /** Paired with `builderId` on every row, because a runId standing alone is indistinguishable
   *  from one a model typed into a trace. */
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
  /** Controller instants around the solver call, restated from the recorded battery case so a
   *  cross-run duration read needs no per-run battery.json open. The run driver writes both on
   *  every row; they stay optional because the case record is append-only and `bun run outcome`
   *  reads a campaign's whole history, rows written before these fields existed included. They are
   *  telemetry, and neither scoring nor classification consults them. */
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

/** One count over classified outcomes, so the verified, unaccepted and non-result arithmetic
 *  cannot drift between the run summary, the controller terminal and the outcome views. It is
 *  exported for the last of those three, whose campaign scorecard would otherwise restate all five
 *  fields itself. */
export interface OutcomeTally {
  verified: number;
  passed: number;
  failed: number;
  unaccepted: number;
  nonResults: number;
}

/** Classify a row the producer or the strict reader has already admitted. An unaccepted attempt is
 *  stored with `pass: false`, but it is not verified, because no accepted artifact ever reached
 *  the correctness model — the order of the tests below is what keeps those two apart. */
export function classifyCaseOutcome(row: CaseOutcomeFields): CaseOutcome {
  if (row.runtimeNonResult !== null) return "non-result";
  if (!row.acceptedSubmit) return "unaccepted";
  return row.pass === true ? "pass" : "fail";
}

/** The verdict fields alone, for a reader that publishes them beside identity or evidence of its
 *  own and must not carry the rest of the row along with them. */
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

/** Why a value is none of the three verdict shapes of {@link CaseVerdict}, or null when it is one
 *  of them. The three are verified (`acceptedSubmit` true with boolean `truthOk` and an equal `pass`),
 *  unaccepted (`acceptedSubmit` false, `truthOk` null, `pass` false, because an attempt that left
 *  no accepted bytes has no truth verdict and still stays in the denominator) and non-result
 *  (`truthOk` and `pass` null, with both a reason string and a recognised kind — either one
 *  without the other is refused here, exactly as the run-events producer refuses it). */
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
    // The producer writes pass as acceptedSubmit && truthOk, so a verified row whose two disagree
    // was not written by it, and the tallies that read pass would count a verdict truthOk denies.
    if (pass !== truthOk) {
      return "a verified row passes exactly when truthOk is true (pass must equal truthOk)";
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

/** `caseRowDefect` used as a type guard: it supplies the reason a reader puts in its error
 *  message, and this wrapper narrows the value once validation succeeded. Both run the same
 *  implementation, so the narrowing cannot admit a row the validator would refuse. */
function isCaseRecordRow(value: JsonValue): value is CaseRecordRow {
  return caseRowDefect(value) === null;
}

/** The strict line-set parse, shared by the reader and by the writer's own open so both hold the
 *  file to one standard. It throws and never skips, because skipping is what makes a torn row
 *  invisible to every count at once. */
/** The bytes after the last newline. The writer appends each row as one line ending in a newline,
 *  so a non-empty remainder is a row whose append has not finished: a reader racing the writer sees
 *  it, and so does anyone reading after a crash mid-append. */
function unterminatedTail(text: string): string {
  return text.slice(text.lastIndexOf("\n") + 1);
}

/** Parses every newline-terminated line. An unterminated last line is not yet written and is left
 *  for the next read; a damaged terminated line anywhere is still a defect and throws. */
function parseRecordText(text: string, path: string): StoredCaseRow[] {
  const rows: StoredCaseRow[] = [];
  const lines = text.slice(0, text.length - unterminatedTail(text).length).split("\n");
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

/** Strict read: any malformed, misshapen, or out-of-order terminated line throws. A last line the
 *  writer has not finished is not a row yet, so a reader polling a live battery sees the rows
 *  written so far rather than a refusal of the whole record. */
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
   * Open the sole writer for a record file. The in-process registry refuses a second writer here,
   * and the O_EXCL lock file refuses one from another process, which together are the first of the
   * three rules at the top of this file. Existing rows are validated before the lock is taken, so
   * a record that is already damaged has to be repaired before any further row is appended to it
   * — appending onto a torn file would bury the damage under evidence that looks intact.
   */
  static open(path: string): CaseRecord {
    const key = resolve(path);
    if (openWriters.has(key)) {
      throw new Error(
        `${path}: a CaseRecord writer is already open in this process — the record has ONE writer`,
      );
    }
    const existing = readCaseRecord(path);
    // No writer holds the file yet, so an unfinished last line is an append a crash cut short, and
    // appending after it would join the next row onto the fragment as one damaged middle line.
    if (existsSync(path) && unterminatedTail(readFileSync(path, "utf8")) !== "") {
      throw new Error(
        `${path}: the last line is unterminated — an interrupted append must be repaired (B-1)`,
      );
    }
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
 * The completeness rule of B-1: a run needs exactly one row for each task its battery was built
 * from, and no other task ids. The comparison is against the original task set rather than against
 * anything the record file says about itself, which is what makes it an independent count and not
 * a file confirming its own contents. The error lists every missing, duplicated and foreign id at
 * once, so one read settles what went wrong.
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

/** Builds a digest-bound pointer at write time, computing the sha256 from the bytes here rather
 *  than accepting one a caller supplies, since a caller-supplied digest would prove only that the
 *  caller and the pointer agree. */
export function tracePointer(baseDir: string, relPath: string): TracePointer {
  return { path: relPath, sha256: sha256OfFile(join(baseDir, relPath)) };
}

/** The absolute path of a pointer that is a canonical relative path and still lies under its
 *  evidence root once symlinks are resolved, or null when it is neither. Resolving before the
 *  containment test is the point: a link inside the root can name bytes outside it, and this is
 *  also the existence probe that runs before any trace bytes are read. */
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

/** Recompute each pointer's digest and report the trace intact, drifted or missing, so a caller
 *  can refuse to rely on evidence that no longer matches the run rather than reading it as the
 *  original. It accepts any object carrying trace pointers, a full row or one case's evidence
 *  record alike. */
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

/** {@link outcomeTally} per family, with each family's total. Two readers kept a copy each — the
 *  outcome metrics and the rebuild advice packet — and the advice copy spelled `passed` as
 *  `truthOk === true` inside its own verified branch. That is the same set today, because a case
 *  row carries `pass: acceptedSubmit && truthOk`, but it is the kind of restatement that stops
 *  being the same set the day one of the two is corrected. Each caller projects the fields it
 *  already publishes, and neither gains `failed` from sharing this. */
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
