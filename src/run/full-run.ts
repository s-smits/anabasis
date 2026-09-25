/** Run the build → measure → analyse loop from one direct prompt and recorded evidence. */
import { BuilderConversation } from "../author/builder-conversation.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { selectedProductDir } from "./product-versions.ts";
import { campaignDir } from "../meta/campaign-root.ts";
import { join, resolve } from "../meta/path.ts";
import { readClimbReadout } from "./climb-readout.ts";
import { claimsDirFor } from "./claim-write.ts";
import { FROZEN_MANIFEST_PATH } from "../critic/manifest.ts";
import type { AdmittedEvidence } from "../analyse/iteration-analysis.ts";
import type { JudgeReviewsResult } from "../analyse/judge-reviews.ts";
import { setProjectBackendSelection } from "../backends/project-backends.ts";
import { backendPinOf } from "../backends/resolve.ts";
import { fullrunLine, startFullRunObservation } from "../observe/run-observer.ts";
import { analyseStep } from "./analyse-step.ts";
import type { AskManifest } from "./ask-manifest.ts";
import { stopIsolatedCommands } from "../builder/candidate-isolation-runtime.ts";
import { ensureBuilderCommandGuard } from "../builder/command-guard.ts";
import type { BuilderCommandGuardResult } from "../builder/command-guard.ts";
import type { CampaignBuilderCondition } from "../author/campaign-epoch.ts";
import { campaignBudgetGate } from "./campaign-budget.ts";
import { batterySize } from "./battery-sizing.ts";
import { controllerIterationRunId } from "./controller-battery-record-policy.ts";
import { type ControllerRunState, controllerOpeningHandler } from "./controller-evidence.ts";
import { closeControllerRun } from "./full-run-close.ts";
import { directKickoff } from "./direct-input.ts";
import { type FullRunInput, openFullRunLaunch } from "./full-run-launch.ts";
import { type FullRunArgs, parseFullRunArgs } from "./launch-arguments.ts";
import type { ProjectIdentity } from "./launch-project.ts";
import { buildHarness, resolveBuilderCondition } from "./harness-build.ts";
import { type HarnessMeasureResult, measureHarness } from "./harness-measure.ts";
import type { ClaimStage } from "./claim-stages.ts";
import type { PromotionEvidence } from "./candidate-promotion.ts";
import { type BuildClause, fullRunExitStatus } from "./loop-terminal.ts";
import type { NextMove } from "./next-move.ts";
import { SOURCE_IDENTITY } from "./source-identity.ts";
import { keyIfDefined, keysIf } from "../meta/optional-key.ts";

export { directKickoff } from "./direct-input.ts";
export { selectProject, slugForDirectInput } from "./launch-project.ts";

import {
  type IterationResult,
  type UnresolvedAuthoringStall,
  loopTerminal,
  nextUnresolvedAuthoringStall,
  nextBlockedRounds,
  runIteration,
  terminalEvidenceFor,
} from "./full-run-round.ts";
import { isString } from "../meta/json-shape.ts";
import { runtimeProcess } from "../meta/process.ts";
import {
  createSafeguardContext,
  safeguardLogDir,
  safeguardTempRootPressure,
  type SafeguardContext,
} from "../meta/safeguard.ts";
import { cleanStaleTempRootScratch } from "../meta/temp-scratch-clean.ts";
import { ProviderResourceBudget } from "./provider-resource-budget.ts";
import { FullRunClosure } from "./full-run-deadline.ts";
import { campaignVerifierLifetime } from "./verifier-lifetime.ts";
import { VerifierOperationalStop } from "../verify/verifier-lifetime.ts";

export { type FullRunArgs, parseFullRunArgs } from "./launch-arguments.ts";

export interface FullRunDeps {
  build: typeof buildHarness;
  drive: typeof measureHarness;
  analyse: typeof analyseStep;
  ensureDcg?: () => BuilderCommandGuardResult;
}

