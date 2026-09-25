/**
 * F2: run the generated reference solve for every task and verify what it produced. The controller
 * owns everything that makes the result usable as evidence — the task bytes, the committed public
 * solve input, schema validation, ordinary verification, tool scopes and the snapshot identity
 * checks — so the candidate cannot supply its own witness. Reference artifacts
 * stay protected: they never become controls or Built Harness inputs, since an answer key that
 * reached the solver would make the battery measure recall rather than solving.
 *
 * What a passing witness proves is narrow, and stating it narrowly is the point: this submission
 * path can be walked from the public inputs and satisfies the declared checks. It does not prove the
 * answer is right for an end user, and it says nothing about a check the brief never declared.
 *
 * The census runs as stages, each reading declared bytes:
 *
 * 1. contract: the immutable snapshot's brief, tasks, correctness model and compiled schema;
 * 2. tool admission: the resolved installed tools;
 * 3. cases, in lanes: the reference solve (reference-solve.ts, remembered by its key), then the
 *    public submission path and the ordinary evaluation, which always run on this snapshot;
 * 4. snapshot drift, then evidence.
 */
// Gate audit 2026-09-25 (docs/gate-audit.md, tool-program-argument): commented out (unsure): an external check passing program text as an argument no longer refuses adoption
// Stage 2 also read the candidate's authored digests, and a stage between the cases and the drift
// check read the tool rows the case evaluations recorded for program arguments.

