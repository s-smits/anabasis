/**
 * Settle the post-build part of one curriculum round — one battery, the analysis, then the
 * promotion and the pointer. This file sequences the evaluation steps; next-move.ts and
 * candidate-promotion.ts retain their respective decisions. The round body that decides,
 * builds, and calls `settleCandidateEvaluation` lives in full-run-round.ts.
 */
import { existsSync } from "../meta/filesystem.ts";
import { campaignDir } from "../meta/campaign-root.ts";
import { join } from "../meta/path.ts";
import type { ResolvedSlots } from "../backends/resolve.ts";
import type { CampaignFeedback } from "../author/campaign-types.ts";
import type { HarnessExperiment } from "../critic/types.ts";
import { CASE_RECORD_FILE, readCaseRecord } from "../claim/case-record.ts";
import {
  type RunObserver,
  fullrunLine,
  observeAnalysisResult,
  observePromotion,
} from "../observe/run-observer.ts";
import { type AdmissionPointer, prepareAdmissionPointer, publishAdmissionPointer } from "./admission.ts";
import { movedIdentity } from "./admission-packet.ts";
import type { AnalyseStepResult } from "./analyse-step.ts";
import type { AskManifest } from "./ask-manifest.ts";
import {
  type PromotionEvidence,
  promoteCandidate,
  recordExperimentIntegrityHold,
} from "./candidate-promotion.ts";
import { evaluationIdentity } from "../claim/fingerprint.ts";
import { executedBundleSnapshotFact } from "./claim-write.ts";
import { type ExperimentAuthoring, type ExperimentFreeze, experimentFreeze } from "./experiment-freeze.ts";
import type { FullRunArgs } from "./launch-arguments.ts";
import type { FullRunDeps, FullRunOutcome } from "./full-run.ts";
import type { HarnessMeasureResult } from "./harness-measure.ts";
import { recordMeasurement } from "./claim-stages.ts";
import type { NextMove } from "./next-move.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import type { BundleSnapshotFact } from "../truth/battery-record.ts";
import type { ProviderResourceBudget } from "./provider-resource-budget.ts";
import type { SafeguardContext } from "../meta/safeguard.ts";
import type { VerifierLifetime } from "../verify/verifier-lifetime.ts";
import { bindProductMeasurement, selectedProductDir } from "./product-versions.ts";
import { errorMessage } from "../meta/runtime-values.ts";

interface PostBuildInput {
  args: FullRunArgs;
  repoRoot: string;
  manifest: AskManifest;
  runId: string;
  build: FullRunOutcome["build"];
  decision: NextMove;
  measureDir: string;
  absentSteps: string[];
  deps: Pick<FullRunDeps, "drive" | "analyse">;
  observer: RunObserver;
  /** Which experiment authored the candidate; null when no session opened. */
  experiment: HarnessExperiment | null;
  runPin: string;
  slots: ResolvedSlots;
  /** The exact operator request, kept public and unchanged through the battery. */
  publicRequest?: string;
  experimentAuthoring?: ExperimentAuthoring;
  /** Kept beside post-build sequencing so later steps cannot erase a started battery identity. */
  recordBatteryRun?: (runId: string) => void;
  /** One run-bound diagnostic channel shared by the battery and the review. */
  safeguardContext?: SafeguardContext;
  providerBudget?: ProviderResourceBudget;
  verifierLifetime?: VerifierLifetime;
}

export type CandidateEvaluation = Pick<
  FullRunOutcome,
  "measure" | "claimStage" | "promotion" | "judges" | "admission"
>;

const NOTHING_EVALUATED: Omit<CandidateEvaluation, "promotion"> = {
  measure: null,
  claimStage: null,
  judges: null,
  admission: null,
};

type ShippingBundle = { expected: BundleSnapshotFact | null; error: string | null };

/** The measured battery is the only identity promotion may install. A battery without a claim has
 *  no verified case and is held for that, so it names no identity; a claim whose battery no longer
 *  verifies, or whose recorded bundle cannot be read, is held as unreadable. */
