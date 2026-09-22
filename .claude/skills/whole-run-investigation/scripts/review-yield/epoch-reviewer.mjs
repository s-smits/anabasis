// Historical Epoch Reviewer yield: once per distinct task set, read the whole
// measured tree and emit one finding tool; findings reach the Builder only through admission and
// then the next iteration's selected repair owner. Opportunity: a completed review. Output: at least
// one finding. Consumed: admission admitted an epoch finding. Changed: an admitted epoch finding's
// owner became `plan.active.owner` and the next iteration's contest selected that owner.
// Counts, kinds, owners, severities and digests only: the reviewer reads protected verifier
// material, so its claim text never enters a WRI report.
// Rows under the current EPOCH_REVIEW_SCHEMA use currentEpoch, which measures admission and advice retention;
// later evidence must establish whether the Builder used the advice and whether it helped.
import {
  findingKey,
  findingKeys,
  iterationRunIds,
  nextRepair,
  readAnalysis,
  report,
  tallyText,
} from "./common.mjs";
import { currentEpoch } from "./current-readers.mjs";
import { isRecord, isString } from "#src/meta/json-shape.ts";
import { EPOCH_REVIEW_SCHEMA } from "#src/review/epoch-review-findings.ts";

function tally(findings, pick) {
  const out = {};
  for (const finding of findings) {
    if (!isRecord(finding)) continue;
    const key = pick(finding);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function reviewOutput(review) {
  if (!isRecord(review)) return null;
  const findings = Array.isArray(review.findings) ? review.findings : [];
  if (findings.length === 0) return null;
  const coverage = isRecord(review.coverage) ? review.coverage : {};
  const calls = isRecord(review.toolCalls) ? review.toolCalls : {};
  return {
    findings: findings.length,
    kinds: tally(findings, (finding) => `${finding.kind ?? "unknown"}/${finding.proposedOwner ?? "unowned"}`),
    severities: tally(findings, (finding) => finding.severity ?? "unstated"),
    allListedFilesRead: coverage.allListedFilesRead ?? null,
    refusedCalls: calls.refused ?? null,
    reads: calls.read ?? null,
  };
}

function consumer(runId, admission, findings) {
  if (!isRecord(admission)) return null;
  const admitted = findingKeys(admission.admitted);
  const hits = findings.filter((finding) => admitted.has(findingKey(finding)));
  const refused = findingKeys(admission.refused);
  const refusedHits = findings.filter((finding) => refused.has(findingKey(finding))).length;
  if (hits.length === 0 && refusedHits === 0) return null;
  const owners = [
    ...new Set(hits.map((finding) => finding.proposedOwner).filter((owner) => isString(owner))),
  ];
  const hitKeys = new Set(hits.map(findingKey));
  const others = (Array.isArray(admission.admitted) ? admission.admitted : [])
    .filter((finding) => !hitKeys.has(findingKey(finding)))
    .map((finding) => finding?.proposedOwner)
    .filter((owner) => isString(owner));
  return {
    path: `analysis/${runId}-admission.json`,
    field: "admitted ∩ epoch findings → feedback owner → next contest.repair.selectedOwner",
    value: { admitted: hits.length, refused: refusedHits, owners, alsoRoutedByOthers: [...new Set(others)] },
  };
}

function row(campaignDir, runId, nextRunId) {
  const review = readAnalysis(campaignDir, runId, "epoch-review");
  if (review?.schema === EPOCH_REVIEW_SCHEMA) return currentEpoch(campaignDir, runId, review);
  const admission = readAnalysis(campaignDir, runId, "admission");
  const status = isRecord(review) ? (review.status ?? null) : null;
  const findings = isRecord(review) && Array.isArray(review.findings) ? review.findings : [];
  const consumed = consumer(runId, admission, findings);
  const { nextOwner, changed, shared } = nextRepair(campaignDir, nextRunId, consumed);
  const taskSetHash =
    isRecord(review) && isRecord(review.condition) ? (review.condition.taskSetHash ?? null) : null;
  let note;
  if (review === null) note = "no epoch-review file";
  else if (status !== "completed") note = `review ${status}`;
  else if (findings.length === 0) note = "completed with no finding";
  else if (consumed === null) note = `${findings.length} finding(s); none admitted or refused by name`;
  else if (changed) {
    note = `next iteration repaired ${nextOwner} from an epoch finding${shared ? " (owner also routed by another producer)" : ""}`;
  } else {
    note = `${consumed.value.admitted} admitted (owners ${consumed.value.owners.join("+") || "none"}); next iteration owner ${nextOwner ?? "none"}`;
  }
  return {
    runId,
    opportunity: status === "completed",
    output: reviewOutput(review),
    consumer: consumed,
    changed,
    status,
    taskSetHash,
    nextOwner,
    note,
  };
}

export function collect(campaignDir) {
  const runIds = iterationRunIds(campaignDir);
  const rows = runIds.map((runId, index) => row(campaignDir, runId, runIds[index + 1] ?? null));
  const reasons = [];
  reasons.push(`statuses: ${tallyText(rows, (entry) => entry.status) || "none"}`);
  const findings = rows.reduce((sum, entry) => sum + (entry.output?.findings ?? 0), 0);
  const unowned = rows.reduce(
    (sum, entry) =>
      sum +
      Object.entries(entry.output?.kinds ?? {})
        .filter(([key]) => key.endsWith("/unowned"))
        .reduce((s, [, n]) => s + n, 0),
    0,
  );
  reasons.push(
    `findings ${findings}, of which without a proposed owner ${unowned}; actual routes belong to admission feedback`,
  );
  const perTaskSet = {};
  for (const entry of rows) {
    const key = entry.conditionDigest ?? entry.taskSetHash;
    if (isString(key) && entry.status === "completed") perTaskSet[key] = (perTaskSet[key] ?? 0) + 1;
  }
  const repeated = Object.values(perTaskSet).filter((n) => n > 1).length;
  if (repeated > 0) {
    reasons.push(`review conditions repeated: ${repeated} (legacy rows use task-set identity)`);
  }
  const partial = rows.filter((entry) => entry.output?.allListedFilesRead === false).length;
  if (partial > 0) reasons.push(`reviews that did not read every listed file: ${partial}`);
  return report("epoch-reviewer", campaignDir, rows, reasons);
}
