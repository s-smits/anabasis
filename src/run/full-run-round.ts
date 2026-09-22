/** Sequence one round while the next-move and candidate-promotion modules retain their decisions. */
import type { BuilderConversation } from "../author/builder-conversation.ts";
import { campaignDir } from "../meta/campaign-root.ts";
import { relative } from "../meta/path.ts";
import type { CampaignBindingInput } from "../author/campaign-epoch.ts";
import type { ResolvedSlots } from "../backends/resolve.ts";
import type { PreparedUserContext } from "../builder/user-context.ts";
import { POLICY } from "../critic/policy.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { type RunObserver, observeNextMove } from "../observe/run-observer.ts";
import { settleRebuildAdvice } from "./admission.ts";
import type { AskManifest } from "./ask-manifest.ts";
import type { CampaignBudgetGate } from "./campaign-budget.ts";
import { type CandidateEvaluation, settleCandidateEvaluation } from "./candidate-verification.ts";
import { productVersionDir, selectedProductDir } from "./product-versions.ts";
import { runBuildStep } from "./full-run-build-step.ts";
import type { FullRunArgs } from "./launch-arguments.ts";
import type { FullRunDeps, FullRunOutcome } from "./full-run.ts";
import { type NextMove, epochPassOf, selectNextMoveFromDisk } from "./next-move.ts";
import { recordDifficultyDecision } from "./difficulty-decision.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import type { SafeguardContext } from "../meta/safeguard.ts";
import type { ProviderResourceBudget } from "./provider-resource-budget.ts";
import type { VerifierLifetime } from "../verify/verifier-lifetime.ts";

export interface IterationInput {
  args: FullRunArgs;
  repoRoot: string;
  manifest: AskManifest;
  runId: string;
  round: number;
  baseKickoff: string;
  /** Exact public user request. The kickoff contains more controller framing and is not a
   *  substitute for this identity. */
  publicRequest: string;
  userContext: PreparedUserContext;
  runPin: string;
  builderCondition: NonNullable<CampaignBindingInput["builder"]>;
  slots: ResolvedSlots;
  deps: FullRunDeps;
  observer: RunObserver;
  safeguardContext?: SafeguardContext;
  providerBudget?: ProviderResourceBudget;
  verifierLifetime?: VerifierLifetime;
  /** The run's one Builder conversation, resumed by each build while its session can continue. */
  builderConversation?: BuilderConversation;
  /** A deadline or signal stop checked between every potentially paid stage. */
  stopRequested?: () => Error | null;
  absentSteps: string[];
  recordBatteryRun?: (runId: string) => void;
  /** Given the kickoff the epoch is bound on. */
  onOpening?: (kickoff: string, epochPass: string | undefined) => void;
  report: (decision: NextMove) => void;
}

export interface IterationResult {
  decision: NextMove;
  nextDecision: NextMove | null;
  /** The repository-relative tree this round measured — the candidate a held or blocked round
   *  leaves recorded. */
  measuredTree: string;
  /** Digest of the active admission/difficulty basis read before authoring. */
  admissionBasisDigest?: string | null;
  build: FullRunOutcome["build"];
  buildClauses: string[];
  steps: CandidateEvaluation;
}

/**
 * The loop carries no staleness guard. It once ended any round that changed no admitted
 * difficulty evidence, and both recorded firings were wrong: run 45 reported two refused batteries as absent
 * ones, and run 68 stopped 80 seconds after recording a blocking admission the next decision would
 * have read. Stopping belongs to the decision layer's own stop reasons, bounded by the round cap
 * and the budget gate. The loop-level too-hard floor (a raw point pass-rate counter over main
 * claims) was removed on 2026-08-10: it duplicated the difficulty selector's decision,
 * blind to verified-vs-unaccepted — three rounds of admission refusals would have ended the loop
 * "too hard" even after the selector excluded that conclusion. The loop retains operational
 * stop counters; the next-move policy interprets difficulty evidence.
 */
export interface LoopState {
  budget: CampaignBudgetGate;
  /** Trailing consecutive batteries that recorded only typed non-results and wrote no claim. */
  blockedRounds: number;
  /** The one unresolved authoring stall counter; null before the first unresolved round. */
  authoringStall: UnresolvedAuthoringStall | null;
  /** Trailing consecutive completed measurements the selector answered with the evidence-free
   *  measure decision again — the battery ran, yet nothing it produced reached the selector. */
  stalledMeasureRounds: number;
}

// --- Authoring stall ---
/* One finite allowance for unresolved authoring work under an unchanged admission/decision basis.
 *  A held candidate is a completed authoring round, not a failed one, so `buildFailedRounds` alone
 *  never limited it. Count rounds against their consumed decision basis; changed feedback or
 *  measured progress prevents unrelated holds from accumulating as one stall. */