export { readAdmission } from "./admission.ts";
import { errorMessage } from "../meta/runtime-values.ts";

type ControllerIteration = ControllerRunState["iterations"][number];

/** One controller round as the terminal records it, with the decision that round took. */
type FullRunRound = ControllerIteration & {
  move: NextMove["move"];
  build: FullRunOutcome["build"];
  promotion: PromotionEvidence["decision"] | null;
};

export interface FullRunOutcome {
  slug: string;
  project: ProjectIdentity;
  build: "adopted" | "reused" | "candidate" | "stopped" | "build-failed";
  buildClause: BuildClause | null;
  buildDetail: string | null;
  decision: NextMove;
  promotion: PromotionEvidence | null;
  measure: HarnessMeasureResult | null;
  claimStage: ClaimStage | null;
  judges: JudgeReviewsResult | null;
  admission: AdmittedEvidence | null;
  absentSteps: string[];
  rounds: FullRunRound[];
  /** The last round's terminal reason, including an operator round or time limit.
   *  Callers use this field to determine how the run ended; loopTerminalCode extracts its code.
   *  Null means no terminal reason was supplied. */
  terminal: string | null;
}

/** One run, once the campaign lock is held: what was asked, where it runs, what it may call, what
 *  was admitted, the controller's mutable state and the two host hooks. */
type LockedRun = {
  readonly args: FullRunArgs;
  readonly repoRoot: string;
  readonly deps: FullRunDeps;
  readonly admitted: FullRunInput;
  readonly state: ControllerRunState;
  readonly safeguardContext: SafeguardContext;
  readonly stopRequested: () => Error | null;
  /** The Builder session every round of this run resumes while it can: paused while the controller
   *  measures, reviews and advises, and closed when the run settles. */
  readonly builderConversation: BuilderConversation;
};

function reportRunStart(project: ProjectIdentity, decision: NextMove): void {
  const source =
    SOURCE_IDENTITY === null
      ? "source unattributed (no git)"
      : `source ${SOURCE_IDENTITY.commit.slice(0, 7)}${SOURCE_IDENTITY.dirty ? " (dirty)" : ""}`;
  fullrunLine(
    `${project.id} (project ${project.origin}): ${source}; decision ${decision.move} — ${decision.reason}`,
  );
  if (project.origin === "created") {
    fullrunLine(
      `created project ${project.id}; use --project ${project.id} next time to continue it after changing the prompt`,
    );
  }
}

