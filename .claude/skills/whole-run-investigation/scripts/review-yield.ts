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
import type { EpochReviewEvidence } from "#src/review/epoch-review-findings.ts";
import { REBUILD_ADVICE_SCHEMA } from "#src/author/rebuild-advice.ts";
import { campaignEpochs } from "#src/author/campaign-epoch.ts";
import type { BuilderExecutionEvidence } from "#src/author/builder-execution.ts";
import { readExecutionEvidenceDetails } from "#tools/outcome/builder-execution-facts.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { asRecord, isRecord, isString } from "#src/meta/json-shape.ts";
import type { JsonValue } from "#src/meta/json-shape.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { DIAGNOSIS_READING_SCHEMA } from "#src/review/diagnosis-reader.ts";
import { readJsonAsOrNull } from "./run-overview.ts";

/** One rebuild-advice issue, as far as this reader looks into it. */
interface AdviceIssue {
  id?: JsonValue;
  status?: JsonValue;
  dispute?: JsonValue;
  diagnosis?: JsonValue;
}

interface AdvicePacket {
  schema?: JsonValue;
  issues?: AdviceIssue[];
}

interface DiagnosisReadingRow {
  issueIds?: JsonValue;
  diagnosis?: JsonValue;
}

interface DiagnosisEvidence {
  schema?: JsonValue;
  offered?: JsonValue[];
  diagnoses?: DiagnosisReadingRow[];
  abstentions?: JsonValue[];
  refused?: JsonValue;
}

interface EpochReviewFile
  extends Partial<Pick<EpochReviewEvidence, "status" | "findings" | "disputes" | "contestedReads">> {
  schema?: JsonValue;
  condition?: { digest?: JsonValue } | null;
  coverage?: { opened?: JsonValue } | null;
}

interface FeedbackItem {
  code?: JsonValue;
  path?: JsonValue;
}

interface FeedbackRow {
  owner?: JsonValue;
  findings?: FeedbackItem[];
}

interface AdmissionFile {
  admitted?: JsonValue[];
  feedback?: FeedbackRow[];
}

type ProjectedReview = ReturnType<typeof publicEpochReview>;
type ProjectedFinding = ProjectedReview["findings"][number];

interface TrialCall {
  sequence: number;
  candidateId: string | null;
  verdict: string | null;
}

interface SubmitCall {
  sequence: number;
  candidateId: string | null;
}

interface TrialCalls {
  trials: TrialCall[];
  submits: SubmitCall[];
}

/** Where a component's output was found consumed: the file, the field and what it held there. */
export interface YieldConsumer {
  path: string;
  field: string;
  value: JsonValue | object;
}

/** What every component row carries, whatever else it reports. */
export interface YieldRow {
  runId: string;
  opportunity: boolean | null;
  output: object | null;
  consumer: YieldConsumer | null;
  changed: boolean | null;
  unknown?: boolean;
  note: string;
}

/** One epoch's rehearsal use. */
export interface TrialRow extends YieldRow {
  output: { rehearsals: number; verdicts: Record<string, number> } | null;
}

/** A measured iteration whose diagnosis evidence was read. */
export interface DiagnosisRow extends YieldRow {
  offered: number;
  diagnosed: number;
  abstained: number;
  unresolved: number;
  opportunity: boolean;
  output: { offered: number; diagnoses: number; refused: JsonValue | undefined } | null;
}

/** A measured iteration with no diagnosis evidence to read. */
export interface DiagnosisGap extends YieldRow {
  opportunity: null;
  output: null;
}

/** A measured iteration with no epoch-review file. */
export interface EpochGap extends YieldRow {
  opportunity: false;
  output: null;
  status: null;
}

/** A measured iteration's epoch review, joined to its admission and advice. */
export interface EpochRow extends YieldRow {
  status: EpochReviewEvidence["status"] | undefined;
  conditionDigest: string;
  opportunity: boolean;
  output: { findings: number; kinds: Record<string, number>; disputes: number; opened: JsonValue } | null;
}

/** A component's counts over its rows. */
export interface YieldSummary {
  iterations: number;
  opportunities: number | null;
  outputs: number | null;
  consumed: number | null;
  changed: number | null;
}

/** One component's verdict, summary, reasons and rows. */
export interface ComponentYield<R extends YieldRow> {
  verdict: string;
  summary: YieldSummary;
  reasons: string[];
  runs: R[];
}

type ComponentRead = (campaignDir: string) => ComponentYield<YieldRow>;

