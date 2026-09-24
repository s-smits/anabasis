/** Build step: author, probe, gate and adopt one prompt-driven harness. */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { existsSync, mkdirSync } from "../meta/filesystem.ts";
import { campaignDir } from "../meta/campaign-root.ts";
import { join, relative } from "../meta/path.ts";
import type { BuilderConversation } from "../author/builder-conversation.ts";
import { carryMemoryForward } from "../author/builder-memory.ts";
import { type CampaignEpochEvidence, selectCampaignEpoch, writeCompleted } from "../author/campaign-epoch.ts";
import {
  attachIssueReadings,
  latestRebuildAdvicePath,
  readLatestRebuildAdvice,
} from "../author/rebuild-advice.ts";
import { type EpochReviewInput, runEpochReview } from "../review/epoch-reviewer.ts";
import { publicEpochReview } from "../review/epoch-review-public.ts";
import type {
  AdmissionLineage,
  CampaignOutcome,
  DiagnosisInput,
  IterationEvidence,
  PriorEvidence,
} from "../author/campaign-types.ts";
import { makeAgentToolsProbes } from "../author/agent-tools-session.ts";
import type { ProbeControlsOptions } from "../truth/probes.ts";
import { loadRepoEnv } from "../backends/env.ts";
import { type ResolvedSlots, resolveSlots } from "../backends/resolve.ts";
import type { PreparedUserContext } from "../builder/user-context.ts";
import type { HarnessAuthoring } from "../critic/types.ts";
import { type RunObserver, createRunObserver } from "../observe/run-observer.ts";
import { readValidatedBrief } from "../truth/public-resources.ts";
import { makeProbeControls } from "../truth/probes.ts";
import type { VerifierHostHandle } from "../verify/verifier-port.ts";
import type { AskManifest } from "./ask-manifest.ts";
import { builderSessionCapMs } from "./builder-backend.ts";
import {
  runBuilderCampaign,
  type BuilderCampaignDeps,
  type BuilderCampaignInput,
} from "./builder-campaign.ts";
import { type BuilderRuntimeFactory, productionBuilderRuntime } from "./builder-runtime.ts";
import { campaignBudgetGate, setTurnBudget } from "./campaign-budget.ts";
import { makeCensusGate } from "./census-gate.ts";
import { assertSupportedHostRuntime } from "./host-runtime-policy.ts";
import { makeSolvabilityCensusGate } from "./solvability-gate.ts";
import type { VerifierLifetime } from "../verify/verifier-lifetime.ts";
import { campaignVerifierLifetime } from "./verifier-lifetime.ts";
import { closeVerifierLifetime } from "../verify/verifier-lifetime.ts";
import { keyIfDefined, keyIfTruthy, keysIf } from "../meta/optional-key.ts";
import type { OptionalEnvValues } from "../backends/scrub-env.ts";
import { runtimeProcess } from "../meta/process.ts";
import type { SafeguardContext } from "../meta/safeguard.ts";
import type { ProviderResourceBudget } from "./provider-resource-budget.ts";
import {
  publishProductVersion,
  measuredSelectedProduct,
  selectedProductDir,
  selectInitialProduct,
} from "./product-versions.ts";
import { CONFORMANCE_FILE } from "../claim/conformance-evidence.ts";
import type { AnalysisFinding } from "../analyse/iteration-analysis.ts";