/** One bounded state for authoring work that remains unresolved under one active basis. */
export type UnresolvedAuthoringStall = {
  /** Admission/decision identity. Promotion clauses are deliberately not part of this key. */
  key: string;
  /** Number of unresolved authoring rounds since the last real progress. */
  rounds: number;
};

/** The single finite authoring allowance. It is intentionally not a global round cap. */
export const AUTHORING_STALL_LIMIT = POLICY.loop.buildFailedRounds;

function measureDirFor(
  move: NextMove["move"],
  repoRoot: string,
  slug: string,
  runId: string,
  domainDir: string,
): string {
  return move === "build" || move === "rebuild" ? productVersionDir(repoRoot, slug, runId) : domainDir;
}

function throwIfStopRequested(input: IterationInput): void {
  input.verifierLifetime?.assertUsable();
  const cause = input.stopRequested?.();
  if (cause !== undefined && cause !== null) throw cause;
}

/** The campaign context the selector reads. `runIteration` asks it twice against the same tree —
 *  once to choose this round's move, once after the build to read the ending — under one owner. */
function selectorContext(
  input: IterationInput,
  domainDir: string,
): Parameters<typeof selectNextMoveFromDisk>[0] {
  return {
    repoRoot: input.repoRoot,
    manifest: input.manifest,
    baseKickoff: input.baseKickoff,
    runPin: input.runPin,
    runId: input.runId,
    domainDir,
    builder: input.builderCondition,
  };
}

/** Recompute the decision after a failed build or held candidate. `loopTerminal` uses it to
 *  decide whether another round may continue. Keep the condition and selector call together
 *  so both outcomes use the same current evidence. */
function endingDecision(
  input: IterationInput,
  build: FullRunOutcome["build"],
  steps: CandidateEvaluation,
  domainDir: string,
): NextMove | null {
  const held = steps.promotion !== null && steps.promotion.decision !== "promoted";
  if (build !== "build-failed" && !(build === "candidate" && held)) return null;
  return selectNextMoveFromDisk(selectorContext(input, domainDir)).decision;
}

/** True when the candidate was held and its refused claim blames only in-loop facts (every clause
 *  `repairable`): the environment, not the candidate's bytes, decided the hold. A created claim
 *  that was still held, an unmeasured candidate and an environment-blocked battery all
 *  return false and keep the ordinary settlement. */
export function heldInLoop(steps: CandidateEvaluation): boolean {
  if (steps.promotion === null || steps.promotion.decision === "promoted") return false;
  const claim = steps.measure?.claim ?? null;
  return claim !== null && !claim.created && claim.clauses.every((clause) => clause.repairable);
}

export async function runIteration(input: IterationInput): Promise<IterationResult> {
  const { args, repoRoot, manifest, runId, runPin, deps, observer } = input;
  throwIfStopRequested(input);
  const domainDir = selectedProductDir(repoRoot, manifest.slug);
  const { prior, lineage, readout, decision, kickoff } = selectNextMoveFromDisk(
    selectorContext(input, domainDir),
  );
  throwIfStopRequested(input);
  // A reopening pass opens in the epoch that pass creates, so the opening evidence must name the
  // same epoch the build step writes into.
  input.onOpening?.(kickoff, epochPassOf(decision));
  // Every round that read a placement records it, whatever it decided to do about it: the record
  // is the rebuild's workspace-reset key, the review's row for what each round did, and, for the
  // placement that ends a campaign, the only durable trace that it was read at all. Run 662762
  // stopped on a third placement that exists in no difficulty-decisions file. The write is
  // content-addressed, so a round that records without authoring adds one file and no duplicate.
  const placement =
    readout === null
      ? null
      : recordDifficultyDecision({
          campaignRoot: campaignDir(repoRoot, manifest.slug),
          runId,
          slug: manifest.slug,
          difficulty: readout,
        });
  // The advisory note carries the evidence into any authoring move, so the record travels only
  // where the round authors against it.
  const recordedDifficulty = decision.move === "rebuild" ? placement : null;
  observeNextMove(
    observer,
    decision,
    placement === null
      ? null
      : {
          evidence: relative(repoRoot, placement.path),
          action: placement.evidence.difficulty.decision.action,
          rationale: placement.evidence.difficulty.decision.rationale,
        },
  );
  input.report(decision);
  const measureDir = measureDirFor(decision.move, repoRoot, manifest.slug, runId, domainDir);
  const built = await runBuildStep(input, decision, {
    kickoff,
    prior,
    lineage,
    difficulty: recordedDifficulty,
  });
  throwIfStopRequested(input);
  const steps = await settleCandidateEvaluation({
    args,
    repoRoot,
    manifest,
    runId,
    build: built.build,
    decision,
    measureDir,
    absentSteps: input.absentSteps,
    ...keyIfDefined("experimentAuthoring", built.experimentAuthoring),
    ...keyIfDefined("recordBatteryRun", input.recordBatteryRun),
    ...keyIfDefined("safeguardContext", input.safeguardContext),
    deps,
    observer,
    experiment: built.experiment,
    runPin,
    slots: input.slots,
    publicRequest: input.publicRequest,
    ...keyIfDefined("providerBudget", input.providerBudget),
    ...keyIfDefined("verifierLifetime", input.verifierLifetime),
  });
  throwIfStopRequested(input);
  // A rebuild spends its packet's active group whatever the candidate's fate, except one in-loop
  // hold, which keeps it for one more rebuild (see settleRebuildAdvice).
  if (decision.move === "rebuild" && prior?.kind === "admitted-packet") {
    settleRebuildAdvice(input.repoRoot, input.manifest.slug, {
      admissionDigest: prior.digest,
      runId,
      heldInLoop: heldInLoop(steps),
    });
  }
  return {
    decision,
    nextDecision: endingDecision(input, built.build, steps, domainDir),
    measuredTree: relative(repoRoot, measureDir),
    admissionBasisDigest: prior?.digest ?? null,
    build: built.build,
    buildClauses: built.clauses,
    steps,
  };
}

