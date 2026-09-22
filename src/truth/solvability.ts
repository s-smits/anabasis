/**
 * F2: execute the generated reference solve for every task and verify what it produced. The
 * controller owns the task bytes, committed public solve input, schema validation, ordinary
 * verification, tool scopes, family comparisons and snapshot identity checks that make the results
 * usable as evidence. Reference artifacts remain protected; they do not become controls or Built
 * Harness inputs. A passing witness establishes this submission path using public inputs, within
 * the declared checks.
 *
 * The census runs as stages, each reading declared bytes:
 *
 * 1. contract: the immutable snapshot's brief, tasks, correctness model and compiled schema;
 * 2. tool admission: the resolved installed tools and the candidate's authored digests;
 * 3. cases, in lanes: the reference solve (reference-solve.ts, remembered by its key), then the
 *    public submission path and the ordinary evaluation, which always run on this snapshot;
 * 4. program arguments: the tool rows the case evaluations recorded;
 * 5. family transplants (adoption only): family-binding.ts, remembered by its key;
 * 6. snapshot drift, then evidence.
 */

import type { FingerprintEvidence } from "../claim/fingerprint.ts";
import { harnessSettings } from "./harness-config.ts";
import type { SolvabilityCaseEvidence, SolvabilityEvidence } from "../claim/readiness.ts";
import {
  BUNDLE_SNAPSHOT_DIRECTORY,
  type BundleSnapshot,
  ensureBundleSnapshot,
} from "../claim/bundle-snapshot.ts";
import { sha256 } from "../meta/digest.ts";
import type { OwnerLayer } from "../meta/owner.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { VerifierOperationalStop, type VerifierLifetime } from "../verify/verifier-lifetime.ts";
import { bundleEvaluator } from "./evaluator-process-bundle.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import type { BuiltStarter } from "../solve/built-starter.ts";
import type { GeneratedToolStarterOptions } from "../solve/generated-tool-worker.ts";
import type { PublicArtifactSchema } from "../solve/public-artifact-schema.ts";
import { createVerifierHost } from "../verify/host.ts";
import type { CorrectnessModelResult } from "../verify/correctness-model-result.ts";
import type { VerifierHostHandle } from "../verify/verifier-port.ts";
import { resolveToolInventory } from "../verify/tool-inventory.ts";
import {
  programArgumentChecks,
  programArgumentRemedy,
  selfGroundedChecks,
  selfGroundedRemedy,
} from "../verify/self-grounding.ts";
import { validateBrief } from "./brief-validator.ts";
import { type Brief, type ContractFinding, externalChecksOf, generatedExecutionFinding } from "./brief.ts";
import { type FamilyWitness, familyBindingStage } from "./family-binding.ts";
import { loadFailureFinding } from "./load-fault.ts";
import type { BuildDeps } from "./build-deps.ts";
import { loadCorrectnessModel } from "./contracts.ts";
import type { CheckRunner } from "./correctness-model-contract.ts";
import { evaluateCheckProgram } from "../../vendor/correctness-model-bundle/evaluate.ts";
import { executionEvidence } from "./tool-runs.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { loadSolvabilityPublicSchema } from "./solvability-artifact-schema.ts";
import { evaluateWitness, type WitnessCensus } from "./solvability-witness.ts";
import type { CheckFailureDetail } from "./predicate.ts";
import {
  type SolvabilitySubmissionOutcome,
  UNATTRIBUTED,
  submitSolvabilityReferenceArtifact,
} from "./solvability-submission.ts";
import type { SolvabilityStageCache, SolvabilityStageReceipt } from "./solvability-stages.ts";
import {
  ReferenceSolveProcessFailure,
  isReferenceSolveIsolationFailure,
  referenceSolveFailure,
  referenceSolveStage,
} from "./reference-solve.ts";
import { type CommittedPublicTask, commitPublicTask } from "./task-split.ts";
import { CENSUS_LANES, inLanes } from "./run-controls.ts";
import { type BuildTask, type TaskBattery, validateTasks } from "./tasks.ts";
import {
  trustedJoin as join,
  trustedReadFileSync as readFileSync,
  trustedJsonParse,
  trustedJsonStringify,
} from "./trusted-runtime.ts";
import { blockingFailedCheckIds, blockingTruthFailure } from "./verdict-binding.ts";
import type { JsonValue } from "../meta/json-shape.ts";
import { BRIEF_FILE, EVALUATOR_FILE, TASKS_FILE } from "../meta/bundle-layout.ts";

