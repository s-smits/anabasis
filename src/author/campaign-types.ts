/** Shared types for the authoring campaign, kept separate from the loop implementation. */
import type { ConformanceEvidence } from "../claim/conformance-evidence.ts";
import type { FingerprintEvidence } from "../claim/fingerprint.ts";
import type { SourceIdentity } from "../run/source-identity.ts";
import type { ExperimentScope } from "../run/experiment-freeze.ts";
import type { PublicArtifactSchema } from "../solve/public-artifact-schema.ts";
import type { Brief, ContractFinding } from "../truth/brief.ts";
import type { ControlCorpus } from "../truth/controls.ts";
import type { TaskBattery } from "../truth/tasks.ts";
import type { ToolsSpec } from "../truth/tools-spec.ts";
import type { ExperimentSubmission } from "./experiment-proposal.ts";
import type { WorkspaceChange } from "./domain-repo.ts";

export type SessionBuildStage =
  | "kickoff"
  | "brief"
  | "tests"
  | "tools-spec"
  | "instructions"
  | "accept-controls"
  | "controls"
  | "correctness-model"
  | "environment"
  | "fingerprint";

export interface BuiltHarness {
  brief: Brief;
  battery: TaskBattery;
  toolsSpec: ToolsSpec;
  corpus: ControlCorpus;
  publicArtifactSchema: PublicArtifactSchema;
  fingerprint: FingerprintEvidence;
  conformance: ConformanceEvidence | null;
}

const FEEDBACK_OWNERS = [
  "brief",
  "tests",
  "instructions",
  "tools-spec",
  "accept-controls",
  "controls",
  "correctness-model",
  "fingerprint",
  "environment",
  "judge",
  "unknown",
] as const;
export type FeedbackOwner = (typeof FEEDBACK_OWNERS)[number];

export type CampaignFeedback = {
  owner: FeedbackOwner;
  severity: "blocking" | "advisory";
  claim: string;
  evidence: string;
  findings?: ContractFinding[];
};

export interface PriorEvidence {
  digest: string;
  feedback: CampaignFeedback[];
  /** Required, so provenance readers need no default. */
  kind: "admitted-packet";
}

export type DiagnosisInput = {
  kind: PriorEvidence["kind"] | "rebuild-advice" | "in-campaign-carry";
  digest: string | null;
};

/** An admission packet that seeded no owner: the digest the build read and why it carried
 *  nothing. Lineage is evidence only and changes no decision. */
export type AdmissionLineage = {
  digest: string;
  /** "evaluation-identity-unadopted": the packet was observed under a correctness model or battery
   *  pair this tree does not have, so its rows stay recorded and select no owner. */
  reason: "no-feedback" | "agenda-consumed" | "evaluation-identity-unadopted";
};

type IterationOutcome = "fingerprinted" | "gates-blocked" | "build-failed";

export type IterationEvidence = {
  experimentProposal?: ExperimentSubmission;
  experimentScope?: ExperimentScope;
  ordinal: number;
  dir: string;
  outcome: IterationOutcome;
  stage: SessionBuildStage | null;
  focusOwner: FeedbackOwner | null;
  attempts: Record<string, number>;
  findingsHash: string | null;
  fingerprint: { agentHash: string; correctnessModelHash: string; taskSetHash: string | null } | null;
  feedback: CampaignFeedback[];
  /** Candidate and installed tools, joined with captured difficulty metadata when present. Always
   *  set before the record is written; a completed record without it is refused. */
  submissionConditionId?: string;
  /** Battery-only authoring's gate identity excludes explanatory metadata from repetition accounting. */
  candidateConditionId?: string;
  consumedEvidenceDigests?: string[];
  /** Present exactly when this iteration read a packet that seeded no owner. */
  admissionLineage?: AdmissionLineage;
  diagnosisInput?: DiagnosisInput | null;
  source?: SourceIdentity | null;
  repairOwner?: FeedbackOwner | null;
  workspaceChange?: WorkspaceChange;
};

export type CampaignClause =
  | "campaign-binding-mismatch"
  | "improvement-memory-missing"
  | "environment-blocked"
  | "authoring-stalled" // a no-op identity resubmitted to POLICY.loop.noopSubmitStrikes, or one diagnosis repeated to stalledFindingsRepeats
  | "repair-unroutable"
  | "carried-battery-unreadable" // a battery exists but cannot be read; do not compare it
  | "carried-exam-drift"
  | "verifier-required"
  | "iterations-exhausted"
  | "no-progress" // a Builder round went STALLED_TURNS turns without a successful tool call; the run may retry the build on the same conversation
  | "budget-limited";

export type CampaignOutcome = (
  | {
      buildAdmissible: true;
      ordinal: number;
      iterationDir: string;
      /** Controller-owned immutable bundleSnapshot used by validation, gates and adoption. */
      acceptedSnapshot: string;
      experimentScope?: ExperimentScope;
      harness: BuiltHarness;
      iterations: IterationEvidence[];
      /** Unchanged-candidate strikes already spent on this candidate's commit, across invocations
       *  and counting this round. */
      unchangedCandidateSubmissions: number;
    }
  | { buildAdmissible: false; clauses: CampaignClause[]; iterations: IterationEvidence[] }
) & { experimentProposal?: ExperimentSubmission };

/** Author-safe finding with its recorded routing severity. */
export type AuthorRepairFinding = ContractFinding & { severity?: CampaignFeedback["severity"] };
