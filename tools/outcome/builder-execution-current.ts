/**
 * Validate the format of current Builder execution evidence.
 *
 * The facts reader derives cross-session findings. Keeping the record checks here keeps those
 * jobs separate: this module checks whether untyped data carries the required fields and satisfies
 * the checked relationships between them.
 */
import {
  BUILDER_EXECUTION_SCHEMA,
  type BuilderExecutionEvidence,
  HANDOVER_FILES,
  type BuilderSubmitAttempt,
} from "../../src/author/builder-execution.ts";
import { parseExperimentSubmission } from "../../src/author/experiment-plan.ts";
import {
  CUSTOM_TOOL_NAMES,
  bareCustomToolName,
  declaredSemanticOutcome,
} from "../../src/author/builder-custom-tool-call.ts";
import { plainRecord } from "../../src/meta/json-evidence.ts";
import { isBoolean, isNumber, isString } from "../../src/meta/json-shape.ts";
import {
  isNonNegativeInteger,
  optionalBoolean,
  optionalCount,
  optionalNumber,
  optionalPositive,
  optionalString,
  isPositiveInteger,
} from "./optional-field.ts";

const BACKEND_IDS = new Set(["codex", "claude", "openrouter"]);

type EvidenceRecord = NonNullable<ReturnType<typeof plainRecord>>;
type CountEntry = readonly [name: string, count: number];

const CURRENT_EXECUTION_OUTCOMES = new Set([
  "recorded",
  "turn-bound",
  "terminal-refusal",
  "no-progress",
  "budget-limited",
  "turn-non-result",
  "evidence-unavailable",
  "in-flight",
  "recorded-at-terminal",
]);

function currentExperimentProposal(value: unknown): boolean {
  return value === undefined || parseExperimentSubmission(value) !== null;
}

function validBackend(value: unknown): boolean {
  return value === null || (isString(value) && BACKEND_IDS.has(value));
}

function nullableNumber(value: unknown): boolean {
  return value === null || (isNumber(value) && Number.isFinite(value));
}

function currentCustomTarget(value: unknown): boolean {
  const target = plainRecord(value);
  return (
    target !== null &&
    optionalString(target.taskId) &&
    optionalString(target.taskIdDigest) &&
    optionalString(target.runId) &&
    optionalString(target.runIdDigest) &&
    optionalString(target.family) &&
    optionalString(target.familyDigest) &&
    optionalString(target.contextId) &&
    optionalNumber(target.feedbackGroup) &&
    optionalString(target.feedbackField) &&
    optionalNumber(target.callCount) &&
    (target.toolNames === undefined || (Array.isArray(target.toolNames) && target.toolNames.every(isString)))
  );
}

function currentCustomSemantic(value: unknown): boolean {
  const semantic = plainRecord(value);
  return (
    semantic !== null &&
    declaredSemanticOutcome(semantic.outcome) !== null &&
    optionalString(semantic.stage) &&
    optionalString(semantic.reason) &&
    optionalString(semantic.resultDigest) &&
    optionalString(semantic.subjectDigest) &&
    optionalString(semantic.candidateId) &&
    optionalString(semantic.artifactDigest) &&
    optionalPositive(semantic.workshopSequence) &&
    optionalCount(semantic.findings) &&
    optionalCount(semantic.turns) &&
    optionalString(semantic.truthVerdict) &&
    optionalCount(semantic.callsCompleted) &&
    optionalCount(semantic.callsAttempted) &&
    optionalCount(semantic.callsFailed) &&
    optionalBoolean(semantic.repeated) &&
    optionalBoolean(semantic.submitted) &&
    (semantic.findingCodes === undefined ||
      (Array.isArray(semantic.findingCodes) && semantic.findingCodes.every(isString)))
  );
}

function currentCustomCall(value: unknown): boolean {
  const call = plainRecord(value);
  return (
    call !== null &&
    isPositiveInteger(call.sequence) &&
    isPositiveInteger(call.turn) &&
    isString(call.tool) &&
    call.tool.length > 0 &&
    isString(call.action) &&
    call.action.length > 0 &&
    currentCustomTarget(call.target) &&
    nullableNumber(call.startedAtMs) &&
    nullableNumber(call.durationMs) &&
    (call.dispatchOutcome === "returned" ||
      call.dispatchOutcome === "threw" ||
      call.dispatchOutcome === "in-flight") &&
    (call.semantic === undefined || currentCustomSemantic(call.semantic))
  );
}

