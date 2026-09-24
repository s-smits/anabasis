/**
 * Measures an adopted harness in the Build → Measure → Analyse flow.
 *
 * The host verifier owns correctness. The Main Judge runs during the battery, on the session
 * passed through the evaluation options below, and records calibrated disagreement for later
 * analysis; its advice changes no truth score, case row, denominator or claim eligibility. One
 * measurement path serves every domain, because the AskManifest supplies the task settings this
 * entrypoint once hardcoded and the controller supplies that manifest along with the request and
 * the selected product. Nothing here describes the request in a command grammar of its own.
 *
 * The module connects components rather than adding behaviour of its own: slot resolution selects
 * the Built engine, transport support and executed isolation probes establish what isolation
 * evidence exists, and that result is recorded before any paid turn — including contractual
 * isolation, when contractual is all the checks establish, because a battery that spent turns
 * before the probe cannot say afterwards what it ran under. `driveBattery` owns fingerprinting,
 * evaluation and case rows.
 *
 * One battery per iteration, under the iteration's own run id. The second battery this once ran —
 * the same harness with and without adviser tools, so a paired repair contest could read a delta —
 * went when the repair experiment did.
 */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { existsSync, mkdirSync } from "../meta/filesystem.ts";
import { campaignDir } from "../meta/campaign-root.ts";
import { dirname, join } from "../meta/path.ts";
import { loadRepoEnv } from "../backends/env.ts";
import type { OptionalEnvValues } from "../backends/scrub-env.ts";
import type { ExperimentAuthoring } from "./experiment-freeze.ts";
import { builtCapabilities, piBuiltReadAllowRoots, resolvePiBuiltRuntime } from "../backends/pi-built.ts";
import { type ResolvedSlots, backendPinOf, resolveSlots } from "../backends/resolve.ts";
import { type SessionProfileEvidence, composedIsolation } from "../backends/session-isolation.ts";
import { CASE_RECORD_FILE, type CaseIsolationEvidence, type RunCondition } from "../claim/case-record.ts";
import { type ConformanceEvidence, readBoundConformance } from "../claim/conformance-evidence.ts";
import { FROZEN_MANIFEST_PATH, loadFrozenManifest } from "../critic/manifest.ts";
import { fullrunLine, createRunObserver, type RunObserver } from "../observe/run-observer.ts";
import {
  type BatteryDisposition,
  BatteryVerificationNonResult,
  batteryPath,
  readBatteryJoinSlice,
} from "../truth/battery-record.ts";
import type { Toolset } from "../truth/contracts.ts";
import type { JudgeSession } from "../truth/judge.ts";
import type { Solver } from "../truth/solve.ts";
import type { BuildTask } from "../truth/tasks.ts";
import { type HostSolveIsolationEvidence, probeHostSolveReadDeny } from "../verify/solve-sandbox.ts";
import type { VerifierHostHandle } from "../verify/verifier-port.ts";
import type { AskManifest } from "./ask-manifest.ts";
import { builtBatteryRuntime, builtSolveIsolation } from "./built-agent-runtime.ts";
import { type WrittenRunClaim, claimsDirFor, writeRunClaim } from "./claim-write.ts";
import { limitMarginFile } from "./limit-margin.ts";
import { assertSupportedHostRuntime } from "./host-runtime-policy.ts";
import { judgeSessionFor } from "../review/review-session.ts";
import {
  type BackendStartupEvidence,
  backendStartupEvidence,
  preflightCampaignModels,
} from "./model-preflight.ts";
import { assertRunIdSafe, batteryCondition, driveBattery, loadRecordedTasks } from "./run-driver.ts";
import { keyIfDefined, keyIfNotNull, keysIf } from "../meta/optional-key.ts";
import { runtimeProcess } from "../meta/process.ts";
import type { ProviderResourceBudget } from "./provider-resource-budget.ts";
import type { SafeguardContext } from "../meta/safeguard.ts";
import { type VerifierLifetime, withVerifierLifetime } from "../verify/verifier-lifetime.ts";
import { campaignVerifierLifetime } from "./verifier-lifetime.ts";
import { selectedProductDir } from "./product-versions.ts";