export function shippingBundleFor(
  input: Pick<PostBuildInput, "measureDir">,
  measure: Pick<HarnessMeasureResult, "claim" | "runId">,
): ShippingBundle {
  if (measure.claim === null) return { expected: null, error: null };
  if (!measure.claim.batteryRecorded) {
    return { expected: null, error: "the battery's recorded evidence does not verify" };
  }
  try {
    return { expected: executedBundleSnapshotFact(input.measureDir, measure.runId), error: null };
  } catch (error) {
    return { expected: null, error: errorMessage(error) };
  }
}

function analyseStandDown(input: PostBuildInput, measure: HarnessMeasureResult): string | null {
  if (measure.claim === null) {
    return "the battery was environment-blocked and recorded no claim evidence to analyse";
  }
  const record = join(campaignDir(input.repoRoot, input.manifest.slug), CASE_RECORD_FILE);
  const rows = readCaseRecord(record).filter((entry) => entry.row.runId === measure.runId);
  if (rows.length === 0) {
    return "the battery recorded zero case rows (refused before any case ran); the claim's blocking clauses carry the feedback";
  }
  return null;
}

/** A battery with no claim evidence has a typed environment-blocked skip. Any other analysis
 *  failure aborts the controller after recording the failed phase: admission is settlement
 *  authority, so its failure cannot be downgraded to an optional review absence. */
async function runAnalysePhase(
  input: PostBuildInput,
  measure: HarnessMeasureResult,
): Promise<AnalyseStepResult | null> {
  const { repoRoot, manifest, runId, measureDir, absentSteps, deps, observer } = input;
  const standDown = analyseStandDown(input, measure);
  if (standDown !== null) {
    absentSteps.push(`judge review + admission: skipped — ${standDown}`);
    return null;
  }
  try {
    observer.phase({ phase: "analyse", state: "started", summary: "Judge review and admission started" });
    fullrunLine(`${manifest.slug}: judge review + admission started`);
    const analysed = await deps.analyse(repoRoot, manifest.slug, runId, measureDir, {
      resolvedSlots: input.slots,
      observer,
      ...keyIfDefined("safeguardContext", input.safeguardContext),
      ...keyIfDefined("publicRequest", input.publicRequest),
      ...keyIfDefined("providerBudget", input.providerBudget),
    });
    observeAnalysisResult(observer, manifest.slug, runId, analysed);
    absentSteps.push(...analysed.judges.absent, ...analysed.absent);
    return analysed;
  } catch (error) {
    const reason = errorMessage(error);
    observer.phase({ phase: "analyse", state: "failed", summary: `Analysis failed: ${reason}` });
    throw error;
  }
}

/** Whether an admitted packet has blocking feedback. The routing step has already decided
 *  which findings to admit. Host findings such as checkerUnboundFinding can require a repair;
 *  the Judge never does. This check used to read only Judge findings, which left a host-reported
 *  unbound verdict recorded but unused: the next decision read older admission, found no blocker
 *  and continued climbing. Every admitted row's severity is inspected now, so blocking host
 *  feedback also controls publication of a held candidate's packet. Advisory rows alone do not
 *  enable publication. */
export function blocksReplacement(feedback: ReadonlyArray<Pick<CampaignFeedback, "severity">>): boolean {
  return feedback.some((row) => row.severity === "blocking");
}

/** A measured current publishes; a promoted candidate publishes; a held candidate stays recorded —
 *  with two exceptions involving a fixed part of the adopted product. A held
 *  climb publishes when an admitted blocking row holds the fixed harness (the next decision reads
 *  it as the evaluation correction); a held evaluation candidate publishes when its freeze is proved,
 *  so its packet describes the adopted agent and battery it left unchanged. Neither exception
 *  replaces the pointer with a packet whose evaluation identity positively moved from the adopted
 *  tree's: `readAdmission` reads such a packet as lineage, so publishing it would erase the adopted
 *  product's standing admission and hand the next decision nothing. */
export function publishesAdmissionPointer(input: {
  build: FullRunOutcome["build"];
  decision: PromotionEvidence["decision"] | null;
  experiment: HarnessExperiment | null;
  blockingFeedback?: boolean;
  /** The candidate's own experiment freeze. Absent (or anything but `held`) means the freeze is
   *  not proved, which keeps the record for an evaluation candidate. */
  freeze?: ExperimentFreeze | null;
  /** False when the packet's evaluation identity positively moved from the adopted tree's. */
  observedOnAdopted?: boolean;
}): boolean {
  if (input.build !== "candidate" || input.decision === "promoted") return true;
  if (input.observedOnAdopted === false) return false;
  if (input.experiment === "climb") return input.blockingFeedback === true;
  return input.experiment === "evaluation" && input.freeze?.state === "held";
}

