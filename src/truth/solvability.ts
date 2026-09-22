/**
 * F2: runs the generated reference solve for every task and verifies what it produced. Reference
 * artifacts stay protected; they never become controls or Built Harness inputs. A passing witness
 * proves the submission path from public inputs, within the declared checks.
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
  /** Test override for a pre-ready spawn failure; production uses the pinned Bun executable. */
  referenceSolveExecutable?: string;
  /** Test override for a host whose sandbox cannot nest the generated-tool wall. */
  createSolvabilityStarter?: (options: GeneratedToolStarterOptions) => Promise<BuiltStarter>;
}

/** What the census reads from the recorded candidate once, before any witness runs. */
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

/** What one case needs beyond its task: the bundle, submission contract, census and stage memory. */
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
    // Stays `unknown` until `validateTasks` proves it is a battery.
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

/** Stage 1: reads the recorded candidate, or returns a finding naming the requirement it failed. */
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
    // Both calls share one bundle, so the digest names the bytes the runner executes.
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
  // F2 checks against the compiled public schema that submit enforces. A null schema (no accepts)
  // is refused by the submission path; a corpus that fails to compile is a finding here.
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

/** Stage 2: resolves tools as measurement does. Missing tools refuse before any witness runs, so a
 *  verifier that never started is not charged as product failures. An external check whose
 *  executable digest matches candidate-authored source is refused too. */
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

/** Solves (or reuses the keyed solve) and submits one task. A typed process failure keeps its
 *  owner; any other throw from the solve belongs to the product. */
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

/** Stage 3, one case: solve, submit, verify and record. Every unpassed row names an owner. */
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

/** Stage 3: cases run in the control census's lanes and are recorded in task order. After a stop
 *  no task starts; every case that ran keeps its row, and the cleanup finding is recorded once. */
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
      // One commit per case; each `view()` call re-parses, so every reader gets its own object.
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

/** Stage 4: external checks whose arguments look like program text, which would make an attested
 *  interpreter run candidate-authored logic. The rule is a bounded detection, not a provenance proof. */
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

/** The BuildDeps solvability probe. */
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
    // A tool refusal already blocks adoption; open neither the verifier nor the reference solver.
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
    // Family comparisons run at adoption only, and only when every case produced a witness.
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
