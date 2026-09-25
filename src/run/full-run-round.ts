/** Sequences one round and holds no judgement of its own. What to do next is `next-move.ts`, and
 *  whether a candidate replaces the selected product is `candidate-promotion.ts`; this module
 *  calls them in order, carries the result between them, and counts how many rounds in a row
 *  ended without resolving anything. */
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
import { type BuildClause, CLAUSE_ENDINGS } from "./loop-terminal.ts";
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
  /** The exact public user request. The kickoff carries controller framing around it and is not a
   *  substitute for this identity, which is what the one-line prompt rule is about. */
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
  markMeasured?: () => void;
  /** Given the kickoff the epoch is bound on. */
  onOpening?: (kickoff: string, epochPass: string | undefined) => void;
  report: (decision: NextMove) => void;
}

export interface IterationResult {
  decision: NextMove;
  nextDecision: NextMove | null;
  /** The repository-relative tree this round measured — including the candidate a held or blocked
   *  round leaves recorded, since that tree is what any later reading of the round refers to. */
  measuredTree: string;
  /** Digest of the active admission/difficulty basis read before authoring. */
  admissionBasisDigest?: string | null;
  build: FullRunOutcome["build"];
  buildClause: BuildClause | null;
  buildDetail: string | null;
  steps: CandidateEvaluation;
}

/**
 * The loop's operational stop counters, and nothing else. `loopGuardTerminal` below reads only the
 * three fields here, so the loop ends a run on spent budget, a dead environment or a measurement
 * that reaches no reader — never on a reading of the tasks.
 *
 * Two further counters were tried here and both were wrong in the same way. A staleness guard
 * ending any round that changed no admitted difficulty evidence fires falsely: it reads refused
 * batteries as absent ones, and it stops a run that has just recorded a blocking admission the next
 * decision would have read. A loop-level too-hard floor — a raw point pass-rate counter over main
 * claims — duplicates the difficulty selector's decision while being blind to the
 * verified-versus-unaccepted distinction, so three rounds of admission refusals end the loop as
 * "too hard" after the selector has already excluded that conclusion. Both are the loop answering a
 * question the decision layer owns, which is why difficulty evidence is read by the next-move
 * policy and the loop keeps only the counters.
 */
export interface LoopState {
  budget: CampaignBudgetGate;
  /** Trailing consecutive batteries that recorded only typed non-results and wrote no claim. */
  blockedRounds: number;
  /** The one unresolved authoring stall counter; null before the first unresolved round. */
  authoringStall: UnresolvedAuthoringStall | null;
}

/** One finite allowance for unresolved authoring work under an unchanged admission or decision
 *  basis. A held candidate is a completed authoring round rather than a failed one, so
 *  `buildFailedRounds` on its own never limited it, and a run could alternate holds with failures
 *  indefinitely. Counting both against their consumed decision basis fixes that, and keying on the
 *  basis rather than the outcome means changed feedback or measured progress prevents unrelated
 *  holds from accumulating as one stall. */
export type UnresolvedAuthoringStall = {
  /** Admission and decision identity. Promotion clauses are deliberately not part of this key, so
   *  a re-worded clause cannot reset an allowance the round has already spent. */
  key: string;
  /** Number of unresolved authoring rounds since the last real progress. */
  rounds: number;
};

/** The single finite authoring allowance. It is intentionally not a global round cap: a campaign
 *  that keeps producing candidates keeps running. */
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

/** The campaign context the selector reads. `runIteration` asks the selector twice against the
 *  same tree — once to choose this round's move, once after the build to read the ending — so the
 *  two calls share one owner here rather than assembling the same fields twice and drifting. */
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

/** The decision recomputed after a failed build or a held candidate, which `loopTerminal` reads to
 *  decide whether another round may run; null otherwise. The condition and the selector call sit
 *  together in one function so that both outcomes are read off the same current evidence, rather
 *  than one branch testing a stale decision. */
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

/** True when the candidate was held and its refused claim carries only `repairable` clauses, which
 *  means in-loop facts rather than the candidate's own bytes decided the hold — and a packet spent
 *  on such a round is worth keeping for one more rebuild. Every other shape returns false and keeps
 *  the ordinary settlement: a claim that was created and still held says the bytes were the
 *  problem, and a candidate that was never measured has no claim to read at all. */
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
  // A reopening pass opens in the epoch that pass creates, so the opening evidence has to name the
  // same epoch the build step will write into rather than the one the round started in.
  input.onOpening?.(kickoff, epochPassOf(decision));
  // Every round that read a placement records it, whatever it then decided to do about it. The
  // record is the rebuild's workspace-reset key, the review's row for what each round did, and —
  // for the placement that ends a campaign — the only durable trace that it was read at all;
  // without this write, a run stops on a placement that exists in no difficulty-decisions file. The
  // write is content-addressed, so a round that records without authoring adds one file and no
  // duplicate.
  const placement =
    readout === null
      ? null
      : recordDifficultyDecision({
          campaignRoot: campaignDir(repoRoot, manifest.slug),
          runId,
          slug: manifest.slug,
          difficulty: readout,
        });
  // The placement travels into the build step only where the round authors against it, which is a
  // rebuild. Every other move records the reading and passes it nothing.
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
    ...keyIfDefined("markMeasured", input.markMeasured),
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
    buildClause: built.buildClause,
    buildDetail: built.buildDetail,
    steps,
  };
}