/** The freeze that decides publication for a held evaluation candidate, checked again rather than
 *  reused from `refuseBrokenFreeze`: that read happened before the battery, and a background write
 *  into the candidate workspace between the two would leave the packet recorded with one identity
 *  and admitted on another. Computed only on the path that consumes it. */
function publicationFreeze(
  input: PostBuildInput,
  decision: PromotionEvidence["decision"] | null,
): ExperimentFreeze | null {
  if (input.build !== "candidate" || decision === "promoted" || input.experiment !== "evaluation") {
    return null;
  }
  const currentDir = selectedProductDir(input.repoRoot, input.manifest.slug);
  if (!existsSync(currentDir)) return null;
  return experimentFreeze({ kind: input.experiment, baseDir: currentDir, candidateDir: input.measureDir });
}

/** Prepare feedback, then commit eligible admission together with product selection. Measuring
 *  the current product publishes directly; a promoted candidate publishes because its packet
 *  describes the newly selected tree. A held candidate publishes only under the two exceptions
 *  above. Other held packets remain in their per-run records because the measured candidate
 *  was not adopted. */
function settleCheckAndPointer(
  input: PostBuildInput,
  analysed: AnalyseStepResult | null,
  measure: HarnessMeasureResult,
  shipping: ShippingBundle,
): PromotionEvidence | null {
  const { repoRoot, manifest, runId, build, measureDir, absentSteps, observer, experiment } = input;
  const observed = evaluationIdentity(measureDir);
  const pointer: AdmissionPointer | null =
    analysed === null
      ? null
      : prepareAdmissionPointer(repoRoot, manifest.slug, runId, analysed.admission, observed);
  const freeze = publicationFreeze(input, "held");
  const adoptedDir = selectedProductDir(repoRoot, manifest.slug);
  const observedOnAdopted =
    !existsSync(adoptedDir) || movedIdentity(observed, evaluationIdentity(adoptedDir)) === null;
  const publishHeld = publishesAdmissionPointer({
    build,
    decision: "held",
    experiment,
    blockingFeedback: analysed !== null && blocksReplacement(analysed.admission.feedback),
    freeze,
    observedOnAdopted,
  });
  const promotion =
    build === "candidate"
      ? promoteCandidate(repoRoot, manifest.slug, measureDir, runId, {
          experiment,
          transaction: {
            expectedShippingBundle: shipping.expected,
            shippingBundleError: shipping.error,
            pointer,
            publishHeldPointer: publishHeld,
          },
          battery: measure.claim === null ? null : { verified: measure.claim.batteryScore.verified },
        })
      : null;
  if (promotion !== null) {
    fullrunLine(
      `${manifest.slug}: promotion ${promotion.decision}${promotion.clauses.length === 0 ? "" : ` (${promotion.clauses.join("; ")})`}`,
    );
    observePromotion(observer, manifest.slug, runId, promotion.decision);
  }
  if (analysed !== null) {
    const decision = promotion?.decision ?? null;
    const publish = publishesAdmissionPointer({
      build,
      decision,
      experiment,
      blockingFeedback: blocksReplacement(analysed.admission.feedback),
      freeze,
      observedOnAdopted,
    });
    if (publish) {
      if (pointer === null) throw new Error("admission pointer was selected without a prepared packet");
      if (promotion === null) publishAdmissionPointer(pointer, campaignDir(repoRoot, manifest.slug));
    } else {
      // The clause code that says why an evaluation freeze is not proved, for the absent step.
      const freezeReason =
        freeze === null
          ? "no adopted harness to prove the freeze against"
          : (freeze.clauses[0]?.split(":")[0] ?? freeze.state);
      absentSteps.push(
        experiment !== "build" && !observedOnAdopted
          ? "admission pointer: held candidate measured under an evaluation the adopted tree does not have — the packet is recorded under analysis/ and the adopted admission stays latest"
          : experiment === "evaluation"
            ? `admission pointer: held evaluation candidate whose freeze is not proved (${freezeReason}) — the packet is recorded under analysis/ but not published as latest`
            : "admission pointer: held candidate — the packet is recorded under analysis/ but not published as latest",
      );
    }
  }
  return promotion;
}