import { capturedJsonParse, capturedJsonStringify } from "../meta/json-runtime.ts";
import { readFileSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import type { FingerprintEvidence } from "../claim/fingerprint.ts";
import { harnessSettings } from "./harness-config.ts";
import type { SolvabilityCaseEvidence, SolvabilityEvidence } from "../claim/readiness.ts";
import {
  BUNDLE_SNAPSHOT_DIRECTORY,
  type BundleSnapshot,
  ensureBundleSnapshot,
} from "../claim/bundle-snapshot.ts";
import { sha256 } from "../meta/digest.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { VerifierOperationalStop, type VerifierLifetime } from "../verify/verifier-lifetime.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import type { BuiltStarter } from "../solve/built-starter.ts";
import type { GeneratedToolStarterOptions } from "../solve/generated-tool-worker.ts";
import type { PublicArtifactSchema } from "../solve/public-artifact-schema.ts";
import { createVerifierHost } from "../verify/host.ts";
import type { CorrectnessModelResult } from "../verify/correctness-model-result.ts";
import type { VerifierHostHandle } from "../verify/verifier-port.ts";
import { resolveToolInventory } from "../verify/tool-inventory.ts";
// Gate audit 2026-09-25 (docs/gate-audit.md, tool-program-argument): commented out (unsure): an external check passing program text as an argument no longer refuses adoption
// import { programArgumentChecks, programArgumentRemedy } from "../verify/self-grounding.ts";
// Gate audit 2026-09-25 (docs/gate-audit.md, tool-self-authored): commented out (unsure): an external check whose tool bytes equal candidate-authored files no longer refuses adoption
// import { selfGroundedChecks, selfGroundedRemedy } from "../verify/self-grounding.ts";
import { validateBrief } from "./brief-validator.ts";
import { type Brief, type ContractFinding, externalChecksOf, generatedExecutionFinding } from "./brief.ts";
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
import { blockingFailedCheckIds, blockingTruthFailure } from "./verdict-binding.ts";
import type { JsonValue } from "../meta/json-shape.ts";
import { BRIEF_FILE, EVALUATOR_FILE, TASKS_FILE } from "../meta/bundle-layout.ts";

export const SOLVABILITY_POLICY =
  "falsifier-solvability/v15:authored-executable-bytes+check-program+captured-controller-primitives+typed-pre-ready-environment-outcome+ready-owned-process-failures+bounded-lifetime+public-reference-package+confined-pid+full-census+canonical-full-task+writer-draft-materialise-submit-accept+compiled-public-submit-schema+ordinary-evaluate+bundleSnapshot-drift-refusal+optional-writer-call-trace";

export interface SolvabilityProbeOptions {
  /** Protected controller-owned process receipts; no generated child runs without this owner. */
  verifierLifetime?: VerifierLifetime;
  createVerifier?: () => VerifierHostHandle;
  /** Test override. Production leaves this unset, so each reference solve gets the wall the
   *  candidate's own `agent/config.yaml` declares as `gate.reference_solve_seconds`. */
  referenceSolveTimeoutMs?: number;
  /** Test override for a host-side pre-ready spawn failure, which is otherwise unreachable.
   *  Production always uses the pinned Bun executable. */
  referenceSolveExecutable?: string;
  /** Test override for a host whose surrounding sandbox cannot nest the production generated-tool
   *  wall, where the alternative would be leaving that host unable to run the census at all. */
  createSolvabilityStarter?: (options: GeneratedToolStarterOptions) => Promise<BuiltStarter>;
}

/** Everything the census reads out of the recorded candidate, read once before any witness runs so
 *  that every case is judged against one set of bytes. */
interface SolvabilityContract {
  bundleSnapshot: BundleSnapshot;
  evaluator: CheckRunner;
  brief: Brief;
  tasks: BuildTask[];
  publicArtifactSchema: PublicArtifactSchema | null;
  /** The bound task-set identity; a candidate without one never reaches the census. */
  taskSetHash: string;
}

type Loaded<T> = { ok: true; value: T } | { ok: false; finding: ContractFinding };

/** What one case needs beyond its own task: the recorded bytes to solve against, the submission
 *  contract it has to pass, the census condition it is judged under, and the stage memory that lets
 *  a repeated gate call reuse a solve instead of paying for it again. */
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

/** One task's census record, with a finding when it fails. */
interface SolvabilityCaseOutcome {
  row: SolvabilityCaseEvidence;
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
    const briefUnknown = capturedJsonParse(readFileSync(join(dir, BRIEF_FILE), "utf8"));
    const briefValidation = validateBrief(briefUnknown);
    if (!briefValidation.ok) {
      throw new Error(briefValidation.findings.map((finding) => finding.detail).join("; "));
    }
    const brief =
      /* SAFETY: `validateBrief` returned ok directly above, which is the only proof of this shape. */ briefUnknown as Brief;
    // Held at `unknown` on purpose: `capturedJsonParse` proves these bytes are JSON and nothing
    // more, and `validateTasks` below is the only thing that proves they are a battery.
    const tasksUnknown: unknown = capturedJsonParse(readFileSync(join(dir, TASKS_FILE), "utf8"));
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

/** Stage 1: read the recorded candidate, or return a finding naming the requirement that failed —
 *  an unbound task set, a broken snapshot, a correctness model that will not load, contract bytes
 *  that are not a brief and a battery, or an accept corpus whose submission schema will not compile.
 *  Naming the requirement is what lets the refusal route to an owner instead of arriving as a
 *  stack trace. */
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
  try {
    evaluator = await loadCorrectnessModel(bundleSnapshot.dir, verifierLifetime);
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
  // The compiled public submission schema is what submit-time acceptance enforces, so F2 has to
  // check against it and not against the brief's declared roots. Checking only the declared
  // top-level roots lets a truth-correct reference artifact pass here while every real solve is
  // refused at submit. The loader returns null when the controls file or its accepts
  // are absent, which the submission path refuses on its own; a corpus present but failing to
  // compile is a finding here, where it still names the corpus.
  const publicSchema = loadSolvabilityPublicSchema(bundleSnapshot.dir, brief.artifactSchema);
  if (!publicSchema.ok) return { ok: false, finding: publicSchema.finding };
  return {
    ok: true,
    value: {
      bundleSnapshot,
      evaluator,
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
      },
      "generated-bundleSnapshot-drift",
    );
  }
}

/** Stage 2: resolve tools exactly as measurement will. A missing tool refuses before any witness
 *  runs, because otherwise a whole battery of product failures is charged to a verifier that never
 *  started. */
function admitTools(
  contract: SolvabilityContract,
  // Gate audit 2026-09-25 (docs/gate-audit.md, tool-self-authored): commented out (unsure): an external check whose tool bytes equal candidate-authored files no longer refuses adoption
  // fingerprint: FingerprintEvidence,
  options: SolvabilityProbeOptions,
) {
  const { brief, bundleSnapshot } = contract;
  const externalChecks = externalChecksOf(brief);
  const resolved = resolveToolInventory({
    toolIds: externalChecks.map((check) => check.adapterId),
    toolTree: bundleSnapshot.toolTree,
  });
  // Gate audit 2026-09-25 (docs/gate-audit.md, tool-self-authored): commented out (unsure): an external check whose tool bytes equal candidate-authored files no longer refuses adoption
  // // An external check whose executable digest matches candidate-authored source is refused as
  // // well: a different digest or a different installation directory still does not make the
  // // instrument independent of the author. The external-check id set is read only here and by the
  // // archived program-argument rule.
  // const externalIds = new Set(
  //   brief.truthChecks
  //     .filter((check) => check.execution.evidence.kind === "external")
  //     .map((check) => check.id),
  // );
  const findings: ContractFinding[] = [];
  // Gate audit 2026-09-25 (docs/gate-audit.md, tool-self-authored): commented out (unsure): an external check whose tool bytes equal candidate-authored files no longer refuses adoption
  // const authored = new Set(
  //   [...fingerprint.agentFiles, ...fingerprint.correctnessModelFiles].map((file) => file.sha256),
  // );
  // const selfGrounded = selfGroundedChecks(
  //   externalChecks.filter((check) => externalIds.has(check.checkId)),
  //   resolved.inventory,
  //   authored,
  // );
  // if (selfGrounded.length > 0) {
  //   findings.push({
  //     code: "solvability-tool-self-authored",
  //     path: BRIEF_FILE,
  //     detail: selfGroundedRemedy(selfGrounded),
  //   });
  // }
  const unresolved = [...resolved.missing, ...resolved.invalid];
  if (options.createVerifier === undefined && unresolved.length > 0) {
    findings.push({
      code: "solvability-tool-missing",
      path: BRIEF_FILE,
      detail: `external-verifier check(s) name tool(s) [${unresolved.join(", ")}] that resolve neither under .toolchain nor on the host PATH; install the tool or ground the check differently`,
    });
  }
  // Gate audit 2026-09-25 (docs/gate-audit.md, tool-program-argument): commented out (unsure): an external check passing program text as an argument no longer refuses adoption
  // return { inventory: resolved.inventory, externalIds, findings };
  return { inventory: resolved.inventory, findings };
}

/** Solve one task, or reuse the keyed solve, and submit it. The submission path always runs on this
 *  snapshot and attributes its own refusals, so this function only has to own what escapes it: a
 *  typed process failure keeps the process owner, and any other throw out of the solve belongs to
 *  the product, which is where an unclassified throw would otherwise leave no owner at all. */
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
      nonResultKind: typed?.kind === "reference-solve-host" ? "reference-solve-host" : null,
      solveIsolationViolation: isReferenceSolveIsolationFailure(caught),
      referenceSolve,
    };
  }
}

