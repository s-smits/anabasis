/**
 * Shared metadata for controller iteration evidence. Build and climb record the same fields
 * into NN-slug/iteration.json, and downstream readers glob that layout across both experiment
 * kinds, so the two controllers must not re-implement the rule.
 *
 * Diagnosis provenance follows the build rule for both: any later iteration, or a first one
 * resuming carried campaign memory, names in-campaign-carry; otherwise the declared diagnosis
 * input, and only then the admitted-packet digest. Spelling it twice let the climb record null for
 * a later pass whose owner went unrouted and ignore carried memory on a first pass, so a resumed
 * climb and an equivalent resumed build recorded different provenance for the same situation, and
 * a reader could not compare them.
 */
import type {
  AdmissionLineage,
  DiagnosisInput,
  IterationEvidence,
  PriorEvidence,
  BuiltHarness,
} from "../author/campaign-types.ts";
import { SOURCE_IDENTITY } from "./source-identity.ts";
import { type CandidateSnapshot, conditionKey } from "../author/candidate-check.ts";
import { experimentOperation } from "../gate/experiment-admission.ts";
import { candidateExperimentScope } from "./experiment-freeze.ts";
import type { HarnessAuthoring } from "../critic/types.ts";

export function decorateIterationEvidence(
  evidence: IterationEvidence,
  input: {
    first: boolean;
    /** Whether the invocation resumed any campaign feedback (`memory.carried`). */
    hasResumedCarry: boolean;
    workspaceChange: NonNullable<IterationEvidence["workspaceChange"]>;
    declaredDiagnosis?: DiagnosisInput;
    priorEvidence?: PriorEvidence;
    admissionLineage?: AdmissionLineage;
  },
): IterationEvidence {
  const { first, hasResumedCarry, workspaceChange, declaredDiagnosis, priorEvidence, admissionLineage } =
    input;
  const decorated: IterationEvidence = {
    ...evidence,
    source: SOURCE_IDENTITY,
    workspaceChange,
    diagnosisInput:
      !first || hasResumedCarry
        ? { kind: "in-campaign-carry", digest: null }
        : (declaredDiagnosis ??
          (priorEvidence === undefined ? null : { kind: priorEvidence.kind, digest: priorEvidence.digest })),
  };
  if (first && priorEvidence !== undefined) decorated.consumedEvidenceDigests = [priorEvidence.digest];
  else if (first && admissionLineage !== undefined) decorated.admissionLineage = admissionLineage;
  return decorated;
}

/** The submission condition an iteration was measured under, stamped onto its evidence.
 *
 * The candidate's bytes alone identify the condition, and what the bytes moved against the adopted
 * product is derived from them on every continuation.
 *
 * Held here beside `decorateIterationEvidence` because both answer one question — what this
 * iteration's record says about itself — and the build and climb controllers must not each carry
 * their own version of it.
 */
export function stampSubmissionCondition(
  evidence: IterationEvidence,
  candidate: CandidateSnapshot,
  harness: BuiltHarness,
  round: { experiment?: HarnessAuthoring; adoptedDir?: string },
): void {
  evidence.submissionConditionId = conditionKey(candidate);
  if (round.experiment === undefined) return;
  evidence.experimentScope = {
    ...candidateExperimentScope(round.adoptedDir, candidate.snapshotDir, harness.conformance),
    operation: experimentOperation(candidate, round.adoptedDir),
  };
}
