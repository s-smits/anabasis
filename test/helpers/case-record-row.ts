/** Build a shared CaseRecordRow; supplied values replace the defaults. */
import { writeFileSync } from "../../src/meta/filesystem.ts";
import { CASE_RECORD_SCHEMA, type CaseRecordRow, readCaseRecord } from "../../src/claim/case-record.ts";

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
