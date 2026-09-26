/**
 * What a recorded run may say about itself.
 *
 * Every type here describes evidence a producer wrote down, and nothing in this module executes:
 * it is the contract between the producers that record a battery and `claim.ts`, the one writer
 * that turns a battery into a claim.
 *
 * Several modules read this vocabulary without ever writing a claim — the verification runner, the
 * build dependency reader, the battery record, the battery facts reader and the battery run
 * evidence projection — so defining the shapes here keeps their projections and the claim's input
 * in agreement, with no runtime dependency in either direction. `claim.ts` is the only consumer
 * that also decides anything. A clause name is never recycled for a different meaning: an older
 * record stays recognisable only while the words in it still mean what they meant.
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
  /** Every row that is not a non-result, so an unaccepted attempt counts here: this is the claim's
   *  denominator. The outcome view's `cases.verified` is the narrower truth-verified count; the two
   *  share a name and must never be summed. */
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
   * Reject controls that failed only this check, counted by checkId after execution. For an
   * in-process primitive this establishes that the check rejected the designed invalid artifact;
   * no separate host tool call attests it, because the primitive and the correctness model share a
   * process, and an import or a source pattern alone could not establish the behaviour at all. The
   * converse does not follow: discrimination does not prove the named primitive caused the
   * verdict, since generated code can report the checkId without ever calling it.
   */
  attributedCheckIds: Record<string, number>;
}

/**
 * Per-check execution counts from a battery. A truth check "fires" when the verifier executes its
 * assertion and returns pass or fail, rather than skipping it as inapplicable.
 *
 * A check that misreads its hidden operand can skip every case and still leave a ready claim, with
 * only artifact shape actually checked. These counts are what detect a declared check that never
 * ran, whether it had applicable verified cases or was scoped to families this battery lacks: a
 * task probe may narrow the battery below a check's families, and the check then reads 0 here
 * rather than refusing the candidate.
 */
export type TruthCheckFiringEvidence = {
  /**
   * checkId → number of verified cases on which the authored check executed. Includes every
   * declared authored check, with 0 for checks that never ran. External-verifier checks have
   * separate execution counts and grounding clauses, so they do not appear in this map.
   */
  firedByCheck: Record<string, number>;
  /**
   * checkId → number of verified cases in which an installed tool ran to completion for this
   * external-verifier check, from the host's own run rows. It carries every declared external
   * check, 0 when no tool ever ran for one. A count below the verified total is applicability and
   * not a skipped check — a per-board build check applies only to the tasks naming that board —
   * and a verified case with an applicable external check that ran no tool is a verifier
   * non-result before it can be verified at all. A bundle declaring only external checks leaves
   * `firedByCheck` empty beside a full battery, so without this field a reader has to go and
   * inspect the execution evidence itself.
   */
  executedByCheck: Record<string, number>;
  /**
   * checkId → number of verified failed cases that failed this check. Every declared check
   * appears, 0 when it blocked nothing. One check carrying every failure of a battery is the
   * reading that prompts a review: establish that the public contract states the rule before
   * attributing those failures to solver capability.
   */
  blockingByCheck: Record<string, number>;
  /**
   * checkId → number of verified cases the check applied to, for the same authored checks as
   * `firedByCheck`. The never-fired clause reads a check against this denominator rather than
   * against the whole verified count: where every task a check applied to was a provider
   * non-result, the clause otherwise blames the harness for a check that had no case to fire on.
   */
  applicableByCheck: Record<string, number>;
  /**
   * Verified cases used for these counts: an accepted artifact reached the verifier and received a
   * truth verdict. `runStatus.verified` is broader despite the shared name, because it also counts
   * unaccepted attempts, which never reach the verifier at all. An all-unaccepted battery may
   * still create a stored claim, with readiness deciding whether it is usable. Check execution
   * cannot be assessed without a verified artifact, so the never-fired clause runs only when this
   * count is above zero.
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
   * Declared truth-check groundings (from the validated brief) plus the adapterIds whose external
   * invocations executed this run. Null blocks, because external grounding whose evidence sources
   * are unnamed is unfounded: it asserts that something outside the candidate decided, without
   * saying what.
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
   * The truth checks this case's hidden expectations exercise. The per-case external-grounding
   * check has to know which checks apply to each case, because what it enforces is that every
   * applicable external check carries execution evidence for that specific case, not that the
   * battery ran the tool somewhere.
   */
  checkIds: string[];
}

export interface ClaimCreationInput {
  slug: string;
  runId: string;
  evidence: ClaimEvidence;
  /**
   * Per-case verdicts from which `n` and `passed` are counted here rather than accepted from the
   * caller: a caller-supplied count could be negative, non-finite or hold a `passed` greater than
   * `n`, and counting the cases makes those unreachable. Case ids allow duplicate detection, and
   * claim creation also compares the list length with `runStatus.verified`.
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
 * case carries a complete v2 agent runtime session plus provider model and result evidence
 * matching both segments of the pin. "unverified": some or all of that evidence is absent or
 * mismatched, so the pin is configuration rather than evidence — the same explicit assurance level
 * `isolation: "contractual"` states. Claude and Codex identity defects can also add
 * `runtime-model-identity-unproven`. A route reporting no served-model attestation stays
 * unverified without refusing the scored cases; other transports stay unverified until they
 * provide equivalent evidence.
 */
type ModelIdentityAssurance = "provider-native" | "unverified";

/** Evidence and score fields a created claim must state. */
export interface ClaimStatement {
  slug: string;
  runId: string;
  /** One row per required tool of each check a verified case applied: host-recorded runs of that
   *  tool and of programs the check built in its cell on verified cases of this battery, and the
   *  reject controls the check blocked. Readiness names a zero-launch row through the
   *  grounding-coverage finding. Empty when no case was verified. */
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
    /** Python distributions beside the interpreter, when there are any: what was installed where
     *  the check ran, which is provenance and never independence. */
    packages?: string[];
    digest: string;
  }>;
}
