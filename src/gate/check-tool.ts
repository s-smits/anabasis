/**
 * `correctness_check` previews submit without adoption. The validation pipeline
 * (validation-pipeline.ts) runs on the snapshot submit would adopt for these bytes and records each
 * trial's host evidence under `trials/<conditionKey>/`; this file shapes what the Builder is allowed
 * to read of it, and nothing else.
 *
 * It accepts nothing and returns no correctness verdict, because `submit` remains the only
 * acceptance path and the verifier the only correctness owner — a preview that could be read as a
 * verdict would put a second owner on the decision rule 1 gives to one. Rows keep producer order
 * within stage order, the order a refusal keeps, so the same tree produces the same text twice and
 * a Builder comparing two previews is reading its own edit rather than a reordering.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { BuilderCustomToolSemantic } from "../author/builder-execution.ts";
import type { BuiltHarness, CampaignFeedback } from "../author/campaign-types.ts";
import {
  type AuthorCheckStage,
  type BuilderAuthorFeedback,
  FEEDBACK_NAVIGATION,
  authorFindingOverview,
  gateFeedbackFindings,
} from "../builder/author-feedback.ts";
import { visibleError } from "../builder/read-window.ts";
import { existsSync, readFileSync } from "../meta/filesystem.ts";
import { parseJsonAs, capturedJsonStringify } from "../meta/json-runtime.ts";
import { type JsonObject, asRecord, isNumber, isString } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { join } from "../meta/path.ts";
import type { ExperimentOperation } from "../run/experiment-freeze.ts";
import { defineTool } from "../solve/define-tool.ts";
import { type ContractFinding, projectFindingForAuthor } from "../truth/brief.ts";
import { type GateReport, PREVIEW_ATTEMPT_SPENT } from "./validation-pipeline.ts";
import { SOLVABILITY_EVIDENCE_FILE } from "../run/solvability-gate.ts";
import { CENSUS_FILE } from "../run/census-gate.ts";

/** No parameters. The host runs every stage the gate runs; the model chooses no subset. */
const Params = Type.Object({});

interface CorrectnessCheckBinding {
  /** The controller's preview of the current workspace bytes. */
  preview(): Promise<GateReport>;
  /** The ask's battery size, for the coverage summary; its upper bound when `minTasks` opens a range. */
  expectedTasks: number | undefined;
  /** The smallest accepted size when the round leaves the count to the Builder. */
  minTasks?: number;
  /** The same store submit records its refusal into, so `harness_inspect feedback` pages a check's
   *  rows exactly as it pages a refusal's and the Builder has one place to read findings.
   *  `builder-campaign.ts` always binds it; the absent branch below is a test's shape, not a
   *  session's. */
  feedback?: BuilderAuthorFeedback;
}

/** What this tool did not do. It rides every result, including the clear ones, because a validation
 *  sequence that found no blocking row is the easiest evidence in a run to mistake for a passing
 *  verifier: it is long, it is expensive, and it ends in the word the author is hoping for. */
const TRUTH = {
  verdict: "not-run",
  note: "Preview only. Submit runs the same validation sequence on the same snapshot and is the only acceptance path. A clear result does not establish practitioner identity, semantic completeness, adoption, measurement success or claim issuance.",
} as const;

const REPAIR =
  "Read every repair group with harness_inspect feedback, repair the named files, then check the changed tree.";
const CLEAR =
  "The validation sequence found no blocking row on these bytes. Its controls cannot detect an obligation omitted by both the evaluator and the corpus. Reconcile the declared coverage with your public contract using harness_inspect coverage; submit when every obligation has an observation and a one-fact control. Checking unchanged bytes repeats this result without new evidence.";
const REPEATED =
  "the workspace and installed-tool bytes are unchanged: conformance and gate rows are remembered, not re-run; bundle and candidate validation were checked again";
const BLOCKED =
  "This tree produced no reusable check result. Resolve the reported mechanism or change the files, then check or submit again.";

const INCOMPLETE_NAVIGATION =
  "This call produced no complete result, so it replaced nothing: only this page of groups is readable here, and harness_inspect feedback still pages the previous check or submit.";

/** The first sentence names what the call returns, the middle ones what submit would do with this
 *  same tree, and the last what this never does. Nothing here says how to repair anything: the
 *  repair sentence belongs to the result, which knows what was found, and rule 14 gives each duty
 *  one owner rather than repeating it in the tool description as well. */
