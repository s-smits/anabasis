/**
 * One case's solve and verification, held apart from every run-level accumulator.
 *
 * `solveCase` runs concurrently with other cases. Its dependencies exclude the verifier host and
 * every shared accumulator, so it cannot open an evaluation scope or touch another case's state.
 *
 * Grading is separate because the host keeps one open subject: opening a second scope closes the
 * first. The battery calls `gradeCase` in task order while later solves may still run, and
 * `rehearseCase` shares the same accepted-byte execution. Grading decides one `CaseOutcome` and
 * builds the record from it.
 */
import type { ConformanceEvidence } from "../claim/conformance-evidence.ts";
import { sha256 } from "../meta/digest.ts";
import {
  type FinalSubmission,
  type SubmissionPort,
  createSubmissionAuthority,
  submissionPortOf,
} from "../solve/final-submission.ts";
import { WORKER_BINDING_MISMATCH, workerBindingRefusal } from "../solve/generated-tool-worker.ts";
import type {
  BuiltStarterCheckpoint,
  BuiltStarterRegistration,
  GeneratedToolWorkerEvidence,
} from "../solve/built-starter.ts";
import type { PublicArtifactSchema } from "../solve/public-artifact-schema.ts";
import type { CaseTrace } from "../backends/trace-capture.ts";
import { type EvaluatorFn, type Toolset, loadCorrectnessModel } from "./contracts.ts";
import {
  type BuiltRuntimeBoundaryEvidence,
  type SolveOutcome,
  type Solver,
  nonResultOutcome,
} from "./solve.ts";
import {
  type CommittedPublicTask,
  type PublicTask,
  commitPublicTask,
  evaluationPublicTask,
} from "./task-split.ts";
import type { BuildTask } from "./tasks.ts";
import { trustedJsonParse, trustedJsonStringify, trustedStructuredClone } from "./trusted-runtime.ts";
import { isString, type JsonValue } from "../meta/json-shape.ts";
import type { DiscriminationClaimabilityFinding } from "../claim/discrimination-claimability.ts";
import type { NonResultKind } from "../claim/record-events.ts";
import { bundleSnapshotToolTree } from "../claim/bundle-snapshot.ts";
import type { CorrectnessModelResult } from "../verify/correctness-model-result.ts";
import type { VerifierHostHandle } from "../verify/verifier-port.ts";
import { VerifierOperationalStop, type VerifierLifetime } from "../verify/verifier-lifetime.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import type { CaseRecord } from "./battery-record.ts";
import { type Brief, applicableTruthChecks, externalChecksOf, requiredToolsOf } from "./brief.ts";
import { hostNonResult, uncoveredExternalCheckIds } from "./tool-runs.ts";
import { solverNonResultReason } from "./runtime-blocker.ts";
import { blockingFailedCheckIds, blockingTruthFailure } from "./verdict-binding.ts";
import { evaluateCheckProgram } from "./predicate.ts";
import { EvaluatorProcessFailure } from "./evaluator-process.ts";
import { resolveVerifier } from "./verification-registry.ts";
import { asError, errorMessage } from "../meta/runtime-values.ts";

/** What this case may record. Interfaces lack the implicit index signature `JsonValue` needs, so
 *  each is listed even though its bytes are JSON. */
export type SolveCaseEvidence =
  | JsonValue
  | BuiltStarterRegistration
  | GeneratedToolWorkerEvidence
  | BuiltRuntimeBoundaryEvidence
  | NonNullable<ReturnType<typeof workerBindingRefusal>>
  | FinalSubmissionEvidence
  | CaseTrace
  | { schema: "built-starter-checkpoints/v2"; checkpoints: BuiltStarterCheckpoint[] };

interface SolveCaseDeps {
  createStarter: (
    task: PublicTask<unknown>,
    submission: SubmissionPort,
    publicArtifactSchema: PublicArtifactSchema,
  ) => Toolset | Promise<Toolset>;
  solver: Solver;
  projectToolset?: (toolset: Toolset) => Toolset;
  /** Build-time worker binding the production generated-tool worker must reproduce. */
  conformance?: ConformanceEvidence | null;
  publicArtifactSchema: PublicArtifactSchema;
  /** The controller-owned submit attempt budget. */
  maxSubmitAttempts: number;
  /** The battery's one evidence writer; every path this function writes is case-scoped. */
  write: (path: string, value: SolveCaseEvidence) => void;
}

