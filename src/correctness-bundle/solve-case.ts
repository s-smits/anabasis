/**
 * One case's solve and verification, held apart from every run-level accumulator.
 *
 * A battery solves its cases concurrently and records them one at a time, which
 * `verification-runner.ts` arranges; `solveCase` is the concurrent half. Its dependencies exclude
 * the verifier host, the Judge observations, the firing counters and the shared case array, so it
 * cannot open a second evaluation scope or update one of those accumulators while another case is
 * being graded. What mutable state it does hold belongs to one case: its submission authority, its
 * own starter and worker processes, and its own `cases/<taskId>/` evidence paths.
 *
 * Verification is separate because the host keeps exactly one open subject (`verify/host.ts`), so
 * opening a second scope closes the first and the closed scope's in-flight engine runs fail closed.
 * The battery therefore calls `gradeCase` in task order while later `solveCase` calls may still be
 * running, and `rehearseCase` shares the same accepted-byte execution below.
 *
 * Grading decides a `CaseOutcome` and the record is built from it once, rather than written in
 * place by whichever branch got there, so the ordered reasons a case scores nothing read in one
 * function instead of across three.
 */
import { capturedJsonParse, capturedJsonStringify, capturedStructuredClone } from "../meta/json-runtime.ts";
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
import { isString, type JsonValue } from "../meta/json-shape.ts";
import type { DiscriminationClaimabilityFinding } from "../claim/discrimination-claimability.ts";
import type { NonResultKind } from "../claim/record-events.ts";
import { bundleSnapshotToolTree } from "../claim/bundle-snapshot.ts";
import type { CheckRun, CorrectnessModelResult } from "../verify/correctness-model-result.ts";
import type { VerifierExecutionEvidence, VerifierHostHandle } from "../verify/verifier-port.ts";
import { VerifierOperationalStop, type VerifierLifetime } from "../verify/verifier-lifetime.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import type { CaseRecord } from "./battery-record.ts";
import { type Brief, applicableTruthChecks, externalChecksOf, requiredToolsOf } from "./brief.ts";
import {
  hostNonResult,
  type UngroundedCheck,
  ungroundedPassChecks,
  ungroundedSentence,
} from "./tool-runs.ts";
import { solverNonResultReason } from "./runtime-blocker.ts";
import { blockingTruthFailure } from "./verdict-binding.ts";
import { evaluateCheckProgram } from "./predicate.ts";
import { EvaluatorProcessFailure } from "./evaluator-process.ts";
import { resolveVerifier } from "./verification-registry.ts";
import { asError, errorMessage } from "../meta/runtime-values.ts";

/** What this case may record. The named members are interfaces, and TypeScript denies an interface
 *  the implicit index signature `JsonValue` needs, so each one has to be listed here even though
 *  its bytes are ordinary JSON. */
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

/** What the recorder needs from a solved case. It carries no verdict and no score, because
 *  evaluating is the recording stage's job and a solve that judged itself would be the author
 *  playing verifier. */
