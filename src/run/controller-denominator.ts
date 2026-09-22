import { existsSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { CASE_RECORD_FILE, classifyCaseOutcome, outcomeTally, readCaseRecord } from "../claim/case-record.ts";

export type Denominator =
  | { state: "absent" }
  | { state: "recorded"; total: number; verified: number; unaccepted: number; nonResults: number }
  | { state: "invalid"; error: "case-record unreadable" };

/**
 * The case counts of this run's admitted batteries, answered from the case rows. The terminal
 * records this value for skill readers; the controller reader recomputes it from the rows and
 * checks agreement, allowing the older terminal spelling when it describes the same counts.
 * A missing case record is zero rows: a battery refused before any case ran (esp32-run62-opus-0904,
 * esp32-sol-stable-20260905T1000Z) is an operational result with a zero denominator, not an
 * unreadable one.
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