/** One component's report, or the typed failure row that stands in for it. */
export type ComponentReport =
  | ({ component: string; readBy: string; status: "ok" } & ComponentYield<YieldRow>)
  | {
      component: string;
      readBy: string;
      status: "failed";
      verdict: "invalid";
      summary: typeof EMPTY;
      reasons: string[];
      runs: never[];
    };

/** The whole review-yield report. */
export interface ReviewYield {
  schema: string;
  campaign: string;
  components: ComponentReport[];
  complete: boolean;
}

export const REVIEW_YIELD_SCHEMA = "wri-review-yield-report/v1";
const EMPTY = { iterations: null, opportunities: null, outputs: null, consumed: null, changed: null };

/** Iteration run ids ordered by `-analysis.json` modification time, then id. */
function iterationRunIds(campaignDir: string): string[] {
  const dir = join(campaignDir, "analysis");
  if (!existsSync(dir)) return [];
  const suffix = "-analysis.json";
  return readdirSync(dir)
    .filter((name) => name.endsWith(suffix))
    .map((name) => ({ runId: name.slice(0, -suffix.length), at: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => a.at - b.at || a.runId.localeCompare(b.runId))
    .map((entry) => entry.runId);
}

const readAnalysis = <T>(campaignDir: string, runId: string, kind: string): T | null =>
  readJsonAsOrNull<T>(join(campaignDir, "analysis", `${runId}-${kind}.json`));

/** The advice packet's issues under the current schema, or null when none is readable. */
function adviceIssues(campaignDir: string, runId: string): AdviceIssue[] | null {
  const packet = readAnalysis<AdvicePacket>(campaignDir, runId, "rebuild-advice");
  return packet?.schema === REBUILD_ADVICE_SCHEMA && Array.isArray(packet.issues) ? packet.issues : null;
}

/** A finding's producer-owned identity: its owner, whether it is a defect, and the evidence file it
 *  cites. The public claim sentence is written at admission time, so another revision of that
 *  projection words the same admitted finding differently; joining on it would report the finding
 *  as not consumed. */
function epochFindingKey(finding: JsonValue | ProjectedFinding): string | null {
  if (!isRecord(finding)) return null;
  return JSON.stringify([finding.owner ?? null, finding.defect ?? null, finding.evidence ?? null]);
}

/** Multiplicity-aware: two findings may share a key, and each admitted row is consumed once. */
function admittedEpochFindings(
  projected: readonly ProjectedFinding[],
  admitted: readonly JsonValue[],
): number {
  const pool: (string | null)[] = admitted.flatMap((hit) => {
    const key = epochFindingKey(hit);
    return key === null ? [] : [key];
  });
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
function trialCalls(record: BuilderExecutionEvidence): TrialCalls {
  const calls = Array.isArray(record.customCalls) ? record.customCalls : [];
  const trials: TrialCall[] = [];
  const submits: SubmitCall[] = [];
  for (const call of calls) {
    if (!isRecord(call)) continue;
    const semantic = isRecord(call.semantic) ? call.semantic : undefined;
    const candidateId = isString(semantic?.candidateId) ? semantic.candidateId : null;
    if (call.tool === "harness_trial") {
      trials.push({ sequence: call.sequence, candidateId, verdict: semantic?.truthVerdict ?? null });
    } else if (call.tool === "submit" && semantic?.outcome === "accepted") {
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
function trialRow(epochDir: string): TrialRow {
  const epoch = basename(epochDir);
  const read = readExecutionEvidenceDetails(epochDir);
  if (read.unavailable.length > 0) throw new Error(`${epoch}: ${read.unavailable.join("; ")}`);
  // The tasks the epoch's workspace battery declares are the rehearsal opportunity.
  const tasks = readJsonFileOrNull(join(epochDir, "workspace", "correctness-model", "tasks.json"));
  const listed = asRecord(tasks)?.tasks;
  const rows = Array.isArray(tasks) ? tasks : Array.isArray(listed) ? listed : null;
  const opportunities = rows === null ? null : rows.length;
  const trials: TrialCall[] = [];
  const submits: SubmitCall[] = [];
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
  const verdicts: Record<string, number> = {};
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
function diagnosisRow(campaignDir: string, runId: string): DiagnosisRow | DiagnosisGap {
  const evidence = readAnalysis<DiagnosisEvidence>(campaignDir, runId, "diagnoses");
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
  const { offered: offeredIds, diagnoses, abstentions } = evidence;
  if (
    evidence.schema !== DIAGNOSIS_READING_SCHEMA ||
    !Array.isArray(offeredIds) ||
    !Array.isArray(diagnoses) ||
    !Array.isArray(abstentions)
  ) {
    throw new Error(`${runId}: diagnosis evidence is not ${DIAGNOSIS_READING_SCHEMA}`);
  }
  const issues = adviceIssues(campaignDir, runId);
  const offered = new Set(offeredIds);
  // One reading may cover several issues, so coverage is counted in issues, not in readings, and
  // only over the issues the reader was actually offered.
  const offeredIn = (row: JsonValue | DiagnosisReadingRow): JsonValue[] =>
    isRecord(row) && Array.isArray(row.issueIds) ? row.issueIds.filter((id) => offered.has(id)) : [];
  const diagnosed = new Set(diagnoses.flatMap(offeredIn));
  const abstained = new Set<JsonValue>();
  for (const id of abstentions.flatMap(offeredIn)) {
    if (!diagnosed.has(id)) abstained.add(id);
  }
  // Retained means the advice carries the reader's own diagnosis bytes under that issue; a
  // reworded or re-attributed diagnosis is another reading, not this one consumed.
  const retained = (row: DiagnosisReadingRow, advice: readonly AdviceIssue[]): JsonValue[] => {
    if (!isRecord(row.diagnosis) || row.diagnosis.runId !== runId) return [];
    const digest = hashJsonValue(row.diagnosis);
    return offeredIn(row).filter((id) =>
      advice.some(
        (issue) => issue.id === id && isRecord(issue.diagnosis) && hashJsonValue(issue.diagnosis) === digest,
      ),
    );
  };
  const attached = issues === null ? null : diagnoses.flatMap((row) => retained(row, issues)).length;
  return {
    runId,
    offered: offeredIds.length,
    diagnosed: diagnosed.size,
    abstained: abstained.size,
    unresolved: [...offered].filter((id) => !diagnosed.has(id) && !abstained.has(id)).length,
    opportunity: offeredIds.length > 0,
    output:
      diagnoses.length > 0
        ? {
            offered: offeredIds.length,
            diagnoses: diagnoses.length,
            refused: evidence.refused,
          }
        : null,
    consumer:
      attached !== null && attached > 0
        ? { path: `analysis/${runId}-rebuild-advice.json`, field: "issues[].diagnosis", value: { attached } }
        : null,
    changed: offeredIds.length > 0 ? null : false,
    unknown: issues === null && diagnoses.length > 0,
    note:
      attached === null
        ? "advice unavailable; diagnosis consumption unobservable"
        : `${attached} diagnosis reading(s) retained in rebuild advice; Builder use and repair benefit require later evidence`,
  };
}

/** Owners admission feedback routed an admitted epoch finding to, joined on its typed identity. */
function routedOwners(
  feedback: readonly FeedbackRow[] | null,
  projected: ProjectedReview,
  admitted: readonly JsonValue[] | null,
): string[] | null {
  if (feedback === null) return null;
  const matches = (item: FeedbackItem): boolean =>
    projected.findings.some(
      (finding) =>
        item.code === (finding.defect === true ? "defect" : "observation") &&
        item.path === finding.evidence &&
        admitted?.some((hit) => epochFindingKey(hit) === epochFindingKey(finding)) === true,
    );
  const owners = feedback
    .filter((row) => Array.isArray(row.findings) && row.findings.some(matches))
    .flatMap((row) => (isString(row.owner) ? [row.owner] : []));
  return [...new Set(owners)];
}

function epochRow(campaignDir: string, runId: string): EpochRow | EpochGap {
  const review = readAnalysis<EpochReviewFile>(campaignDir, runId, "epoch-review");
  if (review === null) {
    const note = "no epoch-review file";
    return { runId, opportunity: false, output: null, consumer: null, changed: false, status: null, note };
  }
  const { findings, disputes } = review;
  const digest = review.condition?.digest;
  if (
    review.schema !== EPOCH_REVIEW_SCHEMA ||
    !Array.isArray(findings) ||
    !Array.isArray(disputes) ||
    !isString(digest)
  ) {
    throw new Error(`${runId}: epoch review is not valid ${EPOCH_REVIEW_SCHEMA}`);
  }
  // Reconstruct the proposed public identities, then join the recorded admission; an incomplete
  // review can still have been admitted, so the projection ignores today's completion rule.
  const projected = publicEpochReview({ ...review, findings, disputes, status: "completed" });
  const admission = readAnalysis<AdmissionFile>(campaignDir, runId, "admission");
  const admitted = Array.isArray(admission?.admitted) ? admission.admitted : null;
  const hits = admitted === null ? null : admittedEpochFindings(projected.findings, admitted);
  const issues = adviceIssues(campaignDir, runId);
  const disputed =
    issues === null
      ? null
      : projected.disputes.filter((dispute) =>
          issues.some(
            (issue) =>
              issue.id === dispute.issueId && issue.status === "disputed" && issue.dispute === dispute.reason,
          ),
        ).length;
  const feedback = Array.isArray(admission?.feedback) ? admission.feedback : null;
  const kinds: Record<string, number> = {};
  for (const finding of projected.findings) {
    const key = `${finding.defect === true ? "defect" : "observation"}/${finding.owner ?? "unowned"}`;
    kinds[key] = (kinds[key] ?? 0) + 1;
  }
  const consumed = (hits ?? 0) + (disputed ?? 0);
  return {
    runId,
    status: review.status,
    conditionDigest: digest,
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
              disputedIssues: disputed,
              advicePath: `analysis/${runId}-rebuild-advice.json`,
            },
          }
        : null,
    changed: review.status === "skipped" ? false : null,
    unknown:
      (projected.findings.length > 0 && admitted === null) ||
      (projected.disputes.length > 0 && issues === null),
    note: `${hits ?? "unknown"} public finding(s) admitted; ${disputed ?? "unknown"} issue dispute(s) retained; repair benefit unmeasured`,
  };
}

function diagnosisReasons(rows: readonly (DiagnosisRow | DiagnosisGap)[]): string[] {
  const current = rows.filter((row): row is DiagnosisRow => row.opportunity === true);
  if (current.length === 0) return [];
  const diagnosed = current.reduce((sum, row) => sum + row.diagnosed, 0);
  const offered = current.reduce((sum, row) => sum + row.offered, 0);
  return [`current issue readings ${diagnosed}/${offered} offered; advice retention is not repair benefit`];
}

function trialReasons(rows: readonly TrialRow[]): string[] {
  const rehearsals = rows.reduce((sum, row) => sum + (row.output?.rehearsals ?? 0), 0);
  const notRun = rows.reduce((sum, row) => sum + (row.output?.verdicts["not-run"] ?? 0), 0);
  const unrehearsed = rows.filter((row) => row.consumer === null && row.output !== null).length;
  if (rows.length === 0) return [];
  return [
    `rehearsals ${rehearsals} across ${rows.length} epoch(s), not-run ${notRun}; epochs whose accepted submit was never rehearsed: ${unrehearsed}`,
  ];
}

function epochReasons(rows: readonly (EpochRow | EpochGap)[]): string[] {
  const statuses: Record<string, number> = {};
  const perCondition: Record<string, number> = {};
  let findings = 0;
  let unowned = 0;
  for (const row of rows) {
    if (row.status !== null) {
      const status = String(row.status);
      statuses[status] = (statuses[status] ?? 0) + 1;
    }
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

const count = (rows: readonly YieldRow[], predicate: (row: YieldRow) => boolean | null): number =>
  rows.reduce((sum, row) => sum + (predicate(row) === true ? 1 : 0), 0);

function summarise(rows: readonly YieldRow[]): YieldSummary {
  const unknown = rows.some((row) => row.unknown === true);
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

function verdictFrom(summary: YieldSummary): string {
  if (summary.opportunities === null || summary.consumed === null) return "unobservable";
  if (summary.opportunities === 0) return "no-opportunity";
  if (summary.changed !== null && summary.changed > 0) return "decision-bearing";
  if (summary.consumed > 0) return "advisory-only";
  return "not-consumed";
}

function collect<R extends YieldRow>(
  rowsOf: (campaignDir: string) => R[],
  reasonsOf: (rows: R[]) => string[],
): (campaignDir: string) => ComponentYield<R> {
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

const COMPONENTS: readonly (readonly [string, ComponentRead, string])[] = [
  ["epoch-reviewer", epochReviewer, "lanes 12 and 14"],
  ["diagnosis-reader", diagnosisReader, "lane 25"],
  ["harness-trial", harnessTrial, "lane 11"],
];

/** One component's result, or a typed failure row; a component that throws hides no other. */
function componentReport(
  component: string,
  read: ComponentRead,
  readBy: string,
  campaignDir: string,
): ComponentReport {
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

export function buildReviewYield(campaignDir: string): ReviewYield {
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
export function renderReviewYield(report: ReviewYield): string {
  const cell = (value: number | null): string => (value === null ? "?" : String(value));
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