export async function runFullRun(
  args: FullRunArgs,
  repoRoot: string,
  suppliedDeps?: FullRunDeps,
): Promise<FullRunOutcome> {
  if (args.providerTurnBudget === undefined && suppliedDeps === undefined) {
    throw new Error("fullrun requires an explicit positive --provider-turn-budget");
  }
  // Injected dependency sets are deterministic controller tests and make no real provider call.
  // They retain a finite high cap so their evidence has the production shape without weakening
  // the CLI boundary above.
  const providerTurnBudget = args.providerTurnBudget ?? Number.MAX_SAFE_INTEGER;
  const deps = suppliedDeps ?? { build: buildHarness, drive: measureHarness, analyse: analyseStep };
  const launch = openFullRunLaunch(args, repoRoot);
  const admittedArgs: FullRunArgs = {
    ...args,
    runId: launch.runId,
  };
  const safeguardContext = createSafeguardContext(
    safeguardLogDir(campaignDir(repoRoot, launch.project.id), launch.runId),
  );
  // A per-user temp root that has reached six figures of entries stalls every fresh child spawn
  // in getdirentries64. Remove this product's own stale scratch first, in a bounded sweep, then let
  // `safeguardTempRootPressure` report whatever pressure remains. The run proceeds either way,
  // because the sweep is a mitigation and not a precondition.
  const swept = cleanStaleTempRootScratch();
  if (swept.removed > 0 || swept.failed > 0) {
    console.error(
      `[launch] temp-root sweep: removed ${String(swept.removed)} stale scratch entr${swept.removed === 1 ? "y" : "ies"}, ${String(swept.failed)} failed${swept.reclaimerPid === null ? "; quarantine kept for the next launch" : `; reclaimer pid ${String(swept.reclaimerPid)}`}${swept.deadlineHit ? "; time-bounded, more remain for the next launch" : ""}`,
    );
  }
  safeguardTempRootPressure(safeguardContext);
  const state: ControllerRunState = { opening: null, iterations: [], absentSteps: [] };
  const builderConversation = new BuilderConversation();
  try {
    state.providerBudget = new ProviderResourceBudget(providerTurnBudget, {
      campaignRoot: campaignDir(repoRoot, launch.project.id),
      runId: launch.runId,
    });
  } catch (error) {
    closeControllerRun(repoRoot, launch, state, error);
    throw error;
  }
  const closure = new FullRunClosure(
    state.providerBudget,
    (cause) => closeControllerRun(repoRoot, launch, state, cause),
    async () => {
      stopIsolatedCommands();
      await builderConversation.close();
      const pending = await state.verifierLifetime?.close();
      state.verifierSettled = true;
      if (pending !== undefined && pending.length > 0) {
        throw new VerifierOperationalStop("unsettled-children", pending);
      }
    },
  );
  closure.install();
  try {
    const outcome = await runUnderLock({
      args: admittedArgs,
      repoRoot,
      deps,
      admitted: launch,
      state,
      safeguardContext,
      stopRequested: closure.stopRequested,
      builderConversation,
    });
    await closure.settleAndClose(null);
    return outcome;
  } catch (error) {
    await closure.settleAndClose(error);
    throw error;
  }
}

/** Presence check for the host-native Builder command guard; its result is a stderr line and never
 *  a launch condition, so the command digest stays what the operator typed. */
function ensureDcgForBuilder(args: FullRunArgs, deps: FullRunDeps, builder: CampaignBuilderCondition): void {
  if (args.dcg !== true || builder.kind === "codex") return;
  const supplied = (deps.ensureDcg ?? ensureBuilderCommandGuard)();
  const guard: BuilderCommandGuardResult = {
    ...supplied,
    path: supplied.path === null ? null : resolve(supplied.path),
  };
  if (guard.path === null) {
    fullrunLine(`dcg ${guard.state}: ${guard.skippedReason ?? "no path"}`);
  } else {
    fullrunLine(`dcg ${guard.state}: ${guard.path}`);
  }
}

/** An unset --max-iterations reads as Infinity, so there is no default round cap (operator
 *  decision). Budgets and typed operational stops still apply, and this cap fires only when the
 *  operator supplies one. */
function roundCapTerminal(round: number, roundLimit: number): string | null {
  return round >= roundLimit
    ? `operator-interrupted: round cap ${roundLimit} reached after completed round ${round} (--max-iterations sets it)`
    : null;
}

/** The soft time boundary: read after a round records, so the battery in flight always finishes
 *  and the run overruns the boundary by at most one round. */
function softBoundaryTerminal(
  round: number,
  elapsedMs: number,
  stopAfterMs: number | undefined,
): string | null {
  return stopAfterMs !== undefined && elapsedMs >= stopAfterMs
    ? `operator-interrupted: time boundary ${stopAfterMs} ms reached after completed round ${round} (--stop-after-ms sets it)`
    : null;
}

function roundReporter(
  project: ProjectIdentity,
  slug: string,
  round: number,
  maxIterations: number,
  runId: string,
): (decision: NextMove) => void {
  const label = Number.isFinite(maxIterations) ? `${round}/${maxIterations}` : `${round}`;
  return (decision) => {
    if (round === 1) return reportRunStart(project, decision);
    fullrunLine(`${slug}: round ${label} (${runId}): decision ${decision.move} — ${decision.reason}`);
  };
}

