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
import type { BundleFile } from "./feedback-routing.ts";
import type { WorkspaceChange } from "./domain-repo.ts";

export interface BuiltHarness {
  brief: Brief;
  battery: TaskBattery;
  toolsSpec: ToolsSpec;
  corpus: ControlCorpus;
  publicArtifactSchema: PublicArtifactSchema;
  fingerprint: FingerprintEvidence;
  conformance: ConformanceEvidence | null;
}

/** One bundle file the finding holds at fault, or the environment, which no bundle edit repairs. */
export type FeedbackOwner = BundleFile | "environment";

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

/** A current-policy admission packet that seeded no owner, by the digest the build read. Why it
 * seeded none is read from the packet that digest names. Lineage is evidence, never a decision --
 * a build with lineage and no `priorEvidence` takes exactly the same course as one with neither. */
export type AdmissionLineage = { digest: string };

type IterationOutcome = "fingerprinted" | "gates-blocked";

export type IterationEvidence = {
  experimentProposal?: ExperimentSubmission;
  experimentScope?: ExperimentScope;
  ordinal: number;
  dir: string;
  outcome: IterationOutcome;
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
  workspaceChange?: WorkspaceChange;
};

export type CampaignClause =
  | "campaign-binding-mismatch"
  | "improvement-memory-missing"
  | "environment-blocked"
  | "authoring-stalled" // a no-op identity resubmitted to POLICY.loop.noopSubmitStrikes, or one commit recorded unchanged to unchangedCandidateStrikes
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
  | { buildAdmissible: false; clause: CampaignClause; iterations: IterationEvidence[] }
) & { experimentProposal?: ExperimentSubmission };

/** Author-safe finding with its recorded routing severity. */
export type AuthorRepairFinding = ContractFinding & { severity?: CampaignFeedback["severity"] };