function countMapEntries(value: unknown): CountEntry[] | null {
  const record = plainRecord(value);
  if (record === null) return null;
  const entries: CountEntry[] = [];
  for (const [name, count] of Object.entries(record)) {
    if (!isNonNegativeInteger(count)) return null;
    entries.push([name, count]);
  }
  return entries;
}

/** Validate the exact tally the writer derives from one per-name map. A failed call must also exist
 * in the all-call map; otherwise a shape-valid aggregate can contradict the rows reports consume. */
function consistentCallCounts(
  total: unknown,
  failed: unknown,
  byNameValue: unknown,
  failedByNameValue: unknown,
): CountEntry[] | null {
  if (!isNonNegativeInteger(total) || !isNonNegativeInteger(failed)) return null;
  const byName = countMapEntries(byNameValue);
  const failedByName = countMapEntries(failedByNameValue);
  if (byName === null || failedByName === null) return null;
  if (byName.reduce((sum, [, count]) => sum + count, 0) !== total) return null;
  if (failedByName.reduce((sum, [, count]) => sum + count, 0) !== failed) return null;
  const calls = new Map(byName);
  if (failedByName.some(([name, count]) => count > (calls.get(name) ?? 0))) return null;
  return byName;
}

/** Absent on every record written before the running tally existed; null when no turn was open. */
function currentPartialTurn(value: unknown): boolean {
  if (value === null) return true;
  const partial = plainRecord(value);
  const calls = plainRecord(partial?.toolCalls);
  return (
    partial !== null &&
    isPositiveInteger(partial.turn) &&
    calls !== null &&
    consistentCallCounts(calls.total, calls.failed, calls.byName, calls.failedByName) !== null
  );
}

/** One failure row. Both excerpts are nullable: a transport that carried no arguments or no result
 * text says so rather than recording an empty string. */
function currentFailedCall(value: unknown): boolean {
  const row = plainRecord(value);
  return (
    row !== null &&
    isPositiveInteger(row.ordinal) &&
    isPositiveInteger(row.turn) &&
    isString(row.tool) &&
    row.tool.length > 0 &&
    isString(row.at) &&
    row.at.length > 0 &&
    isNonNegativeInteger(row.atMs) &&
    (row.request === null || isString(row.request)) &&
    (row.error === null || isString(row.error))
  );
}

/** The rows and their omitted counter arrive together or not at all. */
function currentFailedCalls(rows: unknown, omitted: unknown): boolean {
  return Array.isArray(rows) && rows.every(currentFailedCall) && isNonNegativeInteger(omitted);
}

function currentTurnRetry(value: unknown): boolean {
  const row = plainRecord(value);
  return (
    row !== null &&
    isString(row.role) &&
    (row.turn === null || isPositiveInteger(row.turn)) &&
    isPositiveInteger(row.attempt) &&
    isPositiveInteger(row.of) &&
    (row.status === "failed" || row.status === "aborted") &&
    isString(row.reason) &&
    isNonNegativeInteger(row.waitMs)
  );
}

function currentAuthoringReview(value: unknown): boolean {
  const row = plainRecord(value);
  return (
    row !== null &&
    isPositiveInteger(row.turn) &&
    isString(row.tool) &&
    (row.adviceChars === null || isNonNegativeInteger(row.adviceChars))
  );
}

function currentLifecycle(value: unknown, outcome: "evidence-unavailable" | null): boolean {
  if (outcome !== "evidence-unavailable") return value === undefined;
  const lifecycle = plainRecord(value);
  return lifecycle?.kind === "evidence-unavailable" && lifecycle.phase === "session-dispose";
}

/** One recorded controller invocation: its run id and the time its closing record was written. */
function currentInvocation(value: unknown): boolean {
  const row = plainRecord(value);
  const closedAt = row?.closedAt;
  return (
    row !== null &&
    isString(row.runId) &&
    row.runId.length > 0 &&
    isString(closedAt) &&
    closedAt.length > 0 &&
    Number.isFinite(Date.parse(closedAt))
  );
}