/** The per-round counters have one owner. They read a finished `IterationResult` and answer
 *  only "how many rounds in a row", which the terminals below then compare against policy; keeping
 *  them here as well would give the loop's counting two homes. Re-exported so their callers and
 *  tests keep addressing this module. */
export { nextBlockedRounds, nextStalledMeasureRounds } from "./full-run-round-counters.ts";

function loopGuardTerminal(loop: LoopState): string | null {
  if (loop.budget.status() === "budget_limited") {
    return "budget-limited: the campaign model-call budget is spent (--iteration-budget raises it)";
  }
  if (loop.blockedRounds >= POLICY.loop.environmentBlockedRounds) {
    return `environment-blocked: ${loop.blockedRounds} consecutive batteries were stopped by the provider or recorded only typed non-results, so none of them produced a claim — another measurement creates no evidence; restore the environment and rerun`;
  }
  // After the environment diagnosis: a dead provider raises the environment and measurement
  // guards, and the specific owner (the provider) must not be relabelled as an analysis failure.
  if (loop.stalledMeasureRounds >= POLICY.loop.stalledMeasureRounds) {
    return `measurement-stalled: ${loop.stalledMeasureRounds} consecutive completed measurements admitted no feedback and created no difficulty evidence — another identical battery creates nothing the selector can read; inspect the analysis and admission path, then rerun`;
  }
  return null;
}

function unresolvedAuthoringRounds(loop: LoopState): number {
  return loop.authoringStall?.rounds ?? 0;
}

/** The repository-relative evidence paths behind a terminal; null when the ending cites nothing.
 *  A `candidate-held` ending cites the recorded promotion row: truss-run6-opus-0902 closed on four
 *  held clauses and `terminalEvidence: null`, and the reader had to know which file to open.
 *  Every other terminal stays prose-only. */
export function terminalEvidenceFor(
  terminal: string | null,
  result: IterationResult,
  slug: string,
): string[] | null {
  if (terminal?.startsWith("candidate-held") !== true) return null;
  const { promotion } = result.steps;
  return promotion === null ? null : [`campaigns/${slug}/promotions/${promotion.runId}.json`];
}

/** A failed authoring round whose recomputed decision still names an authoring move may try
 *  again: the Builder session is stochastic and 12 of 55 recorded runs died on a single failed
 *  round. The retry is bounded by the shared unresolved-authoring allowance, and a clause that
 *  already carries its own bounded escalation or owner stays terminal.
 *  Environment failures remain with the environment owner. */
function buildFailedTerminal(result: IterationResult, loop: LoopState): string | null {
  if (result.nextDecision?.move === "stop") return `stopped: ${result.nextDecision.reason}`;
  const retryMove = result.nextDecision?.move;
  if (
    (retryMove === "build" || retryMove === "rebuild") &&
    unresolvedAuthoringRounds(loop) < AUTHORING_STALL_LIMIT &&
    !result.buildClauses.some((clause) => clause === "authoring-stalled" || clause === "environment-blocked")
  ) {
    return loopGuardTerminal(loop);
  }
  // A later failed authoring round does not erase earlier measured cases (run w28 had 50).
  const clauses = result.buildClauses.length > 0 ? ` (${result.buildClauses.join(", ")})` : "";
  return `build-failed: the final iteration produced no build-admissible candidate${clauses}; earlier recorded iterations keep their own evidence`;
}

