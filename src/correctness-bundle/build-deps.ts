/**
 * Verification dependencies shared by the build driver and measurement code. `makeProbeSolvability`
 * and `makeVerify` implement these signatures, so both stay checked against what callers consume.
 */
import type { ClaimEvidence, ScoredCase } from "../claim/claim-evidence.ts";
import type { SolvabilityEvidence } from "../claim/readiness.ts";
import type { FingerprintEvidence } from "../claim/fingerprint.ts";
import type { ContractFinding } from "./brief.ts";
import type { VerifierExecutionEvidence } from "./grounding.ts";
import type { OperandCommitmentContext } from "./predicate.ts";
import type { SolvabilityStageCache } from "./solvability-stages.ts";
import type { BuildTask } from "./tasks.ts";

export interface VerificationInput {
  slug: string;
  slugDir: string;
  fingerprint: FingerprintEvidence;
  tasks: BuildTask[];
}

/**
 * The claim-input projection returned for immediate measurement consumers. The same projection
 * is reconstructed from recorded battery bytes at write time; this in-memory copy has no claim
 * authority. Bundle hashes and grounding declarations remain driver-owned additions.
 */
export interface VerificationReport {
  runId: string;
  evidence: Omit<ClaimEvidence, "bundles" | "grounding">;
  /** Per-case identities and verdicts; claim creation derives n/passed — the runner never states counts. */
  score: ScoredCase[];
  /** Verifier-host execution evidence — the only facts that close the external-grounding
   *  clauses. NO_EXTERNAL_EXECUTION when verification was purely in-process. */
  execution: VerifierExecutionEvidence;
}

export interface BuildDeps {
  verify: (input: VerificationInput) => Promise<VerificationReport>;
  /** Run the reference solve for every authored task from the immutable candidate snapshot.
   * The controller independently checks the resulting artifact bytes through the submission
   * path. Every task requires this executable witness before the candidate can be adopted. */
  probeSolvability: (input: {
    slugDir: string;
    fingerprint: FingerprintEvidence;
    /** Ephemeral controller secret shared only with this probe and the caller's re-derivation. */
    operandCommitment: OperandCommitmentContext;
    /** True once the census wall has cut this probe: start no further reference task. */
    stopped?: () => boolean;
    /** Session memory of settled stage results; when absent every stage executes. */
    stages?: SolvabilityStageCache;
  }) => Promise<{ evidence: SolvabilityEvidence | null; findings: ContractFinding[] }>;
}