export const SOLVABILITY_READINESS_POLICY =
  "falsifier-solvability/v15:authored-executable-bytes+check-program+captured-controller-primitives+typed-pre-ready-environment-outcome+ready-owned-process-failures+bounded-lifetime+public-reference-package+confined-pid+full-census+canonical-full-task+writer-draft-materialise-submit-accept+compiled-public-submit-schema+ordinary-evaluate+bundleSnapshot-drift-refusal+optional-writer-call-trace";
export const SOLVABILITY_PROBE_POLICY = `${SOLVABILITY_READINESS_POLICY}+task-conditioned-family-binding`;

export interface SolvabilityProbeOptions {
  /** Protected controller-owned process receipts; no generated child runs without this owner. */
  verifierLifetime?: VerifierLifetime;
  createVerifier?: () => VerifierHostHandle;
  /** Test override; production gives each reference solve REFERENCE_SOLVE_TIMEOUT_MS. */
  referenceSolveTimeoutMs?: number;
  /** Test override for a host-side pre-ready spawn failure. Production always uses the pinned Bun executable. */
  referenceSolveExecutable?: string;
  /** Test override for a host whose surrounding sandbox cannot nest the production generated-tool wall. */
  createSolvabilityStarter?: (options: GeneratedToolStarterOptions) => Promise<BuiltStarter>;
}

/** Everything the census reads out of the recorded candidate once, before any witness runs. */
interface SolvabilityContract {
  bundleSnapshot: BundleSnapshot;
  evaluator: CheckRunner;
  /** Portable digest of the evaluator bundle `evaluator` runs. */
  evaluatorDigest: string;
  brief: Brief;
  tasks: BuildTask[];
  publicArtifactSchema: PublicArtifactSchema | null;
  /** The bound task-set identity; a candidate without one never reaches the census. */
  taskSetHash: string;
}

type Loaded<T> = { ok: true; value: T } | { ok: false; finding: ContractFinding };

/** What one case needs beyond its own task: the recorded bytes to solve against, the submission
 * contract to pass, the census condition to be judged under, and the stage memory. */
interface SolvabilityCaseSession {
  bundleDir: string;
  bundleSnapshotId: string;
  publicArtifactSchema: PublicArtifactSchema | null;
  options: SolvabilityProbeOptions;
  census: WitnessCensus;
  stages: SolvabilityStageCache | undefined;
}

/** The submission outcome plus the facts only the solve side knows. */
type ReferenceSubmissionAttempt = SolvabilitySubmissionOutcome & {
  /** The solve reported a path or permission error matching the isolation-failure classifier. */
  solveIsolationViolation: boolean;
  referenceSolve: SolvabilityStageReceipt | null;
};

/** The finding code and owner a failed case routes to. */
interface Attribution {
  code: string;
  owner: OwnerLayer;
}

/** One task's census record, with a witness when it passes and a finding when it fails. */
interface SolvabilityCaseOutcome {
  row: SolvabilityCaseEvidence;
  witness: FamilyWitness | null;
  finding: ContractFinding | null;
}

function failedCheckIds(result: CorrectnessModelResult): string[] {
  return [...blockingFailedCheckIds(result)].sort();
}

function blockingFailure(result: CorrectnessModelResult): boolean {
  return result.ok !== true || blockingTruthFailure(result);
}