export interface HarnessBuildOptions {
  verifierLifetime?: VerifierLifetime;
  repoRoot?: string;
  /** Full-run slot snapshot. Phase entrypoints resolve only when no controller snapshot is supplied. */
  resolvedSlots?: ResolvedSlots;
  /** The user's request, rendered by the direct-input owner. Generic callers must state it. */
  kickoff?: string;
  /** Controller-derived advisory prose delivered beside the kickoff, never inside it — the
   *  kickoff's content hash keys the epoch, and an advisory note must not re-key a campaign. */
  advisoryNote?: string;
  measured?: BuilderCampaignInput["measured"];
  /** The run's pass-rate band, read from `thresholds.frozen.yaml` by the controller. The Builder's
   *  difficulty sentences quote the counts it implies, so it must be the band the placement is read
   *  against. Absent, the prompt falls back to the code-owned policy row. */
  band?: [number, number];
  /** Immutable public context available through the context tool. */
  userContext?: PreparedUserContext;
  /** Run-bound diagnostic channel supplied by the full-run controller. */
  safeguardContext?: SafeguardContext;
  /** Saved campaign model-call limit; sets the budget when stated. */
  turnBudget?: number | null;
  /** Finite controller-run budget shared by Builder, Built and Review turns. */
  providerBudget?: ProviderResourceBudget;
  /** Builder session turn ceiling for this iteration; absent, the round has none. */
  maxBuilderTurns?: number;
  model?: string;
  /** Builder effort override, recorded in backends.json. Otherwise use the resolved slot's
   *  effort, then medium. Each transport validates the values it accepts. */
  effort?: string;
  /** Explicit Builder session cap; wins over HARNESS_BUILDER_SESSION_CAP_MS. Absent both, the
   *  session has no overall time cap; the per-turn limit and the no-progress rule still apply. */
  turnTimeoutMs?: number;
  /** Test override for the verifier host; production always opens the live subprocess host. */
  createVerifier?: () => VerifierHostHandle;
  /** Test and simulation override for the Builder session runtime; production always composes
   *  the live transport through `productionBuilderRuntime`. A scripted runtime still goes through
   *  the real campaign, submit, census, solvability and adoption path. */
  builderRuntime?: BuilderRuntimeFactory;
  /** Called when the campaign records an iteration's outcome. */
  onIteration?: (evidence: IterationEvidence) => void;
  priorEvidence?: PriorEvidence;
  admissionLineage?: AdmissionLineage;
  diagnosisInput?: DiagnosisInput;
  /** Admitted-history public fingerprints for the A→B→A refusal of a task-only experiment. */
  priorPublicTaskFingerprints?: readonly string[];
  lastBattery?: BuilderCampaignInput["lastBattery"];
  /** The selector's reading of the adopted product's batteries; a held limit refuses a product change. */
  /** Controller iteration identity for this immutable product version. */
  productVersionId?: string;
  /** The reopen evidence, keying the epoch this pass opens and the harness_reset it mounts. A
   *  reopening pass creates its own epoch rather than writing a second harness lineage into the one
   *  an earlier pass recorded. */
  epochPass?: string;
  /** Authoring scope; accepted bytes determine the measured experiment. */
  experiment?: HarnessAuthoring;
  observer?: RunObserver;
  /** The controller run's one Builder conversation, resumed by this build when its session can
   *  continue. Absent, the build opens and closes its own session. */
  builderConversation?: BuilderConversation;
}

/** Everything the authoring reviewer carries from the build into each mid-session review. It is
 *  the same record `runEpochReview` is called with, so it travels as one. */
type AuthoringReviewBinding = {
  readonly repoRoot: string;
  readonly slug: string;
  readonly review: EpochReviewInput["review"];
  readonly publicRequest: string;
  readonly observer: RunObserver;
  readonly providerBudget: HarnessBuildOptions["providerBudget"];
};

/** What the surrounding epoch already settled by the time the build itself runs: which epoch it
 *  is, the Builder condition it opens under, the campaign budget it spends and the probe walls. */
type EpochBuildContext = {
  readonly epoch: CampaignEpochEvidence;
  readonly builderCondition: ReturnType<typeof resolveBuilderCondition>;
  readonly budget: ReturnType<typeof campaignBudgetGate>;
  readonly probeOptions: ProbeControlsOptions & {
    safeguardContext?: SafeguardContext;
    verifierLifetime: VerifierLifetime;
  };
};

/** Resolve the slots a build records. */
export function resolveBuilderSlots(
  repoRoot: string,
  slug: string,
  processEnv: OptionalEnvValues = Bun.env,
): ResolvedSlots {
  return resolveSlots(repoRoot, slug, loadRepoEnv(repoRoot, processEnv));
}

