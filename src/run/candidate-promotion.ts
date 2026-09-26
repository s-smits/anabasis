import { existsSync, mkdirSync } from "../meta/filesystem.ts";
import { campaignDir } from "../meta/campaign-root.ts";
import { basename, join, normalize } from "../meta/path.ts";
import { writeCompleted } from "../author/campaign-epoch.ts";
import { type FingerprintEvidence, fingerprintSlug, taskSetDigest } from "../claim/fingerprint.ts";
import type { HarnessExperiment } from "../critic/types.ts";
import type { BundleSnapshotFact } from "../correctness-bundle/battery-record.ts";
import { CLAIM_STAGES, type ClaimStage, claimStage } from "./claim-stages.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { validateExperiment } from "./experiment-freeze.ts";
import { recordedVerifierEnvironmentHash } from "../claim/conformance-evidence.ts";
import { ControllerLedger } from "./controller-ledger.ts";
import {
  productVersionDir,
  readProductVersion,
  readRetainedVersion,
  selectedProductDir,
} from "./product-versions.ts";
import { admissionPointerPayload, type AdmissionPointer } from "./admission.ts";
import { parseJsonAs, capturedJsonStringify } from "../meta/json-runtime.ts";
import { isSafePathSegment } from "../meta/path-segment.ts";
import { errorMessage } from "../meta/runtime-values.ts";

type CandidateFingerprint = Pick<FingerprintEvidence, "agentHash" | "correctnessModelHash" | "taskSetHash">;
type PromotionTransaction = {
  expectedShippingBundle?: BundleSnapshotFact | null;
  shippingBundleError?: string | null;
  pointer?: AdmissionPointer | null;
  publishHeldPointer?: boolean;
};
/** The verified-case count of the candidate's own battery. Zero verified cases is a valid
 *  operational result and no capability result, so it holds the candidate (tenet 6). */
type PromotionBattery = { verified: number };

export type PromotionEvidence = {
  schema: "product-promotion/v1";
  runId: string;
  /** Digest of this row without evidenceDigest, so replay can reject a shape-valid edit to a
   * clause or identity field of the committed row. */
  evidenceDigest: string;
  /** `promoted` installs the candidate as current; `held` leaves current in place. The names
   *  predate the single battery and stay so every promotions/ reader keeps one vocabulary. */
  decision: "promoted" | "held";
  experiment: HarnessExperiment | null;
  clauses: string[];
  current: {
    claimStage: ClaimStage | null;
    taskSetDigest: string | null;
    /** The previously selected retained version, null when none was selected. */
    archivedTo: string | null;
  };
  candidate: {
    claimStage: ClaimStage | null;
    taskSetDigest: string | null;
    dir: string;
  };
  /** The candidate's own verified-case count, null when the caller supplied no battery fact. */
  battery: PromotionBattery | null;
  /** The main task set identity expected by promotion and the fresh fingerprint observed just
   * before install. `expected` is null when the caller supplied no recorded fact. */
  shippingIdentity: {
    expected: BundleSnapshotFact | null;
    observed: CandidateFingerprint | null;
  };
};

interface CandidateState {
  claimStage: ClaimStage | null;
  taskSetDigest: string | null;
  correctnessModelDigest: string | null;
  agentDigest: string | null;
  verifierEnvironmentHash: string | null | undefined;
}

type PromotionState = {
  current: CandidateState;
  candidate: CandidateState;
  clauses: string[];
  expectedShippingBundle: BundleSnapshotFact | null;
};

/** What the promotion decides from, beside the four identities that name the candidate. Each has a
 *  standing default, so a caller supplies only what its round actually observed. */
type PromotionInputs = {
  readonly experiment?: HarnessExperiment | null | undefined;
  readonly transaction?: PromotionTransaction | undefined;
  readonly battery?: PromotionBattery | null | undefined;
};

