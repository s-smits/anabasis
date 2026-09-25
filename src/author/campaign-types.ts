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
import type { ExperimentSubmission } from "./experiment-plan.ts";
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

// Every owner here must be one some route can actually select. `routableOwnerOf` returns a key of
// `OWNER_FILES` or null, so an owner absent from that table can only arrive as a literal, and two
// that arrived neither way -- `judge` and `unknown` -- have gone. An owner nothing produces still
// widens every exhaustive switch over this type and still reads to the next author as a route that
// exists, which is the cost a closed set is supposed to avoid paying.
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
  /** Required, so the two provenance readers are plain field picks. While it was optional, each
   *  reader carried its own `?? "admitted-packet"` default, and two copies of a default drift. */
  kind: "admitted-packet";
}

export type DiagnosisInput = {
  kind: PriorEvidence["kind"] | "rebuild-advice" | "in-campaign-carry";
  digest: string | null;
};

/** A current-policy admission packet that seeded no owner: the digest the build read and the
 * reason it carried nothing. Lineage is evidence, never a decision -- a build with lineage and no
 * `priorEvidence` takes exactly the same course as one with neither. */
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
  /** Candidate and installed tools, joined with captured difficulty metadata when present.
   *  `stampSubmissionCondition` sets it before the record is written, so a completed record without
   *  it is refused rather than read as a condition nobody stamped. */
  submissionConditionId?: string;
  /** Battery-only authoring's gate identity excludes explanatory metadata from repetition accounting. */
  candidateConditionId?: string;
  consumedEvidenceDigests?: string[];
  /** Present exactly when this iteration read a current-policy packet that seeded no owner, so a
   * review can tell an unseeded build from one that had no packet at all. */
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
  | "authoring-stalled" // a no-op identity resubmitted to POLICY.loop.noopSubmitStrikes, or one commit recorded unchanged to unchangedCandidateStrikes
  | "repair-unroutable"
  | "carried-battery-unreadable" // a battery exists but cannot be read; do not compare it
  | "carried-exam-drift"
  // Gate audit 2026-09-25 (docs/gate-audit.md, tool-non-result-ceiling): commented out (unsure): a tool that cannot run is an environment fact each run records, not a Builder stall
  // | "verifier-required"
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
      /** Strikes already spent on the commit this candidate carries, counting this round: the
       *  durable per-commit unchanged tally the campaign replayed from disk, extended by this
       *  invocation's own iterations. The round reads it when the candidate turns out to equal its
       *  own round entry, so the ceiling is reached at the same total whether the strikes fell
       *  inside one invocation or across fourteen. */
      unchangedCandidateSubmissions: number;
    }
  | { buildAdmissible: false; clauses: CampaignClause[]; iterations: IterationEvidence[] }
) & { experimentProposal?: ExperimentSubmission };

/** Author-safe finding with its recorded routing severity. */
export type AuthorRepairFinding = ContractFinding & { severity?: CampaignFeedback["severity"] };
