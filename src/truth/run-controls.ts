/** Runs saved controls through the same correctness path as measured cases. */
import { capturedJsonStringify, capturedStructuredClone } from "../meta/json-runtime.ts";
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
import {
  type ControlEvaluation,
  type ReceiptSession,
  recordObservation,
  settleControlReceipts,
  // Gate audit 2026-09-25 (docs/gate-audit.md, reject-discrimination): commented out (unsure): a reject control that passes its named check no longer refuses the candidate or the claim
  // sideMatchesExpected,
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

/** Controls evaluated side by side, each in its own scope and cells. A compiler-bound census run
 *  one control after another spends most of the census wall waiting. Four lanes rather than more,
 *  because the heavy tools already use several cores each. Receipts and findings still settle in
 *  corpus order, so the lane count changes how long the census takes and nothing about what it
 *  records. */
export const CENSUS_LANES = 4;

// --- The control session ---------------------------------------------------------------------

/** State shared by the helpers in one `runControls` call. */
interface ControlSession extends ReceiptSession {
  options: RunControlsOptions;
  evaluate: EvaluatorFn;
  verifier: VerifierHostHandle | undefined;
  /** Each control's own saved task, run through the same correctness path a measured case takes.
   *  The task is committed before generated code runs, which is what gives every result a real
   *  `publicTaskDigest` rather than one taken over bytes something may have edited. */
  boundTaskById: Map<string, { task: BuildTask; committed: ReturnType<typeof commitPublicTask> }>;
  findings: DiscriminationClaimabilityFinding[];
  stopped: boolean;
  /** Whether the one cleanup-pending finding has been admitted. It is admitted at the first
   *  stopped control in corpus order, so a stop reports once rather than per remaining control. */
  cleanupReported: boolean;
  groups: Map<string, ControlGroup>;
}

/** One control's settled evaluation, plus the one fact only its own scope could see: tool runs
 *  still going when the evaluate returned. Findings are admitted from this record in corpus order
 *  and are never pushed from a lane, which is what makes four lanes and one lane write the same
 *  rows. */
type Settled = { evaluation: ControlEvaluation; unboundRuns: number };

type Control = ControlCorpus["accept"][number] | ControlCorpus["reject"][number];

// --- Finding constructors --------------------------------------------------------------------

/** Rows that read alike apart from the control, collected in corpus order and written once each,
 *  naming every control they cover. Without the grouping the author reads the same sentence once
 *  per control — hundreds of repetitions of "stdin is not a string leaf" for one defect. `notes`
 *  keep each control's own text for the evidence, and `write` composes the one finding. */
type ControlGroup = {
  ids: string[];
  notes: string[];
  write: (ids: string[], notes: string[]) => DiscriminationClaimabilityFinding;
};

type Observation = Settled & { attempt: number };

// --- Checks that apply to each task ----------------------------------------------------------

/** The checks applicable to this task under the brief's declared family selection, sorted so the
 *  list is one value rather than whatever order the brief happened to hold. */
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
  // A thrown item stops admission, and the group still settles every started sibling before it
  // rethrows: the census gate retries a verifier non-result, and a lane still running would overlap
  // that retry and write into the same cells.
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
  // One projection per evaluation: `openSubject` digests it synchronously and generated code gets a
  // clone, so both consumers see the same bytes and cannot drift apart.
  const evaluateTask = evaluationPublicTask(run.options.brief, bound.task, bound.committed.view());
  // A reject needs only its declared check to fail, so it runs that check alone and the other
  // checks' verdicts on it decide nothing. A declared check outside the task's scope leaves nothing
  // to run and settles as a thrown evaluation, which is why validation names such a reject first.
  const only = "expectedCheckId" in control ? control.expectedCheckId : undefined;
  // Bind the artifact before generated code runs. The host then checks requested tool inputs
  // against this subject's declared data, and the evaluation receives only this scope's tool port,
  // which keeps its subject binding even if generated code holds a reference to it — so a later
  // control cannot replace the subject behind that port.
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
    // One request shape for controls and measured cases alike, so the correctness model cannot
    // tell a calibration example from a real case, and every task-relative check executes against
    // actual task facts. The model receives a clone, because the canonical artifact was
    // byte-captured at `openSubject` above and generated code never holds the original.
    result = await run.evaluate(
      capturedStructuredClone({ publicTask: evaluateTask, artifact, hidden }),
      scope === undefined ? undefined : { tools: scope.port },
      only,
    );
  } catch (error) {
    failure = error;
  } finally {
    // Evaluate-scoped tool runs close in `finally`, on return and throw alike, draining
    // still-running children so their evidence is durable. A run still pending at close is a
    // fire-and-forget tool run whose result this evaluate cannot have read, so the control fails
    // closed below rather than counting a verdict that rested on nothing.
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

/** The host's own row is read first, whether the evaluate returned or threw. When a tool run hits
 *  its time limit the evaluation throws, and reading the throw first attributes to the author a
 *  failure the host's own timeout row already owns — which costs the whole harness over one
 *  control. The one exception is a throw the generated check owns, such as its own fire-and-forget
 *  run; the host drains that run and records it too, but the generated-code failure keeps its
 *  attribution. A host non-result is this one control's receipt and not the corpus's, so the other
 *  controls still run and this control's DISCRIMINATION_PROBE_NO_VERDICT row keeps the claim
 *  open. */
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
  // A tool run still going when the evaluate returned is the one fact only this scope sees: the
  // declared check read no result from it, so the finding is admitted later, in corpus order.
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

// Gate audit 2026-09-25 (docs/gate-audit.md, controls-no-verdict): kept: a control whose check threw reached no verdict, so it witnesses nothing about the checks
/** A thrown check program groups by its public diagnosis. The thrown message itself is withheld
 *  evidence, so the note names only the examples that threw and where to reproduce them. A
 *  verifier-contract refusal also carries the public tool-request violation — a leaf, binding or
 *  argument-shape diagnostic the host composed about the check's own request, never verifier
 *  output — together with the code's remedy. Without that sentence the author has only the label,
 *  and spends iteration after iteration guessing which part of the request the host refused. */
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
  // One fresh execution for an environment-owned refusal, `sandbox` or `verifierUnavailable`,
  // which is the allowance the census gate gives itself. An author-owned kind, `timeout` or
  // `crash`, settles at once, and a run another lane has already stopped buys no retry at all.
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

/** Records one control's receipt side and admits its verdict, in corpus order. Every non-verdict
 *  outcome lands its finding here, which is what stops the accept and reject loops diverging in how
 *  they admit one. Null means a finding, or a deliberate pending skip, already settled the
 *  control. */
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
  // Gate audit 2026-09-25 (docs/gate-audit.md, external-result-unbound): kept: a check that returns before its tool runs finish grounds its verdict on nothing it waited for
  if (unboundRuns > 0) {
    addToGroup(run, "unbound-runs", control.id, `"${control.id}" (${unboundRuns})`, (_ids, notes) => ({
      code: "EXTERNAL_RESULT_UNBOUND",
      message: `the correctnessModel returned while tool runs were still running for control ${notes.join(", ")}; await every run before returning, because a result the run did not wait for grounds nothing`,
    }));
  }
  // Gate audit 2026-09-25 (docs/gate-audit.md, controls-no-verdict): kept: a control the host could not run to a verdict witnesses no check, so the claim stays open
  // A control the host could not run to a verdict witnesses no cell, so the claim stays open.
  // Without this finding only the executed isolation floor notices, which lets a battery whose
  // rejects all met a vanished tool start solving. The non-result kind is host structure and may
  // cross to the author; tool output may not.
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
      `"${control.id}" names ${capturedJsonStringify(control.taskId)}`,
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

/** How a blocking check's tool runs ended in the verifier cell: tool id and exit, never output. A
 *  tool that fails only under the verifier wall — because it cannot write its temporary file there,
 *  say — otherwise reads to the author as a wrong check, and costs dozens of calls to find. */
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
  // Verified under the bound task's own hidden expectations, which is the condition a measured
  // case gets. Otherwise an accept that contradicts its task passes anyway, on the strength of an
  // empty hidden row.
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
    // Issue text is protected detail and stays on the evidence message. What the author reads is
    // the example ids grouped by the declared checks that blocked them, because ungrouped it is
    // dozens of rows of "was rejected" that all name the same handful of checks.
    issues.push(`"${control.id}": ${blockingIssueSummary(observed.result)}`);
    const blockedBy = [...blockingFailedCheckIds(observed.result)].sort(compareCodeUnits);
    const checks = `[${blockedBy.join(", ") || "no named check"}]${failedToolRuns(run, control.id, observation.attempt, blockedBy)}`;
    idsByChecks.set(checks, [...(idsByChecks.get(checks) ?? []), control.id]);
  }
  if (issues.length === 0) return;
  const groups = [...idsByChecks].map(([checks, ids]) => `on ${checks}: ${namedExamples(ids)}`);
  // Gate audit 2026-09-25 (docs/gate-audit.md, accept-control-rejected): kept: a known-valid answer the checks reject means the checks are wrong, and no measured pass can be read through them
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
  // A hidden-comparison reject is verified with its own evaluate-side operand, which overrides the
  // task's row for that check. External rejects carry no hidden data at all.
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
  // Gate audit 2026-09-25 (docs/gate-audit.md, reject-discrimination): commented out (unsure): a reject control that passes its named check no longer refuses the candidate or the claim
  // // A reject counts only when its declared check fails, and that check is the one the census ran,
  // // so an unrelated schema or empty-input failure cannot stand in for the intended mutation.
  // const missed: string[] = [];
  for (const [index, control] of corpus.reject.entries()) {
    const observation = observations[index];
    if (observation === undefined) break;
    // Gate audit 2026-09-25 (docs/gate-audit.md, reject-discrimination): commented out (unsure): a reject control that passes its named check no longer refuses the candidate or the claim
    // const observed = admitObservation(run, control, observation);
    // if (observed === null) continue;
    // if (!sideMatchesExpected(observed.side, "fail", control.expectedCheckId)) {
    //   missed.push(
    //     control.mutationClass === undefined
    //       ? `"${control.id}"`
    //       : `"${control.id}" (${control.mutationClass})`,
    //   );
    // }
    admitObservation(run, control, observation);
  }
  // Gate audit 2026-09-25 (docs/gate-audit.md, reject-discrimination): commented out (unsure): a reject control that passes its named check no longer refuses the candidate or the claim
  // if (missed.length > 0) {
  //   run.findings.push(
  //     identityComposedFinding(
  //       {
  //         code: "DISCRIMINATION_REJECT_PASSED",
  //         message: `${missed.length} invalid example(s) passed the check that should reject them: ${missed.join(", ")}`,
  //       },
  //       `${missed.length} invalid example(s) passed the check that should reject them: ${missed.join(", ")}. Change each example so that check fails on it, or fix the check`,
  //     ),
  //   );
  // }
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