const sameFingerprint = (a: CandidateFingerprint | null, b: CandidateFingerprint | null): boolean =>
  a !== null &&
  b !== null &&
  a.agentHash === b.agentHash &&
  a.correctnessModelHash === b.correctnessModelHash &&
  a.taskSetHash === b.taskSetHash;

function recordPromotionEvidence(evidence: Omit<PromotionEvidence, "evidenceDigest">): PromotionEvidence {
  if (!isSafePathSegment(evidence.runId)) throw new Error("promotion requires a safe run identity");
  return { ...evidence, evidenceDigest: hashJsonValue(evidence) };
}

function claimStageOrDamage(
  dir: string,
  side: "current" | "candidate",
  clauses: string[],
): ClaimStage | null {
  try {
    return claimStage(dir);
  } catch (error) {
    clauses.push(`${side}-claim-stages-damaged: ${errorMessage(error)}`);
    return null;
  }
}

/** Checks that concern the candidate evidence itself, before experiment-specific evidence. */
function candidateStateClauses(
  current: CandidateState,
  candidate: CandidateState,
  battery: PromotionBattery | null,
): string[] {
  const clauses: string[] = [];
  // Claim maturity is the candidate's own floor, never a contest with current: a candidate held
  // at `claim-created` by a readiness clause still replaces a `ready` product (rule 10).
  if (
    candidate.claimStage === null ||
    CLAIM_STAGES.indexOf(candidate.claimStage) < CLAIM_STAGES.indexOf("measured")
  ) {
    clauses.push(`candidate-unmeasured: its claim stages end at "${candidate.claimStage ?? "no evidence"}"`);
  } else if (candidate.claimStage === "measured") {
    // A measured candidate whose claim was refused is held, whatever refused it. Without that,
    // a battery cut short by a session limit still replaces a product measured at a far higher
    // rate. This clause deliberately does not read why the claim was refused: an environment
    // clause can hold the only round of a run that had failing cases, and rolling its authored
    // bundle back costs a real candidate — but reading clause names here would thread them into
    // this function and make a second owner of a decision the claim has already made (operator
    // decision). If it costs a candidate, narrow what raises the clause in `src/claim/` rather
    // than widening the hold. The climb loses no battery either way, since `ENVIRONMENT_CLAUSES`
    // in `climb-battery-admission.ts` admits a claim refused only for an environment clause.
    clauses.push(
      'candidate-claim-refused: its claim stages end at "measured", so its battery wrote no claim and cannot replace a tree',
    );
  }
  if (battery?.verified === 0) {
    clauses.push(
      "candidate-zero-verified: the candidate's battery verified no case, which is an operational result and no capability result, so it cannot replace a tree that has one",
    );
  }
  if (candidate.taskSetDigest === null) {
    clauses.push(
      "candidate-task-set-unbound: the candidate's correctness-model/tasks.json cannot be read, so task freshness cannot be checked",
    );
  }
  if (candidate.correctnessModelDigest === null) {
    clauses.push(
      "candidate-evaluator-unbound: the candidate's correctness model cannot be fingerprinted, so the rule the installed tree would verify by is unproved",
    );
  }
  if (
    current.taskSetDigest !== null &&
    current.taskSetDigest === candidate.taskSetDigest &&
    current.agentDigest !== null &&
    current.agentDigest === candidate.agentDigest &&
    current.verifierEnvironmentHash === candidate.verifierEnvironmentHash &&
    (current.correctnessModelDigest === null ||
      current.correctnessModelDigest === candidate.correctnessModelDigest)
  ) {
    clauses.push(
      "stale-task-identity: the candidate's agent, correctness model, installed verifier, tasks and controls are byte-identical to current's, so the whole measured package is unchanged",
    );
  }
  return clauses;
}