function parseBattery(dir: string): Loaded<{ brief: Brief; tasks: BuildTask[] }> {
  try {
    const briefUnknown = trustedJsonParse(readFileSync(join(dir, BRIEF_FILE), "utf8"));
    const briefValidation = validateBrief(briefUnknown);
    if (!briefValidation.ok) {
      throw new Error(briefValidation.findings.map((finding) => finding.detail).join("; "));
    }
    const brief =
      /* SAFETY: `validateBrief` returned ok directly above, which is the only proof of this shape. */ briefUnknown as Brief;
    // Held at `unknown` on purpose: `trustedJsonParse` proves these bytes are JSON, and
    // `validateTasks` below is the only thing that proves they are a battery.
    const tasksUnknown: unknown = trustedJsonParse(readFileSync(join(dir, TASKS_FILE), "utf8"));
    const batteryUnknown = { tasks: tasksUnknown };
    const tasksValidation = validateTasks(brief, batteryUnknown, {});
    if (!tasksValidation.ok) {
      throw new Error(tasksValidation.findings.map((finding) => finding.detail).join("; "));
    }
    const tasks =
      /* SAFETY: the battery validation directly above returned ok, which is the only proof of this shape. */ batteryUnknown.tasks as TaskBattery["tasks"];
    return { ok: true, value: { brief, tasks } };
  } catch (error) {
    return {
      ok: false,
      finding: {
        code: "solvability-bundleSnapshot-contract-invalid",
        path: "correctness-model/{brief,tasks}.json",
        detail: errorMessage(error),
      },
    };
  }
}

/** Stage 1: read the recorded candidate or return a finding naming the failed requirement: an
 * unbound task set, a broken snapshot, a correctnessModel that will not load, contract bytes that are
 * not a brief and a battery, and an accept corpus whose submission schema will not compile. */
async function loadSolvabilityContract(
  slugDir: string,
  fingerprint: FingerprintEvidence,
  verifierLifetime?: VerifierLifetime,
): Promise<Loaded<SolvabilityContract>> {
  const { taskSetHash } = fingerprint;
  if (taskSetHash === null) {
    return {
      ok: false,
      finding: {
        code: "solvability-task-set-unbound",
        path: TASKS_FILE,
        detail: "the candidate fingerprint has no taskSetHash, so no task-census proof can bind to it",
      },
    };
  }
  let bundleSnapshot: BundleSnapshot;
  try {
    bundleSnapshot = ensureBundleSnapshot(slugDir, fingerprint);
  } catch (error) {
    return {
      ok: false,
      finding: {
        code: "solvability-bundleSnapshot-integrity",
        path: BUNDLE_SNAPSHOT_DIRECTORY,
        detail: errorMessage(error),
      },
    };
  }
  let evaluator: CheckRunner;
  let evaluatorDigest: string;
  try {
    // Both calls share one bundle per package identity, so the digest names the bytes the runner executes.
    evaluator = await loadCorrectnessModel(bundleSnapshot.dir, verifierLifetime);
    evaluatorDigest = (await bundleEvaluator(bundleSnapshot.dir)).portableDigest;
  } catch (error) {
    return {
      ok: false,
      finding: loadFailureFinding(
        {
          code: "solvability-correctnessModel-load",
          path: EVALUATOR_FILE,
          detail: errorMessage(error),
        },
        "generated-correctness-model-load",
      ),
    };
  }
  const battery = parseBattery(bundleSnapshot.dir);
  if (!battery.ok) return battery;
  const { brief, tasks } = battery.value;
  // The compiled public submission schema is what submit-time acceptance enforces. Run 81's F2
  // checked only declared top-level roots, so truth-correct reference artifacts passed here and
  // every real solve was refused at submit. The loader returns null when controls or accepts are
  // absent, which the submission path refuses; a corpus that fails compilation is a finding here.
  const publicSchema = loadSolvabilityPublicSchema(bundleSnapshot.dir, brief.artifactSchema);
  if (!publicSchema.ok) return { ok: false, finding: publicSchema.finding };
  return {
    ok: true,
    value: {
      bundleSnapshot,
      evaluator,
      evaluatorDigest,
      brief,
      tasks,
      publicArtifactSchema: publicSchema.schema,
      taskSetHash,
    },
  };
}

