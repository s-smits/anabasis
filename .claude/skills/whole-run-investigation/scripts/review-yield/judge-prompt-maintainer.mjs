// Historical Judge Prompt Maintainer yield: propose one content-only prompt edit from
// completed aggregate evidence and never activate it. Its output can only matter if a later judge
// census runs under a different prompt policy digest. Opportunity: the maintainer had input
// (`held` or `candidate`; `not-required` and `unavailable` are none). Output: a candidate.
// Consumed: a later census in the same campaign carries the candidate's replacement digest.
// Changed: a later census differs from this iteration's census digest. This is a comparison lead;
// it does not by itself attribute the change to this candidate. Current-loop rows mark absence.
import {
  CURRENT_LOOP_SCHEMA,
  absentRow,
  iterationRunIds,
  iterationSchema,
  presentRows,
  readAnalysis,
  report,
  tallyText,
} from "./common.mjs";
import { isRecord, isString } from "#src/meta/json-shape.ts";

const COMPONENT = "the judge prompt maintainer";

function censusDigest(judges) {
  const digests =
    isRecord(judges) && isRecord(judges.promptPolicyDigests) ? judges.promptPolicyDigests : null;
  return isString(digests?.census) ? digests.census : null;
}

function candidateOutput(maintenance) {
  if (!isRecord(maintenance)) return null;
  const candidate = isRecord(maintenance.candidate) ? maintenance.candidate : null;
  if (maintenance.status !== "candidate" && maintenance.status !== "held") return null;
  return {
    status: maintenance.status,
    target: maintenance.target ?? null,
    baseDigest: isString(candidate?.base?.digest) ? candidate.base.digest : null,
    replacementDigest: isString(candidate?.replacement?.digest) ? candidate.replacement.digest : null,
    evidenceDigest: isString(maintenance.evidenceDigest) ? maintenance.evidenceDigest : null,
  };
}

function laterDigests(campaignDir, runIds, index) {
  const later = [];
  for (const runId of runIds.slice(index + 1)) {
    const digest = censusDigest(readAnalysis(campaignDir, runId, "judges"));
    if (digest !== null) later.push({ runId, digest });
  }
  return later;
}

function row(campaignDir, runIds, index) {
  const runId = runIds[index];
  if (iterationSchema(campaignDir, runId) === CURRENT_LOOP_SCHEMA) return absentRow(runId, COMPONENT);
  const maintenance = readAnalysis(campaignDir, runId, "judge-prompt-maintenance");
  const status = isRecord(maintenance) ? (maintenance.status ?? null) : null;
  const output = candidateOutput(maintenance);
  const own = censusDigest(readAnalysis(campaignDir, runId, "judges"));
  const later = laterDigests(campaignDir, runIds, index);
  const adopted =
    output?.replacementDigest === null
      ? []
      : later.filter((entry) => entry.digest === output?.replacementDigest);
  const differing = own === null ? [] : later.filter((entry) => entry.digest !== own);
  const consumer =
    adopted.length === 0
      ? null
      : {
          path: `analysis/${adopted[0].runId}-judges.json`,
          field: "promptPolicyDigests.census",
          value: adopted[0].digest,
        };
  const changed = output?.status === "candidate" && differing.length > 0;
  let note;
  if (maintenance === null) note = "no maintenance file";
  else if (status === "not-required") note = "review coverage complete; no input";
  else if (status === "unavailable") note = "maintainer unavailable";
  else if (status === "held") note = "input present; candidate held";
  else if (later.length === 0) note = "candidate drafted; no later census in this campaign";
  else if (changed) {
    note = `candidate drafted; ${differing.length} later census digest(s) differ (activation path: ${maintenance.activation ?? "unknown"})`;
  } else note = `candidate drafted; ${later.length} later census run(s) kept the same prompt digest`;
  return {
    runId,
    opportunity: status === "held" || status === "candidate",
    output,
    consumer,
    changed,
    status,
    activation: isRecord(maintenance) ? (maintenance.activation ?? null) : null,
    censusDigest: own,
    laterCensusRuns: later.length,
    note,
  };
}

export function collect(campaignDir) {
  const runIds = iterationRunIds(campaignDir);
  const rows = runIds.map((_, index) => row(campaignDir, runIds, index));
  const { present, reasons } = presentRows(COMPONENT, rows);
  if (present.length > 0) {
    reasons.push(`statuses: ${tallyText(present, (entry) => entry.status) || "none"}`);
    const candidates = present.filter((entry) => entry.output?.status === "candidate").length;
    const adopted = present.filter((entry) => entry.consumer !== null).length;
    reasons.push(`candidates ${candidates}; adopted by a later census ${adopted}`);
    const activations = new Set(present.map((entry) => entry.activation).filter((value) => value !== null));
    if (activations.size > 0) {
      reasons.push(`activation: ${[...activations].join(", ")} (no controller path activates a candidate)`);
    }
    const digests = new Set(present.map((entry) => entry.censusDigest).filter((value) => value !== null));
    reasons.push(`distinct census prompt digests across the campaign: ${digests.size}`);
  }
  return report("judge-prompt-maintainer", campaignDir, rows, reasons);
}