/** Record a pre-measurement integrity hold. */
export function recordExperimentIntegrityHold(input: {
  repoRoot: string;
  slug: string;
  runId: string;
  candidateDir: string;
  experiment: HarnessExperiment | null;
  clauses: string[];
}): PromotionEvidence {
  const { repoRoot, slug, runId, candidateDir: candidate, experiment, clauses } = input;
  if (normalize(candidate) !== normalize(productVersionDir(repoRoot, slug, basename(candidate)))) {
    throw new Error("candidate is outside its immutable version path");
  }
  const currentDir = selectedProductDir(repoRoot, slug);
  using ledger = ControllerLedger.open(campaignDir(repoRoot, slug));
  const previous = ledger.selectedProduct();
  const promotionsDir = join(campaignDir(repoRoot, slug), "promotions");
  const identityClauses: string[] = [];
  const currentStage = claimStageOrDamage(currentDir, "current", identityClauses);
  const candidateStage = claimStageOrDamage(candidate, "candidate", identityClauses);
  readProductVersion(repoRoot, slug, basename(candidate));
  const observedFingerprint = freshCandidateFingerprint(candidate, slug, null, identityClauses);
  const evidence = recordPromotionEvidence({
    schema: "product-promotion/v1",
    runId,
    decision: "held",
    experiment,
    clauses: [...clauses, ...identityClauses],
    current: {
      claimStage: currentStage,
      taskSetDigest: taskSetDigest(currentDir),
      archivedTo: previous === null ? null : productVersionDir(repoRoot, slug, previous),
    },
    candidate: {
      claimStage: candidateStage,
      taskSetDigest: taskSetDigest(candidate),
      dir: candidate,
    },
    battery: null,
    shippingIdentity: { expected: null, observed: observedFingerprint },
  });
  ledger.recordProductDecision({
    id: runId,
    version: basename(candidate),
    previous,
    adopt: false,
    evidence: capturedJsonStringify(evidence),
    admission: null,
  });
  mkdirSync(promotionsDir, { recursive: true });
  writeCompleted(join(promotionsDir, runId + ".json"), evidence);
  return evidence;
}

function preparePromotionState(input: {
  repoRoot: string;
  slug: string;
  candidateDir: string;
  experiment: HarnessExperiment | null;
  battery: PromotionBattery | null;
  transaction: PromotionTransaction;
}): PromotionState {
  const currentDir = selectedProductDir(input.repoRoot, input.slug);
  const clauses: string[] = [];
  const currentFingerprint = fingerprintSlug(currentDir);
  const candidateFingerprint = fingerprintSlug(input.candidateDir);
  const current = {
    claimStage: claimStageOrDamage(currentDir, "current", clauses),
    taskSetDigest: taskSetDigest(currentDir),
    correctnessModelDigest: currentFingerprint.ok ? currentFingerprint.correctnessModelHash : null,
    agentDigest: currentFingerprint.ok ? currentFingerprint.agentHash : null,
    verifierEnvironmentHash: recordedVerifierEnvironmentHash(currentDir),
  };
  const candidate = {
    claimStage: claimStageOrDamage(input.candidateDir, "candidate", clauses),
    taskSetDigest: taskSetDigest(input.candidateDir),
    correctnessModelDigest: candidateFingerprint.ok ? candidateFingerprint.correctnessModelHash : null,
    agentDigest: candidateFingerprint.ok ? candidateFingerprint.agentHash : null,
    verifierEnvironmentHash: recordedVerifierEnvironmentHash(input.candidateDir),
  };
  const expectedShippingBundle = input.transaction.expectedShippingBundle ?? null;
  if (input.transaction.shippingBundleError !== undefined && input.transaction.shippingBundleError !== null) {
    clauses.push(`shipping-bundle-unreadable: ${input.transaction.shippingBundleError}`);
  }
  clauses.push(...candidateStateClauses(current, candidate, input.battery));
  if (existsSync(currentDir)) {
    clauses.push(
      ...validateExperiment({
        kind: input.experiment,
        baseDir: currentDir,
        candidateDir: input.candidateDir,
      }),
    );
  }
  return { current, candidate, clauses, expectedShippingBundle };
}