/** The recorded bundle must still be the bundle every witness ran against. */
function bundleSnapshotDriftFinding(
  slugDir: string,
  fingerprint: FingerprintEvidence,
  bundleSnapshot: BundleSnapshot,
): ContractFinding | null {
  try {
    if (ensureBundleSnapshot(slugDir, fingerprint).id === bundleSnapshot.id) return null;
    throw new Error("bundle snapshot identity changed during solvability execution");
  } catch (error) {
    return generatedExecutionFinding(
      {
        code: "solvability-bundleSnapshot-drift",
        path: `${BUNDLE_SNAPSHOT_DIRECTORY}/${bundleSnapshot.id}`,
        detail: errorMessage(error),
        owner: "bh-correctness-model",
      },
      "generated-bundleSnapshot-drift",
    );
  }
}

/** Stage 2: resolve tools as measurement does. Missing tools refuse before witnesses: a run on
 *  2026-08-23 charged 25 product failures to a verifier which had never started. An external check
 *  whose executable digest matches candidate-authored source is refused too (a different digest or
 *  installation directory still does not establish independence). */
function admitTools(
  contract: SolvabilityContract,
  fingerprint: FingerprintEvidence,
  options: SolvabilityProbeOptions,
) {
  const { brief, bundleSnapshot } = contract;
  const externalChecks = externalChecksOf(brief);
  const resolved = resolveToolInventory({
    toolIds: externalChecks.map((check) => check.adapterId),
    toolTree: bundleSnapshot.toolTree,
  });
  const externalIds = new Set(
    brief.truthChecks
      .filter((check) => check.execution.evidence.kind === "external")
      .map((check) => check.id),
  );
  const findings: ContractFinding[] = [];
  const authored = new Set(
    [...fingerprint.agentFiles, ...fingerprint.correctnessModelFiles].map((file) => file.sha256),
  );
  const selfGrounded = selfGroundedChecks(
    externalChecks.filter((check) => externalIds.has(check.checkId)),
    resolved.inventory,
    authored,
  );
  if (selfGrounded.length > 0) {
    findings.push({
      code: "solvability-tool-self-authored",
      path: BRIEF_FILE,
      detail: selfGroundedRemedy(selfGrounded),
    });
  }
  const unresolved = [...resolved.missing, ...resolved.invalid];
  if (options.createVerifier === undefined && unresolved.length > 0) {
    findings.push({
      code: "solvability-tool-missing",
      path: BRIEF_FILE,
      detail: `external-verifier check(s) name tool(s) [${unresolved.join(", ")}] that resolve neither under .toolchain nor on the host PATH; install the tool or ground the check differently`,
    });
  }
  return { inventory: resolved.inventory, externalIds, findings };
}

/** Solve (or reuse the keyed solve) and submit one task. The submission path always runs on this
 * snapshot and attributes its own refusals; a throw out of the solve is the process failure's when
 * typed, and the product's otherwise. */
async function attemptReferenceSubmission(
  session: SolvabilityCaseSession,
  task: CommittedPublicTask<JsonValue>,
): Promise<ReferenceSubmissionAttempt> {
  let referenceSolve: SolvabilityStageReceipt | null = null;
  try {
    const solved = await referenceSolveStage({
      slugDir: session.bundleDir,
      task: task.view(),
      timeoutMs: session.options.referenceSolveTimeoutMs,
      executable: session.options.referenceSolveExecutable,
      verifierLifetime: session.options.verifierLifetime,
      producedUnder: session.bundleSnapshotId,
      memory: session.stages?.referenceSolves,
    });
    referenceSolve = solved.receipt;
    if (solved.outcome.kind === "failure") throw referenceSolveFailure(solved.outcome.failure);
    const submitted = await submitSolvabilityReferenceArtifact({
      slugDir: session.bundleDir,
      task: task.view(),
      artifactSchema: session.census.brief.artifactSchema,
      publicArtifactSchema: session.publicArtifactSchema,
      artifact: solved.outcome.artifact,
      ...keyIfDefined("createStarter", session.options.createSolvabilityStarter),
    });
    return { ...submitted, solveIsolationViolation: false, referenceSolve };
  } catch (caught) {
    if (caught instanceof VerifierOperationalStop) throw caught;
    const typed = caught instanceof ReferenceSolveProcessFailure ? caught : null;
    return {
      ...UNATTRIBUTED,
      error: errorMessage(caught),
      authorClassification: typed?.kind ?? "generated-solve-throw",
      nonResultKind: typed?.owner === "environment" ? "reference-solve-host" : null,
      failureOwner: typed?.owner ?? "product",
      solveIsolationViolation: isReferenceSolveIsolationFailure(caught),
      referenceSolve,
    };
  }
}