export interface HarnessMeasureOptions {
  /** Reuse the full-run append owner; standalone measurement creates its own stream. */
  observer?: RunObserver;
  verifierLifetime?: VerifierLifetime;
  /** The battery's run identity: the iteration id supplied by the caller. */
  runId: string;
  repoRoot?: string;
  /** Exact public request that started this product. Fullrun supplies it; a direct measurement
   *  such as a harness-query probe may omit it, which the Judge context records as null rather
   *  than reconstructing from a slug. */
  publicRequest?: string;
  /** Full-run slot snapshot. Direct measurement resolves only when the controller supplies none. */
  resolvedSlots?: ResolvedSlots;
  /** The tree to measure: a candidate during adoption, otherwise the selected product by default. */
  domainDir?: string;
  maxTurns?: number;
  processEnv?: OptionalEnvValues;
  /** Test override: a scripted solver instead of live Pi workers. */
  solver?: Solver;
  /** Test override for the verifier host; production always opens the live subprocess host. */
  createVerifier?: () => VerifierHostHandle;
  /** Test override: isolation probe result (live default: the host Seatbelt probe). */
  isolationProbe?: () => HostSolveIsolationEvidence;
  /** Test override: the session isolation check (live default: the exact Pi worker, with no model turn). */
  sessionProbe?: () => Promise<SessionProfileEvidence>;
  /** Census judge tri-state: undefined resolves the configured judge slot, null is explicitly
   *  disabled, a session is a test injection. */
  judge?: JudgeSession | null;
  /** Called immediately before the battery runs, so the caller can record that this round measured
   *  in a way later steps cannot erase. */
  onBatteryStart?: () => void;
  experimentAuthoring?: ExperimentAuthoring;
  tasks?: BuildTask[];
  /** Run-bound diagnostic channel supplied by the full-run controller. */
  safeguardContext?: SafeguardContext;
  /** One run-wide outer-turn budget shared with Builder and Review. */
  providerBudget?: ProviderResourceBudget;
}

export interface HarnessMeasureResult {
  runId: string;
  isolation: CaseIsolationEvidence;
  /** The battery's written claim — created statement or the create's complete blocking-clause list,
   *  plus the ready verdict; saved copies live under campaigns/<slug>/claims/. Null means the
   *  environment blocked the battery before claim writing: every attempted case recorded a typed
   *  environment non-result. */
  claim: WrittenRunClaim | null;
  /** Separately typed terminal verdicts over the one battery. */
  verdicts: { measured: boolean; claimCreated: boolean; ready: boolean };
  /** How the battery ended, read back from its own record; null when no record was written. */
  disposition: BatteryDisposition | null;
}

interface MeasureBatteryContext {
  verifierLifetime?: VerifierLifetime;
  slug: string;
  repoRoot: string;
  slugDir: string;
  /** The measurement driver's identity paired with runId, supplied by measurementDriverId. */
  builderId: string;
  recordPath: string;
  isolation: CaseIsolationEvidence;
  tasks: BuildTask[];
  conformance: ConformanceEvidence | null;
  openHost: HarnessMeasureOptions["createVerifier"];
  condition: RunCondition;
  solver: Solver;
  /** The offered contract, projected before registration is recorded. */
  projectToolset: (toolset: Toolset) => Toolset;
  backendPin: string;
  /** The built slot's capability disclosure from `builtCapabilities`, read from the resolved
   *  backend rather than restated here: it is recorded into the claim and rendered to the Main
   *  Judge as a runtime fact. */
  capabilities: string[];
  thresholdManifestDigest: string;
  /** Live model catalogue evidence, recorded before controls, judge probes, or cases. */
  backendStartup?: BackendStartupEvidence;
  experimentAuthoring?: ExperimentAuthoring;
  /** Exact original public request for the Judge context. */
  publicRequest?: string;
  /** Run-bound diagnostic channel shared by this battery and its claim. */
  safeguardContext?: SafeguardContext;
  observer?: RunObserver;
  judge: JudgeSession | null;
}

/** The measurement driver's identity recorded on each case row, separate from the solving agent. */
export function measurementDriverId(slug: string): string {
  return `ana/drive-${slug}-battery`;
}

