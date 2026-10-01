/** Fresh, repair and battery-only authoring through one persistent Builder and submit path. */
import type { VerifierLifetime } from "../verify/verifier-lifetime.ts";
import { cpSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import type { AgentToolsProbes } from "../author/agent-tools-session.ts";
import { BuildAgentTurnNonResult } from "../author/build-agent.ts";
import { writeAuthoringAttemptEvidence } from "../author/build-attempt-evidence.ts";
import { builderExecutionEvidenceWriter } from "../author/builder-execution-writer.ts";
import { WORKSPACE_DIR } from "../author/builder-memory.ts";
import { iterationMemoryFindings } from "../author/iteration-memory.ts";
import { advisory } from "../author/feedback-routing.ts";
import {
  type BuilderSessionDeps,
  type BuilderSubmitOutcome,
  type WorkspaceSeed,
  runBuilderSession,
} from "../author/builder-session.ts";
import { writeCompleted } from "../meta/completed-json.ts";
import { type CampaignMemory, nextOrdinal, resumeCampaignMemory } from "../author/campaign-memory.ts";
import { renderBatteryContract } from "./climb-readout.ts";
import { taskCountSentence } from "./battery-sizing.ts";
import { ITERATION_FILE } from "../builder/campaign-iterations.ts";
import { safeguardTriggered } from "../meta/safeguard.ts";
import { type CandidateSnapshot, checkCandidate, conditionKey } from "../author/candidate-check.ts";
import {
  beginIteration,
  candidateTreeIdentity,
  initWorkspace,
  workspaceChangeBetween,
  workspaceHead,
} from "../author/domain-repo.ts";
import type {
  AdmissionLineage,
  BuiltHarness,
  CampaignClause,
  CampaignOutcome,
  DiagnosisInput,
  IterationEvidence,
  PriorEvidence,
} from "../author/campaign-types.ts";
import type { SafeguardContext } from "../meta/safeguard.ts";
import type { BudgetStatus } from "./controller-ledger.ts";
import {
  campaignAttemptGate,
  type CampaignBudgetGate,
  type SavedCampaignBudgetGate,
} from "./campaign-budget.ts";
import { AuthoringReviewClock, REVIEW_INTERVAL_MS } from "../gate/review-clock.ts";
import { AuthoringReviews, type ReviewAuthoring } from "./authoring-review.ts";
import { CandidateMemory } from "../gate/candidate-memory.ts";
import { gateTerminalClause, settleGateRun } from "../gate/settlement.ts";
import { BuilderAuthorFeedback, gateFeedbackFindings } from "../builder/author-feedback.ts";
import { createHarnessInspectTool } from "../builder/harness-inspect.ts";
import { type ContextBinding, RehearsalTraces, createContextTool } from "../builder/context-tool.ts";
import { EMPTY_USER_CONTEXT, type PreparedUserContext } from "../builder/user-context.ts";
import { createHarnessResetTool } from "../builder/harness-reset.ts";
import { createHarnessTrialTool } from "../builder/harness-trial.ts";
import { createCorrectnessCheckTool } from "../gate/check-tool.ts";
import {
  type Gate,
  type GateReport,
  type GateRun,
  type PipelineInput,
  clearPreview,
  freshRunDir,
  memorable,
  stagesOf,
  strikeExempt,
  previewCandidate,
  submitStages,
} from "../gate/validation-pipeline.ts";
import type { HarnessAuthoring } from "../critic/types.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import type { RunObserver } from "../observe/run-observer.ts";
import { SOURCE_IDENTITY } from "./source-identity.ts";
import { decorateIterationEvidence, stampSubmissionCondition } from "./campaign-evidence.ts";
import { keyIfDefined, keyIfTruthy } from "../meta/optional-key.ts";
import type { ProviderResourceBudget } from "./provider-resource-budget.ts";
import type { Solver } from "../correctness-bundle/solve.ts";
import { readableFingerprint, type ExperimentScope } from "./experiment-freeze.ts";

export interface BuilderCampaignInput {
  campaignDir: string;
  slug: string;
  kickoff: string;
  /** Whether the resolved Builder transport carries public web search. It is resolved rather than
   *  requested: `resolvePiSlot` grants it to claude as a CLI builtin and to codex as a Responses
   *  tool, and withholds it from openrouter, whose routing syntax has not been proved live. It
   *  changes one sentence of the start prompt, telling the Builder it may search for specifications,
   *  standards and the real tools to install, and to cite each source beside the rule it supports. */
  webSearch?: boolean;
  expectedTasks: number;
  /** The smallest accepted size when the round leaves the count to the Builder. */
  minTasks?: number;
  /** The controller's starting condition; accepted bytes determine the realised scope. */
  experiment?: HarnessAuthoring;
  /** The immutable baseline for model-proposed continuation and scope attribution. */
  adoptedDir?: string;
  priorEvidence?: PriorEvidence;
  admissionLineage?: AdmissionLineage;
  diagnosisInput?: DiagnosisInput;
  advisoryNote?: string;
  /** The recorded batteries and their passing solver traces, as the context tool's history and
   *  traces sources; absent before anything was measured. */
  measured?: Pick<ContextBinding, "history" | "traces">;
  /** The `--context` files, as the context tool's user source. */
  userContext?: PreparedUserContext;
  maxTurns?: number;
  /** Present on a reopen, where harness_reset may return a surface to the starter seed when the
   *  Builder calls it; the workspace still opens on the adopted bytes. The value keys the
   *  once-per-scope rule: a resumed reopen finds its own reset in workspace history. */
  resetKey?: string;
}

export interface BuilderCampaignDeps {
  /** The Epoch Reviewer over a frozen snapshot: `repair` a validated product's, `backstop` the one
   *  the clock froze. It runs beside the session. */
  reviewAuthoring?: ReviewAuthoring;
  /**
   * Test-only shortened backstop clock; production uses `REVIEW_INTERVAL_MS`, forty minutes.
   *
   * Forty because an interval longer than the sessions it bounds never fires, and a review arriving
   * in a session's last minutes is thousands of characters of advice with no time left to act on
   * them. A session typically runs an hour and a half and takes its first `correctness_check` near
   * the middle of it, so a backstop set above that leaves the whole first half unreviewed. The point
   * of having one is that it fires while the session can still spend.
   */
  reviewIntervalMs?: number;
  open: BuilderSessionDeps["open"];
  recordSession?: BuilderSessionDeps["recordSession"];
  /** The run's one Builder conversation, paused between this campaign's round and the next. */
  conversation?: BuilderSessionDeps["conversation"];
  tools: BuilderSessionDeps["tools"];
  /** Construct path-bound probes only after submit has fixed the candidate directory. */
  toolsProbes: (candidateDir: string) => AgentToolsProbes;
  /** The measured Built solver for harness_trial; absent, the tool refuses. */
  builtSolver?: (providerBudget?: ProviderResourceBudget) => Solver;
  verifierLifetime?: VerifierLifetime;
  gates?: Gate;
  turnTimeoutMs?: number;
  /** Finite production budgets must pass campaignAttemptGate's check of the canonical pair. */
  budget?: CampaignBudgetGate &
    Partial<Pick<SavedCampaignBudgetGate, "startAttempt" | "assertAttemptAvailable" | "campaignRoot">>;
  providerBudget?: ProviderResourceBudget;
  observer?: RunObserver;
  onIteration?: (evidence: IterationEvidence) => void;
  safeguardContext?: SafeguardContext;
  waitMs?: (ms: number) => Promise<void>; // test interface for the turn-retry backoff
}

type Refused = Extract<BuilderSubmitOutcome, { ok: false }>;
type Accepted = {
  experimentScope?: ExperimentScope;
  harness: BuiltHarness;
  iterationDir: string;
  ordinal: number;
  snapshotDir: string;
};

type Iteration = { ordinal: number; dir: string; iterationDir: string };

/** Safeguard 40's floor: a 25-task battery refused on one cause, so a smaller battery repeating a
 *  code does not trip it. */
const REPEATED_CODE_FLOOR = 20;

/** The clause that ends this campaign before a model session opens: exhausted authoring, an
 *  environment blocker or a spent durable cap, none of which a provider turn could change. */
function preSessionClause(
  input: Pick<BuilderCampaignInput, "priorEvidence">,
  memory: CampaignMemory,
  budget: BudgetStatus | undefined,
): CampaignClause | null {
  if (memory.clause !== null) return memory.clause;
  const feedback = [...memory.carried, ...(input.priorEvidence?.feedback ?? [])];
  if (feedback.some((row) => row.severity === "blocking" && row.owner === "environment")) {
    return "environment-blocked";
  }
  // A spent durable cap is settled here, before any provider turn: it used to be found only at
  // the first submit, by which point the session had already been paid for.
  return budget === "budget_limited" ? "budget-limited" : null;
}

/** What the controller asks of this round: how many tasks, and the contract those tasks are
 *  written under. The round states it once, and `harness_inspect readiness` serves these same
 *  bytes, so a session whose opening turn compaction cut recovers the ask without a gate call.
 *  One owner rather than two: a second author would drift. */
function roundContract(input: BuilderCampaignInput): string {
  return [taskCountSentence(input), renderBatteryContract(input.expectedTasks, input.minTasks)].join("\n\n");
}

/** One authoring round's submit, preview and review handling over the Builder workspace. */
class BuilderCampaignController {
  /** When this session hears from the Epoch Reviewer, and over which bytes. A review becomes due
   *  and starts at a completed host tool call, runs beside the session, and restarts the clock
   *  when it finishes. */
  private readonly reviewClock: AuthoringReviewClock;
  /** The review beside this round, absent when the review slot is. */
  readonly reviews: AuthoringReviews | null;
  readonly workspace: string;
  readonly iterations: IterationEvidence[] = [];
  accepted: Accepted | null = null;
  /** The contract-root identity this call submitted; undefined until a candidate was captured, so
   *  a controller stop that inspected no tree reports none rather than an empty one. */
  private submittedTree: string | undefined;
  terminalClause: CampaignClause | null = null;
  /** The immutable Git boundary for the whole controller invocation. A blocked iteration may not
   *  become the next attribution base, because its forbidden bytes were never accepted. */
  private readonly roundBaseCommit: string;
  private lastRecordedTurn = 0;
  /** What this session already knows about the candidates it has seen, and what that memory
   *  permits it to spend next. */
  private readonly candidates: CandidateMemory<Refused>;
  /** This round's passing rehearsals, written by harness_trial and read by the context tool. */
  readonly rehearsals = new RehearsalTraces();

  constructor(
    private readonly input: BuilderCampaignInput,
    private readonly deps: BuilderCampaignDeps,
    private readonly memory: CampaignMemory,
  ) {
    this.workspace = join(input.campaignDir, WORKSPACE_DIR);
    this.reviewClock = new AuthoringReviewClock(
      input.adoptedDir === undefined ? null : readableFingerprint(input.adoptedDir),
      deps.reviewIntervalMs ?? REVIEW_INTERVAL_MS,
    );
    this.roundBaseCommit = workspaceHead(this.workspace);
    this.candidates = new CandidateMemory(memory);
    this.reviews =
      deps.reviewAuthoring === undefined
        ? null
        : new AuthoringReviews(this.workspace, input.slug, this.reviewClock, deps.reviewAuthoring);
  }

  /** What every opening turn carries, in the order the author reads it: what the round asks for,
   *  then what the measured evidence advises without choosing its repair scope. */
  openingContext(): string {
    return [
      roundContract(this.input),
      this.input.advisoryNote,
      advisory(this.input.priorEvidence?.feedback ?? []),
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  /** What only a fresh session's opening carries: the campaign's earlier attempts and the refusals
   *  still standing from them. A continued conversation read each refusal as the result that ended
   *  its round, so the session states this block only when it opens without one. */
  freshContext(): string {
    const history = iterationMemoryFindings(this.input.campaignDir)
      .map((finding) => finding.detail)
      .join("\n");
    return [history, advisory(this.memory.carried)].filter(Boolean).join("\n\n");
  }

  recordNonResult(error: BuildAgentTurnNonResult): void {
    const { ordinal, dir } = this.openIteration();
    const attempts = Math.max(1, error.turns - this.lastRecordedTurn);
    writeAuthoringAttemptEvidence({
      epochDir: this.input.campaignDir,
      ordinal,
      dir,
      error,
      authorCalls: { builder: attempts },
      source: SOURCE_IDENTITY,
    });
    this.lastRecordedTurn = error.turns;
  }

  private budgetSpent(): boolean {
    return this.deps.budget?.status() === "budget_limited";
  }

  async submit({ turn }: { turn: number }): Promise<BuilderSubmitOutcome> {
    this.submittedTree = undefined;
    const outcome = await this.checkSubmission(turn);
    return { ...outcome, ...keyIfDefined("treeId", this.submittedTree) };
  }

  private async checkSubmission(turn: number): Promise<BuilderSubmitOutcome> {
    if (this.budgetSpent()) {
      this.terminalClause = "budget-limited";
      return {
        ok: false,
        kind: "controller-terminal",
        stage: "gates",
        commit: "budget-limited",
        terminal: true,
        findings: gateFeedbackFindings([
          {
            owner: "environment",
            severity: "blocking",
            claim: "durable authoring/session-call budget is spent",
            evidence: "campaign budget evidence",
          },
        ]),
      };
    }
    const candidate = checkCandidate(this.workspace, this.candidateCheckContext());
    // A repaired executable is a new submission condition even when the candidate files did not
    // change, so a valid candidate is keyed by its submission condition and a malformed one by its
    // committed contract-root tree. The candidate memory keys its remembered refusals and its no-op
    // strikes on that identity, and the execution record compares submissions on the same value, so
    // none of the three can disagree about what "the same candidate" means.
    const tree = candidateTreeIdentity(this.workspace, candidate.commit);
    this.submittedTree = tree;
    // Bundle findings, a missing installed tool among them, are ordinary repairable defects: the
    // refusal keeps the session, and it is the byte-identical resubmit that strikes.
    if (!candidate.ok) return this.strike(tree, candidate);
    const candidateId = conditionKey(candidate);
    const cached = this.candidates.refusalFor(candidateId);
    if (cached !== undefined && cached.findings.length > 0) {
      return this.strike(candidateId, { ...cached, commit: candidate.commit });
    }
    const { outcome, retryable } = await this.validate(candidate, turn);
    // A typed runtime non-result or a host refusal says nothing about these bytes, so resubmitting
    // them is not a no-op; counting it would strike the same commit twice for one worker crash.
    if (outcome.ok || outcome.terminal === true || retryable) return outcome;
    return this.strike(candidateId, outcome);
  }

  /** Every non-terminal refusal passes the candidate memory's repeat policy; its ceiling ends the session. */
  private strike(candidateId: string, refusal: Refused): Refused {
    const struck = this.candidates.strike(candidateId, refusal);
    if (this.candidates.stalled) this.terminalClause = "authoring-stalled";
    return struck;
  }

  /**
   * Runs the pipeline on submit's own snapshot load, sharing the gate run. Every stage that can
   * run reports, but only a candidate clean through conformance writes an iteration,
   * so the persisted diagnosis history counts gate verdicts alone. A session can submit many times
   * in one provider turn, which is why the executed stages are remembered per condition; a runtime
   * non-result or a host refusal is not remembered, since neither is a verdict on the bytes.
   */
  private async validate(
    candidate: CandidateSnapshot,
    turn: number,
  ): Promise<{ outcome: BuilderSubmitOutcome; retryable: boolean }> {
    const key = conditionKey(candidate);
    // Read synchronously: submit publishes its run before its first await, so a preview started
    // meanwhile joins it.
    const clear = clearPreview(this.candidates.validation, key);
    let iteration: Iteration | null = null;
    const report = await submitStages(candidate, this.pipelineInput(), {
      gates: this.deps.gates ?? (async () => []),
      memory: this.candidates.validation,
      runDir: (clean, label) => {
        if (!clean) return freshRunDir(join(this.input.campaignDir, "trials", key), label);
        iteration = this.openIteration();
        return iteration.iterationDir;
      },
    });
    if (report.blocked !== null) throw report.blocked.cause;
    const retryable = strikeExempt(report);
    const opened =
      /* SAFETY: assigned inside runDir; the control-flow narrowing of a closure write is lost. */ iteration as Iteration | null;
    // A clean candidate whose gate run another call executed opens its iteration here.
    const settling =
      opened ?? (report.refusals.every((refusal) => refusal.stage === "gates") ? this.openIteration() : null);
    const settled =
      settling !== null && report.harness !== null && report.gated !== null
        ? await this.settle(candidate, report.harness, report.gated, settling, turn)
        : this.unsettled(candidate, report);
    const { executed } = settled;
    // The receipt names each code's stage as a preview's does; the remembered refusal does not,
    // because answering it from memory runs no stage.
    const outcome = settled.outcome.ok ? settled.outcome : { ...settled.outcome, ...stagesOf(report) };
    // Safeguard 33: the preview promises parity with submit on unchanged bytes, so a clear check
    // followed by a refused submit of the same snapshot says the two paths diverged, and nothing
    // else records the pair.
    if (clear !== undefined && !outcome.ok && executed.findings.length > 0) {
      safeguardTriggered(
        "33-preview-clear-submit-refused",
        `candidate ${candidate.snapshotId.slice(0, 12)}: correctness_check was clear under condition ${String(clear.conditionDigest)}, submit refused at stage ${outcome.stage} with ${outcome.findings.map((finding) => finding.code).join(", ")}`,
        this.deps.safeguardContext,
      );
    }
    if (outcome.ok) return { outcome, retryable };
    safeguardRepeatedRefusalCode(outcome, this.deps.safeguardContext);
    this.candidates.remember(key, executed, memorable(report) ? "verdict" : "retryable");
    return { outcome, retryable };
  }

  private openIteration(): Iteration {
    const ordinal = nextOrdinal(this.input.campaignDir);
    const dir = `${String(ordinal).padStart(2, "0")}-${this.input.slug}`;
    return { ordinal, dir, iterationDir: join(this.input.campaignDir, dir) };
  }

  private candidateCheckContext() {
    return {
      slug: this.input.slug,
      exactTasks: this.input.expectedTasks,
      ...keyIfDefined("minTasks", this.input.minTasks),
    };
  }

  private pipelineInput(): PipelineInput {
    return {
      toolsProbes: this.deps.toolsProbes,
      ...keyIfDefined("adoptedDir", this.input.adoptedDir),
    };
  }

  /** The continuous span from the round-entry commit, not only the candidate diff: a bundle
   *  refusal, a settled gates-blocked iteration or a preview commit must not make forbidden bytes
   *  part of the next baseline merely because the Builder left them untouched afterwards. */
  private attributableChange(candidate: CandidateSnapshot) {
    return candidate.baseCommit === this.roundBaseCommit
      ? {
          baseCommit: candidate.baseCommit,
          commit: candidate.commit,
          changedPaths: candidate.changedPaths,
          deletedPaths: candidate.deletedPaths,
        }
      : workspaceChangeBetween(this.workspace, this.roundBaseCommit, candidate.commit);
  }

  /** Submit without adoption, for `correctness_check`: the same candidate check, the same stages
   *  and the same gate on the same snapshot, written into `trials/<conditionKey>`. One outcome is
   *  remembered per candidate-and-tool condition once a run reached a verdict, so unchanged bytes
   *  never buy that verdict twice, and a blocked or non-result run is forgotten and runs again.
   *  Changed bytes may preview without limit (operator decision): under
   *  a ceiling, a build that reaches it spends the rest of the session submitting unchecked. */
  private async preview(gates: Gate): Promise<GateReport> {
    const report = await previewCandidate(this.workspace, this.candidateCheckContext(), {
      input: this.pipelineInput(),
      gates,
      trialsDir: join(this.input.campaignDir, "trials"),
      memory: this.candidates.validation,
    });
    const clear =
      report.harness !== null &&
      report.gated !== null &&
      report.blocked === null &&
      report.refusals.length === 0;
    if (report.harness !== null && clear) this.reviewClock.validatedProduct(report.harness.fingerprint);
    return report;
  }

  /** A shared gate run's evidence becomes the iteration's, including one a preview started. */
  private async settle(
    candidate: CandidateSnapshot,
    harness: BuiltHarness,
    run: GateRun,
    { ordinal, dir, iterationDir }: Iteration,
    turn: number,
  ): Promise<{ outcome: BuilderSubmitOutcome; executed: Refused }> {
    const attributableChange = this.attributableChange(candidate);
    const step = settleGateRun({
      feedback: run.feedback,
      fingerprint: harness.fingerprint,
      attempts: { builder: Math.max(1, turn - this.lastRecordedTurn) },
      ordinal,
      dir,
    });
    if (run.trialDir !== iterationDir) cpSync(run.trialDir, iterationDir, { recursive: true });
    const evidence = decorateIterationEvidence(step.evidence, {
      first: this.iterations.length === 0,
      hasResumedCarry: this.memory.carried.length > 0,
      workspaceChange: attributableChange,
      ...keyIfDefined("declaredDiagnosis", this.input.diagnosisInput),
      ...keyIfDefined("priorEvidence", this.input.priorEvidence),
      ...keyIfDefined("admissionLineage", this.input.admissionLineage),
    });
    stampSubmissionCondition(evidence, candidate, harness, this.input);
    writeCompleted(join(iterationDir, ITERATION_FILE), evidence);
    this.lastRecordedTurn = turn;
    this.deps.onIteration?.(evidence);
    this.deps.observer?.iteration({
      ordinal: evidence.ordinal,
      outcome: evidence.outcome,
      focusOwner: evidence.focusOwner,
      findingsHash: evidence.findingsHash,
    });
    this.iterations.push(evidence);
    if (step.kind === "build-admissible") {
      this.accepted = {
        harness,
        iterationDir,
        ordinal,
        snapshotDir: candidate.snapshotDir,
        ...keyIfDefined("experimentScope", evidence.experimentScope),
      };
      return {
        outcome: candidate,
        executed: { ok: false, stage: "gates", commit: candidate.commit, findings: [] },
      };
    }
    if (step.kind === "terminal") this.terminalClause = step.clause;
    const gated = gateFeedbackFindings(step.kind === "continue" ? step.carried : evidence.feedback);
    const refused: Refused = {
      ok: false,
      stage: "gates",
      commit: candidate.commit,
      findings: [...gated],
      ...keyIfTruthy("terminal", step.kind === "terminal"),
    };
    // Only the rows the bytes earned are remembered; steering and strike counts belong to this call.
    return { outcome: refused, executed: { ...refused, findings: gated } };
  }

  /** A candidate refused before settlement writes no iteration, but a gate run it executed still
   *  ends the session on a blocking environment row. */
  private unsettled(candidate: CandidateSnapshot, report: GateReport) {
    const executed = unsettledRefusal(candidate, report);
    if (report.gated === null) return { outcome: executed, executed };
    const clause = gateTerminalClause(report.gated.feedback);
    if (clause !== null) this.terminalClause = clause;
    return { outcome: { ...executed, ...keyIfTruthy("terminal", clause !== null) }, executed };
  }

  /** The advisory tools the session mounts beside submit: static inspection, one bounded
   *  solve-side rehearsal, the reopen reset and the pre-adoption validation sequence. None is an
   *  acceptance authority. A method rather than a free function because every context it hands a
   *  tool is the controller's own, and passing them back in let a caller compose a different one. */
  authoringTools(feedback: BuilderAuthorFeedback) {
    const { input, deps } = this;
    // Compose inspection and trial where the candidate-check context is available. Both must use
    // the same slug, task count and fresh-candidate contract as submit; a check under different
    // rules could advise the wrong repair. Trial also receives the measured Built solver.
    // The shared feedback channel carries inspection findings into later Builder turns, while acceptance remains with submit and its gates.
    const toolContext = this.candidateCheckContext();
    const inspect = createHarnessInspectTool({
      workspace: this.workspace,
      context: toolContext,
      feedback,
      contract: roundContract(input),
    });
    // The round's own opening is the context tool's round source, so a session whose opening turn
    // compaction cut asks for it rather than guessing. It holds the fresh-session block too, which
    // is how a continued conversation reaches refusals compaction has since cut.
    const context = createContextTool({
      round: [this.openingContext(), this.freshContext()].filter(Boolean).join("\n\n"),
      workspace: this.workspace,
      ...keyIfDefined("history", input.measured?.history),
      ...keyIfDefined("traces", input.measured?.traces),
      rehearsals: this.rehearsals,
      user: input.userContext ?? EMPTY_USER_CONTEXT,
    });
    const { builtSolver, conversation } = deps;
    const trial = createHarnessTrialTool({
      workspace: this.workspace,
      context: toolContext,
      rehearsalDir: join(input.campaignDir, "rehearsals"),
      rehearsals: this.rehearsals,
      onRehearsal: (row, submitted) => this.reviews?.rehearsed(row, submitted),
      ...keyIfDefined(
        "builtSolver",
        builtSolver === undefined ? undefined : () => builtSolver(deps.providerBudget),
      ),
      ...keyIfDefined("verifierLifetime", deps.verifierLifetime),
      ...keyIfDefined(
        "tellOnce",
        conversation === undefined ? undefined : (key: string) => conversation.tellOnce(key),
      ),
    });
    const reset = createHarnessResetTool({
      workspace: this.workspace,
      ...keyIfDefined("resetKey", input.resetKey),
    });
    // Submit without adoption: the controller's own validation sequence on the same workspace, candidate-check context, probe
    // pack and gate, so the rows the Builder reads here are the rows a submit refusal would carry. A
    // scripted session that mounts no gate has no validation sequence to preview and gets no such tool.
    const { gates } = deps;
    if (gates === undefined) return [context, inspect, trial, reset];
    const correctnessCheck = createCorrectnessCheckTool({
      preview: () => this.preview(gates),
      expectedTasks: input.expectedTasks,
      ...keyIfDefined("minTasks", input.minTasks),
      feedback,
    });
    return [context, inspect, trial, reset, correctnessCheck];
  }
}

/** A candidate refused before settlement: every executed stage's findings, no iteration, recorded
 *  at the first stage that refused, and what a later call on the same condition may reuse. */
function unsettledRefusal(candidate: CandidateSnapshot, report: GateReport): Refused {
  return {
    ok: false,
    stage: report.refusals[0]?.stage ?? "gates",
    commit: candidate.commit,
    findings: report.refusals.flatMap((row) => row.findings),
  };
}

/** Safeguard 40: a refused submit whose findings repeat one code across most of the battery is one
 * defect reported once per task, and the recorded findings keep only the count of it. */
function safeguardRepeatedRefusalCode(
  outcome: { stage: string; findings: ReadonlyArray<{ code: string }> },
  context: SafeguardContext | undefined,
): void {
  const counts = new Map<string, number>();
  for (const finding of outcome.findings) counts.set(finding.code, (counts.get(finding.code) ?? 0) + 1);
  const [code, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  if (count < REPEATED_CODE_FLOOR) return;
  safeguardTriggered(
    "40-refused-submit-repeated-code",
    `stage ${outcome.stage}: ${code} x${count} of ${outcome.findings.length} findings`,
    context,
  );
}

/**
 * One persistent session authors files and calls the same submit tool repeatedly. Each successful
 * candidate snapshot is reconstructed from disk, conformance-probed and passed through the
 * adoption gates, and repairable findings return through the tool result inside the same model
 * context, so the Builder repairs what it wrote rather than starting again. Only a clean gate
 * settlement becomes build-admissible.
 */
export async function runBuilderCampaign(
  input: BuilderCampaignInput,
  deps: BuilderCampaignDeps,
): Promise<CampaignOutcome> {
  // The campaign's one attempt gate is its durable budget's reservation, asserted before any
  // session or workspace work.
  const attemptGate = campaignAttemptGate(deps.budget);
  attemptGate?.assertAttemptAvailable();
  const memory = resumeCampaignMemory(input.campaignDir, input.slug, hashJsonValue(input.kickoff));
  const refused = preSessionClause(input, memory, deps.budget?.status());
  if (refused !== null) return { buildAdmissible: false, clause: refused, iterations: [] };
  const workspace = join(input.campaignDir, WORKSPACE_DIR);
  // A repair seeds from the adopted package once and resumes in-flight edits without overwriting them.
  const { created } = initWorkspace(workspace, input.adoptedDir, deps.safeguardContext);
  const fresh: WorkspaceSeed = input.adoptedDir === undefined ? "starter" : "adopted";
  const seed = created ? fresh : "resumed";
  const controller = new BuilderCampaignController(input, deps, memory);
  const feedback = new BuilderAuthorFeedback();
  const authoringTools = controller.authoringTools(feedback);
  // One writer for checkpoints and the settled record, so a host kill between two writes leaves
  // the last checkpoint standing as evidence instead of a half-written pair.
  const writeExecution = builderExecutionEvidenceWriter(input.campaignDir);
  let outcome: Awaited<ReturnType<typeof runBuilderSession>>;
  try {
    outcome = await runBuilderSession(
      {
        slug: input.slug,
        kickoff: input.kickoff,
        workspace: controller.workspace,
        seed,
        advisory: controller.openingContext(),
        freshContext: controller.freshContext(),
        ...keyIfDefined("maxTurns", input.maxTurns),
        ...keyIfDefined("webSearch", input.webSearch),
      },
      {
        open: deps.open,
        ...keyIfDefined("recordSession", deps.recordSession),
        ...keyIfDefined("conversation", deps.conversation),
        // The review beside the session: its advice at a completed call, its join at submit. A
        // settled round runs neither, because the session stops calling both once submit has
        // accepted or finally refused. An adopted product is reviewed after measurement instead.
        ...keyIfDefined("afterTool", controller.reviews?.afterTool),
        ...keyIfDefined("beforeSubmit", controller.reviews?.join),
        tools: [...deps.tools, ...authoringTools],
        ...keyIfDefined("turnTimeoutMs", deps.turnTimeoutMs),
        ...keyIfDefined("observer", deps.observer),
        submit: (request) => controller.submit(request),
        feedback,
        onExecution: writeExecution,
        // The execution record survives a host kill at this boundary; the authoring tree does not.
        // A run that dies between gates leaves an epoch holding only its seed commit, so hours of
        // authored bytes exist in no history and no cycle series can read them. The salvage commit
        // `beginIteration` makes here is the same one the next iteration would have made, it
        // returns null on a clean tree, and `attributableChange` already spans the round base, so a
        // gate's changed paths and its unchanged reading are untouched.
        onCheckpoint: (evidence) => {
          writeExecution(evidence);
          beginIteration(controller.workspace, "checkpoint");
        },
        ...keyIfDefined("attemptGate", attemptGate),
        ...keyIfDefined("providerBudget", deps.providerBudget),
        ...keyIfDefined("waitMs", deps.waitMs),
      },
    );
  } catch (error) {
    if (error instanceof BuildAgentTurnNonResult) controller.recordNonResult(error);
    throw error;
  } finally {
    await controller.reviews?.join();
  }
  const admitted = controller.accepted;
  if (admitted !== null && outcome.ok) {
    return {
      buildAdmissible: true,
      ordinal: admitted.ordinal,
      iterationDir: admitted.iterationDir,
      acceptedSnapshot: admitted.snapshotDir,
      ...keyIfDefined("experimentScope", admitted.experimentScope),
      harness: admitted.harness,
      iterations: controller.iterations,
    };
  }
  const exhausted = deps.budget?.status() === "budget_limited";
  return {
    buildAdmissible: false,
    clause:
      outcome.terminalClause ??
      controller.terminalClause ??
      (exhausted ? "budget-limited" : "iterations-exhausted"),
    iterations: controller.iterations,
  };
}