function failureAttribution(attempt: ReferenceSubmissionAttempt): Attribution {
  if (attempt.nonResultKind === "submission-path-host") {
    return { code: "solvability-submission-path-host-non-result", owner: "environment" };
  }
  if (attempt.nonResultKind !== null) {
    return { code: "solvability-reference-solve-host-non-result", owner: "environment" };
  }
  if (attempt.failureKind === "representation-defect") {
    return { code: "solvability-representation-defect", owner: "bh-representation" };
  }
  return {
    code: attempt.solveIsolationViolation
      ? "solvability-reference-solve-isolation"
      : "solvability-witness-failed",
    owner: "bh-correctness-model",
  };
}

/** Stage 3, one case: solve, submit, verify and record. A passed row carries no failure attribution;
 * an unpassed row always names an owner, even when the attempt itself never said who. */
async function runSolvabilityCase(
  session: SolvabilityCaseSession,
  task: BuildTask,
  fullTaskJson: string,
  committed: CommittedPublicTask<JsonValue>,
): Promise<SolvabilityCaseOutcome> {
  const attempt = await attemptReferenceSubmission(session, committed);
  const accepted = attempt.artifactJson;
  let { error, authorClassification } = attempt;
  let result: CorrectnessModelResult | null = null;
  let predicateFailures: CheckFailureDetail[] = [];
  if (accepted !== null && error === null) {
    const verified = await evaluateWitness(session.census, fullTaskJson, accepted, `self:${task.taskId}`);
    ({ result, error, authorClassification, predicateFailures } = verified);
    if (result !== null && blockingFailure(result)) {
      const blocked = failedCheckIds(result);
      error = `reference artifact was rejected${blocked.length > 0 ? ` on [${blocked.join(", ")}]` : " without an attributed check"}`;
      authorClassification ??= "generated-evaluate-result";
    }
  }
  const passed = result !== null && error === null && !blockingFailure(result);
  const row: SolvabilityCaseEvidence = {
    taskId: task.taskId,
    fullTaskDigest: sha256(fullTaskJson),
    publicTaskDigest: committed.publicTaskDigest,
    artifactDigest: accepted === null ? null : sha256(accepted),
    artifact: accepted === null ? null : trustedJsonParse(accepted),
    status: passed ? "passed" : attempt.nonResultKind === null ? "failed" : "non-result",
    nonResultKind: attempt.nonResultKind,
    failureOwner: passed ? null : (attempt.failureOwner ?? "product"),
    failureKind: passed ? null : attempt.failureKind,
    submissionPath: attempt.submissionPath,
    referenceSolve: attempt.referenceSolve,
    failedCheckIds: result === null ? [] : failedCheckIds(result),
    predicateFailures,
    error,
  };
  if (passed) {
    return {
      row,
      witness:
        accepted === null
          ? null
          : { taskId: task.taskId, family: task.family, artifact: trustedJsonParse(accepted) },
      finding: null,
    };
  }
  const attribution = failureAttribution(attempt);
  const finding = {
    code: attribution.code,
    path: `correctness-model/tasks.json#${task.taskId}`,
    detail: error ?? "reference artifact did not earn a truth verdict",
    owner: attribution.owner,
  };
  return {
    row,
    witness: null,
    finding:
      authorClassification === null ? finding : generatedExecutionFinding(finding, authorClassification),
  };
}

