/** Sequence discrimination, concurrent solves, ordered grading and advisory judgement.
 * An unclaimable corpus stops before solver spend; battery.json binds the recorded phases. */
import { join } from "../meta/path.ts";
import type { ExperimentAuthoring } from "../run/experiment-freeze.ts";
import { measureDifficulty, type MeasuredDifficulty } from "../claim/battery-difficulty.ts";
import {
  type EstimationEvidence,
  environmentBlockedBattery,
  estimationEvidence,
} from "../claim/battery-facts.ts";
import { batteryClaimInput } from "../claim/battery-run-evidence.ts";
import type { RunCondition } from "../claim/case-record.ts";
import type { TruthCheckFiringEvidence } from "../claim/claim-evidence.ts";
import type { ConformanceEvidence } from "../claim/conformance-evidence.ts";
import { EvidenceLog } from "../claim/evidence-log.ts";
import type { JudgeEvidence } from "../claim/judge.ts";
import { ensureBundleSnapshot } from "../claim/bundle-snapshot.ts";
import { sha256 } from "../meta/digest.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { parseJsonAs } from "../meta/json-runtime.ts";
import { requireJsonValue } from "../meta/stable-json.ts";
import { BACKENDS_FILE, type BackendStartupEvidence } from "../run/model-preflight.ts";
import { builtSolveConcurrency } from "../run/session-pool.ts";
import { compilePublicArtifactSchema } from "../solve/public-artifact-schema.ts";
import type { VerifierHostHandle } from "../verify/verifier-port.ts";
import {
  BATTERY_FILE,
  type BatteryRecord,
  batteryDisposition,
  batteryTerminalReason,
  BatteryVerificationNonResult,
  CASE_ARTIFACT_FILE,
  type CaseRecord,
  type DiscriminationExecution,
  SUBMIT_MAX_ATTEMPTS,
  bundleSnapshotFact,
} from "./battery-record.ts";
import { solveBatteryWithProviderStop } from "./battery-provider-stop.ts";
import { harnessSettings } from "./harness-config.ts";
import { validateBrief } from "./brief-validator.ts";
import { type Brief, externalChecksOf, throwIfInvalid } from "./brief.ts";
import type { BuildDeps } from "./build-deps.ts";
import { type Toolset, loadBuiltStarterFactory, loadCorrectnessModel } from "./contracts.ts";
import type { ControlCorpus } from "./controls.ts";
import { executionEvidence } from "./tool-runs.ts";
import { CASE_TRACE_POINTER_FILE, recordCaseTracePointer } from "./case-trace-pointer.ts";
import { blockingFailedCheckIds } from "./verdict-binding.ts";
import type { JudgePublicDomain } from "./judge-contract.ts";
import {
  judgeBatterySubject,
  judgeDomainForRun,
  runJudgePhase,
  writeJudgePublicContext,
} from "./judge-phase.ts";
import { type JudgeObservation, type JudgeSession, summarizeJudge } from "./judge.ts";
import { evaluateCheckProgram } from "./predicate.ts";
import {
  withVerifierLifetime,
  createVerifierLifetime,
  VerifierOperationalStop,
  type VerifierLifetime,
} from "../verify/verifier-lifetime.ts";
import { judgePublicTaskOf } from "./public-resources.ts";
import { applicableCheckIds, runControls } from "./run-controls.ts";
import { gradeCase, solveCase, type GradedCase, type SolveCaseEvidence } from "./solve-case.ts";
import type { JudgeCensusSubject } from "./judge-census.ts";
import { type Solver, builtStarterFactoryForSolver } from "./solve.ts";
import { SAFE_TASK_ID } from "./tasks.ts";
import { trustedJsonParse } from "./trusted-runtime.ts";
import { resolveVerifier } from "./verification-registry.ts";
import { type SafeguardContext, safeguardTriggered } from "../meta/safeguard.ts";
import type { RunObserver } from "../observe/run-observer.ts";
import { BRIEF_FILE, CONTROLS_FILE } from "../meta/bundle-layout.ts";

