/**
 * The per-case half of the transcript pointer problem, written when the case is recorded.
 *
 * `solveCase` writes `cases/<taskId>/trace.json` as soon as the case ends, including on a typed
 * non-result (pi-built.ts hands `recorder.trace()` to both outcome shapes). Nothing pointed at it
 * until `appendRecordedCaseRows` (run-driver.ts) created the record row, and that runs only when the
 * whole battery is recorded. A battery killed mid-run therefore left intact traces on disk that the one
 * verified read (`readVerifiedTrace`) could not reach, because it reads through pointers and there
 * were none — the same shape as run 65's 326-record Builder transcript surviving with nothing in
 * the campaign naming it.
 *
 * The checks are the ones `src/builder/session-transcript.ts` copied from pi's session-verify and
 * that hold at any moment: present, readable, non-empty, and carrying the identity the reader will
 * gate on. For a session that identity is the sessionId from first record to last; for a single
 * trace document it is the schema version, since that is what `CASE_TRACE_SCHEMA` names.
 *
 * Unlike the Builder pointer this function does not write. The battery run dir has one write owner
 * (steering-delta P1) and every evidence goes through the manifest-bound `EvidenceLog`, so the
 * recording caller writes what this returns.
 */
import { readFileSync, statSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { CASE_TRACE_SCHEMA } from "../backends/trace-capture.ts";
import { sha256OfFile } from "../meta/digest.ts";
import { trustedJsonParse } from "./trusted-runtime.ts";
import { plainRecord } from "../meta/json-evidence.ts";
import { isString } from "../meta/json-shape.ts";

export const CASE_TRACE_POINTER_FILE = "trace-pointer.json";

type CaseTracePointer = {
  schema: "case-trace-pointer/v1";
  taskId: string;
  /** Run-dir-relative, the same convention the record row uses, so both resolve under one base. */
  path: string;
  /** Null when the trace is absent or unreadable — never a digest of bytes nobody could parse. */
  sha256: string | null;
  /** The trace's own schema when it parsed and was admissible, else null. */
  traceSchema: string | null;
  /** Empty when the four checks passed. A case that produced no trace states that here. */
  warnings: string[];
  recordedAt: string;
};

/** Present, readable, non-empty, and a schema this repository's readers admit. Returns the
 *  warnings and, when all four hold, the digest and schema the pointer will carry. */
interface VerifyWrittenCaseTraceResult {
  warnings: string[];
  sha256: string | null;
  traceSchema: string | null;
}

function verifyWrittenCaseTrace(absPath: string): VerifyWrittenCaseTraceResult {
  const absent = (warning: string) => ({ warnings: [warning], sha256: null, traceSchema: null });
  try {
    statSync(absPath);
  } catch (e) {
    return absent(
      `trace missing — path=${absPath} err=${/* SAFETY: `statSync` throws an Error; a value without a message renders as undefined in the warning rather than changing a verdict. */ (e as Error).message}`,
    );
  }
  let content: string;
  try {
    content = readFileSync(absPath, "utf8");
  } catch (e) {
    return absent(
      `trace unreadable — path=${absPath} err=${/* SAFETY: `readFileSync` throws an Error; a value without a message renders as undefined in the warning rather than changing a verdict. */ (e as Error).message}`,
    );
  }
  if (content.trim().length === 0) return absent(`trace empty — path=${absPath} bytes=${content.length}`);
  let parsed: unknown;
  try {
    parsed = trustedJsonParse(content);
  } catch (e) {
    return absent(
      `malformed trace JSON — path=${absPath} err=${/* SAFETY: `trustedJsonParse` throws a SyntaxError; a value without a message renders as undefined in the warning rather than changing a verdict. */ (e as Error).message}`,
    );
  }
  const record = plainRecord(parsed);
  const traceSchema = record !== null && isString(record.schema) ? record.schema : null;
  if (traceSchema !== CASE_TRACE_SCHEMA) {
    return absent(`trace schema not readable — path=${absPath} schema=${String(traceSchema)}`);
  }
  // Digested as bytes, the same way `tracePointer` does it, so a record row created later for the
  // same file agrees with this pointer instead of disagreeing over an encoding.
  return { warnings: [], sha256: sha256OfFile(absPath), traceSchema };
}

/**
 * Record one case's trace pointer against the run dir. A case with no trace still gets a pointer
 * carrying the warning: an absence that is stated outranks an absence a later reader has to infer
 * from a directory listing.
 */
export function recordCaseTracePointer(runDir: string, taskId: string): CaseTracePointer {
  const path = `cases/${taskId}/trace.json`;
  const checked = verifyWrittenCaseTrace(join(runDir, path));
  return {
    schema: "case-trace-pointer/v1",
    taskId,
    path,
    sha256: checked.sha256,
    traceSchema: checked.traceSchema,
    warnings: checked.warnings,
    recordedAt: new Date().toISOString(),
  };
}