/** Add the Builder's effort and optional operator model override to the slots recorded in
 *  backends.json. Effort is a plain string because each transport accepts its own vocabulary;
 *  Codex effort values need not be Claude effort values. */
export function withBuilderPin(slots: ResolvedSlots, pin: { effort: string; model?: string }): ResolvedSlots {
  return {
    ...slots,
    builder: {
      ...slots.builder,
      reasoningEffort: pin.effort,
      ...keyIfDefined("model", pin.model),
    },
  };
}

export function resolveBuilderCondition(
  manifest: AskManifest,
  options: HarnessBuildOptions,
  repoRoot: string,
) {
  const slots = options.resolvedSlots ?? resolveBuilderSlots(repoRoot, manifest.slug);
  const effort = options.effort ?? slots.builder.reasoningEffort;
  const denominated = withBuilderPin(slots, {
    effort,
    ...keyIfDefined("model", options.model),
  });
  return {
    slots: denominated,
    builder: {
      kind: denominated.builder.kind,
      model: denominated.builder.model ?? null,
      reasoningEffort: effort,
      ...keyIfTruthy("providerPin", denominated.builder.providerPin),
    },
    // A sibling of `builder`, never a member: the epoch is keyed on the builder condition, and an
    // operational timeout must not change the epoch. Resolving here makes a malformed
    // HARNESS_BUILDER_SESSION_CAP_MS refuse at resolution — fullrun preflight — before any epoch exists.
    ...keyIfDefined("turnTimeoutMs", builderSessionCapMs(options.turnTimeoutMs, loadRepoEnv(repoRoot).env)),
  };
}

export async function buildHarness(
  manifest: AskManifest,
  options: HarnessBuildOptions = {},
): Promise<CampaignOutcome & { adopted: boolean; epoch: CampaignEpochEvidence }> {
  assertSupportedHostRuntime();
  const repoRoot = options.repoRoot ?? runtimeProcess.cwd();
  if (options.kickoff === undefined || options.kickoff.trim() === "") {
    throw new Error(
      "buildHarness requires the direct user kickoff; it does not resolve an on-disk request bundle",
    );
  }
  const { kickoff } = options;
  const campaignRoot = campaignDir(repoRoot, manifest.slug);
  mkdirSync(campaignRoot, { recursive: true });
  // Store usage at campaign root so opening a successor epoch cannot reset the budget.
  // Fullrun applies its requested cap under the campaign lock before the controller opening;
  // this idempotent write remains for direct build callers that intentionally bypass fullrun.
  if (options.turnBudget !== undefined) setTurnBudget(campaignRoot, options.turnBudget);
  const budget = campaignBudgetGate(campaignRoot, options.providerBudget?.runId);
  const verifierLifetime =
    options.verifierLifetime ??
    campaignVerifierLifetime(campaignRoot, undefined, selectedProductDir(repoRoot, manifest.slug));
  let failed = false;
  try {
    verifierLifetime.assertUsable();
    budget.assertAttemptAvailable();
    const builderCondition = resolveBuilderCondition(manifest, options, repoRoot);
    const probeOptions = {
      verifierLifetime,
      ...keyIfDefined("createVerifier", options.createVerifier),
      ...keyIfDefined("safeguardContext", options.safeguardContext),
    };
    const epoch = selectCampaignEpoch(campaignRoot, {
      kickoff,
      builder: builderCondition.builder,
      ...keyIfDefined("pass", options.epochPass),
    });
    carryMemoryForward(campaignRoot, epoch);
    if (budget.status() === "budget_limited") {
      return { buildAdmissible: false, clauses: ["budget-limited"], iterations: [], adopted: false, epoch };
    }
    return await runEpochBuild(
      manifest,
      { ...options, kickoff },
      {
        epoch,
        builderCondition,
        budget,
        probeOptions,
      },
    );
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (options.verifierLifetime === undefined) {
      await closeVerifierLifetime(verifierLifetime, failed ? "failed" : "clean");
    }
  }
}

/** A repair review follows a clear check, and the header has to say so. Left unsaid, a Builder
 *  reads the review's findings as a condition on the check it just cleared and returns to authoring
 *  instead of submitting. */