export interface VerificationRunnerOptions {
  verifierLifetime?: VerifierLifetime;
  solver: Solver;
  projectToolset?: (toolset: Toolset) => Toolset;
  /** Resolved built-side pin from the broker, e.g. "codex/model-slug". */
  backendPin: string;
  /** Digest of the frozen threshold manifest this battery runs under. */
  thresholdManifestDigest: string;
  /** Exact native model selections accepted before any paid campaign work. */
  backendStartup?: BackendStartupEvidence;
  /** Build-time worker binding reproduced by the production generated-tool worker. */
  conformance?: ConformanceEvidence | null;
  /** Resolved Built Harness capabilities, e.g. ["web-search:off"], disclosed in the claim. */
  capabilities: string[];
  /** Exact operator request for the public Judge context; a direct measurement may omit it and records null. */
  publicRequest?: string;
  runId: string;
  /** The caller's run condition (U0.4), recorded in battery.json for later comparison. */
  condition: RunCondition;
  /** Fresh host per battery. Generated checks receive only its subject-bound execution port. */
  createVerifier?: () => VerifierHostHandle;
  toolRetryWaitMs?: number; // wait before an environment-owned control refusal's one retry; tests pass 0
  /** One independently resolved judge slot. Omitted means explicitly off; it is never inherited. */
  judge?: JudgeSession;
  experimentAuthoring?: ExperimentAuthoring;
  /** Run-bound diagnostic channel supplied by the full-run controller. */
  safeguardContext?: SafeguardContext;
  /** Timing-only phase spans for the existing observation stream. */
  observer?: RunObserver;
}

type VerifyInput = Parameters<BuildDeps["verify"]>[0];

/** Everything the sequencing steps share, loaded once per battery from the recorded bundle. */
interface BatteryContext {
  options: VerificationRunnerOptions;
  input: VerifyInput;
  buildInputsHash: string;
  bundleSnapshot: ReturnType<typeof ensureBundleSnapshot>;
  createStarter: Parameters<typeof solveCase>[0]["createStarter"];
  brief: Brief;
  judgeDomain: JudgePublicDomain;
  judgePublicTaskById: Map<string, ReturnType<typeof judgePublicTaskOf>>;
  evaluate: ReturnType<typeof evaluateCheckProgram>;
  corpus: ControlCorpus;
  publicArtifactSchema: ReturnType<typeof compilePublicArtifactSchema>;
  verifier: VerifierHostHandle;
  externalChecks: Array<{ checkId: string; adapterId: string }>;
  checkIdsByTask: Map<string, string[]>;
  evidence: EvidenceLog;
  runDir: string;
}

/** Execute through the immutable, content-addressed bundleSnapshot rather than the repairable live
 *  tree; validate the recorded brief before anything reads it as a contract. */
async function loadRecordedContract(bundleSnapshotDir: string, verifierLifetime: VerifierLifetime) {
  const briefUnknown = trustedJsonParse(await Bun.file(join(bundleSnapshotDir, BRIEF_FILE)).text());
  throwIfInvalid(validateBrief(briefUnknown), "bundle snapshot brief failed validation");
  const brief =
    /* SAFETY: throwIfInvalid above returns only when `validateBrief` reported ok, the only proof of this shape. */ briefUnknown as Brief;
  const evaluate = evaluateCheckProgram(
    brief,
    await loadCorrectnessModel(bundleSnapshotDir, verifierLifetime),
  );
  const corpus = parseJsonAs<ControlCorpus>(await Bun.file(join(bundleSnapshotDir, CONTROLS_FILE)).text());
  return { brief, evaluate, corpus };
}