function findingDelta(value: unknown): boolean {
  if (value === null) return true;
  const record = plainRecord(value);
  return (
    record !== null &&
    isNonNegativeInteger(record.carried) &&
    isNonNegativeInteger(record.resolved) &&
    isNonNegativeInteger(record.introduced)
  );
}

function currentSubmitIdentity(row: EvidenceRecord): boolean {
  return (
    (row.kind === "candidate" || row.kind === "controller-terminal") &&
    isPositiveInteger(row.ordinal) &&
    isPositiveInteger(row.turn) &&
    isNonNegativeInteger(row.atMs) &&
    (row.outcome === "accepted" || row.outcome === "refused") &&
    (row.stage === null ||
      row.stage === "bundle" ||
      row.stage === "validation" ||
      row.stage === "conformance" ||
      row.stage === "gates") &&
    isString(row.commit) &&
    row.commit.length > 0 &&
    isBoolean(row.terminal) &&
    currentExperimentProposal(row.experimentProposal)
  );
}

function currentSubmitFindings(row: EvidenceRecord, findingCodes: readonly unknown[]): boolean {
  return (
    (row.findingsDigest === null || isString(row.findingsDigest)) &&
    findingCodes.every(isString) &&
    (row.repeatedFindings === null || isBoolean(row.repeatedFindings)) &&
    findingDelta(row.findingsDelta)
  );
}

function currentSubmitWorkspace(row: EvidenceRecord): boolean {
  return (
    (row.workspaceChanged === null || isBoolean(row.workspaceChanged)) &&
    // Absent on records written before 2026-09-20, where the reader falls back to the commit.
    (row.treeId === undefined || (isString(row.treeId) && row.treeId.length > 0)) &&
    (row.treeFirstSubmittedAsAttempt === null || isPositiveInteger(row.treeFirstSubmittedAsAttempt))
  );
}

function currentControllerTerminal(row: EvidenceRecord, findingCodes: readonly unknown[]): boolean {
  return (
    row.outcome === "refused" &&
    row.stage === "gates" &&
    row.terminal === true &&
    row.commit === "budget-limited" &&
    isString(row.findingsDigest) &&
    row.findingsDigest.length > 0 &&
    findingCodes.length > 0 &&
    row.findingsDelta === null &&
    row.repeatedFindings === null &&
    row.workspaceChanged === null &&
    // A controller stop inspected no candidate tree, so it carries no identity for one.
    row.treeId === undefined &&
    row.treeFirstSubmittedAsAttempt === null
  );
}

function currentCandidateSubmit(row: EvidenceRecord, candidateNumber: number): boolean {
  // These fields compare this candidate with the preceding candidate. Only the first candidate
  // has no predecessor and may carry nulls.
  if (
    candidateNumber > 1 &&
    (row.repeatedFindings === null || row.findingsDelta === null || row.workspaceChanged === null)
  ) {
    return false;
  }
  if (row.commit === "budget-limited") return false;
  // An accepted row carries the gate advisories the acceptance recorded, so its codes may be
  // non-empty. The null digest is what separates it from a refusal: the writer computes a digest
  // for refusals only.
  return row.outcome === "accepted"
    ? row.stage === null && row.findingsDigest === null
    : row.stage !== null && row.findingsDigest !== null;
}

function currentSubmitRow(value: unknown, candidateNumber: number): boolean {
  const row = plainRecord(value);
  if (row === null) return false;
  const { findingCodes } = row;
  if (!Array.isArray(findingCodes)) return false;
  if (
    !currentSubmitIdentity(row) ||
    !currentSubmitFindings(row, findingCodes) ||
    !currentSubmitWorkspace(row)
  ) {
    return false;
  }
  if (row.kind === "controller-terminal") {
    // This is the one controller-created row, emitted before a candidate is recorded or inspected
    // when the saved model-call budget is already spent. Its exact closure shape stays distinct
    // from a candidate refusal.
    return currentControllerTerminal(row, findingCodes);
  }
  // A controller-terminal row does not advance the candidate sequence, so a candidate after one
  // is still the first comparable candidate.
  return currentCandidateSubmit(row, candidateNumber);
}