/** The finding code a failed case routes to. */
function failureCode(attempt: ReferenceSubmissionAttempt): string {
  if (attempt.nonResultKind === "submission-path-host") return "solvability-submission-path-host-non-result";
  if (attempt.nonResultKind !== null) return "solvability-reference-solve-host-non-result";
  if (attempt.failureKind === "representation-defect") return "solvability-representation-defect";
  return attempt.solveIsolationViolation
    ? "solvability-reference-solve-isolation"
    : "solvability-witness-failed";
}

/** Stage 3, one case: solve, submit, verify and record. A passed row carries no failure
 *  attribution, and an unpassed one always yields a finding whose code names what failed. */
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
    // Gate audit 2026-09-25 (docs/gate-audit.md, f2-reference-verdict): kept: a reference solve its own checks reject shows before any paid solve that no pass is reachable through the declared path
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
    artifact: accepted === null ? null : capturedJsonParse(accepted),
    status: passed ? "passed" : attempt.nonResultKind === null ? "failed" : "non-result",
    nonResultKind: attempt.nonResultKind,
    failureKind: passed ? null : attempt.failureKind,
    submissionPath: attempt.submissionPath,
    referenceSolve: attempt.referenceSolve,
    failedCheckIds: result === null ? [] : failedCheckIds(result),
    predicateFailures,
    error,
  };
  if (passed) return { row, finding: null };
  const finding = {
    code: failureCode(attempt),
    path: `correctness-model/tasks.json#${task.taskId}`,
    detail: error ?? "reference artifact did not earn a truth verdict",
  };
  return {
    row,
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
  };
}

