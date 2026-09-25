// Review-component yield: did each advisory component's output reach something the controller
// recorded? Three components exist. The Epoch Reviewer gets one row per measured iteration,
// joining its public findings into the recorded admission and rebuild advice (read first by lanes
// 12 and 14). The diagnosis reader gets one row per measured iteration too, joining each recorded
// reading into the advice issue it was offered for (read first by lane 25). The Builder's own
// rehearsal instrument, `harness_trial`, gets one row per epoch, joining each rehearsal to the
// candidate the accepted submit froze (read first by lane 11). Campaign JSON only; nothing
// executes.
//
// Current schemas only. Matching an owner alone proves no use, and retention in advice is not
// repair benefit, which needs later Builder and measurement evidence. An iteration whose
// epoch-review, diagnosis or execution file carries another schema fails its component, visibly,
// rather than being read through a reader for a loop that no longer exists. The analysis file only
// lists and orders the iterations; its own schema is not this reader's concern.
import { existsSync, readdirSync, statSync } from "#src/meta/filesystem.ts";
import { basename, join } from "#src/meta/path.ts";
import { readJsonFileOrNull } from "#src/meta/completed-json.ts";
import { publicEpochReview } from "#src/review/epoch-review-public.ts";
import { EPOCH_REVIEW_SCHEMA } from "#src/review/epoch-review-findings.ts";
import { REBUILD_ADVICE_SCHEMA } from "#src/author/rebuild-advice.ts";
import { campaignEpochs } from "#src/author/campaign-epoch.ts";
import { readExecutionEvidenceDetails } from "#tools/outcome/builder-execution-facts.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { isRecord, isString } from "#src/meta/json-shape.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { DIAGNOSIS_READING_SCHEMA } from "#src/review/diagnosis-reader.ts";

export const REVIEW_YIELD_SCHEMA = "wri-review-yield-report/v1";
const EMPTY = { iterations: null, opportunities: null, outputs: null, consumed: null, changed: null };