async function prepareBattery(
  options: VerificationRunnerOptions,
  input: VerifyInput,
): Promise<BatteryContext> {
  const { slugDir, fingerprint, tasks } = input;
  const { verifierLifetime } = options;
  if (verifierLifetime === undefined) throw new Error("battery verifier lifetime is required");
  verifierLifetime.assertUsable();
  const buildInputsHash = sha256(
    `agent:${fingerprint.agentHash}\ncorrectnessModel:${fingerprint.correctnessModelHash}\ntasks:${fingerprint.taskSetHash ?? "missing"}`,
  );
  const bundleSnapshot = ensureBundleSnapshot(slugDir, fingerprint);
  const solverStarterFactory = builtStarterFactoryForSolver(options.solver);
  const createStarter =
    solverStarterFactory === undefined
      ? await loadBuiltStarterFactory(bundleSnapshot.dir)
      : (
          task: Parameters<typeof solverStarterFactory>[1],
          submission: Parameters<typeof solverStarterFactory>[2],
          publicArtifactSchema: Parameters<typeof solverStarterFactory>[3],
        ) => solverStarterFactory(bundleSnapshot.dir, task, submission, publicArtifactSchema);
  const { brief, evaluate, corpus } = await loadRecordedContract(bundleSnapshot.dir, verifierLifetime);
  const judgeDomain = judgeDomainForRun(brief, bundleSnapshot.dir, {
    publicRequest: options.publicRequest ?? null,
    capabilities: [...options.capabilities],
    condition: options.condition,
  });
  const judgePublicTaskById = new Map(
    tasks.map((task) => [task.taskId, judgePublicTaskOf(brief, task)] as const),
  );
  const publicArtifactSchema = compilePublicArtifactSchema(
    brief.artifactSchema,
    corpus.accept.map((accept) => accept.artifact),
  );
  // A missing tool refuses at the census before adoption; a measured tree that lost one since
  // records host-observed non-results, which the runner reads per case.
  const { verifier } = resolveVerifier({
    toolTree: bundleSnapshot.toolTree,
    bundleDir: bundleSnapshot.dir,
    toolIds: externalChecksOf(brief).map((check) => check.adapterId),
    verifierLifetime,
    ...keyIfDefined("createVerifier", options.createVerifier),
  });
  const externalChecks = externalChecksOf(brief);
  const runDir = join(slugDir, "runs", options.runId);
  return {
    options,
    input,
    buildInputsHash,
    bundleSnapshot,
    createStarter,
    brief,
    judgeDomain,
    judgePublicTaskById,
    evaluate,
    corpus,
    publicArtifactSchema,
    verifier,
    externalChecks,
    // The provenance consequence is settled with the Builder before any battery (the
    // external-grounding-provenance declaration in builder-campaign.ts); no battery-time notice.
    checkIdsByTask: new Map(tasks.map((task) => [task.taskId, applicableCheckIds(brief, task)])),
    // One write owner for the whole run directory (steering-delta P1): all evidence, including the
    // verdict-bearing judge session, goes through the ordinary manifest-bound evidence writer.
    // `live/` remains telemetry-only.
    evidence: new EvidenceLog(runDir),
    runDir,
  };
}

/** The one battery.json assembler — the skipped-battery and the completed-battery records differ
 *  only in what this receives, so the two writes cannot drift apart field by field. */
function recordBatteryRecord(
  ctx: BatteryContext,
  parts: {
    /** Declared by the caller: "no rows" cannot tell a refused battery from an empty one. */
    plan: "scheduled" | "skipped";
    cases: CaseRecord[];
    measured: MeasuredDifficulty;
    discrimination: DiscriminationExecution;
    truthCheckFiring: TruthCheckFiringEvidence;
    estimation: EstimationEvidence;
    judge: JudgeEvidence;
  },
): BatteryRecord {
  const { options } = ctx;
  const disposition = batteryDisposition(parts.plan, parts.cases);
  const battery: BatteryRecord = {
    runId: options.runId,
    slug: ctx.input.slug,
    backendPin: options.backendPin,
    thresholdManifestDigest: options.thresholdManifestDigest,
    buildInputsHash: ctx.buildInputsHash,
    terminalReason: batteryTerminalReason(disposition, parts.cases),
    disposition,
    capabilities: [...options.capabilities],
    condition: options.condition,
    cases: parts.cases,
    measured: parts.measured,
    ...keyIfDefined("experimentAuthoring", options.experimentAuthoring),
    discrimination: parts.discrimination,
    bundleSnapshot: bundleSnapshotFact(ctx.bundleSnapshot),
    execution: executionEvidence(ctx.verifier),
    executionEvidence: ctx.verifier.evidence(),
    truthCheckFiring: parts.truthCheckFiring,
    estimation: parts.estimation,
    judge: parts.judge,
    solveExecution: {
      maxConcurrency: solveWidth(ctx),
      scheduling: "bounded-worker-pool",
    },
  };
  ctx.evidence.write(BATTERY_FILE, battery);
  ctx.evidence.record();
  return battery;
}