function recordRound(
  rounds: FullRunRound[],
  pending: ControllerIteration,
  terminal: string | null,
  result: IterationResult,
  slug: string,
): void {
  pending.terminal = terminal;
  pending.buildClause = result.buildClause;
  pending.buildDetail = result.buildDetail;
  // Only a terminal with something to cite carries evidence; every other round leaves the recorded
  // iteration row without the key rather than writing an empty list that reads as "cited nothing".
  const cited = terminalEvidenceFor(terminal, result, slug);
  if (cited !== null) pending.terminalEvidence = cited;
  rounds.push({
    ...pending,
    move: result.decision.move,
    build: result.build,
    promotion: result.steps.promotion?.decision ?? null,
  });
}

function startIteration(state: ControllerRunState, baseRunId: string, round: number) {
  const runId = controllerIterationRunId(baseRunId, round);
  const pending: ControllerIteration = {
    runId,
    terminal: null,
    buildClause: null,
    buildDetail: null,
    measured: false,
  };
  state.iterations.push(pending);
  return [runId, pending] as const;
}

function fullRunOutcome(
  manifest: FullRunInput["manifest"],
  project: FullRunInput["project"],
  completed: IterationResult,
  absentSteps: string[],
  rounds: FullRunRound[],
): FullRunOutcome {
  return {
    slug: manifest.slug,
    project,
    build: completed.build,
    buildClause: completed.buildClause,
    buildDetail: completed.buildDetail,
    decision: completed.decision,
    ...completed.steps,
    absentSteps,
    rounds,
    terminal: rounds.at(-1)?.terminal ?? null,
  };
}