function freshCandidateFingerprint(
  candidate: string,
  slug: string,
  expected: BundleSnapshotFact | null,
  clauses: string[],
): CandidateFingerprint | null {
  const observed = fingerprintSlug(candidate, { slug });
  if (!observed.ok) {
    clauses.push(
      `candidate-fingerprint-unreadable: ${observed.findings.map((finding) => finding.code).join(",")}`,
    );
    return null;
  }
  const actual: CandidateFingerprint = {
    agentHash: observed.agentHash,
    correctnessModelHash: observed.correctnessModelHash,
    taskSetHash: observed.taskSetHash,
  };
  if (expected !== null && !sameFingerprint(expected, actual)) {
    clauses.push(
      `candidate-fingerprint-drift: measured shipping bundle (${expected.agentHash}/${expected.correctnessModelHash}/${expected.taskSetHash}) differs from the fresh candidate fingerprint (${actual.agentHash}/${actual.correctnessModelHash}/${actual.taskSetHash})`,
    );
  }
  return actual;
}

/** Selection, decision evidence and eligible feedback commit together after publication. */
export function promoteCandidate(
  repoRoot: string,
  slug: string,
  candidate: string,
  runId: string,
  inputs: PromotionInputs = {},
): PromotionEvidence {
  const experiment = inputs.experiment ?? null;
  const transaction = inputs.transaction ?? {};
  const battery = inputs.battery ?? null;
  const id = readRetainedVersion(
    repoRoot,
    slug,
    candidate,
    "candidate is outside its immutable version path",
  );
  using ledger = ControllerLedger.open(campaignDir(repoRoot, slug));
  const previous = ledger.selectedProduct();
  const previousDir = previous === null ? null : productVersionDir(repoRoot, slug, previous);
  const prior = ledger.productDecision(runId);
  if (prior !== null) {
    const evidence = parseJsonAs<PromotionEvidence>(prior);
    const actual = freshCandidateFingerprint(candidate, slug, null, []);
    const expectedSelected = evidence.decision === "promoted" ? candidate : evidence.current.archivedTo;
    const { evidenceDigest, ...unsigned } = evidence;
    if (evidenceDigest !== hashJsonValue(unsigned)) {
      throw new Error("promotion replay reads a committed row whose bytes no longer match its digest");
    }
    if (
      evidence.candidate.dir !== candidate ||
      evidence.experiment !== experiment ||
      expectedSelected !== previousDir ||
      !sameFingerprint(evidence.shippingIdentity.observed, actual) ||
      !sameFingerprint(transaction.expectedShippingBundle ?? actual, actual)
    ) {
      throw new Error("promotion replay names a different retained product or experiment");
    }
    return evidence;
  }
  const state = preparePromotionState({
    repoRoot,
    slug,
    candidateDir: candidate,
    experiment,
    battery,
    transaction,
  });
  const { clauses, expectedShippingBundle } = state;
  const observed = freshCandidateFingerprint(candidate, slug, expectedShippingBundle, clauses);
  const adopt = clauses.length === 0;
  const evidence = recordPromotionEvidence({
    schema: "product-promotion/v1",
    runId,
    decision: adopt ? "promoted" : "held",
    experiment,
    clauses,
    current: { ...state.current, archivedTo: previousDir },
    candidate: { ...state.candidate, dir: candidate },
    battery,
    shippingIdentity: { expected: expectedShippingBundle, observed },
  });
  const pointer = transaction.pointer ?? null;
  const admission = pointer === null ? null : admissionPointerPayload(pointer, campaignDir(repoRoot, slug));
  ledger.recordProductDecision({
    id: runId,
    version: id,
    previous,
    adopt,
    evidence: capturedJsonStringify(evidence),
    admission: adopt || transaction.publishHeldPointer === true ? admission : null,
  });
  const exports = join(campaignDir(repoRoot, slug), "promotions");
  mkdirSync(exports, { recursive: true });
  writeCompleted(join(exports, runId + ".json"), evidence);
  return evidence;
}