/** What the recorder needs from a solved case; it carries no verdict. */
export interface SolvedCase {
  task: BuildTask;
  /** The pre-solve commitment, the recorder's only source of task bytes for verification. */
  committed: CommittedPublicTask<unknown>;
  solved: SolveOutcome;
  final: FinalSubmission | null;
  /** Non-null identifies an invalid controller record that prevents a claim. */
  finalDefect: string | null;
  acceptedSubmit: boolean;
  /** Controller clock around the solver call, recorded on the case row. */
  instants: { startedAt: string; endedAt: string };
}

export interface GradeCaseDeps {
  verifierLifetime?: VerifierLifetime;
  brief: Brief;
  evaluate: EvaluatorFn;
  verifier: VerifierHostHandle;
  runId: string;
  externalChecks: Array<{ checkId: string; adapterId: string }>;
  /** This task's applicable checkIds, computed by the shared applicability owner. */
  applicableIds: string[];
}

/** The record fields a case's outcome decides; the rest of a `CaseRecord` is solver telemetry. */
type ScoredFields = Pick<
  CaseRecord,
  "acceptedSubmit" | "truthOk" | "pass" | "runtimeNonResult" | "runtimeNonResultKind"
>;

/** One case's facts; difficulty, firing counts and Judge subjects are projected from these. */
export interface GradedCase {
  record: CaseRecord;
  /** Raw evaluator output stays private, including a verdict overruled by a host non-result. */
  verdict: CorrectnessModelResult | null;
  /** Accepted bytes, parsed independently of the evaluator's mutable request. */
  submittedArtifact: JsonValue | null;
  unboundFindings: DiscriminationClaimabilityFinding[];
  /** Solver-side non-results have different censoring rules from verifier-side failures. */
  solverOrigin: boolean;
}

/** The final-submission fact, or a note saying why it could not be recorded. */
type FinalSubmissionEvidence = FinalSubmission | null | { falsifiedFact: true; note: string };

/** What grading decided about one case: no accepted submission, a defective controller record,
 *  an operational failure that scores nothing, or a verdict over accepted bytes. */
type CaseOutcome =
  | { kind: "unaccepted" }
  | { kind: "invalid-authority" }
  | { kind: "non-result"; reason: string; nonResultKind: NonResultKind }
  | { kind: "truth"; truthOk: boolean };

/** Grading's decision plus what the record does not carry: unbound findings, the raw verdict, and
 *  whether a failure was the solver's, which censors differently. */
interface GradedOutcome {
  outcome: CaseOutcome;
  unbound: string[];
  verdict: CorrectnessModelResult | null;
  solverOrigin: boolean;
}

/** The whole verifier deadline for one rehearsal, stated in `harness_trial`'s own description. */
export const REHEARSAL_VERIFIER_DEADLINE_MS = 30_000;

const nonResult = (reason: string, nonResultKind: NonResultKind): CaseOutcome => ({
  kind: "non-result",
  reason,
  nonResultKind,
});

/** Checks the controller's final-submission fact is internally consistent before it is read as
 *  JSON. A violation is a submission-authority defect and prevents a claim. */
function finalSubmissionDefect(final: FinalSubmission | null): string | null {
  try {
    trustedJsonStringify(final);
  } catch {
    return "the final-submission fact itself does not serialize (BigInt/circular field)";
  }
  if (final?.accepted !== true) return null;
  if (!isString(final.artifactJson)) return "accepted with no captured bytes";
  if (sha256(final.artifactJson) !== final.artifactDigest) return "artifactDigest != sha256(artifactJson)";
  try {
    trustedJsonParse(final.artifactJson);
  } catch {
    return "captured bytes are not valid JSON";
  }
  return null;
}