async function runUnderLock(run: LockedRun): Promise<FullRunOutcome> {
  const { args, repoRoot, deps, admitted, state, safeguardContext, stopRequested, builderConversation } = run;
  const { prompt, userContext, project } = admitted;
  for (const slot of ["builder", "built", "review"] as const) {
    const selection = args.backendSelections?.[slot];
    if (selection !== undefined) setProjectBackendSelection(repoRoot, project.id, slot, selection);
  }
  const manifest: AskManifest =
    args.expectedTasks === undefined
      ? admitted.manifest
      : { ...admitted.manifest, expectedTasks: batterySize(args.expectedTasks) };
  const baseKickoff = directKickoff(prompt, userContext);
  // SAFETY: the launch path fills the run id from the clock when the operator gave none and then
  // resolves it against the project, so it is set before this call.
  const baseRunId = args.runId as string;
  const roundLimit = args.maxIterations ?? Infinity;
  const { absentSteps } = state;
  const { slots, builder: builderCondition } = resolveBuilderCondition(manifest, {}, repoRoot);
  const runPin = backendPinOf(slots);
  ensureDcgForBuilder(args, deps, builderCondition);
  const observer = startFullRunObservation(repoRoot, manifest.slug, baseRunId, prompt);
  const providerBudget = state.providerBudget;
  if (providerBudget === undefined || providerBudget === null) {
    throw new Error("controller provider resource budget was not initialised");
  }
  const budget = campaignBudgetGate(campaignDir(repoRoot, manifest.slug), providerBudget.runId);
  const openRun = controllerOpeningHandler(state, {
    args,
    repoRoot,
    project,
    runId: baseRunId,
    builder: builderCondition,
    slots,
    providerBudget,
  });
  // The verifier lifetime resolves the selected product, and the selector reads it again inside
  // round one. Either read can refuse a damaged or unreadable retained version, including one
  // whose product bytes are intact. Both refusals used to land before the opening existed, and
  // `closeControllerRun` prepares a terminal only once it does, so the campaign died with exit 2
  // and no recorded reason; a clause present only in stdout is not durable evidence.
  // `openIfUnopened` gives the close path an opening to record against. It binds
  // the epoch on the base kickoff, which is right precisely here: a round that decided nothing has
  // no climb kickoff to preserve, and a round that reached its own decision has already opened
  // on it.
  state.openIfUnopened = () => {
    if (state.opening === null) openRun(baseKickoff, undefined);
  };
  // A fresh readout at the close, so the terminal counts a last battery no later decision saw.
  state.readClimb = () =>
    readClimbReadout(
      selectedProductDir(repoRoot, manifest.slug),
      runPin,
      claimsDirFor(repoRoot, manifest.slug),
      join(repoRoot, FROZEN_MANIFEST_PATH),
    );
  state.verifierLifetime = campaignVerifierLifetime(
    campaignDir(repoRoot, manifest.slug),
    baseRunId,
    selectedProductDir(repoRoot, manifest.slug),
  );
  const rounds: FullRunRound[] = [];
  const loopStartedMs = Date.now();
  let blockedRounds = 0,
    completed: IterationResult | null = null;
  let authoringStall: UnresolvedAuthoringStall | null = null;
  for (let round = 1; ; round += 1) {
    state.verifierLifetime.assertUsable();
    const stop = stopRequested();
    if (stop !== null) throw stop;
    const [runId, pendingIteration] = startIteration(state, baseRunId, round);
    const result = await runIteration({
      args,
      repoRoot,
      manifest,
      runId,
      round,
      baseKickoff,
      publicRequest: prompt,
      userContext,
      runPin,
      builderCondition,
      slots,
      deps,
      observer,
      safeguardContext,
      providerBudget,
      ...keyIfDefined("verifierLifetime", state.verifierLifetime),
      builderConversation,
      stopRequested,
      absentSteps,
      markMeasured: () => {
        pendingIteration.measured = true;
      },
      ...keysIf(round === 1, () => ({ onOpening: openRun })),
      report: roundReporter(project, manifest.slug, round, roundLimit, runId),
    });
    completed = result;
    blockedRounds = nextBlockedRounds(blockedRounds, result);
    authoringStall = nextUnresolvedAuthoringStall(authoringStall, result);
    const curriculumTerminal = loopTerminal(result, {
      budget,
      blockedRounds,
      authoringStall,
    });
    const terminal =
      curriculumTerminal ??
      softBoundaryTerminal(round, Date.now() - loopStartedMs, args.stopAfterMs) ??
      roundCapTerminal(round, roundLimit);
    recordRound(rounds, pendingIteration, terminal, result, manifest.slug);
    // No loop-end summary here: the recorded terminal evidence is the one owner of the ending, and
    // closeControllerRun prints its line only after the evidence is written.
    if (terminal !== null) break;
  }
  return fullRunOutcome(manifest, project, completed, absentSteps, rounds);
}

const invokedAsScript = isString(Bun.argv[1]) && Bun.pathToFileURL(Bun.argv[1]).href === import.meta.url;
if (invokedAsScript) {
  let args: FullRunArgs | undefined;
  try {
    args = parseFullRunArgs(Bun.argv.slice(2));
  } catch (error) {
    fullrunLine(errorMessage(error));
    runtimeProcess.exitCode = 2;
  }
  if (args !== undefined) {
    runFullRun(args, runtimeProcess.cwd()).then(
      (outcome) => {
        // The outcome JSON is the programmatic result; the recorded terminal evidence's closure line
        // is the only end-of-run summary.
        console.log(capturedJsonStringify(outcome, null, 2));
        // Derive the exit status from the terminal reason. Testing whether the last round measured
        // gave candidate-held and budget-limited a zero status and a normal stopped result a one,
        // so CI could report success for an incomplete run and failure for one that reached its
        // intended stop.
        runtimeProcess.exitCode = fullRunExitStatus(outcome.terminal);
      },
      (error) => {
        fullrunLine(`aborted: ${errorMessage(error)}`);
        runtimeProcess.exitCode = 2;
      },
    );
  }
}
