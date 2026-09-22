/** Runs saved controls through the same correctness path as measured cases. */
import { isAuthoredEvaluatorFailure } from "./evaluator-process.ts";
import {
  VERIFIER_CONTRACT_HINTS,
  VerifierContractError,
  type VerifierContractCode,
} from "../../vendor/correctness-model-bundle/contract-error.ts";
import type { DiscriminationClaimabilityFinding } from "../claim/discrimination-claimability.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import type { CorrectnessModelResult } from "../verify/correctness-model-result.ts";
import type { EvaluationScopeHandle, VerifierHostHandle } from "../verify/verifier-port.ts";
import type { ControlReceiptSide, DiscriminationExecution } from "./battery-record.ts";
import { type Brief, applicableTruthChecks } from "./brief.ts";
import type { EvaluatorFn } from "./contracts.ts";
import type { ControlCorpus } from "./controls.ts";
import { identityComposedFinding, withheldDiscrimination } from "./discrimination-author-detail.ts";
import { commitPublicTask, evaluationPublicTask } from "./task-split.ts";
import type { BuildTask } from "./tasks.ts";
import { trustedJsonStringify, trustedStructuredClone } from "./trusted-runtime.ts";
import {
  type ControlEvaluation,
  type ReceiptSession,
  recordObservation,
  settleControlReceipts,
  sideMatchesExpected,
} from "./control-receipts.ts";
import { blockingFailedCheckIds, blockingIssueSummary } from "./verdict-binding.ts";
import { namedExamples, type SettledControl } from "./grounding-coverage.ts";
import { hostNonResult, subjectRuns } from "./tool-runs.ts";
import { environmentOwnedToolNonResult, toolRetryDelay } from "./verifier-nonresult.ts";
import { VerifierOperationalStop, type VerifierLifetime } from "../verify/verifier-lifetime.ts";

interface RunControlsOptions {
  verifierLifetime?: VerifierLifetime;
  /** The brief's external-verifier checks: each adapterId is the tool id that grounds the check. */
  externalChecks?: readonly { checkId: string; adapterId: string }[];
  /** The checked brief defines the public rules for both authoring checks and live measurement. */
  brief: Brief;
  /** Added to correctness-model requests during a live run; absent during authoring checks. */
  runId?: string | null;
  /** Wait before the one fresh execution an environment-owned refusal earns; tests pass 0. */
  toolRetryWaitMs?: number;
  /** Controls evaluated side by side; defaults to CENSUS_LANES. Tests with order-exact stop
   *  expectations pass 1. */
  lanes?: number;
  /** Receives each control's settled attempt, in corpus order, for readers of the host's rows. */
  onSettled?: (controlId: string, settled: SettledControl) => void;
  /** True once the census wall has cut the run: start no further control. */
  stopped?: () => boolean;
}

/** Controls evaluated side by side, each in its own scope. Four, because heavy tools already use
 *  several cores each. Receipts and findings still settle in corpus order. */
export const CENSUS_LANES = 4;

// --- The control session ---------------------------------------------------------------------

/** State shared by the helpers in one `runControls` call. */
interface ControlSession extends ReceiptSession {
  options: RunControlsOptions;
  evaluate: EvaluatorFn;
  verifier: VerifierHostHandle | undefined;
  /** Each control's bound task, committed before generated code runs. */
  boundTaskById: Map<string, { task: BuildTask; committed: ReturnType<typeof commitPublicTask> }>;
  findings: DiscriminationClaimabilityFinding[];
  stopped: boolean;
  /** Whether the single cleanup-pending finding has been recorded. */
  cleanupReported: boolean;
  groups: Map<string, ControlGroup>;
}

/** One control's settled evaluation plus the tool runs still going when evaluate returned.
 *  Findings are admitted from this in corpus order, so the lane count cannot change them. */
type Settled = { evaluation: ControlEvaluation; unboundRuns: number };

type Control = ControlCorpus["accept"][number] | ControlCorpus["reject"][number];

// --- Finding constructors --------------------------------------------------------------------

/** Findings that differ only by control, collected in corpus order and written once naming every
 *  control. `notes` keep each control's own text; `write` composes the finding. */