export async function solveCase(deps: SolveCaseDeps, task: BuildTask): Promise<SolvedCase> {
  // Commit the task before generated code runs, so nothing it mutates reaches the digest or the
  // task verification reads; solve and evaluate each get their own clone.
  const committed = commitPublicTask(task);
  deps.write(`cases/${task.taskId}/public-task.json`, {
    taskId: task.taskId,
    family: task.family,
    publicTaskDigest: committed.publicTaskDigest,
    publicTask: trustedJsonParse(committed.publicTaskJson),
  });
  const publicTask = committed.view();
  // The controller keeps the authority; generated code gets only its narrow port.
  const authority = createSubmissionAuthority({
    maxAttempts: deps.maxSubmitAttempts,
    publicArtifactSchema: deps.publicArtifactSchema,
  });
  const createdToolset = await deps.createStarter(
    publicTask,
    submissionPortOf(authority),
    deps.publicArtifactSchema,
  );
  const toolset = deps.projectToolset?.(createdToolset) ?? createdToolset;
  const registration = trustedStructuredClone(toolset.registration);
  deps.write(`cases/${task.taskId}/built-registration.json`, registration);
  const refusal = workerBindingRefusal(deps.conformance, deps.publicArtifactSchema.sha256, toolset);
  if (refusal !== null) {
    deps.write(`cases/${task.taskId}/worker-binding.json`, refusal);
    const closed = await toolset.close?.();
    if (closed) deps.write(`cases/${task.taskId}/built-runtime.json`, closed);
  }
  const startedAt = new Date().toISOString();
  const solved =
    refusal === null
      ? await deps.solver(publicTask, toolset, () => authority.finalSubmission()?.accepted === true)
      : nonResultOutcome({ kind: "protocol", message: WORKER_BINDING_MISMATCH });
  const endedAt = new Date().toISOString();
  if (solved.runtimeBoundary) deps.write(`cases/${task.taskId}/built-runtime.json`, solved.runtimeBoundary);
  // Verification reads the captured bytes, never mutable toolset state.
  const final = authority.finalSubmission();
  const finalDefect = finalSubmissionDefect(final);
  deps.write(
    `cases/${task.taskId}/final-submission.json`,
    finalDefect === null ? final : { falsifiedFact: true, note: finalDefect },
  );
  if (solved.trace) deps.write(`cases/${task.taskId}/trace.json`, solved.trace);
  deps.write(`cases/${task.taskId}/draft-checkpoints.json`, {
    schema: "built-starter-checkpoints/v2",
    checkpoints: solved.checkpoints ?? [],
  });
  return {
    task,
    committed,
    solved,
    instants: { startedAt, endedAt },
    final,
    finalDefect,
    acceptedSubmit: final?.accepted === true && finalDefect === null,
  };
}

/** A case the battery's stop rule never scheduled: it keeps its row as a provider non-result. */
export function unattemptedCase(task: BuildTask, message: string): SolvedCase {
  const at = new Date().toISOString();
  return {
    task,
    committed: commitPublicTask(task),
    solved: nonResultOutcome({ kind: "provider", message }),
    final: null,
    finalDefect: null,
    acceptedSubmit: false,
    instants: { startedAt: at, endedAt: at },
  };
}

/** One verifier scope over accepted canonical bytes, closed in `finally` so cleanup and output
 *  recording also run after a failure. */
