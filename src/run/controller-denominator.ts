import { existsSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { CASE_RECORD_FILE, classifyCaseOutcome, outcomeTally, readCaseRecord } from "../claim/case-record.ts";

export type Denominator =
  | { state: "absent" }
  | { state: "recorded"; total: number; verified: number; unaccepted: number; nonResults: number }
  | { state: "invalid"; error: "case-record unreadable" };

/**
 * The case counts of this run's admitted batteries, answered from the case rows. The terminal
 * records which iterations measured and never the counts, so every reader derives them here from
 * the one authority rather than trusting a copy it would then have to cross-check. A missing case record is zero rows rather than an error, because a battery refused before any
 * case ran is an operational result with a zero denominator. Reading it as unreadable would lose the
 * one thing it establishes: that nothing was measured, which is a fact and not a gap in the
 * evidence.
 */
export function controllerDenominator(campaignDir: string, batteryRunIds: readonly string[]): Denominator {
  if (batteryRunIds.length === 0) return { state: "absent" };
  const path = join(campaignDir, CASE_RECORD_FILE);
  if (!existsSync(path)) return { state: "recorded", total: 0, verified: 0, unaccepted: 0, nonResults: 0 };
  try {
    const admitted = new Set(batteryRunIds);
    const rows = readCaseRecord(path).filter(({ row }) => admitted.has(row.runId));
    const tally = outcomeTally(rows.map(({ row }) => classifyCaseOutcome(row)));
    return {
      state: "recorded",
      total: rows.length,
      verified: tally.verified,
      unaccepted: tally.unaccepted,
      nonResults: tally.nonResults,
    };
  } catch {
    return { state: "invalid", error: "case-record unreadable" };
  }
}

/** The run ids of the measured iterations; each iteration measures under its own id. */
export function measuredRunIds(iterations: readonly { runId: string; measured: boolean }[]): string[] {
  return iterations.flatMap(({ runId, measured }) => (measured ? [runId] : []));
}
