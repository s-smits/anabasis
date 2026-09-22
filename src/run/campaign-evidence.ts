/**
 * Shared metadata for controller iteration evidence. Build and climb record the same fields
 * into NN-slug/iteration.json, and downstream readers glob that layout across both experiment
 * kinds, so the two controllers must not re-implement the rule.
 *
 * Diagnosis provenance is the same for both: any later iteration, or a first one resuming carried
 * campaign memory, names in-campaign-carry; otherwise the declared diagnosis input, then the
 * admitted-packet digest.
 */
import type {
  AdmissionLineage,
  DiagnosisInput,
  FeedbackOwner,
  IterationEvidence,
  PriorEvidence,
  BuiltHarness,
} from "../author/campaign-types.ts";
import { SOURCE_IDENTITY } from "./source-identity.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { keysIf } from "../meta/optional-key.ts";
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
    repairOwner: FeedbackOwner | null;
    workspaceChange: NonNullable<IterationEvidence["workspaceChange"]>;
    declaredDiagnosis?: DiagnosisInput;
    priorEvidence?: PriorEvidence;
    admissionLineage?: AdmissionLineage;
  },
): IterationEvidence {
  const {
    first,
    hasResumedCarry,
    repairOwner,
    workspaceChange,
    declaredDiagnosis,
    priorEvidence,
    admissionLineage,
  } = input;
  const decorated: IterationEvidence = {
    ...evidence,
    source: SOURCE_IDENTITY,
    repairOwner,
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
 * The candidate's bytes alone identify the condition, until the Builder proposes an experiment
 * over them: a proposal is part of what the round is asking, so it joins the identity, and the
 * bytes keep their own id beside it under `candidateConditionId`. The experiment scope is the
 * separate question of what the proposal is allowed to have moved, which only a round opened with
 * a declared experiment asks.
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
  const proposal = candidate.experimentProposal;
  evidence.submissionConditionId = conditionKey(candidate);
  if (proposal !== undefined) {
    evidence.experimentProposal = proposal;
    evidence.submissionConditionId = hashJsonValue({
      candidate: conditionKey(candidate),
      experimentProposal: proposal.digest,
    });
    evidence.candidateConditionId = conditionKey(candidate);
  }
  if (round.experiment === undefined) return;
  evidence.experimentScope = {
    ...candidateExperimentScope(
      round.experiment,
      round.adoptedDir,
      candidate.snapshotDir,
      harness.conformance,
      proposal?.scope,
    ),
    ...keysIf(proposal !== undefined, () => ({
      operation: experimentOperation(candidate, round.adoptedDir),
    })),
  };
}
