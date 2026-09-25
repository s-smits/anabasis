// Current readers consume an advice ledger, not the retired paired-repair contest. Match the
// producer's public projection and complete diagnosis bytes; matching an owner alone proves no use.
import { publicEpochReview } from "#src/review/epoch-review-public.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { redactProviderDiagnostic } from "#src/backends/diagnostic-redaction.ts";
import { readAnalysis } from "./common.mjs";
import { REBUILD_ADVICE_SCHEMA } from "#src/author/rebuild-advice.ts";
import { DIAGNOSIS_READING_SCHEMA } from "#src/review/diagnosis-reader.ts";
import { isRecord, isString } from "#src/meta/json-shape.ts";

/** A finding's producer-owned identity: kind, owner and the evidence file it cites. The public
 *  claim sentence is written by `publicEpochReview` at admission time, so a campaign recorded by
 *  another revision of that projection carries a different sentence for the same admitted finding;
 *  joining on it reports an admitted epoch finding as not consumed. Kind, owner and evidence path
 *  come from the reviewer's own tool and stay stable across revisions. */
function epochFindingKey(finding) {
  if (!isRecord(finding)) return null;
  return JSON.stringify([finding.kind ?? null, finding.proposedOwner ?? null, finding.evidence ?? null]);
}

/** Multiplicity-aware: two findings of one review may share a kind and owner, and each is admitted
 *  on its own. Every admitted row is consumed at most once. */
function admittedEpochFindings(projected, admitted) {
  const pool = admitted.map(epochFindingKey).filter((key) => key !== null);
  let hits = 0;
  for (const finding of projected) {
    const index = pool.indexOf(epochFindingKey(finding));
    if (index === -1) continue;
    pool.splice(index, 1);
    hits += 1;
  }
  return hits;
}

export function currentDiagnosis(campaignDir, runId) {
  const evidence = readAnalysis(campaignDir, runId, "diagnoses");
  if (evidence === null) {
    return {
      runId,
      evidenceSchema: DIAGNOSIS_READING_SCHEMA,
      opportunity: null,
      output: null,
      consumer: null,
      changed: null,
      unknown: true,
      note: "diagnosis evidence unavailable; no-opportunity and repair yield are unproved",
    };
  }
  if (
    evidence.schema !== DIAGNOSIS_READING_SCHEMA ||
    !Array.isArray(evidence.offered) ||
    !Array.isArray(evidence.diagnoses)
  ) {
    throw new Error(`unsupported diagnosis evidence for ${runId}`);
  }
  const packet = readAnalysis(campaignDir, runId, "rebuild-advice");
  const issues =
    packet?.schema === REBUILD_ADVICE_SCHEMA && Array.isArray(packet.issues) ? packet.issues : null;
  const offered = new Set(evidence.offered);
  // One reading may cover several issues, so coverage is counted in issues, not in readings.
  const covered = (row) => (isRecord(row) && Array.isArray(row.issueIds) ? row.issueIds : []);
  const diagnosed = new Set(evidence.diagnoses.flatMap(covered).filter((id) => offered.has(id)));
  const abstained = Array.isArray(evidence.abstentions)
    ? new Set(
        evidence.abstentions
          .filter((row) => isRecord(row) && isString(row.reason) && row.reason.trim() !== "")
          .flatMap(covered)
          .filter((id) => offered.has(id) && !diagnosed.has(id)),
      )
    : null;
  const attached =
    issues === null
      ? null
      : evidence.diagnoses
          .filter((row) => isRecord(row.diagnosis) && row.diagnosis.runId === runId)
          .flatMap((row) =>
            covered(row).filter(
              (id) =>
                offered.has(id) &&
                issues.some(
                  (issue) =>
                    issue.id === id &&
                    isRecord(issue.diagnosis) &&
                    hashJsonValue(issue.diagnosis) === hashJsonValue(row.diagnosis),
                ),
            ),
          ).length;
  return {
    runId,
    evidenceSchema: evidence.schema,
    offered: evidence.offered.length,
    diagnosed: diagnosed.size,
    abstained: abstained?.size ?? null,
    unresolved:
      abstained === null
        ? null
        : [...offered].filter((id) => !diagnosed.has(id) && !abstained.has(id)).length,
    readerText:
      evidence.error == null && isString(evidence.readerText)
        ? redactProviderDiagnostic(evidence.readerText, 4_000)
        : null,
    opportunity: evidence.offered.length > 0,
    output:
      evidence.diagnoses.length > 0
        ? {
            offered: evidence.offered.length,
            diagnoses: evidence.diagnoses.length,
            refused: evidence.refused ?? null,
          }
        : null,
    consumer:
      attached > 0
        ? { path: `analysis/${runId}-rebuild-advice.json`, field: "issues[].diagnosis", value: { attached } }
        : null,
    changed: evidence.offered.length > 0 ? null : false,
    unknown: issues === null && evidence.diagnoses.length > 0,
    note:
      attached === null
        ? "advice unavailable; diagnosis consumption unobservable"
        : `${attached} diagnosis reading(s) retained in rebuild advice; Builder use and repair benefit require later evidence`,
  };
}

