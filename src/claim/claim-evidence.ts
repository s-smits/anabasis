/**
 * What a recorded run may say about itself.
 *
 * Types only: the contract between the producers that record a battery and `claim.ts`, the one
 * writer that turns a battery into a claim. Readers share these shapes so their projections match
 * the claim's input. A clause name is never reused for a different meaning.
 */
import type { GroundingEvidence, TruthGrounding } from "../truth/grounding.ts";
import type { ToolCheckCoverage } from "../truth/grounding-coverage.ts";
import type { DiscriminationClaimabilityFinding } from "./discrimination-claimability.ts";
import type { JudgeDecision, JudgeEvidence, JudgeState } from "./judge.ts";
import type { RuntimeIdentityCaseEvidence } from "./runtime-model-identity.ts";

/** Run-status evidence consumed by `Claim.create()`. Evidence readers return this type, keeping
 *  their projection and the claim's input in agreement. */
export interface RunStatusEvidence {
  state: "provisional" | "interrupted" | "terminal";
  reason: string | null;
  /**
   * Every row that is not a non-result, so an unaccepted attempt counts here: this is the claim's
   * denominator. The outcome view's `cases.verified` is the narrower truth-verified count; the
   * two share a name and must never be summed.
   */
  verified: number;
  nonResults: Record<string, number>;
}

/** Staleness evidence consumed by `Claim.create()`. As with {@link RunStatusEvidence}, readers
 *  use this type directly so their result matches the claim's requirements. */
export interface StalenessEvidence {
  stale: boolean;
  hashes: string[];
}

/** Evidence from executing the control discrimination checks. */
interface DiscriminationEvidence {
  claimable: boolean;
  findings: DiscriminationClaimabilityFinding[];
  /**
   * Reject controls that failed only this check, counted by checkId after execution. This shows
   * the check rejected the designed invalid artifact; it does not prove that a named primitive
   * caused the verdict.
   */
  attributedCheckIds: Record<string, number>;
}

/**
 * Per-check execution counts from a battery. A truth check "fires" when the verifier executes
 * it and returns pass or fail rather than skipping it as inapplicable. The counts detect a
 * declared check that never ran despite applicable verified cases, which a static declaration
 * check such as `tasks-check-unexercised` cannot.
 */
export type TruthCheckFiringEvidence = {
  /**
   * checkId → number of verified cases on which the authored check executed. Includes every
   * declared intrinsic or authored check, with 0 for checks that never ran. External-verifier
   * checks have separate execution counts and grounding clauses. Exception groundings have
   * no executable predicate, so neither category appears in this map.
   */
  firedByCheck: Record<string, number>;
  /**
   * checkId → number of verified cases in which an installed tool ran to completion for
   * this external-verifier check, from the host's own run rows; 0 when no tool ran for it. A
   * count below the verified total reflects applicability, since a verified case whose applicable
   * external check ran no tool is a verifier non-result instead.
   */
  executedByCheck: Record<string, number>;
  /**
   * checkId → number of verified failed cases that failed this check; 0 when it blocked nothing.
   * One check carrying every failure asks whether the public contract states its rule before the
   * failures are read as solver capability.
   */
  blockingByCheck: Record<string, number>;
  /**
   * checkId → number of verified cases the check applied to, for the same authored checks as
   * `firedByCheck`. The never-fired clause reads a check against this denominator, so a check
   * whose applicable cases were all non-results is not blamed.
   */
  applicableByCheck: Record<string, number>;
  /**
   * Verified cases used for these counts: an accepted artifact reached the verifier and received
   * a truth verdict. `runStatus.verified` is broader and also counts unaccepted attempts. The
   * never-fired clause runs only when this count is above zero.
   */
  verifierVerifiedCount: number;
};

/** One improvement-memory prediction with its post-battery classification and closing disposition. */
export interface PredictionItem {
  id: string;
  outcome: "open" | "held" | "refuted" | "inconclusive" | "unexercised";
  disposition?: "repair" | "delete" | "retest";
}

/** The recorded harness's three separate content hashes, matching FingerprintEvidence.
 *  correctnessModelHash excludes tasks.json. Without taskSetHash, changed questions or hidden
 *  expectations could appear to be the same measured condition. */
export interface BundleHashesEvidence {
  agentHash: string;
  correctnessModelHash: string;
  taskSetHash: string;
}