export function resolveBuiltSlot(
  repoRoot: string,
  slug: string,
  processEnv: OptionalEnvValues = Bun.env,
): ResolvedSlots {
  const slots = resolveSlots(repoRoot, slug, loadRepoEnv(repoRoot, processEnv));
  // Report an unconfigured review slot before measurement rather than after it. Run 15 measured
  // 50 cases before the missing reviewer became apparent in its recorded `judge: "off"` condition.
  // An explicit `disabled` is the operator's choice and needs no warning; `unconfigured` is a
  // fallback the operator should see before paying for cases. This is a disclosure and not a
  // refusal, because the host verifier decides correctness independently of the Judge, so the
  // battery is still worth what it costs.
  if (!slots.review.enabled && slots.review.source === "unconfigured") {
    fullrunLine(
      // default.json first: a prompt-driven slug is a prompt hash, so `<slug>.json` is a file the
      // operator can only name after the run that needed it.
      `${slug}: no review slot configured — this battery records judge:"off" and no Judge reviews; pin one in .harness/backends/default.json, .harness/backends/${slug}.json, or HARNESS_REVIEW_BACKEND`,
    );
  }
  return slots;
}

/** Combine the host probe and the session's activated-profile check to describe the battery's
 *  isolation. Retain both checks in the evidence; a missing session check lowers the
 *  reported strength to contractual, as defined by composedIsolation. */
export function caseIsolationFromProbe(
  probe: HostSolveIsolationEvidence,
  session?: SessionProfileEvidence,
): CaseIsolationEvidence {
  return {
    strength: composedIsolation(probe, session),
    probe,
    ...keyIfDefined("session", session),
  };
}

/** The battery's isolation check result, recorded beside the case rows before any paid turn: the
 *  executed fixture for the transport that evaluates, joined with that transport's session check.
 *  Each family probes with its own mechanism; the isolation vocabulary refuses a crossed pair. */
async function resolveCaseIsolation(
  options: HarnessMeasureOptions,
  repoRoot: string,
  recordPath: string,
  preflight: Awaited<ReturnType<typeof preflightCampaignModels>> | null,
  piRuntime: ReturnType<typeof resolvePiBuiltRuntime> | null,
): Promise<CaseIsolationEvidence> {
  const probe =
    options.isolationProbe?.() ??
    probeHostSolveReadDeny({
      repoRoot,
      ...keyIfDefined("readAllowRoots", piRuntime?.policy.allowedReadRoots),
    });
  const session = options.sessionProbe === undefined ? preflight?.builtSession : await options.sessionProbe();
  const isolation = caseIsolationFromProbe(probe, session);
  await Bun.write(
    join(dirname(recordPath), `isolation-probe-${options.runId}.json`),
    `${capturedJsonStringify(isolation, null, 2)}\n`,
  );
  return isolation;
}

/** Everything the battery consumes, resolved once: slot identities, executed isolation evidence,
 *  recorded tasks and the Built runtime. `measureHarness` then runs measurement and records the
 *  result, including an environment-blocked battery. */