async function measuredPhase<T>(
  observer: RunObserver | undefined,
  phase: "controls" | "judge",
  summary: string,
  work: () => Promise<T>,
): Promise<T> {
  observer?.phase({ phase, state: "started", summary });
  try {
    const result = await work();
    observer?.phase({ phase, state: "completed", summary });
    return result;
  } catch (error) {
    observer?.phase({ phase, state: "failed", summary });
    throw error;
  }
}

/** One per-checkId counter, seeded at zero for the ids its record declares. The record has a null
 *  prototype because a model-authored checkId may be "__proto__" or "constructor". `declared` counts
 *  only a seeded id; `any` also opens a row for an id the declared set never named, which is
 *  evidence of a defect rather than a count to discard. */
function checkCounter(ids: Iterable<string>) {
  const counts: Record<string, number> = Object.create(null);
  for (const id of ids) counts[id] = 0;
  const any = (id: string) => {
    counts[id] = (counts[id] ?? 0) + 1;
  };
  return {
    counts,
    any,
    declared: (id: string) => {
      if (id in counts) any(id);
    },
  };
}

/** Derive the firing counts from verified case verdicts and the host's completed runs.
 * Raw evaluator output overruled by a host non-result remains evidence, but is not a verified case.
 * Only the first battery attempt counts; one subject counts once per external check. */
function truthCheckFiring(ctx: BatteryContext, gradedCases: readonly GradedCase[]): TruthCheckFiringEvidence {
  const authored = ctx.brief.truthChecks
    .filter((check) => check.execution.evidence.kind === "authored")
    .map((check) => check.id);
  const fired = checkCounter(authored);
  const applicable = checkCounter(authored);
  const blocking = checkCounter(ctx.brief.truthChecks.map((check) => check.id));
  const executed = checkCounter(ctx.externalChecks.map((check) => check.checkId));
  const verified = new Set<string>();
  for (const { record, verdict } of gradedCases) {
    if (record.truthOk === null || verdict === null) continue;
    verified.add(record.taskId);
    for (const receipt of verdict.checkReceipts) fired.declared(receipt.checkId);
    for (const id of blockingFailedCheckIds(verdict)) blocking.any(id);
    for (const id of ctx.checkIdsByTask.get(record.taskId) ?? []) applicable.declared(id);
  }
  const seen = new Set<string>();
  for (const binding of ctx.verifier.executedBindings()) {
    const key = binding.subjectId + "\u0000" + binding.checkId;
    if (
      binding.phase !== "battery" ||
      binding.attempt !== 1 ||
      !verified.has(binding.subjectId) ||
      seen.has(key)
    ) {
      continue;
    }
    seen.add(key);
    executed.declared(binding.checkId);
  }
  return {
    firedByCheck: fired.counts,
    executedByCheck: executed.counts,
    blockingByCheck: blocking.counts,
    applicableByCheck: applicable.counts,
    verifierVerifiedCount: verified.size,
  };
}

/** Grade and write in task order, retaining finished case evidence if killed before battery publication. */
async function recordSolvedCase(
  ctx: BatteryContext,
  gradedCases: GradedCase[],
  solvedCase: Awaited<ReturnType<typeof solveBatteryWithProviderStop>>[number],
): Promise<boolean> {
  const { task } = solvedCase;
  const graded = await gradeCase(
    {
      brief: ctx.brief,
      evaluate: ctx.evaluate,
      verifier: ctx.verifier,
      ...keyIfDefined("verifierLifetime", ctx.options.verifierLifetime),
      runId: ctx.options.runId,
      externalChecks: ctx.externalChecks,
      applicableIds: ctx.checkIdsByTask.get(task.taskId) ?? [],
    },
    solvedCase,
  );
  if (graded.submittedArtifact !== null) {
    ctx.evidence.write(`cases/${task.taskId}/${CASE_ARTIFACT_FILE}`, graded.submittedArtifact);
  }
  if (graded.verdict !== null) ctx.evidence.write(`cases/${task.taskId}/verifier.json`, graded.verdict);
  ctx.evidence.write(`cases/${task.taskId}/case-result.json`, graded.record);
  ctx.evidence.write(
    `cases/${task.taskId}/${CASE_TRACE_POINTER_FILE}`,
    recordCaseTracePointer(ctx.runDir, task.taskId),
  );
  gradedCases.push(graded);
  try {
    ctx.options.verifierLifetime?.assertUsable();
  } catch (cause) {
    if (!(cause instanceof VerifierOperationalStop)) throw cause;
    return false;
  }
  return true;
}