const DESCRIPTION =
  "Run the pre-adoption validation sequence on the current workspace bytes and read every blocking row a submit would refuse with, the advisory rows the gates recorded without refusing, a receipt for each stage (passed, refused, blocked or not run), and a coverage summary (controls, tasks, check groundings, what the census spent running each check, and F2 cases). " +
  "The stages are the ones submit follows, on the same immutable snapshot submit would adopt: static bundle with installed-tool resolution, candidate validation, generated-tool conformance, then the adoption gates — control census with family isolation and task count, and beside it the F2 solvability census with its representation readers. Every stage that can run reports all of its rows; a bundle refusal stops conformance and the gates, a blocked stage or a generated-runtime non-result stops the stages after it, and a conformance refusal skips F2 but not the census. " +
  "No arguments. Conformance and the gates run once per distinct tree and installed-tool condition: unchanged bytes return the remembered rows, or preview-attempt-spent when that run was blocked or ended without a verdict; the bundle and candidate validation, which reads EXPERIMENT.json, are checked on every call. Changed bytes run again as often as you like. " +
  "It freezes a copy of the workspace when it starts and runs for minutes, so you may keep editing files and running commands in the same message while it runs; the result describes the frozen copy. " +
  "It accepts nothing, charges nothing and returns no correctness verdict. A clear result covers the authored checks and controls, not omitted public obligations; submit remains the only acceptance path.";

/** The rows the Builder reads. A complete result goes into the shared feedback store first, so this
 *  page is not the only way back to them; a blocked or spent call records nothing, which leaves the
 *  stored rows and the codes they carry exactly as the last complete check or refusal left them.
 *  Overwriting them with a partial run would lose the rows the session is working from and replace
 *  them with the ones a broken call happened to reach. */
function stageRows(
  binding: CorrectnessCheckBinding,
  stage: AuthorCheckStage,
  rows: readonly ContractFinding[],
  snapshotId: string | null,
  result: "complete" | "incomplete",
) {
  const delta =
    result === "complete"
      ? (binding.feedback?.recordCheck(stage, rows, snapshotId ?? undefined) ?? null)
      : null;
  const overview = authorFindingOverview(rows);
  const paged =
    binding.feedback === undefined
      ? "No feedback store is bound: only this page of groups is readable here."
      : FEEDBACK_NAVIGATION;
  const navigation =
    result === "incomplete" ? INCOMPLETE_NAVIGATION : rows.length === 0 ? overview.navigation : paged;
  // The same three counts a submit refusal carries. A list of findings says what is wrong now; the
  // counts say what the last edit did to that list, which is the question an author previewing a
  // changed tree is actually asking. They are absent when the sequence did not complete or no
  // feedback store is bound, since there is then no previous check to count against, and a result
  // served from memory carries the `REPEATED` note rather than counts of an edit nobody made.
  const sinceLast =
    delta === null
      ? {}
      : {
          delta,
          sinceLast: `finding codes against the previous check or submit: ${delta.carried} carried over, ${delta.resolved} resolved, ${delta.introduced} new`,
        };
  return { ...overview, navigation, ...sinceLast };
}

