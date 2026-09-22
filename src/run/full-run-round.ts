/** Sequences one round; next-move and candidate-promotion own its decisions. */
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
  /** The exact public user request, distinct from the framed kickoff. */
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
  /** The repository-relative tree this round measured. */
  measuredTree: string;
  /** Digest of the active admission/difficulty basis read before authoring. */
  admissionBasisDigest?: string | null;
  build: FullRunOutcome["build"];
  buildClauses: string[];
  steps: CandidateEvaluation;
}

/**
 * The loop's operational stop counters. Difficulty evidence is read by the next-move policy, not
 * here.
 */
export interface LoopState {
  budget: CampaignBudgetGate;
  /** Trailing consecutive batteries that recorded only typed non-results and wrote no claim. */
  blockedRounds: number;
  /** The one unresolved authoring stall counter; null before the first unresolved round. */
  authoringStall: UnresolvedAuthoringStall | null;
  /** Trailing consecutive completed measurements after which the selector still chose an
   *  evidence-free measure: nothing the battery produced reached it. */
  stalledMeasureRounds: number;
}

/** Unresolved authoring rounds (failed builds and held candidates) under one active basis. */
export type UnresolvedAuthoringStall = {
  /** Admission/decision identity; promotion clauses are not part of it. */
  key: string;
  /** Number of unresolved authoring rounds since the last real progress. */
  rounds: number;
};

/** The unresolved-authoring allowance; not a global round cap. */
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

/** The campaign context the selector reads, before the build and again for the ending. */
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

/** The decision recomputed after a failed build or held candidate, which `loopTerminal` reads to
 *  decide whether another round may run; null otherwise. */
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

/** True when the candidate was held and its refused claim carries only `repairable` clauses, so
 *  in-loop facts rather than the candidate's bytes decided the hold. */
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
  // The opening evidence names the epoch the build step writes into.
  input.onOpening?.(kickoff, epochPassOf(decision));
  // Every round that read a placement records it, including one that ends the campaign. The
  // write is content-addressed, so repeating it adds no duplicate.
  const placement =
    readout === null
      ? null
      : recordDifficultyDecision({
          campaignRoot: campaignDir(repoRoot, manifest.slug),
          runId,
          slug: manifest.slug,
          difficulty: readout,
        });
  // Only a rebuild authors against the recorded placement.
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

/** The per-round streak counters, owned by full-run-round-counters.ts. */
export { nextBlockedRounds, nextStalledMeasureRounds } from "./full-run-round-counters.ts";

function loopGuardTerminal(loop: LoopState): string | null {
  if (loop.budget.status() === "budget_limited") {
    return "budget-limited: the campaign model-call budget is spent (--iteration-budget raises it)";
  }
  if (loop.blockedRounds >= POLICY.loop.environmentBlockedRounds) {
    return `environment-blocked: ${loop.blockedRounds} consecutive batteries were stopped by the provider or recorded only typed non-results, so none of them produced a claim — another measurement creates no evidence; restore the environment and rerun`;
  }
  // Checked after the environment guard, so a dead provider is not reported as an analysis stall.
  if (loop.stalledMeasureRounds >= POLICY.loop.stalledMeasureRounds) {
    return `measurement-stalled: ${loop.stalledMeasureRounds} consecutive completed measurements admitted no feedback and created no difficulty evidence — another identical battery creates nothing the selector can read; inspect the analysis and admission path, then rerun`;
  }
  return null;
}

function unresolvedAuthoringRounds(loop: LoopState): number {
  return loop.authoringStall?.rounds ?? 0;
}

/** The repository-relative evidence paths behind a terminal: the promotion row for a
 *  `candidate-held` ending, otherwise null. */
export function terminalEvidenceFor(
  terminal: string | null,
  result: IterationResult,
  slug: string,
): string[] | null {
  if (terminal?.startsWith("candidate-held") !== true) return null;
  const { promotion } = result.steps;
  return promotion === null ? null : [`campaigns/${slug}/promotions/${promotion.runId}.json`];
}

/** A failed authoring round may retry when the recomputed decision still authors, since Builder
 *  sessions are stochastic. The retry shares the unresolved-authoring allowance; a stalled or
 *  environment-blocked build stays terminal. */
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
  const clauses = result.buildClauses.length > 0 ? ` (${result.buildClauses.join(", ")})` : "";
  return `build-failed: the final iteration produced no build-admissible candidate${clauses}; earlier recorded iterations keep their own evidence`;
}

/** A held candidate shares the unresolved-authoring allowance with a failed build; an authoring
 *  round may continue into a further measure or rebuild. */
function heldCandidateTerminal(result: IterationResult, loop: LoopState): string | null {
  const { decision } = result;
  if (result.nextDecision?.move === "stop") return `stopped: ${result.nextDecision.reason}`;
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
  // The terminal names what blocked continuation.
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
 * Counts unresolved authoring rounds under one active admission/decision basis. A failed build
 * and a held candidate count alike, and clause wording does not change the key. An adoption resets
 * the state; admitted evidence opens a new key once the next round consumes it; any other round
 * leaves the state as it was.
 */
export function nextUnresolvedAuthoringStall(
  prev: UnresolvedAuthoringStall | null,
  result: IterationResult,
): UnresolvedAuthoringStall | null {
  const key = unresolvedAuthoringKey(result);
  if (key !== null) {
    return prev?.key === key ? { key, rounds: prev.rounds + 1 } : { key, rounds: 1 };
  }
  const adopted = result.build === "adopted" || result.steps.promotion?.decision === "promoted";
  return adopted ? null : prev;
}

/** Identity of one unresolved authoring round, or null for a round that authored no unresolved candidate. */
function unresolvedAuthoringKey(result: IterationResult): string | null {
  const { promotion } = result.steps;
  const unresolved =
    result.build === "build-failed" || (result.build === "candidate" && promotion?.decision === "held");
  if (!unresolved) return null;
  // Key by what the round consumed; a produced digest is new every round and would never repeat.
  const admissionDigest = result.admissionBasisDigest ?? null;
  return hashJsonValue({ admissionDigest, decision: { move: result.decision.move } });
}
