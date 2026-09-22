import type { OutcomeMetrics } from "../../../../tools/outcome/metrics.ts";

export interface ClimbPoint {
  id: string;
  label: string;
  rate: number | null;
  passed: number;
  verified: number;
  unaccepted: number;
  nonResults: number;
  condition: string | null;
  taskSet: string | null;
}

/** Claims own chronology. Undated batteries remain in Evals; they cannot acquire a position by filename. */
export function climbPoints(
  batteries: readonly Pick<OutcomeMetrics, "runId" | "claim" | "cases" | "identity">[],
): ClimbPoint[] {
  return batteries
    .filter((b) => b.claim.createdAt !== null)
    .sort((a, b) => a.claim.createdAt!.localeCompare(b.claim.createdAt!) || a.runId.localeCompare(b.runId))
    .map((b, i) => ({
      id: b.runId,
      label: String(i + 1),
      rate: b.cases.verified === 0 ? null : b.cases.passed / b.cases.verified,
      passed: b.cases.passed,
      verified: b.cases.verified,
      unaccepted: b.cases.unaccepted,
      nonResults: b.cases.nonResults.total,
      condition: b.identity.backendPins.length === 1 ? b.identity.backendPins[0]! : null,
      taskSet: b.claim.taskSetHash,
    }));
}