function readSealed(path: string): JsonObject | null {
  if (!existsSync(path)) return null;
  try {
    return asRecord(parseJsonAs<unknown>(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}

const asNumber = (value: unknown) => (isNumber(value) ? value : 0);

/**
 * What the census spent running each check, by check id. A row is the candidate's own evaluator
 * running, summed over the whole corpus, so it names no control, task or failure location and
 * crosses the rule 4 boundary as an aggregate over the author's own code.
 *
 * It is reported because the cost is otherwise invisible until it is paid at measurement. Seven
 * checks that each re-run the same nonlinear solver over one design turn every gate call into
 * minutes, and without this row nothing in the result tells the author which check is doing it.
 */
function censusCost(census: JsonObject | null) {
  const rows = Array.isArray(census?.checkCost) ? census.checkCost : [];
  return new Map(
    rows.flatMap((row) => {
      const record = asRecord(row);
      if (!isString(record?.checkId)) return [];
      const seconds = Math.round(asNumber(record.totalMs) / 100) / 10;
      return [
        [
          record.checkId,
          { evaluations: asNumber(record.evaluations), seconds, toolLaunches: asNumber(record.toolLaunches) },
        ],
      ] as const;
    }),
  );
}

/** What the gates covered, composed only from public authoring identities. Verifier output, issue
 *  text and per-task failure locations stay in the protected host files this reads. */
function coverageOf(
  harness: BuiltHarness,
  trialDir: string,
  binding: Pick<CorrectnessCheckBinding, "expectedTasks" | "minTasks">,
) {
  const census = readSealed(join(trialDir, CENSUS_FILE));
  const cost = censusCost(census);
  const evidence = asRecord(readSealed(join(trialDir, SOLVABILITY_EVIDENCE_FILE))?.evidence);
  const cases = Array.isArray(evidence?.cases) ? evidence.cases : null;
  const tally = (status: string) => (cases ?? []).filter((row) => asRecord(row)?.status === status).length;
  return {
    controls: { accept: harness.corpus.accept.length, reject: harness.corpus.reject.length },
    tasks: {
      authored: harness.battery.tasks.length,
      expected: binding.expectedTasks ?? null,
      atLeast: binding.minTasks ?? binding.expectedTasks ?? null,
    },
    checks: harness.brief.truthChecks.map((check) => ({
      id: check.id,
      evidence: check.execution.evidence,
      censusCost: cost.get(check.id) ?? null,
    })),
    censusFindings: Array.isArray(census?.findings) ? census.findings.length : null,
    solvability:
      cases === null
        ? { ran: false as const }
        : { ran: true as const, cases: cases.length, passed: tally("passed"), failed: tally("failed") },
  };
}

/** What these bytes moved against the adopted product, so a broader move is visible before submit. */
function measuredAs({
  operation,
  moved,
  unproven,
  correctnessModelChangedFiles,
}: ExperimentOperation): string {
  if (unproven !== undefined) {
    return `new-baseline: ${unproven}, so no comparison with the adopted product is certified`;
  }
  const what = moved.length === 0 ? "nothing" : moved.join(" and ");
  const basis =
    correctnessModelChangedFiles === undefined
      ? ""
      : `; correctness-model files changed: ${capturedJsonStringify(correctnessModelChangedFiles)}. The scoring program is brief.json plus evaluator.ts with every module it imports; a changed file outside it, such as a reference solve or test, moves no scoring`;
  return `${operation}: these bytes moved ${what} against the adopted product${operation === "new-baseline" ? "; a new baseline carries no attributable-improvement claim" : ""}${basis}`;
}

/**
 * The rows the gates recorded without refusing, read the way a refusal's rows are read.
 *
 * They arrived as a count. An advisory names something only the author can weigh — an accept corpus
 * that re-states the reference, a representation reading the census will not block on — and a
 * number said one existed with nowhere to read it: the feedback store holds the last refusal, and a
 * candidate that clears the gates ends the session on the spot.
 *
 * It crosses through the same two functions a refusal's rows cross through, so rule 7 decides this
 * boundary exactly as it decides that one. A controller-validated finding keeps its detail, an
 * unmarked one arrives as `generated-execution-unclassified`, and a row carrying no findings at all
 * arrives as the name of the gate that wrote it and nothing more.
 */
function advisoryOf(feedback: readonly CampaignFeedback[]) {
  const rows = feedback.filter((row) => row.severity !== "blocking");
  const findings = gateFeedbackFindings(rows).map(projectFindingForAuthor);
  return { rows: rows.length, findings: findings.map(({ code, path, detail }) => ({ code, path, detail })) };
}

function resultOf(binding: CorrectnessCheckBinding, report: GateReport) {
  const rows = report.refusals.flatMap((refusal) => refusal.findings);
  const stage = report.blocked?.stage ?? report.refusals[0]?.stage ?? "gates";
  const found = rows.length > 0 ? ("findings" as const) : ("clear" as const);
  const status = report.blocked === null ? found : ("blocked" as const);
  const { gated, harness } = report;
  return {
    status,
    stage,
    snapshotId: report.snapshotId,
    ...keyIfDefined(
      "measuredAs",
      report.experiment === undefined ? undefined : measuredAs(report.experiment),
    ),
    ...keyIfDefined("error", report.blocked === null ? undefined : visibleError(report.blocked.cause)),
    findings: stageRows(
      binding,
      stage,
      rows,
      report.snapshotId,
      report.blocked === null && report.attemptSpent !== true ? "complete" : "incomplete",
    ),
    stages: report.receipts,
    notReached: report.receipts
      .filter((receipt) => receipt.status === "not-run")
      .map((receipt) => receipt.stage),
    ...keyIfDefined("advisory", gated === null ? undefined : advisoryOf(gated.feedback)),
    ...keyIfDefined(
      "coverage",
      gated === null || harness === null ? undefined : coverageOf(harness, gated.trialDir, binding),
    ),
    ...keyIfDefined("repeated", report.repeated === true ? REPEATED : undefined),
    nextAction: status === "blocked" ? BLOCKED : status === "findings" ? REPAIR : CLEAR,
    truth: TRUTH,
  };
}

/** Why this call ended as it did, for the durable receipt. */
function receiptReason(body: ReturnType<typeof resultOf>): string {
  if (body.status === "blocked") return "blocked";
  if (body.repeated !== undefined) return "remembered";
  if (body.findings.groups.some((group) => group.code.text === PREVIEW_ATTEMPT_SPENT.code)) {
    return "preview-attempt-spent";
  }
  return body.status === "clear" ? "clear" : `refused-${body.stage}`;
}

export function createCorrectnessCheckTool(binding: CorrectnessCheckBinding): AgentTool<typeof Params> {
  return defineTool({
    name: "correctness_check",
    label: "Correctness check",
    description: DESCRIPTION,
    parameters: Params,
    executionMode: "sequential",
    run: async () => {
      const body = resultOf(binding, await binding.preview());
      const receipt: BuilderCustomToolSemantic = {
        outcome: body.status,
        stage: body.stage,
        findings: body.findings.totalFindings,
        reason: receiptReason(body),
        ...keyIfDefined("candidateId", body.snapshotId ?? undefined),
        ...keyIfDefined("repeated", body.repeated === undefined ? undefined : true),
        ...body.findings.delta,
      };
      return {
        text: capturedJsonStringify(body),
        details: { status: body.status, stage: body.stage, receipt },
      };
    },
  });
}
