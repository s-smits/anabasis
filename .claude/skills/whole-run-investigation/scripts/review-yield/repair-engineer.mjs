// Historical Repair Engineer yield: bounded packets of failed measured traces, at most
// one hypothesis per packet, carried to the Builder only as an `agent-repair` finding owned by
// `tools-spec`, `instructions` or `fingerprint` (or a corroborated `correctness-model` dispute).
// Opportunity: failed verified shipping cases existed (`coverage.diagnosable > 0`). Output: an owned
// finding or a held hypothesis. Consumed: admission admitted that exact finding. Changed: the next
// iteration's contest names that owner as the selected repair owner.
// Current-loop rows use currentDiagnosis to measure advice retention; repair benefit needs
// later evidence from the Builder and measurement.
import {
  CURRENT_LOOP_SCHEMAS,
  findingKey,
  findingKeys,
  iterationRunIds,
  iterationSchema,
  nextRepair,
  readAnalysis,
  report,
} from "./common.mjs";
import { currentDiagnosis } from "./current-readers.mjs";
import { isRecord, isString } from "#src/meta/json-shape.ts";

export const REPAIR_OWNERS = new Set(["tools-spec", "instructions", "fingerprint", "correctness-model"]);

function ownedFindings(judges) {
  const findings = Array.isArray(judges?.findings) ? judges.findings : [];
  return findings.filter((finding) => isRecord(finding) && REPAIR_OWNERS.has(finding.proposedOwner));
}

function kindTally(findings) {
  const tally = {};
  for (const finding of findings) {
    if (!isRecord(finding)) continue;
    const key = `${finding.kind ?? "unknown"}/${finding.proposedOwner ?? "unowned"}`;
    tally[key] = (tally[key] ?? 0) + 1;
  }
  return tally;
}

function output(judges) {
  if (!isRecord(judges)) return null;
  const findings = Array.isArray(judges.findings) ? judges.findings : [];
  const held = Array.isArray(judges.held) ? judges.held.length : 0;
  const owned = ownedFindings(judges);
  if (findings.length === 0 && held === 0) return null;
  return {
    findings: findings.length,
    owned: owned.length,
    held,
    kinds: kindTally(findings),
    repairNonResults: Array.isArray(judges.repairNonResults) ? judges.repairNonResults.length : 0,
    packetNonResults: Array.isArray(judges.repairPacketNonResults) ? judges.repairPacketNonResults.length : 0,
  };
}

/** Owners the other producers (host validators, guard, epoch reviewer) also routed this iteration. */
function otherOwners(admission, own) {
  const ownKeys = new Set(own.map(findingKey));
  const admitted = Array.isArray(admission.admitted) ? admission.admitted : [];
  return new Set(
    admitted
      .filter((finding) => !ownKeys.has(findingKey(finding)))
      .map((finding) => finding?.proposedOwner)
      .filter((owner) => isString(owner)),
  );
}

function consumer(runId, admission, owned) {
  if (!isRecord(admission)) return null;
  const admitted = findingKeys(admission.admitted);
  const hits = owned.filter((finding) => admitted.has(findingKey(finding)));
  if (hits.length === 0) return null;
  const owners = [...new Set(hits.map((finding) => finding.proposedOwner))];
  return {
    path: `analysis/${runId}-admission.json`,
    field: "admitted ∩ judges.findings → feedback owner → next contest.repair.selectedOwner",
    value: { admitted: hits.length, owners, alsoRoutedByOthers: [...otherOwners(admission, hits)] },
  };
}

function row(campaignDir, runId, nextRunId) {
  if (CURRENT_LOOP_SCHEMAS.has(iterationSchema(campaignDir, runId))) {
    return currentDiagnosis(campaignDir, runId);
  }
  const judges = readAnalysis(campaignDir, runId, "judges");
  const admission = readAnalysis(campaignDir, runId, "admission");
  const coverage = isRecord(judges) && isRecord(judges.coverage) ? judges.coverage : null;
  const diagnosable = Number.isInteger(coverage?.diagnosable) ? coverage.diagnosable : 0;
  const diagnosed = Number.isInteger(coverage?.diagnosed) ? coverage.diagnosed : 0;
  const owned = ownedFindings(judges);
  const consumed = consumer(runId, admission, owned);
  const { nextOwner, changed, shared } = nextRepair(campaignDir, nextRunId, consumed);
  let note;
  if (judges === null) note = "no judges file";
  else if (diagnosable === 0) note = "no failed shipping traces to diagnose";
  else if (owned.length === 0) note = `diagnosed ${diagnosed}/${diagnosable}; no owned repair finding`;
  else if (consumed === null) note = "owned finding not admitted";
  else if (changed) {
    note = `next iteration repaired ${nextOwner}${shared ? " (owner also routed by another producer)" : ""}`;
  } else {
    note = `admitted; next iteration owner ${nextOwner ?? "none"}`;
  }
  return {
    runId,
    opportunity: diagnosable > 0,
    output: output(judges),
    consumer: consumed,
    changed,
    diagnosable,
    diagnosed,
    nextOwner,
    note,
  };
}

export function collect(campaignDir) {
  const runIds = iterationRunIds(campaignDir);
  const rows = runIds.map((runId, index) => row(campaignDir, runId, runIds[index + 1] ?? null));
  const reasons = [];
  const withTraces = rows.filter((entry) => entry.opportunity === true && entry.evidenceSchema === undefined);
  const diagnosed = withTraces.reduce((sum, entry) => sum + entry.diagnosed, 0);
  const diagnosable = withTraces.reduce((sum, entry) => sum + entry.diagnosable, 0);
  if (withTraces.length > 0) {
    reasons.push(
      `failed shipping traces diagnosed ${diagnosed}/${diagnosable} over ${withTraces.length} iteration(s)`,
    );
  }
  const current = rows.filter(
    (entry) => entry.evidenceSchema === "diagnosis-reading/v1" && entry.opportunity === true,
  );
  if (current.length > 0) {
    reasons.push(
      `current issue readings ${current.reduce((sum, entry) => sum + entry.diagnosed, 0)}/${current.reduce((sum, entry) => sum + entry.offered, 0)} offered; advice retention is not repair benefit`,
    );
  }
  const owned = rows.reduce((sum, entry) => sum + (entry.output?.owned ?? 0), 0);
  const unowned = rows.reduce(
    (sum, entry) => sum + ((entry.output?.findings ?? 0) - (entry.output?.owned ?? 0)),
    0,
  );
  if (rows.some((entry) => entry.evidenceSchema === undefined)) {
    reasons.push(
      `legacy owned repair findings ${owned}; unowned advisory findings ${unowned} (hardness, verifier-suspicion, diagnosis-uncertain)`,
    );
  }
  const held = rows.reduce((sum, entry) => sum + (entry.output?.held ?? 0), 0);
  if (held > 0) reasons.push(`held hypotheses ${held}`);
  return report("repair-engineer", campaignDir, rows, reasons);
}