/** Iteration run ids ordered by `-analysis.json` modification time, then id. */
function iterationRunIds(campaignDir) {
  const dir = join(campaignDir, "analysis");
  if (!existsSync(dir)) return [];
  const suffix = "-analysis.json";
  return readdirSync(dir)
    .filter((name) => name.endsWith(suffix))
    .map((name) => ({ runId: name.slice(0, -suffix.length), at: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => a.at - b.at || a.runId.localeCompare(b.runId))
    .map((entry) => entry.runId);
}

const readAnalysis = (campaignDir, runId, kind) =>
  readJsonFileOrNull(join(campaignDir, "analysis", `${runId}-${kind}.json`));

/** The advice packet's issues under the current schema, or null when none is readable. */
function adviceIssues(campaignDir, runId) {
  const packet = readAnalysis(campaignDir, runId, "rebuild-advice");
  return packet?.schema === REBUILD_ADVICE_SCHEMA && Array.isArray(packet.issues) ? packet.issues : null;
}

/** A finding's producer-owned identity: its owner, whether it is a defect, and the evidence file it
 *  cites. The public claim sentence is written at admission time, so another revision of that
 *  projection words the same admitted finding differently; joining on it would report the finding
 *  as not consumed. */
function epochFindingKey(finding) {
  if (!isRecord(finding)) return null;
  return JSON.stringify([finding.owner ?? null, finding.defect ?? null, finding.evidence ?? null]);
}

/** Multiplicity-aware: two findings may share a key, and each admitted row is consumed once. */
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

/** The harness_trial and accepted-submit rows of one execution record, in call order. */
function trialCalls(record) {
  const calls = Array.isArray(record.customCalls) ? record.customCalls : [];
  const trials = [];
  const submits = [];
  for (const call of calls) {
    if (!isRecord(call)) continue;
    const semantic = isRecord(call.semantic) ? call.semantic : {};
    const candidateId = isString(semantic.candidateId) ? semantic.candidateId : null;
    if (call.tool === "harness_trial") {
      trials.push({ sequence: call.sequence, candidateId, verdict: semantic.truthVerdict ?? null });
    } else if (call.tool === "submit" && semantic.outcome === "accepted") {
      submits.push({ sequence: call.sequence, candidateId });
    }
  }
  return { trials, submits };
}

/**
 * One epoch's rehearsal use, over every execution record the epoch holds. The rehearsal is
 * consumed when the accepted submit's candidate was rehearsed, and it changed something when a
 * failed or not-run rehearsal was followed by another rehearsal or by a submit, since that is the
 * order in which a Builder reads a verdict and acts on it.
 */
function trialRow(epochDir) {
  const epoch = basename(epochDir);
  const read = readExecutionEvidenceDetails(epochDir);
  if (read.unavailable.length > 0) throw new Error(`${epoch}: ${read.unavailable.join("; ")}`);
  // The tasks the epoch's workspace battery declares are the rehearsal opportunity.
  const tasks = readJsonFileOrNull(join(epochDir, "workspace", "correctness-model", "tasks.json"));
  const rows = Array.isArray(tasks) ? tasks : Array.isArray(tasks?.tasks) ? tasks.tasks : null;
  const opportunities = rows === null ? null : rows.length;
  const trials = [];
  const submits = [];
  for (const record of read.records) {
    const calls = trialCalls(record);
    trials.push(...calls.trials);
    submits.push(...calls.submits);
  }
  if (read.records.length === 0) {
    const note = "no execution record; rehearsal use unobservable";
    return {
      runId: epoch,
      opportunity: null,
      output: null,
      consumer: null,
      changed: null,
      unknown: true,
      note,
    };
  }
  const rehearsed = new Set(
    trials.flatMap((trial) => (trial.candidateId === null ? [] : [trial.candidateId])),
  );
  const consumedSubmit = submits.find(
    (submit) => submit.candidateId !== null && rehearsed.has(submit.candidateId),
  );
  const acted = trials.some(
    (trial, index) =>
      (trial.verdict === "fail" || trial.verdict === "not-run") &&
      (index < trials.length - 1 || submits.some((submit) => submit.sequence > trial.sequence)),
  );
  const verdicts = {};
  for (const trial of trials) {
    verdicts[trial.verdict ?? "unrecorded"] = (verdicts[trial.verdict ?? "unrecorded"] ?? 0) + 1;
  }
  return {
    runId: epoch,
    opportunity: opportunities === null ? null : opportunities > 0,
    output: trials.length > 0 ? { rehearsals: trials.length, verdicts } : null,
    consumer:
      consumedSubmit === undefined
        ? null
        : {
            path: "builder-execution.json",
            field: "customCalls[].semantic.candidateId",
            value: consumedSubmit.candidateId,
          },
    changed: acted,
    note:
      submits.length === 0
        ? `${trials.length} rehearsal(s), no accepted submit`
        : `${trials.length} rehearsal(s); accepted submit ${consumedSubmit === undefined ? "was not" : "was"} rehearsed`,
  };
}

/**
 * One measured iteration's diagnosis reading: which offered issues the reader diagnosed or
 * explicitly declined, and whether each reading reached the rebuild advice as the exact bytes the
 * reader recorded, under the issue it was offered for.
 */
function diagnosisRow(campaignDir, runId) {
  const evidence = readAnalysis(campaignDir, runId, "diagnoses");
  if (evidence === null) {
    return {
      runId,
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
    !Array.isArray(evidence.diagnoses) ||
    !Array.isArray(evidence.abstentions)
  ) {
    throw new Error(`${runId}: diagnosis evidence is not ${DIAGNOSIS_READING_SCHEMA}`);
  }
  const issues = adviceIssues(campaignDir, runId);
  const offered = new Set(evidence.offered);
  // One reading may cover several issues, so coverage is counted in issues, not in readings, and
  // only over the issues the reader was actually offered.
  const offeredIn = (row) =>
    isRecord(row) && Array.isArray(row.issueIds) ? row.issueIds.filter((id) => offered.has(id)) : [];
  const diagnosed = new Set(evidence.diagnoses.flatMap(offeredIn));
  const abstained = new Set();
  for (const id of evidence.abstentions.flatMap(offeredIn)) {
    if (!diagnosed.has(id)) abstained.add(id);
  }
  // Retained means the advice carries the reader's own diagnosis bytes under that issue; a
  // reworded or re-attributed diagnosis is another reading, not this one consumed.
  const retained = (row) => {
    if (!isRecord(row.diagnosis) || row.diagnosis.runId !== runId) return [];
    const digest = hashJsonValue(row.diagnosis);
    return offeredIn(row).filter((id) =>
      issues.some(
        (issue) => issue.id === id && isRecord(issue.diagnosis) && hashJsonValue(issue.diagnosis) === digest,
      ),
    );
  };
  const attached = issues === null ? null : evidence.diagnoses.flatMap(retained).length;
  return {
    runId,
    offered: evidence.offered.length,
    diagnosed: diagnosed.size,
    abstained: abstained.size,
    unresolved: [...offered].filter((id) => !diagnosed.has(id) && !abstained.has(id)).length,
    opportunity: evidence.offered.length > 0,
    output:
      evidence.diagnoses.length > 0
        ? {
            offered: evidence.offered.length,
            diagnoses: evidence.diagnoses.length,
            refused: evidence.refused,
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

/** Owners admission feedback routed an admitted epoch finding to, joined on its typed identity. */
function routedOwners(feedback, projected, admitted) {
  if (feedback === null) return null;
  const matches = (item) =>
    projected.findings.some(
      (finding) =>
        item.code === (finding.defect === true ? "defect" : "observation") &&
        item.path === finding.evidence &&
        admitted?.some((hit) => epochFindingKey(hit) === epochFindingKey(finding)),
    );
  const owners = feedback
    .filter((row) => Array.isArray(row.findings) && row.findings.some(matches))
    .map((row) => row.owner)
    .filter((owner) => isString(owner));
  return [...new Set(owners)];
}

function epochRow(campaignDir, runId) {
  const review = readAnalysis(campaignDir, runId, "epoch-review");
  if (review === null) {
    const note = "no epoch-review file";
    return { runId, opportunity: false, output: null, consumer: null, changed: false, status: null, note };
  }
  if (
    review.schema !== EPOCH_REVIEW_SCHEMA ||
    !Array.isArray(review.findings) ||
    !Array.isArray(review.disputes) ||
    !isString(review.condition?.digest)
  ) {
    throw new Error(`${runId}: epoch review is not valid ${EPOCH_REVIEW_SCHEMA}`);
  }
  // Reconstruct the proposed public identities, then join the recorded admission; an incomplete
  // review can still have been admitted, so the projection ignores today's completion rule.
  const projected = publicEpochReview({ ...review, status: "completed" });
  const admission = readAnalysis(campaignDir, runId, "admission");
  const admitted = Array.isArray(admission?.admitted) ? admission.admitted : null;
  const hits = admitted === null ? null : admittedEpochFindings(projected.findings, admitted);
  const issues = adviceIssues(campaignDir, runId);
  const disputes =
    issues === null
      ? null
      : projected.disputes.filter((dispute) =>
          issues.some(
            (issue) =>
              issue.id === dispute.issueId && issue.status === "disputed" && issue.dispute === dispute.reason,
          ),
        ).length;
  const feedback = Array.isArray(admission?.feedback) ? admission.feedback : null;
  const kinds = {};
  for (const finding of projected.findings) {
    const key = `${finding.defect === true ? "defect" : "observation"}/${finding.owner ?? "unowned"}`;
    kinds[key] = (kinds[key] ?? 0) + 1;
  }
  const consumed = (hits ?? 0) + (disputes ?? 0);
  return {
    runId,
    status: review.status,
    conditionDigest: review.condition.digest,
    opportunity: review.status !== "skipped",
    output:
      projected.findings.length + projected.disputes.length > 0
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
              routedOwners: routedOwners(feedback, projected, admitted),
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

function diagnosisReasons(rows) {
  const current = rows.filter((row) => row.opportunity === true);
  if (current.length === 0) return [];
  const diagnosed = current.reduce((sum, row) => sum + row.diagnosed, 0);
  const offered = current.reduce((sum, row) => sum + row.offered, 0);
  return [`current issue readings ${diagnosed}/${offered} offered; advice retention is not repair benefit`];
}

function trialReasons(rows) {
  const rehearsals = rows.reduce((sum, row) => sum + (row.output?.rehearsals ?? 0), 0);
  const notRun = rows.reduce((sum, row) => sum + (row.output?.verdicts?.["not-run"] ?? 0), 0);
  const unrehearsed = rows.filter((row) => row.consumer === null && row.output !== null).length;
  if (rows.length === 0) return [];
  return [
    `rehearsals ${rehearsals} across ${rows.length} epoch(s), not-run ${notRun}; epochs whose accepted submit was never rehearsed: ${unrehearsed}`,
  ];
}

function epochReasons(rows) {
  const statuses = {};
  const perCondition = {};
  let findings = 0;
  let unowned = 0;
  for (const row of rows) {
    if (row.status !== null) statuses[row.status] = (statuses[row.status] ?? 0) + 1;
    if (row.status === "completed") {
      perCondition[row.conditionDigest] = (perCondition[row.conditionDigest] ?? 0) + 1;
    }
    findings += row.output?.findings ?? 0;
    for (const [key, n] of Object.entries(row.output?.kinds ?? {})) {
      if (key.endsWith("/unowned")) unowned += n;
    }
  }
  const tally = Object.entries(statuses).map(([key, n]) => `${key} ${n}`);
  const repeated = Object.values(perCondition).filter((n) => n > 1).length;
  return [
    `statuses: ${tally.join(", ") || "none"}`,
    `measured-iteration findings ${findings}, of which without a proposed owner ${unowned}; actual routes belong to admission feedback, and recurrence to digest block 4d`,
    ...(repeated > 0 ? [`review conditions repeated: ${repeated}`] : []),
  ];
}

const count = (rows, predicate) => rows.reduce((sum, row) => sum + (predicate(row) ? 1 : 0), 0);

function summarise(rows) {
  const unknown = rows.some((row) => row.unknown);
  return {
    iterations: rows.length,
    opportunities: rows.some((row) => row.opportunity === null)
      ? null
      : count(rows, (row) => row.opportunity),
    outputs: unknown ? null : count(rows, (row) => row.output !== null),
    consumed: unknown ? null : count(rows, (row) => row.consumer !== null),
    changed: rows.some((row) => row.changed === null) ? null : count(rows, (row) => row.changed),
  };
}

function verdictFrom(summary) {
  if (summary.opportunities === null || summary.consumed === null) return "unobservable";
  if (summary.opportunities === 0) return "no-opportunity";
  if (summary.changed > 0) return "decision-bearing";
  if (summary.consumed > 0) return "advisory-only";
  return "not-consumed";
}

function collect(rowsOf, reasonsOf) {
  return (campaignDir) => {
    const runs = rowsOf(campaignDir);
    const summary = summarise(runs);
    return { verdict: verdictFrom(summary), summary, reasons: reasonsOf(runs), runs };
  };
}

export const epochReviewer = collect(
  (campaignDir) => iterationRunIds(campaignDir).map((runId) => epochRow(campaignDir, runId)),
  epochReasons,
);
export const diagnosisReader = collect(
  (campaignDir) => iterationRunIds(campaignDir).map((runId) => diagnosisRow(campaignDir, runId)),
  diagnosisReasons,
);
export const harnessTrial = collect(
  (campaignDir) => campaignEpochs(campaignDir).map((epoch) => trialRow(join(campaignDir, epoch))),
  trialReasons,
);

const COMPONENTS = [
  ["epoch-reviewer", epochReviewer, "lanes 12 and 14"],
  ["diagnosis-reader", diagnosisReader, "lane 25"],
  ["harness-trial", harnessTrial, "lane 11"],
];

/** One component's result, or a typed failure row; a component that throws hides no other. */
function componentReport(component, read, readBy, campaignDir) {
  try {
    return { component, readBy, status: "ok", ...read(campaignDir) };
  } catch (error) {
    return {
      component,
      readBy,
      status: "failed",
      verdict: "invalid",
      summary: EMPTY,
      reasons: [errorMessage(error)],
      runs: [],
    };
  }
}

export function buildReviewYield(campaignDir) {
  const components = COMPONENTS.map(([name, read, readBy]) =>
    componentReport(name, read, readBy, campaignDir),
  );
  return {
    schema: REVIEW_YIELD_SCHEMA,
    campaign: campaignDir,
    components,
    complete: components.every((row) => row.status === "ok"),
  };
}

/** The table the primary reviewer reads: one line per component, counts before verdicts. */
export function renderReviewYield(report) {
  const cell = (value) => (value === null ? "?" : String(value));
  const lines = [
    "| component | read first by | iterations | opportunities | outputs | consumed | changed | verdict |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const row of report.components) {
    const s = row.summary;
    lines.push(
      `| ${row.component} | ${row.readBy} | ${cell(s.iterations)} | ${cell(s.opportunities)} | ${cell(s.outputs)} | ${cell(s.consumed)} | ${cell(s.changed)} | ${row.status === "ok" ? row.verdict : row.status} |`,
    );
  }
  for (const row of report.components) {
    for (const reason of row.reasons) lines.push(`- ${row.component}: ${reason}`);
  }
  return `${lines.join("\n")}\n`;
}
