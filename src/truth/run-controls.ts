/** Runs saved controls through the same correctness path as measured cases. */
import { isAuthoredEvaluatorFailure } from "./evaluator-process.ts";
import {
  VERIFIER_CONTRACT_HINTS,
  VerifierContractError,
  type VerifierContractCode,
} from "../../vendor/correctness-model-bundle/contract-error.ts";
import {
  ADVISORY_DISCRIMINATION_CODES,
  type DiscriminationClaimabilityFinding,
} from "../claim/discrimination-claimability.ts";
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

/** Controls evaluated side by side, each in its own scope and cells. The compiler-bound censuses of
 *  2026-09-13 spent 12 minutes running 69 controls one after another; four lanes, because the
 *  heavy tools already use several cores each. Receipts and findings still settle in corpus order. */
export const CENSUS_LANES = 4;

// --- The control session ---------------------------------------------------------------------

/** State shared by the helpers in one `runControls` call. */
interface ControlSession extends ReceiptSession {
  options: RunControlsOptions;
  evaluate: EvaluatorFn;
  verifier: VerifierHostHandle | undefined;
  /** Each control uses its own saved task and the same correctness path as measured cases. The
   * task is fixed before generated code runs, so each result has a real `publicTaskDigest`. */
  boundTaskById: Map<string, { task: BuildTask; committed: ReturnType<typeof commitPublicTask> }>;
  findings: DiscriminationClaimabilityFinding[];
  stopped: boolean;
  /** The one cleanup-pending finding is admitted at the first stopped control in corpus order. */
  cleanupReported: boolean;
  groups: Map<string, ControlGroup>;
}

/** One control's settled evaluation plus the fact only its scope could see: tool runs still
 *  going when the evaluate returned. Findings are admitted from this record in corpus order,
 *  never pushed from a lane, so four lanes and one lane write the same rows. */
type Settled = { evaluation: ControlEvaluation; unboundRuns: number };

type Control = ControlCorpus["accept"][number] | ControlCorpus["reject"][number];

// --- Finding constructors --------------------------------------------------------------------

/** Rows that read alike apart from the control, collected in corpus order and written once each,
 *  naming every control: the censuses of 2026-09-12 repeated "stdin is not a string leaf" for 344
 *  controls. `notes` keep each control's own text for evidence; `write` composes the one finding. */
type ControlGroup = {
  ids: string[];
  notes: string[];
  write: (ids: string[], notes: string[]) => DiscriminationClaimabilityFinding;
};

type Observation = Settled & { attempt: number };

/** A reject must fail on its declared check. An unrelated schema or empty-input failure does
 *  not establish that the intended mutation was detected; further failures beside the declared
 *  check are allowed. */
/** What the reject corpus showed about one declared check. A check is isolated once some reject
 *  failed it and nothing else: that is the observation which establishes the check refuses an
 *  artifact its neighbours accept. Without it the corpus proves the aggregate verdict and leaves
 *  the check's own comparison unexercised — truss run de8b40 carried four member-loss rejects, all
 *  of one mutation class, every one of which already failed strength-and-buckling. */
interface CheckIsolation {
  ids: string[];
  classes: Set<string>;
  beside: Set<string>;
  isolated: boolean;
}

// --- Checks that apply to each task ----------------------------------------------------------