/** The same eligibility projection supplies the offered census and the Judge's actual subjects. */
function judgeSubjects(ctx: BatteryContext, gradedCases: readonly GradedCase[]): JudgeCensusSubject[] {
  if (ctx.options.judge === undefined) return [];
  return gradedCases.flatMap(({ record, submittedArtifact }) => {
    const judgeTask = ctx.judgePublicTaskById.get(record.taskId);
    if (judgeTask === undefined) {
      throw new Error(`judge public context: no recorded task for taskId "${record.taskId}"`);
    }
    const subject = judgeBatterySubject({
      taskId: record.taskId,
      judgeDomain: ctx.judgeDomain,
      judgeTask,
      submittedArtifact,
      truthOk: record.truthOk,
    });
    return subject === null ? [] : [subject];
  });
}

/** Stop before paid solving when control evidence already prevents a claim (the audit's
 *  computed-then-ignored finding). Preserve the battery record with an empty case list and
 *  the complete discrimination findings, so later readers can see why measurement was skipped
 *  without inferring the reason from a missing file. */
function recordUnclaimableBattery(
  ctx: BatteryContext,
  discrimination: DiscriminationExecution,
): BatteryRecord {
  const judge = summarizeJudge(
    ctx.options.judge,
    `correctness-model@${ctx.input.fingerprint.correctnessModelHash}`,
    ctx.options.backendPin,
    [],
  );
  return recordBatteryRecord(ctx, {
    plan: "skipped",
    cases: [],
    measured: measureDifficulty([]),
    discrimination,
    // No task was verified (the paid loop was skipped), so every intrinsic check fired zero
    // times over zero truth-verified cases — present-zero, never absent. The claim already
    // blocks on the discrimination findings; the never-fired clause stays inert at count 0.
    truthCheckFiring: {
      firedByCheck: Object.fromEntries(
        ctx.brief.truthChecks
          .filter((check) => check.execution.evidence.kind === "authored")
          .map((check) => [check.id, 0]),
      ),
      executedByCheck: {},
      blockingByCheck: {},
      applicableByCheck: {},
      verifierVerifiedCount: 0,
    },
    estimation: estimationEvidence([]),
    judge,
  });
}

/** Concurrent solves own submission authority and evidence, without verifier access; grading has one open subject.
 * The provider stop counts only provider failures (opus326); other non-results still run the complete battery. */
/** The width this battery runs at: what the harness declared, unless the operator bounded it. */
const solveWidth = (ctx: BatteryContext) =>
  builtSolveConcurrency(harnessSettings(ctx.bundleSnapshot.dir).solveConcurrency);

/** The run-wide spans this pool opens and closes. Per-case rows reuse the phase and say their own
 *  summary; these two say the same thing every time, so only their state changes. */
const SOLVING = { phase: "solve", summary: "Built Harness solve pool" } as const;
const GRADING = { phase: "grade", summary: "Ordered host grading" } as const;