async function resolveMeasureInterface(manifest: AskManifest, options: HarnessMeasureOptions) {
  assertSupportedHostRuntime();
  const { slug } = manifest;
  const repoRoot = options.repoRoot ?? runtimeProcess.cwd();
  const slugDir = options.domainDir ?? selectedProductDir(repoRoot, slug);
  if (!existsSync(join(slugDir, "agent")) || !existsSync(join(slugDir, "correctness-model"))) {
    throw new Error(
      `${slugDir}: no adopted harness (agent/ + correctness-model/) — the build campaign for "${slug}" adopts one on a build-admissible iteration`,
    );
  }
  const slots = options.resolvedSlots ?? resolveBuiltSlot(repoRoot, slug, options.processEnv);
  // Create the driver's evidence directory before measurement; a missing parent is not a held lock.
  const recordPath = join(campaignDir(repoRoot, slug), CASE_RECORD_FILE);
  mkdirSync(dirname(recordPath), { recursive: true });
  const solveIsolation = builtSolveIsolation(repoRoot, piBuiltReadAllowRoots(slots));
  const piRuntime =
    options.solver === undefined
      ? resolvePiBuiltRuntime(slots, repoRoot, solveIsolation, options.processEnv ?? Bun.env)
      : null;
  const preflight =
    piRuntime === null
      ? null
      : await preflightCampaignModels({
          builder: slots.builder,
          review: slots.review,
          repoRoot,
          builtRuntime: piRuntime,
          phase: "measurement",
        });
  const isolation = await resolveCaseIsolation(options, repoRoot, recordPath, preflight, piRuntime);
  const tasks = options.tasks ?? loadRecordedTasks(slugDir);
  const observer = options.observer ?? createRunObserver(repoRoot, slug, options.runId);
  const runtime = builtBatteryRuntime(piRuntime, observer, {
    maxTurns: options.maxTurns,
    scripted: options.solver,
    providerBudget: options.providerBudget,
    safeguardContext: options.safeguardContext,
  });
  return {
    repoRoot,
    slugDir,
    slots,
    recordPath,
    isolation,
    tasks,
    openHost: options.createVerifier,
    runtime,
    capabilities: builtCapabilities(piRuntime?.profile ?? null),
    backendStartup:
      preflight === null
        ? undefined
        : backendStartupEvidence(slots, preflight.hostRuntime, preflight.modelSelections),
    thresholdManifestDigest: loadFrozenManifest(join(repoRoot, FROZEN_MANIFEST_PATH)).digest,
  };
}

/** The battery over the already-resolved contract: the drive, its claim, and the one typed absence
 *  the environment may leave (a `BatteryVerificationNonResult` after the record is on disk). */
async function measureResolvedBattery(
  contract: Awaited<ReturnType<typeof resolveMeasureInterface>>,
  manifest: AskManifest,
  options: HarnessMeasureOptions,
): Promise<WrittenRunClaim | null> {
  const { slug } = manifest;
  const {
    repoRoot,
    slugDir,
    slots,
    recordPath,
    isolation,
    tasks,
    openHost,
    runtime,
    capabilities,
    backendStartup,
    thresholdManifestDigest,
  } = contract;
  const { runId } = options;
  fullrunLine(`${slug}: battery started (${runId}, ${tasks.length} tasks)`);
  const judge =
    options.judge === undefined
      ? judgeSessionFor(slots.review, repoRoot, runtime.observer, options.providerBudget)
      : options.judge;
  let claim: WrittenRunClaim | null = null;
  try {
    claim = await measureBattery(runId, {
      slug,
      repoRoot,
      slugDir,
      builderId: measurementDriverId(slug),
      recordPath,
      isolation,
      tasks,
      conformance: readBoundConformance(slugDir),
      openHost,
      ...keyIfDefined("verifierLifetime", options.verifierLifetime),
      ...keyIfDefined("safeguardContext", options.safeguardContext),
      condition: batteryCondition(slugDir),
      solver: runtime.solver(),
      projectToolset: (toolset) => toolset,
      backendPin: backendPinOf(slots),
      capabilities,
      thresholdManifestDigest,
      ...keyIfDefined("experimentAuthoring", options.experimentAuthoring),
      ...keyIfDefined("publicRequest", options.publicRequest),
      ...keyIfDefined("backendStartup", backendStartup),
      observer: runtime.observer,
      judge,
    });
  } catch (error) {
    if (!(error instanceof BatteryVerificationNonResult)) throw error;
  }
  // One sentence, two readers. This is the round's verdict on its own battery, and reaching stderr
  // alone leaves the observation stream a live reader watches with no row for it, so a run whose
  // claim was refused looks from the stream exactly like one whose claim was written — while the
  // refusal has in fact held the candidate and left the next round sizing its battery from a stale
  // landing. A clause present only in stdout is not durable evidence.
  const settled =
    claim === null
      ? {
          state: "failed" as const,
          summary: "battery environment-blocked — typed non-results recorded; no claim was written",
        }
      : claim.created && claim.statement !== null
        ? {
            state: "completed" as const,
            summary: `battery recorded — claim ${claim.statement.passed}/${claim.statement.n} truth`,
          }
        : {
            state: "failed" as const,
            summary: `battery recorded — claim refused (${claim.clauses.map((c) => c.clause).join(", ") || "no clauses"})`,
          };
  runtime.observer.phase({
    phase: "claim",
    state: settled.state,
    summary: settled.summary,
    evidence: [`campaigns/${slug}/claims/${runId}.json`],
  });
  fullrunLine(`${slug}: ${settled.summary}`);
  return claim;
}