async function runCaseScope(
  deps: Pick<GradeCaseDeps, "brief" | "evaluate" | "verifier" | "verifierLifetime" | "runId">,
  solved: Pick<SolvedCase, "task" | "committed">,
  artifactJson: string,
  signal?: AbortSignal,
): Promise<{
  verdict: CorrectnessModelResult | null;
  failure: Error | null;
  pendingInvocations: number;
  cleanupPending: boolean;
}> {
  const { task, committed } = solved;
  // One projection for the host subject and the evaluate request; openSubject digests it at once
  // and generated code gets a clone, so the two cannot drift.
  const evaluateTask = evaluationPublicTask(deps.brief, task, committed.view());
  // The host binds the accepted bytes, so the correctness model cannot route another value to an
  // engine. A port kept past evaluation stays this case's and fails closed.
  const scope = deps.verifier.openSubject({
    checks: applicableTruthChecks(deps.brief, task),
    runId: deps.runId,
    phase: "battery",
    subjectId: task.taskId,
    attempt: 1,
    artifact: trustedJsonParse(artifactJson),
    publicTask: evaluateTask,
    hidden: task.hidden,
  });
  let verdict: CorrectnessModelResult | null = null;
  let failure: Error | null = null;
  let cleanupPending = false;
  let closedScope: Awaited<ReturnType<typeof scope.close>>;
  const abort = () => {
    void scope.close().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    // The evaluator gets its own parse of the accepted bytes, so mutating its input cannot reach
    // the engine's input or the record.
    verdict = await deps.evaluate(
      trustedStructuredClone({
        publicTask: evaluateTask,
        artifact: trustedJsonParse(artifactJson),
        hidden: task.hidden,
      }),
      { tools: scope.port },
    );
  } catch (error) {
    cleanupPending = error instanceof VerifierOperationalStop;
    failure = asError(error);
    verdict = null;
  } finally {
    signal?.removeEventListener("abort", abort);
    closedScope = await scope.close();
  }
  const lifetimeStopped = !lifetimeUsable(deps.verifierLifetime);
  return {
    verdict,
    failure,
    pendingInvocations: closedScope.pendingInvocations,
    cleanupPending: cleanupPending || lifetimeStopped || closedScope.cleanup?.state === "pending",
  };
}

function lifetimeUsable(lifetime: VerifierLifetime | undefined): boolean {
  try {
    lifetime?.assertUsable();
  } catch (cause) {
    if (!(cause instanceof VerifierOperationalStop)) throw cause;
    return false;
  }
  return true;
}

/** Why a rehearsal produced no verdict. Deadline and cancellation are read from the signals,
 *  because an abort surfaces as whatever the aborted stage threw. */
function rehearsalFailure(error: unknown, signal: AbortSignal, callerSignal: AbortSignal | undefined) {
  if (error instanceof VerifierOperationalStop) return { status: "non-result", kind: "cleanup-pending" };
  if (signal.aborted) {
    return { status: "non-result", kind: callerSignal?.aborted === true ? "cancelled" : "timeout" };
  }
  if (error instanceof EvaluatorProcessFailure && ["timeout", "crash", "sandbox"].includes(error.kind)) {
    return { status: "non-result", kind: error.kind };
  }
  return { status: "execution-failed" };
}

/** Grades a rehearsal's accepted bytes with the battery's check program. Only the execution status
 *  and the aggregate `truthOk` bit leave; check ids and verifier diagnostics stay private. */
export async function rehearseCase(
  workspace: string,
  brief: Brief,
  solved: Pick<SolvedCase, "task" | "committed" | "final">,
  lifetime?: VerifierLifetime,
  callerSignal?: AbortSignal,
) {
  const { final, task } = solved;
  if (final?.accepted !== true || final.kind !== "artifact" || final.artifactJson === null) {
    return { status: "not-run" };
  }
  if (lifetime === undefined) return { status: "non-result", kind: "verifierUnavailable" };
  const deadline = AbortSignal.timeout(REHEARSAL_VERIFIER_DEADLINE_MS);
  const signal = callerSignal === undefined ? deadline : AbortSignal.any([callerSignal, deadline]);
  try {
    signal.throwIfAborted();
    lifetime.assertUsable();
    const checks = applicableTruthChecks(brief, task);
    const { verifier, missingTools } = resolveVerifier({
      toolTree: bundleSnapshotToolTree(workspace),
      bundleDir: workspace,
      toolIds: checks.flatMap((check) => requiredToolsOf(check.execution)),
      verifierLifetime: lifetime,
    });
    if (missingTools.length > 0) return { status: "non-result", kind: "verifierUnavailable" };
    const evaluate = evaluateCheckProgram(brief, await loadCorrectnessModel(workspace, lifetime, signal));
    // Reuse battery execution without recording a case or publishing the raw verdict.
    const scoped = await runCaseScope(
      { brief, evaluate, verifier, verifierLifetime: lifetime, runId: "harness-trial" },
      solved,
      final.artifactJson,
      signal,
    );
    if (scoped.cleanupPending) return { status: "non-result", kind: "cleanup-pending" };
    if (scoped.failure !== null) throw scoped.failure;
    signal.throwIfAborted();
    // The battery's own decision, so a grounded check that ran no tool is no pass here either.
    const subject = { phase: "battery" as const, subjectId: task.taskId, attempt: 1 };
    const outcome = acceptedOutcome(
      scoped,
      hostNonResult(verifier, subject),
      uncoveredExternalCheckIds(
        checks.map((check) => check.id),
        externalChecksOf(brief),
        verifier.executedBindings(),
        subject,
      ),
    );
    if (outcome.kind === "non-result") return { status: "non-result", kind: outcome.nonResultKind };
    return { status: "completed", truthOk: outcome.kind === "truth" ? outcome.truthOk : null };
  } catch (error) {
    return rehearsalFailure(error, signal, callerSignal);
  }
}