async function solveAndGradeBattery(ctx: BatteryContext): Promise<GradedCase[]> {
  const { observer } = ctx.options;
  const gradedCases: GradedCase[] = [];
  let gradingStarted = false,
    gradingStopped = false;
  // How many cases the ordered reader below has taken. A solve that finishes at a later index is
  // held until every earlier one has been delivered, which is deliberate — a rerun then reports
  // the same failing case — but nothing said so, and a held case looked exactly like a stalled
  // verifier from outside. This counts deliveries so the hold can name what it is waiting on.
  let delivered = 0;
  observer?.phase({ ...SOLVING, state: "started" });
  try {
    await solveBatteryWithProviderStop(
      ctx.input.tasks,
      async (task, index) => {
        const solvedCase = await solveCase(
          {
            createStarter: ctx.createStarter,
            solver: ctx.options.solver,
            ...keyIfDefined("projectToolset", ctx.options.projectToolset),
            ...keyIfDefined("conformance", ctx.options.conformance),
            publicArtifactSchema: ctx.publicArtifactSchema,
            maxSubmitAttempts: SUBMIT_MAX_ATTEMPTS,
            write: (path: string, value: SolveCaseEvidence) =>
              ctx.evidence.write(path, requireJsonValue(value)),
          },
          task,
        );
        const ahead = index - delivered;
        if (ahead > 0) {
          observer?.phase({
            phase: GRADING.phase,
            state: "deferred",
            summary: `Case ${task.taskId} solved, held behind ${ahead} earlier case${ahead === 1 ? "" : "s"}`,
            subjectId: task.taskId,
          });
        }
        return solvedCase;
      },
      solveWidth(ctx),
      async (solvedCase) => {
        delivered += 1;
        if (gradingStopped) {
          // 45: streaming owner review at ce4f77c7c; solve receipts do not name this omitted grading.
          safeguardTriggered(
            "45-case-grading-skipped",
            `run=${ctx.options.runId} task=${solvedCase.task.taskId} graded=${gradedCases.length}`,
            ctx.options.safeguardContext,
          );
          return;
        }
        if (!gradingStarted) {
          gradingStarted = true;
          observer?.phase({ ...GRADING, state: "started" });
        }
        if (!(await recordSolvedCase(ctx, gradedCases, solvedCase))) {
          gradingStopped = true;
          observer?.phase({ ...GRADING, state: "failed" });
        }
      },
      () => observer?.phase({ ...SOLVING, state: "completed" }),
    );
    if (gradingStarted && !gradingStopped) observer?.phase({ ...GRADING, state: "completed" });
  } catch (error) {
    observer?.phase({ ...SOLVING, state: "failed" });
    if (gradingStarted) observer?.phase({ ...GRADING, state: "failed" });
    throw error;
  }
  return gradedCases;
}

/** A host-bound subset is authoritative even when every changed task returned no result. It is
 *  recorded as two counts; every rate and interval downstream is read back from them. */
function measuredExperiment(ctx: BatteryContext, gradedCases: readonly GradedCase[]): MeasuredDifficulty {
  // Climb dive F5: admission-refused attempts stay in the tally; only non-results are censored.
  const observations = gradedCases.flatMap(({ record }) =>
    record.pass === null ? [] : [{ taskId: record.taskId, item: record.family, pass: record.pass }],
  );
  const measured = measureDifficulty(observations);
  const changed = ctx.options.experimentAuthoring?.changedTaskIds;
  if (changed === undefined || changed === null) return measured;
  const ids = new Set(changed);
  const changedObservations = observations.filter((row) => ids.has(row.taskId));
  measured.changedSubset = {
    attempts: changedObservations.length,
    passes: changedObservations.filter((row) => row.pass).length,
  };
  return measured;
}

function publishBattery(
  ctx: BatteryContext,
  executed: DiscriminationExecution,
  gradedCases: readonly GradedCase[],
  judgeCases: readonly JudgeObservation[],
  judgeCaseCount: number,
) {
  const { options } = ctx;
  const cases = gradedCases.map((graded) => graded.record);
  const unboundFindings = gradedCases.flatMap((graded) => graded.unboundFindings);
  // An unbound tool result during measurement prevents a claim. Add it to the discrimination
  // findings with claimable=false so Claim.create applies the shared refusal path.
  const discrimination =
    unboundFindings.length === 0
      ? executed
      : {
          ...executed,
          claimable: false,
          findings: [...executed.findings, ...unboundFindings],
        };

  const judge = summarizeJudge(
    options.judge,
    `correctness-model@${ctx.input.fingerprint.correctnessModelHash}`,
    options.backendPin,
    judgeCases,
    // Offered eligible subjects, not completed observations: an abort must keep the unattempted
    // remainder inside censusSize.battery.
    { battery: judgeCaseCount },
  );
  const battery = recordBatteryRecord(ctx, {
    plan: "scheduled",
    cases,
    measured: measuredExperiment(ctx, gradedCases),
    discrimination,
    truthCheckFiring: truthCheckFiring(ctx, gradedCases),
    estimation: estimationEvidence(cases),
    judge,
  });
  return { battery, discrimination };
}