function currentToolCalls(value: unknown, failedByName: unknown): boolean {
  const toolCalls = plainRecord(value);
  if (toolCalls === null) return false;
  const byName = consistentCallCounts(toolCalls.total, toolCalls.failed, toolCalls.byName, failedByName);
  if (byName === null || !isNonNegativeInteger(toolCalls.custom) || !isNonNegativeInteger(toolCalls.native)) {
    return false;
  }
  const total = byName.reduce((sum, [, count]) => sum + count, 0);
  const custom = byName.reduce(
    (sum, [name, count]) => sum + (CUSTOM_TOOL_NAMES.has(bareCustomToolName(name)) ? count : 0),
    0,
  );
  return toolCalls.custom === custom && toolCalls.native === total - custom;
}

function currentUsage(value: unknown): boolean {
  const usage = plainRecord(value);
  if (usage === null || !isNonNegativeInteger(usage.reportedTurns)) return false;
  return (
    nullableNumber(usage.inputTokens) &&
    nullableNumber(usage.outputTokens) &&
    nullableNumber(usage.costUsd) &&
    isNonNegativeInteger(usage.estimatedTurns) &&
    usage.estimatedTurns <= usage.reportedTurns
  );
}

function currentSubmits(value: unknown): value is BuilderSubmitAttempt[] {
  if (!Array.isArray(value)) return false;
  let candidateNumber = 0;
  return value.every((row) => {
    if (plainRecord(row)?.kind === "candidate") candidateNumber += 1;
    return currentSubmitRow(row, candidateNumber);
  });
}

function currentExecutionReceipts(plain: EvidenceRecord): boolean {
  return (
    currentPartialTurn(plain.partialTurn) &&
    currentFailedCalls(plain.failedCalls, plain.failedCallsOmitted) &&
    Array.isArray(plain.turnRetries) &&
    plain.turnRetries.every(currentTurnRetry) &&
    Array.isArray(plain.authoringReviews) &&
    plain.authoringReviews.every(currentAuthoringReview) &&
    Array.isArray(plain.customCalls) &&
    // The writer numbers receipts 1..n in dispatch order and drops only the tail past its ceiling,
    // so a recorded list whose sequences skip or reorder was not written by it.
    plain.customCalls.every(
      (call, index) => currentCustomCall(call) && plainRecord(call)?.sequence === index + 1,
    ) &&
    isNonNegativeInteger(plain.customCallsOmitted)
  );
}

function currentExecutionSettlement(plain: EvidenceRecord): boolean {
  if (!isString(plain.outcome) || !CURRENT_EXECUTION_OUTCOMES.has(plain.outcome)) return false;
  return (
    currentLifecycle(plain.lifecycle, plain.outcome === "evidence-unavailable" ? plain.outcome : null) &&
    // The closing terminal is present exactly on the outcome that names it, so a record cannot
    // claim a controller recorded it without saying which run did.
    (plain.outcome === "recorded-at-terminal"
      ? currentInvocation(plain.closure)
      : plain.closure === undefined) &&
    (plain.postTerminal === undefined || currentInvocation(plain.postTerminal)) &&
    isString(plain.writtenAt) &&
    plain.writtenAt.length > 0
  );
}

export function isCurrentExecutionRecord(value: unknown): value is BuilderExecutionEvidence {
  const plain = plainRecord(value);
  if (plain === null) return false;
  return (
    plain.schema === BUILDER_EXECUTION_SCHEMA &&
    validBackend(plain.backend) &&
    (plain.runtimeIdentity === null || plainRecord(plain.runtimeIdentity) !== null) &&
    isNonNegativeInteger(plain.turns) &&
    isNonNegativeInteger(plain.durationMs) &&
    currentToolCalls(plain.toolCalls, plain.failedByName) &&
    currentUsage(plain.usage) &&
    nullableNumber(plain.firstToolMs) &&
    currentSubmits(plain.submits) &&
    currentExecutionReceipts(plain) &&
    currentExecutionSettlement(plain) &&
    currentHandovers(plain.handovers)
  );
}

/** Absent, or one digest-or-null per handover file and no other key. */
function currentHandovers(value: unknown): boolean {
  if (value === undefined) return true;
  const plain = plainRecord(value);
  if (plain === null) return false;
  const keys = Object.keys(plain);
  return (
    keys.length === HANDOVER_FILES.length &&
    HANDOVER_FILES.every((name) => {
      const digest = plain[name];
      return digest === null || (isString(digest) && /^[0-9a-f]{64}$/.test(digest));
    })
  );
}