/**
 * The ordered reasons an accepted artifact scores nothing, else its truth bit. A cleanup failure
 * outranks the verdict it may have corrupted, a throw outranks a missing host run, and a host
 * outage outranks a grounded check that ran no tool, because the outage explains the missing run.
 */
function acceptedOutcome(
  scoped: Awaited<ReturnType<typeof runCaseScope>>,
  hostFailure: ReturnType<typeof hostNonResult>,
  missingExternalVerdicts: readonly string[],
): CaseOutcome {
  if (scoped.cleanupPending) {
    return nonResult("verifier-cleanup-pending: host process cleanup is incomplete", "sandbox");
  }
  if (scoped.verdict === null) {
    return nonResult(
      `verifier threw (${errorMessage(scoped.failure)}) — a declared check returns a Boolean, never throws`,
      "verifier-throw",
    );
  }
  if (hostFailure !== null && hostFailure.outcome !== "executed") {
    return nonResult(
      `tool "${hostFailure.toolId}" for check "${hostFailure.checkId}" reached no completed run (${hostFailure.outcome})`,
      hostFailure.outcome,
    );
  }
  // A blocking fail on a check with complete evidence decides the case; a skipped tool run could
  // only have withheld a pass.
  const failed = [...blockingFailedCheckIds(scoped.verdict)];
  if (missingExternalVerdicts.length > 0 && failed.every((id) => missingExternalVerdicts.includes(id))) {
    // The unattributed verifier kind belongs to generated behaviour, not the environment.
    return nonResult(
      `externally grounded check(s) ${missingExternalVerdicts.map((id) => `"${id}"`).join(", ")} ran no tool for this case`,
      "verifier",
    );
  }
  return { kind: "truth", truthOk: !blockingTruthFailure(scoped.verdict) };
}

/** Grades one closed verifier scope. A tool run still pending when evaluate returned prevents a
 *  claim, since a late result cannot prove the check used it. */
async function gradeAcceptedArtifact(
  deps: GradeCaseDeps,
  solved: SolvedCase,
  artifactJson: string,
): Promise<GradedOutcome> {
  const { taskId } = solved.task;
  // An evaluator throw leaves only this case ungraded.
  const scoped = await runCaseScope(deps, solved, artifactJson);
  const subject = { phase: "battery" as const, subjectId: taskId, attempt: 1 };
  // Coverage is required only after accepted bytes reached a real correctness-model verdict.
  const missingExternalVerdicts =
    solved.acceptedSubmit && scoped.verdict !== null
      ? uncoveredExternalCheckIds(
          deps.applicableIds,
          deps.externalChecks,
          deps.verifier.executedBindings(),
          subject,
        )
      : [];
  const unbound =
    scoped.pendingInvocations > 0
      ? [
          `case "${taskId}": ${scoped.pendingInvocations} tool run(s) still in flight when evaluate returned — a fire-and-forget tool run grounds nothing; the evaluate scope failed closed`,
        ]
      : [];
  return {
    outcome: acceptedOutcome(scoped, hostNonResult(deps.verifier, subject), missingExternalVerdicts),
    // A verdict the cleanup failure may have corrupted is not published as this case's verdict.
    verdict: scoped.cleanupPending ? null : scoped.verdict,
    unbound,
    solverOrigin: false,
  };
}