type ControlGroup = {
  ids: string[];
  notes: string[];
  write: (ids: string[], notes: string[]) => DiscriminationClaimabilityFinding;
};

type Observation = Settled & { attempt: number };

// --- Checks that apply to each task ----------------------------------------------------------

/** Sorted ids of the checks applicable to this task. */
export function applicableCheckIds(
  brief: Brief,
  task: { family: string; hidden: Array<{ checkId: string }> },
): string[] {
  return applicableTruthChecks(brief, task)
    .map((check) => check.id)
    .sort();
}

/** Runs `work` over `items` in at most `lanes` parallel lanes, keeping results in item order.
 *  A slot stays undefined when a stop or a failure prevented it from starting. */
export async function inLanes<T, R>(
  items: readonly T[],
  lanes: number,
  work: (item: T) => Promise<R>,
  stopped: () => boolean,
): Promise<(R | undefined)[]> {
  const results: (R | undefined)[] = Array.from({ length: items.length }, () => undefined);
  let next = 0;
  let failed = false;
  const lane = async (): Promise<void> => {
    // oxlint-disable-next-line eslint/no-unmodified-loop-condition -- `failed` is set by the `work` rejection handler in the body below, which the rule cannot see from this header.
    for (let index = next++; index < items.length && !failed && !stopped(); index = next++) {
      const item = items[index];
      if (item !== undefined) {
        results[index] = await work(item).catch((cause: unknown) => {
          failed = true;
          throw cause;
        });
      }
    }
  };
  // A throw stops admission, but every started sibling settles first, so a retry cannot overlap it.
  const settled = await Promise.allSettled(
    Array.from({ length: Math.max(1, Math.min(lanes, items.length)) }, lane),
  );
  const rejected = settled.find((outcome) => outcome.status === "rejected");
  if (rejected !== undefined) throw rejected.reason;
  return results;
}

const laneStopped = (run: ControlSession) => run.stopped || run.options.stopped?.() === true;

async function evaluateControl(
  run: ControlSession,
  control: Control,
  hidden: BuildTask["hidden"],
  attempt: number,
): Promise<Settled> {
  const { id: controlId, artifact } = control;
  const bound = run.boundTaskById.get(control.taskId);
  if (bound === undefined) return { evaluation: { unknownTask: true }, unboundRuns: 0 };
  // One projection per evaluation, shared by the host subject and the evaluate request.
  const evaluateTask = evaluationPublicTask(run.options.brief, bound.task, bound.committed.view());
  // A reject runs only its declared check, the one whose failure it must show.
  const only = "expectedCheckId" in control ? control.expectedCheckId : undefined;
  // The host binds the artifact before generated code runs; the scope's port keeps that binding
  // even if generated code retains it.
  let scope: EvaluationScopeHandle | undefined;
  let result: CorrectnessModelResult | undefined;
  let failure: unknown;
  let closedScope: { pendingInvocations: number } | undefined;
  try {
    run.options.verifierLifetime?.assertUsable();
    scope = run.verifier?.openSubject({
      checks: applicableTruthChecks(run.options.brief, bound.task).filter(
        (check) => only === undefined || check.id === only,
      ),
      runId: run.options.runId ?? null,
      phase: "discrimination",
      subjectId: controlId,
      attempt,
      artifact,
      publicTask: evaluateTask,
      hidden,
    });
    // The same request shape as a measured case, so the evaluator cannot tell a control from a
    // real case. It receives a clone; the host already captured the canonical bytes.
    result = await run.evaluate(
      trustedStructuredClone({ publicTask: evaluateTask, artifact, hidden }),
      scope === undefined ? undefined : { tools: scope.port },
      only,
    );
  } catch (error) {
    failure = error;
  } finally {
    // Close on return and throw alike, draining running children so their evidence is durable.
    // A run still pending at close is one this evaluate cannot have read.
    try {
      closedScope = await scope?.close();
    } catch (error) {
      failure = error;
    }
  }
  try {
    if (failure instanceof VerifierOperationalStop) throw failure;
    run.options.verifierLifetime?.assertUsable();
    return settleControlOutcome(run, { controlId, attempt, result, failure, closedScope });
  } catch (error) {
    if (!(error instanceof VerifierOperationalStop)) throw error;
    run.stopped = true;
    return { evaluation: { cleanupPending: true }, unboundRuns: 0 };
  }
}