export function makeVerify(options: VerificationRunnerOptions): BuildDeps["verify"] {
  return async (input) => {
    if (options.verifierLifetime !== undefined) return runVerification(options, input);
    const verifierLifetime = createVerifierLifetime({ root: join(input.slugDir, "verifier-lifetime") });
    return withVerifierLifetime(verifierLifetime, async () => {
      verifierLifetime.recover();
      verifierLifetime.assertUsable();
      return await runVerification({ ...options, verifierLifetime }, input);
    });
  };
}

async function runVerification(options: VerificationRunnerOptions, input: VerifyInput) {
  const { tasks } = input;
  const ctx = await prepareBattery(options, input);
  if (options.judge !== undefined) {
    writeJudgePublicContext(ctx.evidence.write.bind(ctx.evidence), ctx.judgeDomain);
  }
  if (options.backendStartup !== undefined) ctx.evidence.write(BACKENDS_FILE, options.backendStartup);

  // Prove the corpus before solver spend. A control's non-result stays one receipt, not an
  // abort of the corpus (truss-run16-sol-0903); runControls owns that distinction.
  const discrimination = await measuredPhase(options.observer, "controls", "Control replay", () =>
    runControls(
      ctx.evaluate,
      ctx.corpus,
      tasks,
      {
        brief: ctx.brief,
        runId: options.runId,
        externalChecks: ctx.externalChecks,
        ...keyIfDefined("verifierLifetime", options.verifierLifetime),
        ...keyIfDefined("toolRetryWaitMs", options.toolRetryWaitMs),
      },
      ctx.verifier,
    ),
  );
  if (!discrimination.claimable) {
    const battery = recordUnclaimableBattery(ctx, discrimination);
    ctx.options.verifierLifetime?.assertUsable();
    return { runId: options.runId, ...batteryClaimInput(battery, ctx.checkIdsByTask, ctx.corpus) };
  }

  // Task ids become case-directory names below. validateTasks normally refuses unsafe ids;
  // repeat the check for direct callers with an unvalidated list and throw before writing
  // outside the run directory.
  const unsafeId = tasks.find((t) => !SAFE_TASK_ID.test(t.taskId));
  if (unsafeId) {
    throw new Error(
      `task-id-unsafe: taskId "${unsafeId.taskId}" is not a safe path segment — refusing to FS-join it (product defect: the task battery bypassed validateTasks)`,
    );
  }

  // Concurrent solves own their submissions; ordered grading keeps one open verifier subject.
  const gradedCases = await solveAndGradeBattery(ctx);
  const subjects = judgeSubjects(ctx, gradedCases);

  // Preserve the completed verdicts before the review, which may never finish.
  if (options.judge !== undefined) {
    publishBattery(ctx, discrimination, gradedCases, [], subjects.length);
  }

  let cleanupStopped = false;
  try {
    ctx.options.verifierLifetime?.assertUsable();
  } catch (cause) {
    if (!(cause instanceof VerifierOperationalStop)) throw cause;
    cleanupStopped = true;
  }

  const { judge } = options;
  const judgeCases =
    judge === undefined || cleanupStopped
      ? []
      : await measuredPhase(options.observer, "judge", "Judge census", () =>
          runJudgePhase({
            judge,
            subjects,
            write: ctx.evidence.write.bind(ctx.evidence),
          }),
        );

  const completed = publishBattery(ctx, discrimination, gradedCases, judgeCases, subjects.length);
  options.verifierLifetime?.assertUsable();
  // Only host-bound environment failures classify the whole battery as environment-blocked. Publish first so
  // a thrown non-result preserves every verdict; mixed cases remain the claim owner's decision.
  const blockedKinds = environmentBlockedBattery(completed.battery.cases, {
    discriminationClaimable: completed.discrimination.claimable,
    solverOriginCaseIds: new Set(
      gradedCases.filter((graded) => graded.solverOrigin).map((graded) => graded.record.taskId),
    ),
  });
  if (blockedKinds !== null) throw new BatteryVerificationNonResult(options.runId, blockedKinds);
  return { runId: options.runId, ...batteryClaimInput(completed.battery, ctx.checkIdsByTask, ctx.corpus) };
}
