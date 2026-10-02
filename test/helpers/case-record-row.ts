/** Build a shared CaseRecordRow; supplied values replace the defaults. */
import { writeFileSync } from "../../src/meta/filesystem.ts";
import { join } from "../../src/meta/path.ts";
import { CASE_RECORD_SCHEMA, type CaseRecordRow, readCaseRecord } from "../../src/claim/case-record.ts";

/** Write `dir`'s case record as the writer does: one `{seq, row}` line per row, seq from 1. */
export function writeCaseRecord(dir: string, rows: readonly CaseRecordRow[]): void {
  const lines = rows.map((row, index) => `${JSON.stringify({ seq: index + 1, row })}\n`);
  writeFileSync(join(dir, "case-record.jsonl"), lines.join(""));
}

/** Rewrite a case record without one run's rows. The product never removes rows; this forges
 *  the state a runner leaves when it dies before publishing, for reader tests. */
export function dropRunRows(recordPath: string, runId: string): void {
  const kept = readCaseRecord(recordPath).filter((entry) => entry.row.runId !== runId);
  writeFileSync(recordPath, kept.map((entry) => `${JSON.stringify(entry)}\n`).join(""));
}

export function caseRecordRow(
  taskId: string,
  family: string,
  overrides: Partial<Omit<CaseRecordRow, "schema" | "taskId" | "family">> = {},
): CaseRecordRow {
  return {
    schema: CASE_RECORD_SCHEMA,
    runId: "run-07",
    builderId: "builder-1",
    slug: "fixture",
    buildInputsHash: "hash-1",
    backendPin: "claude/claude-opus-5",
    taskId,
    family,
    acceptedSubmit: true,
    truthOk: true,
    pass: true,
    runtimeNonResult: null,
    runtimeNonResultKind: null,
    isolation: null,
    condition: { variant: "repair-off", advisorsRemoved: [], toolInterfaceHash: null },
    traces: [],
    ...overrides,
  };
}