/** The host's own non-result row wins over the evaluation, whether it returned or threw, so a
 *  tool timeout is not charged to the author. A failure the generated check owns keeps its own
 *  attribution. A host non-result settles this control only; the others still run. */
function settleControlOutcome(
  run: ControlSession,
  input: {
    controlId: string;
    attempt: number;
    result: CorrectnessModelResult | undefined;
    failure: unknown;
    closedScope: { pendingInvocations: number } | undefined;
  },
): Settled {
  const { controlId, attempt, result, failure, closedScope } = input;
  const hostFailure =
    run.verifier === undefined || isAuthoredEvaluatorFailure(failure)
      ? null
      : hostNonResult(run.verifier, { phase: "discrimination", subjectId: controlId, attempt });
  const settled = (evaluation: ControlEvaluation): Settled => ({ evaluation, unboundRuns: 0 });
  if (hostFailure !== null) return settled({ hostNonResult: hostFailure.outcome });
  if (failure instanceof VerifierContractError) {
    return settled({ threw: failure.message, authorClassification: failure.code });
  }
  if (failure !== undefined) return settled({ threw: errorMessage(failure) });
  if (result === undefined) return settled({ threw: "check program returned no result" });
  // A tool run still going when evaluate returned grounded nothing; its finding is admitted later.
  return { evaluation: result, unboundRuns: closedScope?.pendingInvocations ?? 0 };
}

function addToGroup(
  run: ControlSession,
  key: string,
  controlId: string,
  note: string,
  write: ControlGroup["write"],
): void {
  const group = run.groups.get(key) ?? { ids: [], notes: [], write };
  group.ids.push(controlId);
  group.notes.push(note);
  run.groups.set(key, group);
}

/** Groups a thrown check program by its public diagnosis. The thrown message stays withheld; the
 *  author sees the examples and, for a verifier-contract refusal, the host-composed request
 *  violation and its remedy (never verifier output). */
function addThrown(
  run: ControlSession,
  controlId: string,
  threw: string,
  code: VerifierContractCode | undefined,
): void {
  const violation = code === undefined ? "" : threw.replace(/^tool run refused: /, "");
  addToGroup(run, `threw ${code ?? ""} ${violation}`, controlId, `"${controlId}": ${threw}`, (ids, notes) =>
    withheldDiscrimination(
      {
        code: "DISCRIMINATION_NOT_PROVEN",
        message: `the correctnessModel threw for control ${notes.join("; ")}. Repair the evaluator exception and rerun the controls`,
      },
      code ?? "generated-evaluate-throw",
      code === undefined
        ? `the correctnessModel threw while evaluating ${ids.length} example(s) in the host's confined check cell: ${namedExamples(ids)}. ` +
            "Reproduce one through correctness-model/evaluator.test.ts, repair the exception, then rerun the check"
        : `the host refused the tool run of ${ids.length} example(s) on the tool-request contract: ${violation}. Examples: ${namedExamples(ids)}. ` +
            `${VERIFIER_CONTRACT_HINTS[code]} Reproduce it through correctness-model/evaluator.test.ts with a tools.run runtime, repair the request, then rerun the check`,
    ),
  );
}

/** Evaluate one control in its own lane. */
async function evaluateInLane(
  run: ControlSession,
  control: Control,
  hidden: BuildTask["hidden"],
): Promise<Observation> {
  let attempt = 1;
  let settled = await evaluateControl(run, control, hidden, attempt);
  // An environment-owned refusal earns one fresh execution; an author-owned kind settles at once,
  // and a stopped run retries nothing.
  if (
    !run.stopped &&
    "hostNonResult" in settled.evaluation &&
    environmentOwnedToolNonResult(settled.evaluation.hostNonResult)
  ) {
    await toolRetryDelay(run.options.toolRetryWaitMs);
    attempt = 2;
    settled = await evaluateControl(run, control, hidden, attempt);
  }
  return { ...settled, attempt };
}