export interface ClaimEvidence {
  runStatus: RunStatusEvidence;
  staleness: StalenessEvidence;
  discrimination: DiscriminationEvidence;
  /** Resolved Built Harness backend pin, e.g. "codex/gpt-5.5", as the battery recorded it. */
  backendPin: string;
  /** Content identity of the frozen decision thresholds used for this battery. */
  thresholdManifestDigest: string;
  /** Provider-reported model and session evidence for scored cases. Claude and Codex have
   *  identity checks; transports without equivalent evidence remain explicitly unverified. */
  runtimeIdentities?: RuntimeIdentityCaseEvidence[] | null;
  /** Resolved Built Harness capabilities, e.g. ["web-search:off"], as the battery recorded them:
   *  the claim states whether web search was available and by which mechanism. */
  capabilities: string[];
  /** Registered prediction record, or null when no improvement-memory sidecar exists for this slug. */
  predictions: PredictionItem[] | null;
  /** Per-check execution counts from the battery. The evaluation runner records them on every
   *  battery, a skipped one included, with every declared check at zero until it fires. */
  truthCheckFiring: TruthCheckFiringEvidence;
  /** Full-census judge aggregate, or the explicit off disclosure. Absence is not a state. */
  judge: JudgeEvidence;
  /** The fingerprinted slug's content addresses. Null blocks: an unfingerprinted slug was never recorded. */
  bundles: BundleHashesEvidence | null;
  /**
   * Declared truth-check groundings (from the validated brief) plus the adapterIds whose
   * external invocations executed this run. Null blocks: external grounding with unnamed evidence
   * sources is unfounded.
   */
  grounding: GroundingEvidence | null;
}

/** One scored case's identity and verdict, excluding typed non-results. */
export interface ScoredCase {
  caseId: string;
  passed: boolean;
  /** True only when accepted artifact bytes reached the correctness model and received a verdict.
   *  Unaccepted attempts remain in the difficulty denominator but have no artifact an external
   *  verifier could have executed. */
  truthVerified: boolean;
  /**
   * The truth checks this case's hidden expectations exercise, so every applicable external check
   * can be required to have execution evidence for this case.
   */
  checkIds: string[];
}

export interface ClaimCreationInput {
  slug: string;
  runId: string;
  evidence: ClaimEvidence;
  /**
   * Per-case verdicts from which n and passed are counted, so impossible counts cannot be
   * supplied. Case ids allow duplicate detection, and the list length must equal
   * `runStatus.verified`.
   */
  score: ScoredCase[];
}

export interface ClaimClause {
  clause: string;
  detail: string;
  /** True when the remedy is in-loop: resume, rerun or prediction closure. */
  repairable: boolean;
}

/**
 * How the solving model's identity is evidenced on this claim. "provider-native": every scored
 * case carries a complete v2 agent runtime session plus provider model/result evidence,
 * matching both segments of the pin.
 * "unverified": some or all of that evidence is absent or mismatched — the pin is configuration,
 * not evidence. Like `isolation: "contractual"`, this makes the assurance level explicit.
 * Claude and Codex identity defects can also add `runtime-model-identity-unproven`. A route
 * that explicitly reports no served-model attestation remains unverified without refusing the
 * scored cases; other transports remain unverified until they provide equivalent evidence.
 */
type ModelIdentityAssurance = "provider-native" | "unverified";

/** Evidence and score fields a created claim must state. */
export interface ClaimStatement {
  slug: string;
  runId: string;
  /** One row per declared external-verifier check: host-recorded runs of its tool on verified
   *  cases of this battery, and the reject controls it blocked. Readiness names a zero-launch row
   *  through the grounding-coverage finding. Empty when no case was verified. */
  externalCheckCoverage: ToolCheckCoverage[];
  n: number;
  passed: number;
  passRate: number;
  /** Verified passes the Judge failed while citing a shown rule; 0 when the Judge was off. The
   *  verifier's pass stands; the reviewer settles each one. */
  vetoed: number;
  backendPin: string;
  thresholdManifestDigest: string;
  /** Independent judge state and exact advisory result. Off is explicit and maps to null. */
  judge: JudgeState;
  judgeDecision: JudgeDecision | null;
  /** Whether backendPin is provider-evidence-proven or configuration-asserted for this score. */
  modelIdentity: ModelIdentityAssurance;
  /** Resolved capabilities available to the Built Harness during measurement. */
  capabilities: string[];
  buildInputsHash: string;
  /** Content hash of the agent bundle that produced the artifacts. */
  agentHash: string;
  /** Content hash of the correctness-model bundle that verified them. */
  correctnessModelHash: string;
  /** Content address of the exact tasks.json and controls.json battery. Kept separate from
   *  correctnessModelHash so task drift and verifier drift remain distinguishable while both
   *  stay claim-pinned. */
  taskSetHash: string;
  /**
   * Correctness-model identity: correctness-model@<correctnessModelHash>. No separate
   * discrimination status is needed: claim creation already requires successful control evidence.
   */
  correctnessModelId: string;
  /** Per-assertion evidence: every truth check's declared grounding kind, and for external
   *  kinds the adapter that executed it — how each blocking assertion is evidenced. */
  groundings: Array<{
    checkId: string;
    kind: TruthGrounding["kind"];
    adapterId: string | null;
    requiredToolIds?: readonly string[];
  }>;
  /** Identity of the installed tools that ran, or null when the run verified purely in-process. */
  verifierEnvironmentHash: string | null;
  /** Host-attested executable identities, sorted by id. Path and executable form do not prove
   *  algorithm independence or attest the complete imported dependency chain. */
  verifierTools: Array<{
    toolId: string;
    source: "workspace-toolchain" | "host";
    kind: "binary" | "script";
    interpreter: string | null;
    digest: string;
  }>;
  /**
   * Exception groundings with their original justifications, so every exception is visible on
   * the claim.
   */
  groundingExceptions: Array<{ checkId: string; justification: string }>;
}