/** An explicit solve-side non-result wins; otherwise the unaccepted solve's trace is inspected. */
export function solverBlockerOf({ solved, acceptedSubmit }: SolvedCase): string | null {
  return (
    solved.nonResult?.message ??
    (acceptedSubmit
      ? null
      : solverNonResultReason({
          toolCalls: solved.toolCalls,
          ...keyIfDefined("startedToolCalls", solved.startedToolCalls),
          acceptedSubmit,
          errors: solved.errors,
          turns: solved.turns,
          completedTurns: solved.completedTurns,
        }))
  );
}

/** The scored fields of a `CaseRecord`, one arm per outcome. */
function scoredFields(outcome: CaseOutcome, acceptedSubmit: boolean): ScoredFields {
  const clear = { truthOk: null, runtimeNonResult: null, runtimeNonResultKind: null } as const;
  switch (outcome.kind) {
    case "unaccepted":
      return { acceptedSubmit, pass: false, ...clear };
    case "invalid-authority":
      return { acceptedSubmit: false, pass: false, ...clear };
    case "non-result":
      return {
        acceptedSubmit,
        truthOk: null,
        pass: null,
        runtimeNonResult: outcome.reason,
        runtimeNonResultKind: outcome.nonResultKind,
      };
    case "truth":
      return {
        acceptedSubmit,
        truthOk: outcome.truthOk,
        pass: acceptedSubmit && outcome.truthOk,
        runtimeNonResult: null,
        runtimeNonResultKind: null,
      };
  }
}

function caseRecord(solvedCase: SolvedCase, outcome: CaseOutcome): CaseRecord {
  const { task, solved, instants } = solvedCase;
  return {
    taskId: task.taskId,
    family: task.family,
    ...scoredFields(outcome, solvedCase.acceptedSubmit),
    solver: {
      turns: solved.turns,
      completedTurns: solved.completedTurns,
      toolCalls: solved.toolCalls ?? null,
      startedToolCalls: solved.startedToolCalls ?? null,
      errors: solved.errors,
      nonResult: trustedStructuredClone(solved.nonResult ?? null),
      runtimeIdentities: trustedStructuredClone(solved.runtimeIdentities ?? []),
      startedAt: instants.startedAt,
      endedAt: instants.endedAt,
    },
  };
}

/** Which outcome this case reached, checked in order: a defective final submission, a solver
 *  blocker, no accepted artifact, then verification of the accepted bytes. */
async function gradeOutcome(deps: GradeCaseDeps, solvedCase: SolvedCase): Promise<GradedOutcome> {
  const { solved, final, finalDefect } = solvedCase;
  if (finalDefect !== null) {
    return { outcome: { kind: "invalid-authority" }, verdict: null, unbound: [], solverOrigin: false };
  }
  const solverBlocker = solverBlockerOf(solvedCase);
  if (solverBlocker !== null) {
    return {
      outcome: nonResult(solverBlocker, solved.nonResult?.kind ?? "solver"),
      verdict: null,
      unbound: [],
      solverOrigin: true,
    };
  }
  if (final?.accepted !== true || final.kind !== "artifact" || !isString(final.artifactJson)) {
    return { outcome: { kind: "unaccepted" }, verdict: null, unbound: [], solverOrigin: false };
  }
  return gradeAcceptedArtifact(deps, solvedCase, final.artifactJson);
}

/** One case's whole grading result: the record, and the private evidence beside it. */
export async function gradeCase(deps: GradeCaseDeps, solvedCase: SolvedCase): Promise<GradedCase> {
  const { final, acceptedSubmit } = solvedCase;
  const graded = await gradeOutcome(deps, solvedCase);
  return {
    record: caseRecord(solvedCase, graded.outcome),
    verdict: graded.verdict,
    // Parsed from the captured bytes, so no evaluator mutation or later draft edit reaches it.
    submittedArtifact:
      acceptedSubmit && final?.kind === "artifact" && isString(final.artifactJson)
        ? trustedJsonParse(final.artifactJson)
        : null,
    unboundFindings: graded.unbound.map((message) => ({ code: "EXTERNAL_RESULT_UNBOUND", message })),
    solverOrigin: graded.solverOrigin,
  };
}