/** Drive an adopted harness through one battery under the iteration's run id and write its claim. */
export async function measureHarness(
  manifest: AskManifest,
  options: HarnessMeasureOptions,
): Promise<HarnessMeasureResult> {
  // Validate before any filesystem operation: runId is used directly in run and claim paths,
  // so an id containing path traversal must be refused before joining it to a directory.
  assertRunIdSafe(options.runId);
  if (options.verifierLifetime === undefined) {
    const repoRoot = options.repoRoot ?? runtimeProcess.cwd();
    const verifierLifetime = campaignVerifierLifetime(
      campaignDir(repoRoot, manifest.slug),
      options.runId,
      options.domainDir ?? selectedProductDir(repoRoot, manifest.slug),
    );
    return withVerifierLifetime(verifierLifetime, () =>
      measureHarness(manifest, { ...options, verifierLifetime }),
    );
  }
  const contract = await resolveMeasureInterface(manifest, options);
  options.onBatteryStart?.();
  const claim = await measureResolvedBattery(contract, manifest, options);
  // The recorded disposition of the battery, read back from its own record.
  const record = batteryPath(contract.slugDir, options.runId);
  return {
    runId: options.runId,
    isolation: contract.isolation,
    claim,
    verdicts: {
      measured: claim?.batteryRecorded === true,
      claimCreated: claim?.created === true,
      ready: claim?.readiness?.ready === true,
    },
    disposition: existsSync(record) ? readBatteryJoinSlice(record).disposition : null,
  };
}

/** One battery end-to-end: the battery through the driver (fingerprint, evaluation, and case rows
 *  appended to the campaign record), then its claim created under its disclosed condition.
 *  Conformance comes from the adopted tree's own hash-joined evidence; a tree without it yields
 *  null, and readiness carries the conformance-unprobed clause instead of a fabricated pass. The
 *  battery records its run condition, and the claim restates it. */
async function measureBattery(runId: string, ctx: MeasureBatteryContext): Promise<WrittenRunClaim> {
  const { slug, slugDir, openHost } = ctx;
  await driveBattery({
    slug,
    slugDir,
    runId,
    builderId: ctx.builderId,
    recordPath: ctx.recordPath,
    verification: {
      solver: ctx.solver,
      projectToolset: ctx.projectToolset,
      backendPin: ctx.backendPin,
      thresholdManifestDigest: ctx.thresholdManifestDigest,
      ...keysIf(ctx.backendStartup !== undefined, () => ({
        backendStartup: ctx.backendStartup,
        conformance: ctx.conformance,
      })),
      capabilities: ctx.capabilities,
      ...keyIfDefined("publicRequest", ctx.publicRequest),
      condition: ctx.condition,
      ...keyIfDefined("experimentAuthoring", ctx.experimentAuthoring),
      ...keyIfNotNull("judge", ctx.judge),
      ...keyIfDefined("createVerifier", openHost),
      ...keyIfDefined("verifierLifetime", ctx.verifierLifetime),
      ...keyIfDefined("safeguardContext", ctx.safeguardContext),
      ...keyIfDefined("observer", ctx.observer),
    },
    isolation: ctx.isolation,
    tasks: ctx.tasks,
  });
  return writeRunClaim({
    slug,
    slugDir,
    claimsDir: claimsDirFor(ctx.repoRoot, slug),
    limitMarginPath: limitMarginFile(campaignDir(ctx.repoRoot, slug), runId),
    runId,
    isolation: ctx.isolation.strength,
    conformance: ctx.conformance,
    probe: {
      ...keyIfDefined("verifierLifetime", ctx.verifierLifetime),
      ...keyIfDefined("createVerifier", openHost),
    },
  });
}