/** The host stopped a verifier child it could not reap; the environment owns the rest of the census. */
function cleanupPending(stop: VerifierOperationalStop): ContractFinding {
  return {
    code: "verifier-cleanup-pending",
    path: TASKS_FILE,
    detail: stop.message,
    owner: "environment",
  };
}

/** Stage 3: cases run in the control census's lanes and are recorded in task order. The 7d433e truss
 *  candidate solved 25 tasks one after another inside the same ten-minute wall as its controls,
 *  and met that wall on all three gate calls. After a stop no task starts; every case that ran
 *  keeps its row, and the cleanup finding is admitted once. */
async function solveInLanes(
  session: SolvabilityCaseSession,
  tasks: readonly BuildTask[],
  cut: () => boolean,
) {
  const cases: SolvabilityCaseEvidence[] = [];
  const witnesses: FamilyWitness[] = [];
  const findings: ContractFinding[] = [];
  /** Canonical full-task bytes for the family comparisons. */
  const taskJson = new Map<string, string>();
  let stopped = false;
  const settled = await inLanes(
    [...tasks].sort((a, b) => compareCodeUnits(a.taskId, b.taskId)),
    CENSUS_LANES,
    async (task) => {
      const fullTaskJson = trustedJsonStringify(task);
      taskJson.set(task.taskId, fullTaskJson);
      // One commit for the whole case: `view()` re-parses its own bytes on each call, so every reader
      // still gets an independent object.
      const roundTripped: unknown = trustedJsonParse(fullTaskJson);
      const committed = commitPublicTask(
        /* SAFETY: this loop's own serialisation of a battery member. */ roundTripped as BuildTask,
      );
      try {
        return {
          task,
          fullTaskJson,
          committed,
          outcome: await runSolvabilityCase(session, task, fullTaskJson, committed),
        };
      } catch (error) {
        if (!(error instanceof VerifierOperationalStop)) throw error;
        stopped = true;
        return { task, fullTaskJson, committed, stop: error };
      }
    },
    () => stopped || cut(),
  );
  for (const slot of settled) {
    if (slot === undefined) break;
    if ("outcome" in slot) {
      cases.push(slot.outcome.row);
      if (slot.outcome.witness !== null) witnesses.push(slot.outcome.witness);
      if (slot.outcome.finding !== null) findings.push(slot.outcome.finding);
      continue;
    }
    cases.push({
      taskId: slot.task.taskId,
      fullTaskDigest: sha256(slot.fullTaskJson),
      publicTaskDigest: slot.committed.publicTaskDigest,
      artifactDigest: null,
      artifact: null,
      status: "non-result",
      nonResultKind: "sandbox",
      failureOwner: "environment",
      failureKind: null,
      submissionPath: null,
      referenceSolve: null,
      failedCheckIds: [],
      predicateFailures: [],
      error: errorMessage(slot.stop),
    });
    if (!findings.some((finding) => finding.code === "verifier-cleanup-pending")) {
      findings.push(cleanupPending(slot.stop));
    }
  }
  return { cases, witnesses, findings, taskJson };
}

/** Stage 4: external checks with arguments matching the program-text rule. Program text can make an
 *  attested interpreter execute candidate-authored logic (truss 0908: 81% of python3 rows used
 *  `-c`). The bounded rule detects some such cases without proving provenance. */
function programArgumentFindings(
  verifier: VerifierHostHandle,
  externalIds: ReadonlySet<string>,
): ContractFinding[] {
  const checks = programArgumentChecks(verifier.evidence(), externalIds);
  if (checks.length === 0) return [];
  return [
    {
      code: "solvability-tool-program-argument",
      path: BRIEF_FILE,
      detail: programArgumentRemedy(checks),
    },
  ];
}

