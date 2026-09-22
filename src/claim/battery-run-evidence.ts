import type { NonResultKind } from "./record-events.ts";
import type { BatteryRecord } from "../truth/battery-record.ts";
import { runtimeIdentityCensus, scoredCases } from "./battery-facts.ts";
import type { ClaimEvidence, RunStatusEvidence, ScoredCase, StalenessEvidence } from "./claim-evidence.ts";
import type { ControlCorpus } from "../truth/controls.ts";
import {
  checkReceiptSet,
  controlReceiptInvalidFinding,
  totalsMatchRecorded,
} from "../truth/control-receipts.ts";
import { isString } from "../meta/json-shape.ts";

interface BatteryEvidenceCase {
  taskId: string;
  runtimeNonResult: string | null;
  runtimeNonResultKind: NonResultKind | null;
}

/** Project claim inputs directly from the recorded battery facts that own them. */
interface BatteryRunEvidenceResult {
  runStatus: RunStatusEvidence;
  staleness: StalenessEvidence;
}

interface BatteryClaimInputResult {
  evidence: Omit<ClaimEvidence, "bundles" | "grounding">;
  score: ScoredCase[];
  execution: BatteryRecord["execution"];
}

export function batteryRunEvidence(
  cases: readonly BatteryEvidenceCase[],
  buildInputsHash: string,
  terminalReason: string,
): BatteryRunEvidenceResult {
  const nonResults: Record<string, number> = {};
  let verified = 0;
  for (const item of cases) {
    const hasReason = item.runtimeNonResult !== null;
    const hasKind = item.runtimeNonResultKind !== null;
    if (hasReason !== hasKind) {
      throw new Error(
        `case "${item.taskId}" has mismatched non-result evidence: reason=${hasReason}, kind=${hasKind}`,
      );
    }
    if (item.runtimeNonResultKind === null) verified += 1;
    else nonResults[item.runtimeNonResultKind] = (nonResults[item.runtimeNonResultKind] ?? 0) + 1;
  }
  return {
    runStatus: { state: "terminal", reason: terminalReason, verified, nonResults },
    staleness: { stale: false, hashes: verified === 0 ? [] : [buildInputsHash] },
  };
}

/** Reconstruct every runner-owned claim input from one battery record. The live runner and the
 * later claim write share this projection, so process memory cannot become a second score owner. */
export function batteryClaimInput(
  battery: BatteryRecord,
  checkIdsByTask: ReadonlyMap<string, readonly string[]>,
  corpus: ControlCorpus,
): BatteryClaimInputResult {
  if (!isString(battery.terminalReason) || !Array.isArray(battery.capabilities)) {
    throw new Error("battery record is missing terminalReason or capabilities — claim inputs are incomplete");
  }
  const projected = batteryRunEvidence(battery.cases, battery.buildInputsHash, battery.terminalReason);
  const score = scoredCases(battery.cases).map((item) => {
    const checkIds = checkIdsByTask.get(item.taskId);
    if (checkIds === undefined) {
      throw new Error(`battery case "${item.taskId}" has no task-bound truth-check census`);
    }
    return {
      caseId: item.taskId,
      passed: item.pass === true,
      truthVerified: item.truthOk !== null,
      checkIds: [...checkIds],
    };
  });
  const receiptCheck = checkReceiptSet(corpus, battery.discrimination.controlReceipts);
  const receiptFindings = [...receiptCheck.findings];
  const calculatedTotals = receiptCheck.totals;
  if (calculatedTotals !== null && !totalsMatchRecorded(battery.discrimination, calculatedTotals)) {
    receiptFindings.push(
      controlReceiptInvalidFinding("saved discrimination totals do not match the checked control receipts"),
    );
  }
  const claimable = battery.discrimination.claimable && receiptFindings.length === 0;
  const attributedCheckIds: Record<string, number> = calculatedTotals?.attributedCheckIds ?? {};
  return {
    evidence: {
      ...projected,
      discrimination: {
        claimable,
        findings: [...battery.discrimination.findings, ...receiptFindings],
        attributedCheckIds,
      },
      backendPin: battery.backendPin,
      thresholdManifestDigest: battery.thresholdManifestDigest,
      runtimeIdentities: runtimeIdentityCensus(battery.cases),
      capabilities: [...battery.capabilities],
      predictions: null,
      truthCheckFiring: battery.truthCheckFiring,
      judge: battery.judge,
    },
    score,
    execution: battery.execution,
  };
}