const REVIEW_HEADER = {
  repair: "Epoch review of the candidate your clear correctness_check just previewed.",
  backstop: "Epoch review of the live workspace.",
} as const;

/** One reading of the whole review: the request once, then what blocks submit. An advisory row
 *  crosses only with a probe behind it, because advisory rows arrive in bulk, repeat one another
 *  and promise themselves "for the next round", and no reader carries them anywhere that changes
 *  what the Builder does. The post-battery review weighs the product again. */
export function authoringReviewText(
  trigger: keyof typeof REVIEW_HEADER,
  status: string,
  request: string,
  findings: readonly Pick<AnalysisFinding, "severity" | "claim" | "probes">[],
): string {
  const shown = findings.filter(
    (finding) => finding.severity !== "advisory" || (finding.probes ?? []).length > 0,
  );
  const blocking = shown.filter((finding) => finding.severity !== "advisory").length;
  const route =
    blocking === 0
      ? "No finding blocks submit."
      : `${String(blocking)} blocking finding(s) name a demonstrated defect: repair those before submit.`;
  const rows = shown.map((finding) => `- [${finding.severity ?? "blocking"}] ${finding.claim}`);
  return [
    `${REVIEW_HEADER[trigger]} Review ${status}. ${shown.length === 0 ? "No finding blocks submit." : route}`,
    ...(shown.length === 0 ? [] : [`Original request: ${capturedJsonStringify(request)}`]),
    ...rows,
  ].join("\n");
}

/** Carry an authoring review's disputes onto the issue register the next build reads. The measured
 *  path does this inside its own publish step; this one used to write the review file and stop, so
 *  a dispute the reviewer was invited to make reached nothing that reads it, and the next build
 *  was still told to rebuild the agent around an issue that a review of the tree had called an
 *  evaluation defect. The register is re-read here rather than reused from the turn above, because
 *  a measured battery may have published between the two moments. */
export function recordAuthoringDisputes(
  repoRoot: string,
  slug: string,
  disputes: ReadonlyArray<{ issueId: string; reason: string }>,
): void {
  if (disputes.length === 0) return;
  const prior = readLatestRebuildAdvice(repoRoot, slug);
  if (prior === null) return;
  const carried = attachIssueReadings(prior, { disputes });
  if (carried !== prior) writeCompleted(latestRebuildAdvicePath(repoRoot, slug), carried);
}

/** The existing Epoch Reviewer over an authoring tree, which the campaign invokes at a completed
 *  host tool call. Its evidence is recorded beside the measured reviews with a null condition;
 *  only the public projection of its findings returns to the Builder. */
function authoringReviewer(
  binding: AuthoringReviewBinding,
): NonNullable<BuilderCampaignDeps["reviewAuthoring"]> {
  const { repoRoot, slug, review, publicRequest, observer, providerBudget } = binding;
  return async (root, trigger, experiment) => {
    const runId = `authoring-${Bun.randomUUIDv7()}`;
    const advice = readLatestRebuildAdvice(repoRoot, slug);
    const result = await runEpochReview({
      repoRoot,
      slug,
      runId,
      treeRoot: relative(repoRoot, root),
      analysis: null,
      priorAdvice: advice,
      priorAdviceOnSeededTree: advice === null ? null : measuredSelectedProduct(repoRoot, slug, advice.runId),
      experiment,
      review,
      publicRequest,
      observer,
      ...keyIfDefined("providerBudget", providerBudget),
    });
    const dir = join(campaignDir(repoRoot, slug), "analysis");
    mkdirSync(dir, { recursive: true });
    writeCompleted(join(dir, `${runId}-epoch-review.json`), result);
    const { findings, disputes } = publicEpochReview(result, {
      brief: result.status === "completed" ? readValidatedBrief(root) : null,
      deferAdvisory: true,
    });
    recordAuthoringDisputes(repoRoot, slug, disputes);
    return authoringReviewText(trigger, result.status, publicRequest, findings);
  };
}