export interface SolvedCase {
  task: BuildTask;
  /** The pre-solve commitment. It is the recorder's only source of task bytes for verification,
   *  so nothing generated code touched afterwards can reach what is verified. */
  committed: CommittedPublicTask<unknown>;
  solved: SolveOutcome;
  final: FinalSubmission | null;
  /** Non-null identifies an invalid controller record that prevents a claim. */
  finalDefect: string | null;
  acceptedSubmit: boolean;
  /** The controller's clock around the solver call, recorded on each case row; a row without it
   *  leaves a reader unable to bound how long the case took. */
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

/** One case's facts, kept once. Difficulty, firing counts and Judge subjects are all projections
 *  of the battery over these rows rather than fields a case carries, so there is one place a case
 *  fact can be written and one place it can be wrong. */
export interface GradedCase {
  record: CaseRecord;
  /** Raw evaluator output stays private, including a verdict overruled by a host non-result. */
  verdict: CorrectnessModelResult | null;
  /** Accepted bytes, parsed independently of the evaluator's mutable request. */
  submittedArtifact: JsonValue | null;
  unboundFindings: DiscriminationClaimabilityFinding[];
  /** Solver-side non-results have different censoring rules from verifier-side failures. */
  solverOrigin: boolean;
  /** One row per check grading reached, empty when nothing was graded. */
  checkRuns: CheckRun[];
}

/** What the case records as its final-submission evidence: the controller-written fact itself,
 *  or, when that fact does not serialize, the note recording why nothing else could be written in
 *  its place — an absent field would read as "no submission", which is a different event. */
/** The caller's abort, and where the host's own rows for this grading go; neither reaches a model. */
type RehearsalWatch = {
  signal?: AbortSignal | undefined;
  record?: (checkRuns: CheckRun[], toolRuns: VerifierExecutionEvidence[]) => void;
};

type FinalSubmissionEvidence = FinalSubmission | null | { falsifiedFact: true; note: string };

/** What grading decided about one case beyond the solver's own telemetry. Exactly one arm holds,
 *  and `scoredFields` below is where each becomes the record shape `battery-record.ts` names for
 *  it: a real attempt that produced no accepted submission, a defective controller record that is
 *  recorded as unaccepted whatever the authority claimed, an operational failure that scores
 *  nothing, or a verdict over accepted bytes. */
type CaseOutcome =
  | { kind: "unaccepted" }
  | { kind: "invalid-authority" }
  | { kind: "non-result"; reason: string; nonResultKind: NonResultKind }
  | { kind: "truth"; truthOk: boolean };

/** The whole of what grading learned before the record is built from it: the decision, the
 *  claimability findings grading produced, the raw verdict that the record never carries, and
 *  whether the failure was the solver's rather than the verifier's, because those two censor
 *  differently. */
interface GradedOutcome {
  outcome: CaseOutcome;
  unbound: string[];
  verdict: CorrectnessModelResult | null;
  solverOrigin: boolean;
  checkRuns?: CheckRun[];
}

const nonResult = (reason: string, nonResultKind: NonResultKind): CaseOutcome => ({
  kind: "non-result",
  reason,
  nonResultKind,
});

/**
 * The controller writes the final-submission fact, and this checks its own internal consistency
 * before anything downstream treats its contents as JSON. The record must serialize, and an
 * accepted artifact must have string bytes, a matching digest and valid JSON. A violation
 * identifies a defect in the submission authority itself, which is why it prevents a claim rather
 * than being repaired here: a controller record that contradicts itself cannot be trusted to say
 * what the solver submitted.
 */
function finalSubmissionDefect(final: FinalSubmission | null): string | null {
  try {
    capturedJsonStringify(final);
  } catch {
    return "the final-submission fact itself does not serialize (BigInt/circular field)";
  }
  if (final?.accepted !== true) return null;
  if (!isString(final.artifactJson)) return "accepted with no captured bytes";
  if (sha256(final.artifactJson) !== final.artifactDigest) return "artifactDigest != sha256(artifactJson)";
  try {
    capturedJsonParse(final.artifactJson);
  } catch {
    return "captured bytes are not valid JSON";
  }
  return null;
}

export async function solveCase(deps: SolveCaseDeps, task: BuildTask): Promise<SolvedCase> {
  // Capture the task before any generated code runs. The canonical bytes and the digest come from
  // the authoritative task, the public evidence is written before the solver starts, and solve and
  // evaluate each get an independent clone, so a toolset factory that mutates its view changes only
  // that clone. Generated code therefore cannot reach the original bytes the digest was taken over,
  // and cannot change the task verification will consume.
  const committed = commitPublicTask(task);
  deps.write(`cases/${task.taskId}/public-task.json`, {
    taskId: task.taskId,
    family: task.family,
    publicTaskDigest: committed.publicTaskDigest,
    publicTask: capturedJsonParse(committed.publicTaskJson),
  });
  const publicTask = committed.view();
  // The controller keeps the submission authority itself and hands generated code only its narrow
  // port, so acceptance is decided on this side of the wall.
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
  const registration = capturedStructuredClone(toolset.registration);
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
  // Acceptance and canonical bytes both come from one controller-created transition, so
  // verification reads those captured bytes rather than mutable toolset state that may have moved
  // on since.
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

/** A case the battery's stop rule never scheduled. The denominator keeps its row, and the typed
 *  provider non-result naming the stop is the whole of what happened to it. It is built here so the
 *  scheduler does not assemble a `SolvedCase` of its own beside this file's writer, which is how the
 *  two shapes would drift. */
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

/** One verifier scope over accepted canonical bytes: open, evaluate, and close in a `finally`, so
 *  that child cleanup and output recording still run when evaluation failed — which is exactly the
 *  case where the recorded output is worth the most. */
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
  checkRuns: CheckRun[];
}> {
  const { task, committed } = solved;
  // One projection serves all three evaluate-side consumers: the host subject, the generated
  // evaluate request and the intrinsic firing census. `openSubject` digests it synchronously and
  // generated code receives a clone, so sharing one projection cannot leak a mutation and the three
  // views cannot drift apart.
  const evaluateTask = evaluationPublicTask(deps.brief, task, committed.view());
  // The host evaluates the accepted submission bytes, which is what stops the correctness model
  // routing a different value to the engine, and the evidence carries the full join key: runId,
  // phase, caseId, attempt and the artifact and public-task digests. The scope's port is
  // evaluation's only verifier contract, and a port retained past evaluation stays this case's port
  // and fails closed rather than quietly becoming the next case's.
  const scope = deps.verifier.openSubject({
    checks: applicableTruthChecks(deps.brief, task),
    runId: deps.runId,
    phase: "battery",
    subjectId: task.taskId,
    attempt: 1,
    artifact: capturedJsonParse(artifactJson),
    publicTask: evaluateTask,
    hidden: task.hidden,
  });
  let verdict: CorrectnessModelResult | null = null;
  let failure: Error | null = null;
  let cleanupPending = false;
  let closedScope: Awaited<ReturnType<typeof scope.close>>;
  const checkRuns: CheckRun[] = [];
  const abort = () => {
    void scope.close().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    // Each stage parses afresh: the artifact the correctness model consumes and the artifact bound
    // to the host are parsed separately from the same accepted canonical bytes, and the model's
    // task view is parsed fresh from the committed bytes. So a correctness model that mutates its
    // evaluate input can alter neither the engine's input nor the record, and a toolset mutating
    // the solve view or post-accept draft state cannot reach any evaluate-side fact.
    verdict = await deps.evaluate(
      capturedStructuredClone({
        publicTask: evaluateTask,
        artifact: capturedJsonParse(artifactJson),
        hidden: task.hidden,
      }),
      { tools: scope.port },
      undefined,
      (run) => checkRuns.push(run),
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
    checkRuns,
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

/** Why a rehearsal produced no verdict. A cancellation is read from the caller's signal rather
 *  than from the error, because an abort surfaces as whatever the aborted stage happened to throw,
 *  which names the stage and not the cause. */
function rehearsalFailure(error: unknown, callerSignal: AbortSignal | undefined) {
  if (error instanceof VerifierOperationalStop) return { status: "non-result", kind: "cleanup-pending" };
  if (callerSignal?.aborted === true) return { status: "non-result", kind: "cancelled" };
  if (error instanceof EvaluatorProcessFailure && ["timeout", "crash", "sandbox"].includes(error.kind)) {
    return { status: "non-result", kind: error.kind };
  }
  return { status: "execution-failed" };
}

/** Invokes the existing check program and host over the rehearsal's accepted bytes. The execution
 *  status and the one aggregate `truthOk` bit leave this boundary; the raw evaluator result, its
 *  failing check ids and every verifier diagnostic stay private. That single bit is the author's own
 *  check program run over the author's own bytes, and it is the only instrument in the authoring
 *  loop that can show a Builder its battery is easier than the target it stated.
 *
 *  It grades under the walls a measured battery grades under and no tighter one: each check gets
 *  the harness's own `gate.check_seconds`, which `loadCorrectnessModel` reads from the snapshot,
 *  and each tool run its `tool_run_seconds`. A fixed total over the whole grading returned
 *  `not-run` for any harness whose checks outlast it, which spent the solve and graded nothing on
 *  exactly the tasks the battery would have graded. */
export async function rehearseCase(
  workspace: string,
  brief: Brief,
  solved: Pick<SolvedCase, "task" | "committed" | "final">,
  lifetime?: VerifierLifetime,
  watch: RehearsalWatch = {},
) {
  const { signal: callerSignal, record } = watch;
  const { final, task } = solved;
  if (final?.accepted !== true || final.kind !== "artifact" || final.artifactJson === null) {
    return { status: "not-run" };
  }
  if (lifetime === undefined) return { status: "non-result", kind: "verifierUnavailable" };
  try {
    callerSignal?.throwIfAborted();
    lifetime.assertUsable();
    const checks = applicableTruthChecks(brief, task);
    const { verifier, missingTools } = resolveVerifier({
      toolTree: bundleSnapshotToolTree(workspace),
      bundleDir: workspace,
      toolIds: checks.flatMap((check) => requiredToolsOf(check.execution)),
      verifierLifetime: lifetime,
    });
    if (missingTools.length > 0) return { status: "non-result", kind: "verifierUnavailable" };
    const evaluate = evaluateCheckProgram(
      brief,
      await loadCorrectnessModel(workspace, lifetime, callerSignal),
    );
    // Reuse battery execution without recording a case or publishing the raw verdict.
    const scoped = await runCaseScope(
      { brief, evaluate, verifier, verifierLifetime: lifetime, runId: "harness-trial" },
      solved,
      final.artifactJson,
      callerSignal,
    );
    record?.(scoped.checkRuns, verifier.evidence());
    if (scoped.cleanupPending) return { status: "non-result", kind: "cleanup-pending" };
    if (scoped.failure !== null) throw scoped.failure;
    callerSignal?.throwIfAborted();
    // The battery's own decision over the same evidence, so a grounded check that returned true
    // without ever running its tool is no pass here either; only the aggregate bit leaves.
    const subject = { phase: "battery" as const, subjectId: task.taskId, attempt: 1 };
    const outcome = acceptedOutcome(
      scoped,
      hostNonResult(verifier, subject),
      ungroundedPassChecks(
        scoped.verdict,
        checks.map((check) => check.id),
        externalChecksOf(brief),
        verifier.executedBindings(),
        subject,
      ),
    );
    if (outcome.kind === "non-result") return { status: "non-result", kind: outcome.nonResultKind };
    return { status: "completed", truthOk: outcome.kind === "truth" ? outcome.truthOk : null };
  } catch (error) {
    return rehearsalFailure(error, callerSignal);
  }
}

/**
 * The ordered reasons an accepted artifact scores nothing, and the truth bit when none of them
 * holds. The order is the contract, not an implementation detail: a cleanup failure outranks the
 * verdict it may have corrupted, a throw outranks a missing host run, and a host outage outranks a
 * grounded check that ran no tool, because the outage is what explains the missing run.
 */
function acceptedOutcome(
  scoped: Awaited<ReturnType<typeof runCaseScope>>,
  hostFailure: ReturnType<typeof hostNonResult>,
  ungrounded: readonly UngroundedCheck[],
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
  // R1 (`ungroundedPassChecks`). The unattributed verifier kind belongs to generated behaviour,
  // not the environment. A case that failed to compile is filed here rather than as a non-result.
  if (ungrounded.length > 0) return nonResult(ungroundedSentence(ungrounded), "verifier");
  return { kind: "truth", truthOk: !blockingTruthFailure(scoped.verdict) };
}

/**
 * Grades one closed verifier scope. A tool call still pending when evaluate returned prevents a
 * claim. Exempting those calls when some checks had completed was tried and removed, because a
 * result collected after the fact cannot establish that the check actually used it, so an unawaited
 * call stays a defect rather than becoming a pass.
 */
async function gradeAcceptedArtifact(
  deps: GradeCaseDeps,
  solved: SolvedCase,
  artifactJson: string,
): Promise<GradedOutcome> {
  const { taskId } = solved.task;
  // An evaluator throw over one partial artifact leaves this one case ungraded and lets the
  // remaining cases run, rather than aborting the whole battery as an uncaught throw here would.
  const scoped = await runCaseScope(deps, solved, artifactJson);
  const subject = { phase: "battery" as const, subjectId: taskId, attempt: 1 };
  // Coverage is required only after accepted bytes reached a real correctness-model verdict.
  const ungrounded = solved.acceptedSubmit
    ? ungroundedPassChecks(
        scoped.verdict,
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
    outcome: acceptedOutcome(scoped, hostNonResult(deps.verifier, subject), ungrounded),
    // A verdict the cleanup failure may have corrupted is not published as this case's verdict.
    verdict: scoped.cleanupPending ? null : scoped.verdict,
    unbound,
    solverOrigin: false,
    checkRuns: scoped.checkRuns,
  };
}

/** An explicit solve-side non-result wins; otherwise the unaccepted solve's trace is inspected.
 *  Exported for the standalone bundle entry, whose caller classifies the case without ever reaching
 *  the grading path. */
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

/** The five scored fields of a `CaseRecord`, written as one arm per outcome rather than filled in
 *  place by whichever branch reached them. The arms are the record kinds `battery-record.ts`
 *  documents as a closed set, so a new outcome cannot silently borrow another kind's shape. */
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
      nonResult: capturedStructuredClone(solved.nonResult ?? null),
      runtimeIdentities: capturedStructuredClone(solved.runtimeIdentities ?? []),
      startedAt: instants.startedAt,
      endedAt: instants.endedAt,
    },
  };
}

/** Which of the four outcomes this case reached, along with the evidence the record does not
 *  carry. Final-submission defects, solver blockers, unaccepted attempts and verified artifacts are
 *  ordered branches: an invalid authority prevents a claim and stays attributed to the controller,
 *  while an ordinary refusal reaches neither, because no accepted bytes exist to verify. */
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
    // Evidence and Judge input are both parsed from the captured bytes after evaluation, so
    // neither an evaluator mutation nor a later draft edit can change what this case submitted.
    submittedArtifact:
      acceptedSubmit && final?.kind === "artifact" && isString(final.artifactJson)
        ? capturedJsonParse(final.artifactJson)
        : null,
    unboundFindings: graded.unbound.map((message) => ({ code: "EXTERNAL_RESULT_UNBOUND", message })),
    solverOrigin: graded.solverOrigin,
    checkRuns: graded.checkRuns ?? [],
  };
}