/** List checks applicable to this task under the brief's declared family selection. */
export function applicableCheckIds(
  brief: Brief,
  task: { family: string; hidden: Array<{ checkId: string }> },
): string[] {
  return applicableTruthChecks(brief, task)
    .map((check) => check.id)
    .sort();
}

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
  // A thrown item stops admission and the group still settles every started sibling before it
  // throws: the census gate retries a verifier non-result, and an unsettled lane would overlap it.
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
  // One projection per evaluation: openSubject digests it synchronously and generated code gets a
  // clone, so both consumers see the same bytes and cannot drift apart.
  const evaluateTask = evaluationPublicTask(run.options.brief, bound.task, bound.committed.view());
  // A reject needs only its declared check to fail, so it runs that check alone; the other checks'
  // verdicts on it decide nothing. A declared check outside the task's scope leaves nothing to run
  // and settles as a thrown evaluation; validation names that reject first.
  const only = "expectedCheckId" in control ? control.expectedCheckId : undefined;
  // Bind the artifact before generated code runs (P0, steering 2026-07-11). The host checks
  // requested tool inputs against this subject's declared data. The evaluation receives only
  // this scope's tool port, which retains its subject binding even if generated code keeps
  // a reference to it. A later control cannot replace the subject behind that port.
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

    // One request shape for controls and measured cases: the correctnessModel cannot tell a
    // calibration example from a real case, and every task-relative check executes against
    // actual task facts (runs 76/77). The correctness model receives a clone
    // (steering delta 2026-07-11): the canonical artifact was byte-captured at openSubject
    // above, and generated code never holds the original.
    result = await run.evaluate(
      trustedStructuredClone({ publicTask: evaluateTask, artifact, hidden }),
      scope === undefined ? undefined : { tools: scope.port },
      only,
    );
  } catch (error) {
    failure = error;
  } finally {
    // Evaluate-scoped tool runs (steering delta 2026-07-11): close in `finally` — return and
    // throw alike — draining still-running children so their evidence is durable. A run still
    // pending at close is a fire-and-forget tool run whose result this evaluate cannot have
    // read; the control fails closed below.
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

/** The host's own row first, whether the evaluate returned or threw: run
 *  esp32-sol-20260908T214013792Z-23a1bc lost a harness with 61 of 62 controls settled when one
 *  `arduino-compile` run hit its time limit and evaluation threw. The failure was attributed
 *  to the author while the host's timeout row went unread. One
 *  exception: a throw the generated check owns, such as its own fire-and-forget run. The host
 *  drains that run and records it too, but the generated-code failure retains its attribution.
 *  A host non-result is this one control's receipt, not the corpus's: the other controls still
 *  run, and the control's DISCRIMINATION_PROBE_NO_VERDICT row keeps the claim open. */
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
  // A tool run still going when the evaluate returned is the one fact only this scope sees; the
  // declared check read no result from it, and its finding is admitted in corpus order.
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

/** A thrown check program groups by its public diagnosis. The thrown message is withheld evidence;
 *  the note names only the examples that threw and where to reproduce them. A verifier-contract
 *  refusal also carries the public tool-request violation (a leaf/binding/argument-shape diagnostic
 *  the host composed about the check's request, never verifier output) and the code's remedy. Run
 *  w11 spent 36 iterations on the payload-free label before this note existed. */
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
  // One fresh execution for an environment-owned refusal (sandbox, verifierUnavailable), the
  // allowance the census gate gives itself; an author-owned kind (timeout, crash) settles at once.
  // A run another lane has already stopped buys no retry.
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

/** Record one control's receipt side and admit its verdict, in corpus order. Every non-verdict
 *  outcome lands its finding here, so the accept and reject loops cannot diverge in how they admit
 *  one. Null means a finding (or a deliberate pending skip) already settled the control. */
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
  // A control the host could not run to a verdict witnesses no cell, so the claim stays open. Before
  // 2026-09-15 only the executed isolation floor noticed; removing it let a battery whose rejects
  // all met a vanished tool start solving. The kind is host structure and crosses; tool output does not.
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

/** How a blocking check's tool runs ended in the verifier cell: tool id and exit, never output. A
 *  tool that fails only under the verifier wall reads otherwise as a wrong check: truss run 406cca
 *  spent 38 calls finding that Frame3DD could not write its temporary file there. */
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
  // Verified under the bound task's own hidden expectations, the condition a measured case gets.
  // Run w12: 11 of 29 accepts contradicted their task and passed only on empty hidden rows.
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
    // Issue text is protected detail and stays on the evidence message. The author reads the
    // example ids grouped by the declared checks that blocked them: esp32-opus 2026-08-22 read 30
    // rows of "was rejected" while every one named the same eight checks.
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

function isolationFinding(byCheck: Map<string, CheckIsolation>): DiscriminationClaimabilityFinding[] {
  const gaps = byCheck
    .entries()
    .filter(([, row]) => !row.isolated)
    .map(
      ([checkId, row]) =>
        `"${checkId}" (${namedExamples(row.ids)}, mutation class(es) [${[...row.classes].sort(compareCodeUnits).join(", ")}], each also failing [${[...row.beside].sort(compareCodeUnits).join(", ")}])`,
    )
    .toArray();
  if (gaps.length === 0) return [];
  return [
    identityComposedFinding(
      {
        code: "DISCRIMINATION_CHECK_NOT_ISOLATED",
        message: `${gaps.length} declared check(s) have no reject that fails them alone: ${gaps.join("; ")}`,
      },
      `${gaps.length} declared check(s) have no reject control that fails on them alone: ${gaps.join("; ")}. Every reject naming one of those checks is also refused by another declared check, so the census does not show it refusing anything its neighbours accept. Add one reject per check that fails that check and no other`,
    ),
  ];
}

async function runRejects(run: ControlSession, corpus: ControlCorpus): Promise<void> {
  // A hidden-comparison reject is verified with its evaluate-side operand. External rejects carry no
  // hidden data.
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
  // A reject counts only when its declared check fails; that check is the one the census ran.
  const missed: string[] = [];
  const byCheck = new Map<string, CheckIsolation>();
  for (const [index, control] of corpus.reject.entries()) {
    const observation = observations[index];
    if (observation === undefined) break;
    const observed = admitObservation(run, control, observation);
    if (observed === null) continue;
    const expected = control.expectedCheckId;
    if (!sideMatchesExpected(observed.side, "fail", expected)) {
      missed.push(
        control.mutationClass === undefined
          ? `"${control.id}"`
          : `"${control.id}" (${control.mutationClass})`,
      );
      continue;
    }
    const row = byCheck.get(expected) ?? {
      ids: [],
      classes: new Set<string>(),
      beside: new Set<string>(),
      isolated: false,
    };
    row.ids.push(control.id);
    row.classes.add(control.mutationClass ?? "unnamed");
    const beside = [...blockingFailedCheckIds(observed.result)].filter((checkId) => checkId !== expected);
    if (beside.length === 0) row.isolated = true;
    for (const checkId of beside) row.beside.add(checkId);
    byCheck.set(expected, row);
  }
  run.findings.push(...isolationFinding(byCheck));
  // Every example stays on the evidence message; the author reads the first eight and a count.
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
    // An advisory row names a control gap; it does not refuse the candidate or the claim.
    claimable: !run.findings.some((finding) => !ADVISORY_DISCRIMINATION_CODES.has(finding.code)),
    findings: run.findings,
  };
}
