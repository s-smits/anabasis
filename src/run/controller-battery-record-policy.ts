/**
 * One owner for the battery-record question: when a final record may be missing, and whether every
 * admitted battery id actually reaches its own record and case rows.
 */
import { existsSync } from "../meta/filesystem.ts";
import { campaignDir, defaultProductDir } from "../meta/campaign-root.ts";
import { basename, dirname, join } from "../meta/path.ts";
import { batteryPath, readBatteryJoinSlice } from "../truth/battery-record.ts";
import { CASE_RECORD_FILE, readCaseRecord } from "../claim/case-record.ts";
import { measuredProductDir } from "./product-versions.ts";

/** `operator-signal`: the controller caught SIGTERM mid-battery, before any verdict. The final
 *  battery then has accepted artifacts under `candidates/` and no record of its own, and the
 *  evidence reader still opens the rounds that did complete rather than refusing the whole run —
 *  the rounds before the signal were measured, and the signal says nothing about them. */
type MissingFinalRecordOwner = "provider-resource-budget" | "operator-signal";

/** The part of a controller iteration this join reads: its id and the batteries it admitted. */
type AdmittedIteration = {
  runId: string;
  batteryRunIds: string[];
  lastBatteryRunId: string | null;
};

export function missingFinalRecordOwner(input: {
  outcome: unknown;
  abortClause: string | null;
  providerCapExhausted: boolean;
}): MissingFinalRecordOwner | null {
  if (input.outcome !== "aborted") return null;
  if (input.abortClause === "budget-limited" && input.providerCapExhausted) return "provider-resource-budget";
  return input.abortClause === "signal-terminated" ? "operator-signal" : null;
}

/** The controller and its readers share the exact iteration identity, including zero padding. */
export function controllerIterationRunId(selector: string, round: number): string {
  return round === 1 ? selector : `${selector}-i${String(round).padStart(2, "0")}`;
}

/** Provisional row selection before a terminal supplies its authoritative battery set. A shared
 *  prefix is insufficient: only canonical iteration ids match. */
export function isControllerBatteryRunId(selector: string, batteryRunId: string): boolean {
  if (batteryRunId === selector) return true;
  if (!batteryRunId.startsWith(`${selector}-i`)) return false;
  const round = Number(batteryRunId.slice(selector.length + 2));
  return (
    Number.isSafeInteger(round) && round >= 2 && controllerIterationRunId(selector, round) === batteryRunId
  );
}

/** Resolve a battery's record from the owners that may have placed it: the iteration's candidate
 *  directory and the adopted tree. An iteration measures one battery, under its own run id. */
function admittedBatteryRecordPaths(
  repoRoot: string,
  slug: string,
  iterationRunId: string,
  batteryRunId: string,
): string[] {
  if (batteryRunId !== iterationRunId) return [];
  const version = measuredProductDir(repoRoot, slug, batteryRunId);
  if (version !== null) return [batteryPath(version, batteryRunId)];
  return [
    batteryPath(join(campaignDir(repoRoot, slug), "candidates", iterationRunId), batteryRunId),
    batteryPath(defaultProductDir(repoRoot, slug), batteryRunId),
  ];
}

/**
 * Check every admitted battery against its own record and its case rows, once the case record is
 * readable. Without this join, a recorded skip, an unrecorded failed execution and rows deleted
 * after recording all appear as runs with zero rows. battery.json owns the disposition. */
export function verifyAdmittedBatteryRecords(
  campaign: string,
  terminalPath: string,
  iterations: readonly AdmittedIteration[],
  finalRecordOwner: MissingFinalRecordOwner | null,
): void {
  const repoRoot = dirname(dirname(campaign)); // always `<repoRoot>/campaigns/<slug>`
  const slug = basename(campaign);
  const rowCounts = new Map<string, number>();
  for (const { row } of readCaseRecord(join(campaign, CASE_RECORD_FILE))) {
    rowCounts.set(row.runId, (rowCounts.get(row.runId) ?? 0) + 1);
  }
  // Only the final iteration's own battery, admitted last and with no rows, may lack its record, once.
  const final = iterations.at(-1);
  let excused = finalRecordOwner === null || final === undefined ? null : final.lastBatteryRunId;
  for (const iteration of iterations) {
    for (const runId of iteration.batteryRunIds) {
      const rows = rowCounts.get(runId) ?? 0;
      const records = admittedBatteryRecordPaths(repoRoot, slug, iteration.runId, runId).filter((path) =>
        existsSync(path),
      );
      // The record's case count must equal the record's rows for that run id, and a zero-row battery
      // may only carry a skipped-precase disposition.
      for (const path of records) {
        const { caseCount, disposition } = readBatteryJoinSlice(path);
        if (caseCount !== rows) {
          throw new Error(
            `${terminalPath}: battery ${runId} recorded ${String(caseCount)} cases, record holds ${String(rows)} rows`,
          );
        }
        if (rows === 0 && disposition !== "skipped-precase") {
          throw new Error(
            `${terminalPath}: battery ${runId} has zero case rows but its record says "${disposition}"`,
          );
        }
      }
      if (records.length > 0) continue;
      if (iteration === final && runId === excused && rows === 0) {
        excused = null;
        continue;
      }
      throw new Error(
        `${terminalPath}: battery ${runId} has no record at any derived path (battery record missing)`,
      );
    }
  }
}