async function runEpochBuild(
  manifest: AskManifest,
  options: HarnessBuildOptions & { kickoff: string },
  context: EpochBuildContext,
) {
  const { epoch, builderCondition, budget, probeOptions } = context;
  const repoRoot = options.repoRoot ?? runtimeProcess.cwd();
  const { kickoff } = options;
  const adoptedDir = selectedProductDir(repoRoot, manifest.slug);
  const { verifierLifetime } = probeOptions;
  const observer = options.observer ?? createRunObserver(repoRoot, manifest.slug, epoch.key);
  const runtime = await (options.builderRuntime ?? productionBuilderRuntime)(
    manifest,
    { ...keyIfDefined("safeguardContext", options.safeguardContext) },
    repoRoot,
    epoch.dir,
    builderCondition,
  );
  // Submit and correctness_check share the census on the same snapshot.
  const probeControls = makeProbeControls(probeOptions);
  const gates = makeCensusGate({
    verifierLifetime,
    probeControls,
    expectedTasks: manifest.expectedTasks,
    solvability: makeSolvabilityCensusGate(probeOptions),
  });
  const outcome = await runBuilderCampaign(
    {
      campaignDir: epoch.dir,
      slug: manifest.slug,
      kickoff,
      webSearch: runtime.webSearch,
      expectedTasks: manifest.expectedTasks,
      ...keyIfDefined("minTasks", manifest.minTasks),
      ...keyIfDefined("maxTurns", options.maxBuilderTurns),
      ...keyIfDefined("experiment", options.experiment),
      // An adopted product opens the next experiment; submit proves its actual byte scope.
      ...keysIf(existsSync(adoptedDir), () => ({ adoptedDir })),
      ...keyIfDefined("priorEvidence", options.priorEvidence),
      ...keyIfDefined("admissionLineage", options.admissionLineage),
      ...keyIfDefined("diagnosisInput", options.diagnosisInput),
      ...keyIfDefined("advisoryNote", options.advisoryNote),
      ...keyIfDefined("measured", options.measured),
      ...keyIfDefined("userContext", options.userContext),
      ...keyIfDefined("band", options.band),
      ...keyIfDefined("priorPublicTaskFingerprints", options.priorPublicTaskFingerprints),
      ...keyIfDefined("lastBattery", options.lastBattery),
      // A reopen is the one round harness_reset works in; its pass keys the once-per-scope rule,
      // so a resumed round finds its own reset in history rather than wiping its later work.
      ...keyIfDefined("resetKey", options.epochPass),
    },
    {
      open: runtime.open,
      ...keyIfDefined("recordSession", runtime.recordSession),
      ...keyIfDefined("conversation", options.builderConversation),
      tools: runtime.tools,
      ...keyIfDefined("builtSolver", runtime.builtSolver),
      verifierLifetime,
      ...keysIf(builderCondition.slots.review.enabled, () => ({
        reviewAuthoring: authoringReviewer({
          repoRoot,
          slug: manifest.slug,
          review: builderCondition.slots.review,
          publicRequest: kickoff,
          observer,
          providerBudget: options.providerBudget,
        }),
      })),
      ...keyIfDefined("turnTimeoutMs", builderCondition.turnTimeoutMs),
      toolsProbes: makeAgentToolsProbes,
      gates,
      budget,
      attemptGate: budget,
      ...keyIfDefined("providerBudget", options.providerBudget),
      observer,
      ...keyIfDefined("safeguardContext", options.safeguardContext),
      ...keyIfDefined("onIteration", options.onIteration),
    },
  );
  if (outcome.buildAdmissible) {
    const id = options.productVersionId ?? crypto.randomUUID();
    publishProductVersion({
      repoRoot,
      slug: manifest.slug,
      id,
      acceptedSnapshot: outcome.acceptedSnapshot,
      fingerprint: outcome.harness.fingerprint,
      conformancePath: join(outcome.iterationDir, CONFORMANCE_FILE),
    });
    selectInitialProduct(repoRoot, manifest.slug, id);
  }
  return { ...outcome, adopted: outcome.buildAdmissible, epoch };
}