/** Check experiment constraints before the paid battery. A candidate shown to violate its
 *  declared fixed condition would be held regardless of its result, so measuring it would
 *  add no usable evidence. Refuse only a proven violation: a tree that cannot be
 *  fingerprinted leaves the freeze unproven rather than broken, and its measurement may be the
 *  evidence that explains the unreadable tree; the promotion check holds it after measurement.
 *  The clauses come from the promotion owner's own function, so the preflight and the check
 *  cannot disagree. */
function refuseBrokenFreeze(input: PostBuildInput): CandidateEvaluation | null {
  const { repoRoot, manifest, runId, build, measureDir, absentSteps, observer, experiment } = input;
  if (build !== "candidate") return null;
  const currentDir = selectedProductDir(repoRoot, manifest.slug);
  if (!existsSync(currentDir)) return null;
  const freeze = experimentFreeze({ kind: experiment, baseDir: currentDir, candidateDir: measureDir });
  if (freeze.state !== "broken") return null;
  absentSteps.push(`measurement + analysis: skipped — ${freeze.clauses.join("; ")}`);
  const promotion = recordExperimentIntegrityHold({
    repoRoot,
    slug: manifest.slug,
    runId,
    candidateDir: measureDir,
    experiment,
    clauses: freeze.clauses,
  });
  fullrunLine(`${manifest.slug}: promotion held before measurement (${freeze.clauses.join("; ")})`);
  observePromotion(observer, manifest.slug, runId, promotion.decision);
  return { ...NOTHING_EVALUATED, promotion };
}

/** The round's one battery. Its identity is recorded immediately before it drives, so a drive
 *  that dies mid-battery still leaves its case rows inside the recorded denominator. */
async function driveCandidate(input: PostBuildInput): Promise<HarnessMeasureResult> {
  const { manifest, repoRoot, runId, measureDir } = input;
  bindProductMeasurement(repoRoot, manifest.slug, runId, measureDir);
  return await input.deps.drive(manifest, {
    runId,
    repoRoot,
    observer: input.observer,
    resolvedSlots: input.slots,
    ...keyIfDefined("publicRequest", input.publicRequest),
    domainDir: measureDir,
    ...keyIfDefined("experimentAuthoring", input.experimentAuthoring),
    ...keyIfDefined("onBatteryStart", input.recordBatteryRun),
    ...keyIfDefined("verifierLifetime", input.verifierLifetime),
    ...keyIfDefined("providerBudget", input.providerBudget),
    ...keyIfDefined("safeguardContext", input.safeguardContext),
  });
}

export async function settleCandidateEvaluation(input: PostBuildInput): Promise<CandidateEvaluation> {
  const { runId, build, decision, measureDir, absentSteps } = input;
  if (build === "stopped" || build === "build-failed") {
    absentSteps.push(
      build === "stopped"
        ? `measure + judge review: stopped — ${decision.reason}`
        : "judge review: no measured battery to analyse",
    );
    return { ...NOTHING_EVALUATED, promotion: null };
  }
  const refused = refuseBrokenFreeze(input);
  if (refused !== null) return refused;
  const measure = await driveCandidate(input);
  input.providerBudget?.throwIfDenied();
  input.verifierLifetime?.assertUsable();
  const shipping = shippingBundleFor(input, measure);
  // A null claim states an environment-blocked battery (live-run-08: a dead provider); its
  // recorded evidence and typed case rows carry the reason, so the absence is only named here.
  if (measure.claim === null) {
    absentSteps.push(
      `battery "${runId}": environment-blocked — typed non-results recorded; no claim was written`,
    );
  }
  const claimStage = recordMeasurement(measureDir, { runId, ...measure.verdicts });
  // Analysis runs for every measured battery, including one that passed nothing: the battery that
  // most needs its census and admission read is the one that failed everywhere. On 2026-08-10 the
  // claude-med run's 25 recorded admission refusals were never diagnosed, because a zero-pass skip
  // stood here.
  const analysed = await runAnalysePhase(input, measure);
  const promotion = settleCheckAndPointer(input, analysed, measure, shipping);
  return {
    measure,
    claimStage,
    promotion,
    judges: analysed?.judges ?? null,
    admission: analysed?.admission ?? null,
  };
}