export function currentEpoch(campaignDir, runId, review) {
  if (
    !Array.isArray(review.findings) ||
    !Array.isArray(review.disputes) ||
    !isString(review.condition?.digest)
  ) {
    throw new Error(`invalid ${review.schema} evidence for ${runId}`);
  }
  // Reconstruct the proposed public identities, then join actual recorded admission. Historical
  // producers could admit incomplete reviews; today's completion rule cannot erase that use.
  const projected = publicEpochReview({ ...review, status: "completed" });
  const admission = readAnalysis(campaignDir, runId, "admission");
  const admitted = Array.isArray(admission?.admitted) ? admission.admitted : null;
  const hits = admitted === null ? null : admittedEpochFindings(projected.findings, admitted);
  const packet = readAnalysis(campaignDir, runId, "rebuild-advice");
  const issues =
    packet?.schema === REBUILD_ADVICE_SCHEMA && Array.isArray(packet.issues) ? packet.issues : null;
  const disputes =
    issues === null
      ? null
      : projected.disputes.filter((dispute) =>
          issues.some(
            (issue) =>
              issue.id === dispute.issueId && issue.status === "disputed" && issue.dispute === dispute.reason,
          ),
        ).length;
  // The proposal stays unchanged in admitted[]; admission may route it to a different owner.
  // Join the feedback's typed finding identity, never private claim text or nearby order.
  const feedback = Array.isArray(admission?.feedback) ? admission.feedback : null;
  const routedOwners =
    feedback === null
      ? null
      : [
          ...new Set(
            feedback
              .filter(
                (row) =>
                  Array.isArray(row.findings) &&
                  row.findings.some((item) =>
                    projected.findings.some(
                      (finding) =>
                        item.code === finding.kind &&
                        item.path === finding.evidence &&
                        admitted?.some((hit) => epochFindingKey(hit) === epochFindingKey(finding)),
                    ),
                  ),
              )
              .map((row) => row.owner)
              .filter((owner) => isString(owner)),
          ),
        ];
  const output = projected.findings.length + projected.disputes.length > 0;
  const kinds = {};
  for (const finding of projected.findings) {
    const key = `${finding.kind}/${finding.proposedOwner ?? "unowned"}`;
    kinds[key] = (kinds[key] ?? 0) + 1;
  }
  const consumed = (hits ?? 0) + (disputes ?? 0);
  return {
    runId,
    status: review.status,
    conditionDigest: review.condition.digest,
    opportunity: review.status !== "skipped",
    output: output
      ? {
          findings: projected.findings.length,
          kinds,
          disputes: projected.disputes.length,
          opened: review.coverage?.opened ?? null,
        }
      : null,
    consumer:
      consumed > 0
        ? {
            path: `analysis/${runId}-admission.json`,
            field: "publicEpochReview findings → admitted; disputes → rebuild advice",
            value: {
              admitted: hits,
              routedOwners,
              disputedIssues: disputes,
              advicePath: `analysis/${runId}-rebuild-advice.json`,
            },
          }
        : null,
    changed: review.status === "skipped" ? false : null,
    unknown:
      (projected.findings.length > 0 && admitted === null) ||
      (projected.disputes.length > 0 && issues === null),
    note: `${hits ?? "unknown"} public finding(s) admitted; ${disputes ?? "unknown"} issue dispute(s) retained; repair benefit unmeasured`,
  };
}