/**
 * Count consecutive environment-blocked batteries. A null claim after an executed battery states
 * exactly that (harness-measure claims contract): every attempted case recorded as a typed
 * non-result of an environment-owned kind, which is what `BatteryVerificationNonResult` is raised
 * on after the battery record is already on disk. Rounds that ran no battery leave the counter
 * unchanged — only a completed measurement can say whether the environment recovered.
 *
 * A provider-stopped battery that still created a claim measured enough cases to be read, so it
 * resets the counter like any other delivery. One whose claim was refused counts instead. Read as a
 * delivery it would reset the counter on a battery that was almost entirely non-results, the
 * declared allowance would never engage, and authoring round after authoring round would open
 * against a dead provider until the Builder's own turn was refused. A dead provider is not
 * remeasured merely because rounds remain.
 */
export function nextBlockedRounds(prev: number, result: IterationResult): number {
  const { measure } = result.steps;
  if (measure === null) return prev;
  // Whether the environment carried this battery far enough to say anything. A written claim
  // normally proves it completed turns, with one exception: the provider-stop rule ends scheduling
  // after five consecutive provider non-results and records the battery `provider-stopped`, and
  // the claim it then writes is a refusal for that same dead provider rather than evidence that
  // the provider worked.
  const delivered =
    measure.claim !== null && (measure.claim.created || measure.disposition !== "provider-stopped");
  return delivered ? 0 : prev + 1;
}

// Gate audit 2026-09-25 (docs/gate-audit.md, environment-blocked-ceiling): kept: batteries of typed non-results create no evidence, so remeasuring the same environment buys nothing (rule 15)
function loopGuardTerminal(loop: LoopState): string | null {
  if (loop.budget.status() === "budget_limited") {
    return "budget-limited: the campaign model-call budget is spent (--iteration-budget raises it)";
  }
  if (loop.blockedRounds >= POLICY.loop.environmentBlockedRounds) {
    return `environment-blocked: ${loop.blockedRounds} consecutive batteries were stopped by the provider or recorded only typed non-results, so none of them produced a claim — another measurement creates no evidence; restore the environment and rerun`;
  }
  return null;
}

function unresolvedAuthoringRounds(loop: LoopState): number {
  return loop.authoringStall?.rounds ?? 0;
}

/** The repository-relative evidence paths behind a terminal; null when the ending cites nothing.
 *  A `candidate-held` ending cites the recorded promotion row, because prose alone leaves whoever
 *  reads a run that closed on several held clauses having to know which file to open. Every other
 *  terminal stays prose-only, since its reason is in the terminal string itself. */
export function terminalEvidenceFor(
  terminal: string | null,
  result: IterationResult,
  slug: string,
): string[] | null {
  if (terminal?.startsWith("candidate-held") !== true) return null;
  const { promotion } = result.steps;
  return promotion === null ? null : [`campaigns/${slug}/promotions/${promotion.runId}.json`];
}

/** A failed authoring round whose recomputed decision still names an authoring move may try again,
 *  when `CLAUSE_ENDINGS` gives its clause no ending of its own; without the retry a campaign dies
 *  on its first failed round. The retry is bounded by the shared unresolved-authoring allowance
 *  rather than being free. */
// Gate audit 2026-09-25 (docs/gate-audit.md, build-failed-ceiling): kept: a round that admits no candidate measures nothing, so its retries share one bounded allowance
function buildFailedTerminal(result: IterationResult, loop: LoopState): string | null {
  if (result.nextDecision?.move === "stop") return `stopped: ${result.nextDecision.reason}`;
  const retryMove = result.nextDecision?.move;
  const ending = result.buildClause === null ? null : CLAUSE_ENDINGS[result.buildClause];
  if (
    (retryMove === "build" || retryMove === "rebuild") &&
    unresolvedAuthoringRounds(loop) < AUTHORING_STALL_LIMIT &&
    ending === null
  ) {
    return loopGuardTerminal(loop);
  }
  const named = [result.buildClause, result.buildDetail].filter((part) => part !== null);
  const clause = named.length > 0 ? ` (${named.join("; ")})` : "";
  // The terminal says the final iteration failed, not the run: a later failed authoring round does
  // not erase the cases earlier rounds measured, and a run can end this way holding dozens of them.
  return `${ending ?? "build-failed"}: the final iteration produced no build-admissible candidate${clause}; earlier recorded iterations keep their own evidence`;
}