/** Records one control's receipt side and admits its verdict, in corpus order. Null means a
 *  finding already settled the control. */
function admitObservation(
  run: ControlSession,
  control: Control,
  { attempt, evaluation, unboundRuns }: Observation,
): { side: ControlReceiptSide; result: CorrectnessModelResult } | null {
  const side = recordObservation(run, control.id, attempt, evaluation);
  run.options.onSettled?.(control.id, {
    attempt,
    hostNonResult: "hostNonResult" in evaluation ? evaluation.hostNonResult : null,
  });
  if (unboundRuns > 0) {
    addToGroup(run, "unbound-runs", control.id, `"${control.id}" (${unboundRuns})`, (_ids, notes) => ({
      code: "EXTERNAL_RESULT_UNBOUND",
      message: `the correctnessModel returned while tool runs were still running for control ${notes.join(", ")}; await every run before returning, because a result the run did not wait for grounds nothing`,
    }));
  }
  // A control with no verdict witnesses no cell, so the claim stays open. The non-result kind is
  // host structure and may cross to the author; tool output may not.
  if ("hostNonResult" in evaluation) {
    addToGroup(run, "no-verdict", control.id, `"${control.id}" (${evaluation.hostNonResult})`, (ids, notes) =>
      identityComposedFinding(
        {
          code: "DISCRIMINATION_PROBE_NO_VERDICT",
          message: `the host could not run these examples to a verdict: ${notes.join(", ")}`,
        },
        `${ids.length} example(s) reached no verdict because the host could not complete their tool runs (${notes.join(", ")}). A timeout or crash is the check's run to repair; a sandbox or unavailable tool belongs to the verifier environment`,
      ),
    );
    return null;
  }
  if ("unknownTask" in evaluation) {
    addToGroup(
      run,
      "unknown-task",
      control.id,
      `"${control.id}" names ${trustedJsonStringify(control.taskId)}`,
      (ids, notes) =>
        identityComposedFinding(
          {
            code: "DISCRIMINATION_NOT_PROVEN",
            message: `examples name a taskId that is not a task of this battery: ${notes.join(", ")}`,
          },
          `${ids.length} example(s) name a taskId that is not a task of this battery: ${namedExamples(ids)}. Bind every example to one recorded battery task`,
        ),
    );
    return null;
  }
  if ("threw" in evaluation) {
    addThrown(run, control.id, evaluation.threw, evaluation.authorClassification);
    return null;
  }
  if ("cleanupPending" in evaluation) {
    if (!run.cleanupReported) {
      run.findings.push({
        code: "DISCRIMINATION_NOT_PROVEN",
        message:
          "verifier cleanup is pending; preserve these partial controls and restore the host before another execution",
      });
    }
    run.cleanupReported = true;
    return null;
  }
  return { side, result: evaluation };
}

// --- The accept and reject loops -------------------------------------------------------------

/** How a blocking check's tool runs ended in the verifier cell: tool id and exit, never output,
 *  so a tool that fails only under the wall does not read as a wrong check. */
function failedToolRuns(
  run: ControlSession,
  controlId: string,
  attempt: number,
  checkIds: readonly string[],
): string {
  if (run.verifier === undefined) return "";
  const ended = new Set(
    subjectRuns(run.verifier, { phase: "discrimination", subjectId: controlId, attempt })
      .filter((row) => checkIds.includes(row.checkId) && (row.exitCode !== 0 || row.timedOut))
      .map(
        (row) =>
          `${row.toolId} ${row.timedOut ? "timed out" : (row.signal ?? `exit ${String(row.exitCode)}`)}`,
      ),
  );
  return ended.size === 0 ? "" : `, where tool runs ended [${[...ended].sort(compareCodeUnits).join(", ")}]`;
}