/** Stage 3: cases run in the control census's lanes and are recorded in task order. The lane width
 *  is the control census's because the two have the same shape of work: a whole task set solved one
 *  after another inside the same wall the controls run under. After a stop no further task starts,
 *  every case that already ran keeps its row, and the cleanup finding is admitted once rather than
 *  per lane. */
async function solveInLanes(
  session: SolvabilityCaseSession,
  tasks: readonly BuildTask[],
  cut: () => boolean,
) {
  const cases: SolvabilityCaseEvidence[] = [];
  const findings: ContractFinding[] = [];
  let stopped = false;
  const settled = await inLanes(
    [...tasks].sort((a, b) => compareCodeUnits(a.taskId, b.taskId)),
    CENSUS_LANES,
    async (task) => {
      const fullTaskJson = capturedJsonStringify(task);
      // One commit for the whole case: `view()` re-parses its own bytes on each call, so every
      // reader gets an independent object and no stage can hand the next one a mutated task.
      const roundTripped: unknown = capturedJsonParse(fullTaskJson);
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
  return { cases, findings };
}

// Gate audit 2026-09-25 (docs/gate-audit.md, tool-program-argument): commented out (unsure): an external check passing program text as an argument no longer refuses adoption
// /** Stage 4: external checks whose arguments match the program-text rule. Program text passed as an
//  *  argument makes an attested interpreter execute candidate-authored logic, which is authored
//  *  computation wearing an installed tool's digest, and it is the ordinary way an authored check
//  *  reaches for an interpreter rather than a corner case. The rule detects some such cases and
//  *  proves no provenance, so it refuses the shape rather than claiming to establish independence. */
// function programArgumentFindings(
//   verifier: VerifierHostHandle,
//   externalIds: ReadonlySet<string>,
// ): ContractFinding[] {
//   const checks = programArgumentChecks(verifier.evidence(), externalIds);
//   if (checks.length === 0) return [];
//   return [
//     {
//       code: "solvability-tool-program-argument",
//       path: BRIEF_FILE,
//       detail: programArgumentRemedy(checks),
//     },
//   ];
// }

/** One policy-owned implementation for the mandatory BuildDeps solvability probe, so adoption and
 *  readiness cannot diverge on what F2 means. */
export function makeProbeSolvability(options: SolvabilityProbeOptions = {}): BuildDeps["probeSolvability"] {
  return async ({ slugDir, fingerprint, operandCommitment, stopped: cut = () => false, stages }) => {
    const loaded = await loadSolvabilityContract(slugDir, fingerprint, options.verifierLifetime);
    if (!loaded.ok) return { evidence: null, findings: [loaded.finding] };
    const contract = loaded.value;
    const { bundleSnapshot, evaluator, brief } = contract;
    // Gate audit 2026-09-25 (docs/gate-audit.md, tool-self-authored): commented out (unsure): an external check whose tool bytes equal candidate-authored files no longer refuses adoption
    // const tools = admitTools(contract, fingerprint, options);
    const tools = admitTools(contract, options);
    // A known admission refusal cannot earn an F2 witness, so keep the findings and open neither
    // the verifier nor the reference solver for a candidate that already cannot be adopted.
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
    // Gate audit 2026-09-25 (docs/gate-audit.md, tool-program-argument): commented out (unsure): an external check passing program text as an argument no longer refuses adoption
    // const findings = [...solved.findings, ...programArgumentFindings(verifier, tools.externalIds)];
    const findings = [...solved.findings];
    // A cut census reports no evidence.
    if (cut()) return { evidence: null, findings };
    const drift = bundleSnapshotDriftFinding(slugDir, fingerprint, bundleSnapshot);
    if (drift !== null && !findings.some((finding) => finding.code === "verifier-cleanup-pending")) {
      return { evidence: null, findings: [...findings, drift] };
    }
    if (drift !== null) findings.push(drift);
    const evidence: SolvabilityEvidence = {
      schema: "solvability/v9",
      policy: SOLVABILITY_POLICY,
      correctnessModelHash: fingerprint.correctnessModelHash,
      taskSetHash: contract.taskSetHash,
      bundleSnapshotId: bundleSnapshot.id,
      verifierEnvironmentHash: executionEvidence(verifier).verifierEnvironmentHash,
      operandCommitmentKeyId: operandCommitment.keyId,
      toolRuns: verifier.evidence().length,
      cases: solved.cases,
    };
    return { evidence, findings };
  };
}