/** A held candidate keeps its packet and, once its battery verified a case, shares the
 *  unresolved-authoring allowance with a failed build, so an authoring round may continue into a further measure or rebuild. What decides
 *  whether the next round is a new experiment is the active admission and decision key, not the
 *  wording of the clauses: clause prose alone cannot reset an allowance. */
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
  // The terminal names what blocked continuation rather than reporting a bare code: a run that
  // records only "candidate-held" leaves a reviewer opening promotion files by hand to learn why
  // the loop ended.
  return result.nextDecision === null
    ? `candidate-held: the ${decision.move} candidate was held and no grounded next decision exists`
    : `candidate-held: the ${decision.move} candidate was held; a next "${result.nextDecision.move}" does not continue in this invocation`;
}

/** Settle every terminal between completed rounds; null continues. */
export function loopTerminal(result: IterationResult, loop: LoopState): string | null {
  const { build, decision } = result;
  if (result.buildClause === "fixed-product-boundary" && result.buildDetail !== null) {
    return result.buildDetail;
  }
  if (build === "stopped") return `stopped: ${decision.reason}`;
  if (build === "build-failed") return buildFailedTerminal(result, loop);
  if (build === "candidate" && result.steps.promotion?.decision !== "promoted") {
    return heldCandidateTerminal(result, loop);
  }
  return loopGuardTerminal(loop);
}

/**
 * Counts unresolved authoring rounds under one active admission and decision basis.
 *
 * A failed build and a held candidate whose battery verified a case are the same unresolved
 * authoring problem as far as this guard is concerned, so they share one state. That is what makes `held -> failed -> held` reach
 * the same finite allowance as three failed builds, instead of resetting one counter every time
 * the outcome changes shape.
 *
 * The key is the active basis, and clause codes and prose are deliberately not part of it: an A/B
 * alternation of clauses stays one stall, while a changed admission digest or a changed decision
 * opens a new one. A changed result therefore matters through its admitted feedback or through an
 * adoption, rather than through how a clause happened to be worded.
 *
 * A real adoption resets the state, and admitted evidence advances the key once the next round
 * consumes it. A round that produces neither leaves the state intact, so a held candidate cannot
 * evade the allowance by alternating with an evidence-free measurement or by recording a packet
 * that no round can read.
 */
export function nextUnresolvedAuthoringStall(
  prev: UnresolvedAuthoringStall | null,
  result: IterationResult,
): UnresolvedAuthoringStall | null {
  const key = unresolvedAuthoringKey(result);
  if (key !== null) {
    return prev?.key === key ? { key, rounds: prev.rounds + 1 } : { key, rounds: 1 };
  }
  // A successful adoption resets the stall state. Recording a packet on its own is not enough:
  // counting a new output digest as progress lets a measurement round carrying no useful evidence
  // clear an allowance a held candidate has already spent. Admitted evidence still clears the
  // streak, one step later and through the key — a published packet becomes the next round's basis,
  // so that round opens a new stall at one round rather than continuing the old one, while a
  // packet that reaches no reader changes no basis and clears nothing.
  const adopted = result.build === "adopted" || result.steps.promotion?.decision === "promoted";
  return adopted ? null : prev;
}

/** Identity of one unresolved authoring round, or null for a round that authored no unresolved candidate. */
function unresolvedAuthoringKey(result: IterationResult): string | null {
  const { promotion } = result.steps;
  // Gate audit 2026-09-25 (docs/gate-audit.md, held-candidate-ceiling): commented out (unsure): a zero-verified battery is the hard battery prior 10 asks for, not an authoring stall
  // const unresolved =
  //   result.build === "build-failed" || (result.build === "candidate" && promotion?.decision === "held");
  const unresolved =
    result.build === "build-failed" ||
    (result.build === "candidate" && promotion?.decision === "held" && promotion.battery?.verified !== 0);
  if (!unresolved) return null;
  // Key the round by what it consumed. A produced digest is new for every analysed round by
  // construction, so preferring it gives each unresolved round its own key and the declared
  // allowance never accumulates: round after round holds under one unchanged basis and the limit is
  // never reached. A genuinely fresh finding still clears the streak,
  // because a packet measured on the adopted harness is published and becomes the next round's
  // basis — what is not progress is a digest that was produced and can be consumed by nobody.
  const admissionDigest = result.admissionBasisDigest ?? null;
  return hashJsonValue({ admissionDigest, decision: { move: result.decision.move } });
}
