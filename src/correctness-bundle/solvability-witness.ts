/** The host-owned evaluation of one constructive witness. */
import { VerifierContractError } from "../../vendor/correctness-model-bundle/contract-error.ts";
import { applicableTruthChecks } from "../../vendor/correctness-model-bundle/evaluation-public-task.ts";
import { parseJsonAs, capturedJsonParse, capturedStructuredClone } from "../meta/json-runtime.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import type { CheckRun, CorrectnessModelResult } from "../verify/correctness-model-result.ts";
import type { VerifierHostHandle } from "../verify/verifier-port.ts";
import { VerifierOperationalStop } from "../verify/verifier-lifetime.ts";
import { type Brief, type GeneratedExecutionClassification, externalChecksOf } from "./brief.ts";
import type { EvaluatorFn } from "./contracts.ts";
import { isAuthoredEvaluatorFailure } from "./evaluator-process.ts";
import {
  checkProgramFailureDetails,
  type CheckFailureDetail,
  type OperandCommitmentContext,
} from "./predicate.ts";
import { commitPublicTask, evaluationPublicTask } from "./task-split.ts";
import type { BuildTask } from "./tasks.ts";
import {
  hostNonResult,
  type UngroundedCheck,
  ungroundedPassChecks,
  ungroundedSentence,
} from "./tool-runs.ts";
import { VerifierExecutionNonResult } from "./verifier-nonresult.ts";

/** One artifact's evaluation result, with host-observed execution failures and protected
 * diagnostics for any failed checks. */
interface EvaluatedWitness {
  result: CorrectnessModelResult | null;
  error: string | null;
  authorClassification: GeneratedExecutionClassification | null;
  predicateFailures: CheckFailureDetail[];
  /** The checks a passing verdict rested on without their tools; the evaluator owns this failure. */
  ungrounded: UngroundedCheck[];
  checkRuns: CheckRun[];
}

/** The fixed condition every witness of one census is evaluated under. */
export interface WitnessCensus {
  brief: Brief;
  verifier: VerifierHostHandle;
  evaluate: EvaluatorFn;
  operandCommitment: OperandCommitmentContext;
}

/** Put one artifact through the generated correctnessModel for one task and say what came back. The
 * verdict itself is only half the answer: the host's own run rows decide the rest, so a
 * correctnessModel that leaves tool runs pending, reports an outage the host never minted or skips
 * the tool a declared external check names returns an error here instead of a passing witness. */
export async function evaluateWitness(
  census: WitnessCensus,
  targetTaskJson: string,
  artifactJson: string,
  subjectId: string,
): Promise<EvaluatedWitness> {
  const { brief } = census;
  const fullTask = parseJsonAs<BuildTask>(targetTaskJson);
  const committed = commitPublicTask(fullTask);
  const artifact = capturedJsonParse(artifactJson);
  // F2 evaluates through the same declared-operand wall the measured battery uses: a witness
  // that only passes because the correctnessModel read an undeclared operand is not a witness that the
  // public path works.
  // One projection for the host subject and the generated evaluate request alike: the host
  // captures and digests it synchronously here, and generated code receives only the clone
  // taken below, so one object cannot leak a mutation between the two.
  const evaluateView = evaluationPublicTask(brief, fullTask, committed.view());
  const scope = census.verifier.openSubject({
    checks: applicableTruthChecks(brief, fullTask),
    runId: null,
    phase: "solvability",
    subjectId,
    attempt: 1,
    artifact,
    publicTask: evaluateView,
    hidden: fullTask.hidden,
  });
  let result: CorrectnessModelResult | null = null;
  let error: string | null = null;
  let authorClassification: GeneratedExecutionClassification | null = null;
  let failure: unknown;
  let pending: number;
  const checkRuns: CheckRun[] = [];
  const predicateRequest = {
    publicTask: evaluateView,
    artifact: capturedJsonParse(artifactJson),
    hidden: capturedStructuredClone(fullTask.hidden),
  };
  try {
    result = await census.evaluate(
      capturedStructuredClone(predicateRequest),
      { tools: scope.port },
      undefined,
      (row) => checkRuns.push(row),
    );
  } catch (caught) {
    if (caught instanceof VerifierOperationalStop) throw caught;
    failure = caught;
    error = errorMessage(caught);
    authorClassification = caught instanceof VerifierContractError ? caught.code : "generated-evaluate-throw";
  } finally {
    pending = (await scope.close()).pendingInvocations;
  }
  const subject = { phase: "solvability" as const, subjectId, attempt: 1 };
  // As in gradeCase, pending calls are an authoring defect. Scope closure cancels queued
  // calls without spawning; their refusal rows must not turn that defect into an outage.
  const hostFailure =
    pending === 0 && !isAuthoredEvaluatorFailure(failure) ? hostNonResult(census.verifier, subject) : null;
  if (hostFailure !== null) throw new VerifierExecutionNonResult(hostFailure);
  if (pending > 0) {
    error = `${pending} tool run(s) were still pending when evaluate returned`;
    authorClassification ??= "generated-correctness-model-pending";
  }
  // R1: a reference that passed a check without running its required tools proves no path.
  const ungrounded = ungroundedPassChecks(
    error === null ? result : null,
    applicableTruthChecks(brief, fullTask).map((check) => check.id),
    externalChecksOf(brief),
    census.verifier.executedBindings(),
    subject,
  );
  if (ungrounded.length > 0) error = ungroundedSentence(ungrounded);

  return {
    result,
    error,
    authorClassification,
    ungrounded,
    checkRuns,
    predicateFailures: checkProgramFailureDetails(
      brief,
      predicateRequest,
      census.operandCommitment,
      result?.checkReceipts ?? [],
    ),
  };
}