/** Held candidates retain their packet and share the unresolved-authoring allowance. A build
 * can continue into another admitted move. */
function heldCandidateTerminal(result: IterationResult, loop: LoopState): string | null {
  const { decision } = result;
  if (result.nextDecision?.move === "stop") return `stopped: ${result.nextDecision.reason}`;
  // A held candidate shares the same unresolved-authoring allowance as a failed build. The
  // active admission/decision key and structured comparison determine whether the next round is
  // a new experiment; clause wording alone cannot reset the allowance.
  if (unresolvedAuthoringRounds(loop) >= AUTHORING_STALL_LIMIT) {
    return `candidate-held: ${unresolvedAuthoringRounds(loop)} unresolved authoring rounds remained under the same admission/decision basis — read the recorded evidence, then rerun`;
  }
  const nextMove = result.nextDecision?.move;
  if (
    (decision.move === "build" || decision.move === "rebuild") &&
    (nextMove === "measure" || nextMove === "rebuild")
  ) {
    return loopGuardTerminal(loop);
  }
  // The terminal names what blocked continuation. Three held runs between truss-w30 and
  // truss-w36-sol each recorded a bare "candidate-held", and the review had to scrape promotion
  // files by hand to learn why each loop ended.
  return result.nextDecision === null
    ? `candidate-held: the ${decision.move} candidate was held and no grounded next decision exists`
    : `candidate-held: the ${decision.move} candidate was held; a next "${result.nextDecision.move}" does not continue in this invocation`;
}

/** Settle every terminal between completed rounds; null continues. */
export function loopTerminal(result: IterationResult, loop: LoopState): string | null {
  const { build, decision } = result;
  const productBoundary = result.buildClauses.find((clause) => clause.startsWith("fixed-product-boundary:"));
  if (productBoundary !== undefined) return productBoundary;
  if (build === "stopped") return `stopped: ${decision.reason}`;
  if (build === "build-failed") return buildFailedTerminal(result, loop);
  if (build === "candidate" && result.steps.promotion?.decision !== "promoted") {
    return heldCandidateTerminal(result, loop);
  }
  return loopGuardTerminal(loop);
}

/**
 * Count unresolved authoring rounds under one active admission/decision basis.
 *
 * A failed build and a held candidate are the same unresolved authoring problem for this guard.
 * Keeping one state means `held -> failed -> held` reaches the same finite allowance as three
 * failed builds, rather than resetting one counter whenever the outcome changes.
 *
 * The key is the active admission/decision basis. Clause codes and prose are not that basis: an
 * A/B alternation stays one stall, while a changed admission digest or decision opens a new one.
 * A changed result matters through its admitted feedback or an adoption, rather than through the
 * wording of a clause.
 *
 * A real adoption resets the state, and admitted evidence advances
 * the key once the next round consumes it. A round that produces no such progress leaves the state
 * intact, so a held candidate cannot evade the allowance by alternating with an evidence-free
 * measurement or by recording a packet no round can read.
 */
export function nextUnresolvedAuthoringStall(
  prev: UnresolvedAuthoringStall | null,
  result: IterationResult,
): UnresolvedAuthoringStall | null {
  const key = unresolvedAuthoringKey(result);
  if (key !== null) {
    return prev?.key === key ? { key, rounds: prev.rounds + 1 } : { key, rounds: 1 };
  }
  // A successful adoption resets authoring stall state. Recording a packet alone is insufficient:
  // previously a new output digest counted as progress, so even a measurement round without useful
  // evidence cleared the allowance a held candidate had already spent. Admitted evidence still
  // clears the streak, one step later and through the key — a published packet becomes the next
  // round's basis, so that round opens a new stall at one round instead of continuing the old one.
  // A packet that reaches no reader changes no basis and clears nothing.
  const adopted = result.build === "adopted" || result.steps.promotion?.decision === "promoted";
  return adopted ? null : prev;
}

/** Identity of one unresolved authoring round, or null for a round that authored no unresolved candidate. */
function unresolvedAuthoringKey(result: IterationResult): string | null {
  const { promotion } = result.steps;
  const unresolved =
    result.build === "build-failed" || (result.build === "candidate" && promotion?.decision === "held");
  if (!unresolved) return null;
  // Key the round by what it consumed. A produced digest is new for every
  // analysed round by construction, so preferring it gave each unresolved round its own key and the
  // declared allowance could not accumulate: run21 iterations 11-13 and run22 each held under one
  // unchanged basis and never reached the limit. A genuinely fresh finding still clears the streak,
  // because a packet measured on the adopted harness is published and becomes the next round's
  // basis — a produced but unconsumable digest is not progress.
  const admissionDigest = result.admissionBasisDigest ?? null;
  return hashJsonValue({ admissionDigest, decision: { move: result.decision.move } });
}