/** One policy-owned implementation for the mandatory BuildDeps probe. */
export function makeProbeSolvability(
  options: SolvabilityProbeOptions = {},
  purpose: "adoption" | "readiness" = "adoption",
): BuildDeps["probeSolvability"] {
  return async ({ slugDir, fingerprint, operandCommitment, stopped: cut = () => false, stages }) => {
    const loaded = await loadSolvabilityContract(slugDir, fingerprint, options.verifierLifetime);
    if (!loaded.ok) return { evidence: null, findings: [loaded.finding] };
    const contract = loaded.value;
    const { bundleSnapshot, evaluator, brief } = contract;
    const tools = admitTools(contract, fingerprint, options);
    // A known admission refusal cannot earn an F2 witness: keep the findings and open neither the
    // verifier nor the reference solver for a candidate that already cannot be adopted.
    if (tools.findings.length > 0) return { evidence: null, findings: tools.findings };
    const verifier = (
      options.createVerifier ??
      (() =>
        createVerifierHost({
          inventory: tools.inventory,
          toolTree: bundleSnapshot.toolTree,
          toolRunMs: harnessSettings(bundleSnapshot.dir).toolRunMs,
          ...keyIfDefined("lifetime", options.verifierLifetime),
        }))
    )();
    const census: WitnessCensus = {
      brief,
      verifier,
      evaluate: evaluateCheckProgram(brief, evaluator),
      operandCommitment,
    };
    const session: SolvabilityCaseSession = {
      bundleDir: bundleSnapshot.dir,
      bundleSnapshotId: bundleSnapshot.id,
      publicArtifactSchema: contract.publicArtifactSchema,
      options,
      census,
      stages,
    };
    const solved = await solveInLanes(session, contract.tasks, cut);
    if (cut()) return { evidence: null, findings: [] };
    const findings = [...solved.findings, ...programArgumentFindings(verifier, tools.externalIds)];
    // Only adoption decides family discrimination: readiness re-verifies every public solve, and a
    // missing witness already refuses the candidate and cannot support a family comparison.
    let familyBinding: SolvabilityStageReceipt | null = null;
    try {
      if (
        purpose === "adoption" &&
        solved.cases.length > 0 &&
        solved.witnesses.length === solved.cases.length
      ) {
        const stage = await familyBindingStage({
          brief,
          witnesses: solved.witnesses,
          taskJson: solved.taskJson,
          census,
          evaluator,
          evaluatorDigest: contract.evaluatorDigest,
          inventory: tools.inventory,
          producedUnder: bundleSnapshot.id,
          memory: stages?.familyBindings,
          stopped: cut,
        });
        findings.push(...stage.findings);
        familyBinding = stage.receipt;
      }
    } catch (error) {
      if (!(error instanceof VerifierOperationalStop)) throw error;
      findings.push(cleanupPending(error));
    }
    // The wall stopped admitting transplants; a partial family census reports no evidence.
    if (cut()) return { evidence: null, findings };
    const drift = bundleSnapshotDriftFinding(slugDir, fingerprint, bundleSnapshot);
    if (drift !== null && !findings.some((finding) => finding.code === "verifier-cleanup-pending")) {
      return { evidence: null, findings: [...findings, drift] };
    }
    if (drift !== null) findings.push(drift);
    const evidence: SolvabilityEvidence = {
      schema: "solvability/v8",
      policy: purpose === "adoption" ? SOLVABILITY_PROBE_POLICY : SOLVABILITY_READINESS_POLICY,
      correctnessModelHash: fingerprint.correctnessModelHash,
      taskSetHash: contract.taskSetHash,
      bundleSnapshotId: bundleSnapshot.id,
      verifierEnvironmentHash: executionEvidence(verifier).verifierEnvironmentHash,
      operandCommitmentKeyId: operandCommitment.keyId,
      toolRuns: verifier.evidence().length,
      familyBinding,
      cases: solved.cases,
    };
    return { evidence, findings };
  };
}