async function runAccepts(run: ControlSession, corpus: ControlCorpus): Promise<void> {
  // Verified under the bound task's own hidden expectations, as a measured case is.
  const observations = await inLanes(
    corpus.accept,
    run.options.lanes ?? CENSUS_LANES,
    (control) => evaluateInLane(run, control, run.boundTaskById.get(control.taskId)?.task.hidden ?? []),
    () => laneStopped(run),
  );
  const issues: string[] = [];
  const idsByChecks = new Map<string, string[]>();
  for (const [index, control] of corpus.accept.entries()) {
    const observation = observations[index];
    if (observation === undefined) break;
    const observed = admitObservation(run, control, observation);
    if (observed?.side.outcome !== "fail") continue;
    // Issue text stays on the protected message; the author sees ids grouped by blocking checks.
    issues.push(`"${control.id}": ${blockingIssueSummary(observed.result)}`);
    const blockedBy = [...blockingFailedCheckIds(observed.result)].sort(compareCodeUnits);
    const checks = `[${blockedBy.join(", ") || "no named check"}]${failedToolRuns(run, control.id, observation.attempt, blockedBy)}`;
    idsByChecks.set(checks, [...(idsByChecks.get(checks) ?? []), control.id]);
  }
  if (issues.length === 0) return;
  const groups = [...idsByChecks].map(([checks, ids]) => `on ${checks}: ${namedExamples(ids)}`);
  run.findings.push(
    identityComposedFinding(
      {
        code: "DISCRIMINATION_ACCEPT_REJECTED",
        message: `valid examples were rejected. Blocking issues: ${issues.join("; ")}`,
      },
      `${issues.length} valid example(s) were rejected by the correctnessModel, ${groups.join("; ")}. Fix the correctnessModel so declared-valid examples pass`,
    ),
  );
}

async function runRejects(run: ControlSession, corpus: ControlCorpus): Promise<void> {
  // A reject's own hidden rows override its task's; external rejects carry none.
  const hiddenOf = (control: ControlCorpus["reject"][number]) => {
    const hiddenById = new Map(
      (run.boundTaskById.get(control.taskId)?.task.hidden ?? []).map((row) => [row.checkId, row]),
    );
    for (const row of control.hidden ?? []) hiddenById.set(row.checkId, row);
    return [...hiddenById.values()];
  };
  const observations = await inLanes(
    corpus.reject,
    run.options.lanes ?? CENSUS_LANES,
    (control) => evaluateInLane(run, control, hiddenOf(control)),
    () => laneStopped(run),
  );
  // A reject counts only when its declared check fails, so an unrelated failure cannot stand in.
  const missed: string[] = [];
  for (const [index, control] of corpus.reject.entries()) {
    const observation = observations[index];
    if (observation === undefined) break;
    const observed = admitObservation(run, control, observation);
    if (observed === null) continue;
    if (!sideMatchesExpected(observed.side, "fail", control.expectedCheckId)) {
      missed.push(
        control.mutationClass === undefined
          ? `"${control.id}"`
          : `"${control.id}" (${control.mutationClass})`,
      );
    }
  }
  if (missed.length > 0) {
    run.findings.push(
      identityComposedFinding(
        {
          code: "DISCRIMINATION_REJECT_PASSED",
          message: `${missed.length} invalid example(s) passed the check that should reject them: ${missed.join(", ")}`,
        },
        `${missed.length} invalid example(s) passed the check that should reject them: ${missed.join(", ")}. Change each example so that check fails on it, or fix the check`,
      ),
    );
  }
}

export async function runControls(
  evaluate: EvaluatorFn,
  corpus: ControlCorpus,
  tasks: readonly BuildTask[],
  options: RunControlsOptions,
  verifier?: VerifierHostHandle,
): Promise<DiscriminationExecution> {
  const run: ControlSession = {
    options,
    evaluate,
    verifier,
    boundTaskById: new Map(tasks.map((task) => [task.taskId, { task, committed: commitPublicTask(task) }])),
    findings: [],
    stopped: false,
    cleanupReported: false,
    groups: new Map(),
    observationsByControlId: new Map(),
  };
  await runAccepts(run, corpus);
  await runRejects(run, corpus);
  for (const { ids, notes, write } of run.groups.values()) run.findings.push(write(ids, notes));
  const settled = settleControlReceipts(run, corpus);
  run.findings.push(...settled.findings);
  return {
    accepts: corpus.accept.length,
    rejects: corpus.reject.length,
    ...settled.totals,
    controlReceipts: settled.controlReceipts,
    claimable: run.findings.length === 0,
    findings: run.findings,
  };
}
