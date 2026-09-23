/** Fresh, repair and battery-only authoring through one persistent Builder and submit path. */
import type { VerifierLifetime } from "../verify/verifier-lifetime.ts";
import { cpSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import type { AgentToolsProbes } from "../author/agent-tools-session.ts";
import { BuildAgentTurnNonResult } from "../author/build-agent.ts";
import { ensureBundleSnapshot } from "../claim/bundle-snapshot.ts";
import { writeAuthoringAttemptEvidence } from "../author/build-attempt-evidence.ts";
import { builderExecutionEvidenceWriter } from "../author/builder-execution-writer.ts";
import { WORKSPACE_DIR } from "../author/builder-memory.ts";
import type { ExperimentSubmission } from "../author/experiment-proposal.ts";
import { iterationMemoryFindings } from "../author/iteration-memory.ts";
import { advisory } from "../author/feedback-routing.ts";
import {
  type BuilderSessionDeps,
  type BuilderSubmitOutcome,
  type WorkspaceSeed,
  runBuilderSession,
} from "../author/builder-session.ts";
import { writeCompleted } from "../author/campaign-epoch.ts";
import {
  extendTrailingBlockedFindings,
  nextOrdinal,
  resumeCampaignMemory,
  unchangedCandidateSubmissions,
} from "../author/campaign-memory.ts";
import { safeguardRepeatedRefusalCode } from "../truth/run-safeguards.ts";
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
import {
  campaignAttemptGate,
  type CampaignBudgetGate,
  type ModelAttemptGate,
  type SavedCampaignBudgetGate,
} from "./campaign-budget.ts";
import { toolNonResultFinding } from "../author/tool-non-result.ts";
import { AuthoringReviewClock, REVIEW_INTERVAL_MS } from "../gate/review-clock.ts";
import { CandidateMemory } from "../gate/candidate-memory.ts";
import { gateTerminalClause, settleGateRun } from "../gate/settlement.ts";
import { BuilderAuthorFeedback, gateFeedbackFindings } from "../builder/author-feedback.ts";
import { createHarnessInspectTool, type HarnessInspectBinding } from "../builder/harness-inspect.ts";
import { createHarnessResetTool } from "../builder/harness-reset.ts";
import { createHarnessTrialTool } from "../builder/harness-trial.ts";
import { createCorrectnessCheckTool } from "../gate/check-tool.ts";
import { type AdmissionInput, admissionFindings } from "../gate/experiment-admission.ts";
import {
  type Gate,
  type GateReport,
  type GateRun,
  type PipelineInput,
  clearPreview,
  freshRunDir,
  memorable,
  previewCandidate,
  submitStages,
} from "../gate/validation-pipeline.ts";
import type { HarnessAuthoring } from "../critic/types.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import type { RunObserver } from "../observe/run-observer.ts";
import { SOURCE_IDENTITY } from "./source-identity.ts";
import { decorateIterationEvidence, stampSubmissionCondition } from "./campaign-evidence.ts";
import { keyIfDefined, keysIf } from "../meta/optional-key.ts";
import {
  builderSessionRequest,
  preSessionRefusal,
  proposesExperiment,
} from "./builder-campaign-preflight.ts";
import type { ProviderResourceBudget } from "./provider-resource-budget.ts";
import type { Solver } from "../truth/solve.ts";
import { readableFingerprint, type ExperimentScope } from "./experiment-freeze.ts";

export interface BuilderCampaignInput extends Pick<AdmissionInput, "priorPublicTaskFingerprints"> {
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
  /** The run's pass-rate band, quoted by the difficulty sentences; absent, the policy row applies. */
  band?: [number, number];
  /** The controller's starting condition; accepted bytes determine the realised scope. */
  experiment?: HarnessAuthoring;
  /** The immutable baseline for model-proposed continuation and scope attribution. */
  adoptedDir?: string;
  priorEvidence?: PriorEvidence;
  admissionLineage?: AdmissionLineage;
  diagnosisInput?: DiagnosisInput;
  advisoryNote?: string;
  readHistory?: HarnessInspectBinding["readHistory"];
  maxTurns?: number;
  /** Present when a reopen lets harness_reset return a surface to the starter seed. The value keys
   *  idempotence: a resumed rebuild finds its own key in workspace history and keeps its work. */
  rebuildReset?: string;
}

export interface BuilderCampaignDeps {
  /** The Epoch Reviewer: `repair` reads a validated snapshot, `backstop` the live workspace. Returns
   *  the public advice the Builder reads. */
  reviewAuthoring?(root: string, trigger: "repair" | "backstop"): Promise<string>;
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
  /** Per-model-call gate. */
  attemptGate?: ModelAttemptGate;
  providerBudget?: ProviderResourceBudget;
  observer?: RunObserver;
  onIteration?: (evidence: IterationEvidence) => void;
  safeguardContext?: SafeguardContext;
  waitMs?: (ms: number) => Promise<void>; // test interface for the turn-retry backoff
}

export type CampaignMemory = ReturnType<typeof resumeCampaignMemory>;

type Refused = Extract<BuilderSubmitOutcome, { ok: false }>;
type Accepted = {
  experimentProposal?: ExperimentSubmission;
  experimentScope?: ExperimentScope;
  harness: BuiltHarness;
  iterationDir: string;
  ordinal: number;
  snapshotDir: string;
};

type Iteration = { ordinal: number; dir: string; iterationDir: string };

/** One authoring round's submit, preview and review handling over the Builder workspace. */
class BuilderCampaignController {
  /** When this session hears from the Epoch Reviewer, and over which bytes. Elapsed time alone
   *  only makes a review due at the next completed host tool call, never inside one, and the clock
   *  restarts when a review finishes. */
  private readonly reviewClock: AuthoringReviewClock;
  readonly workspace: string;
  readonly iterations: IterationEvidence[] = [];
  accepted: Accepted | null = null;
  experimentProposal: ExperimentSubmission | undefined;
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
  }

  /** Measured feedback and iteration history advise the author without choosing its repair scope. */
  openingAdvisory(): string | undefined {
    const feedback = [...this.memory.carried, ...(this.input.priorEvidence?.feedback ?? [])];
    const history = iterationMemoryFindings(this.input.campaignDir)
      .map((finding) => finding.detail)
      .join("\n");
    return [history, this.input.advisoryNote, advisory(feedback)].filter(Boolean).join("\n\n") || undefined;
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
      sessions: [],
      source: SOURCE_IDENTITY,
    });
    this.lastRecordedTurn = error.turns;
  }

  async submit({ turn }: { turn: number }): Promise<BuilderSubmitOutcome> {
    this.experimentProposal = undefined;
    this.submittedTree = undefined;
    const outcome = await this.checkSubmission(turn);
    return {
      ...outcome,
      ...keyIfDefined("experimentProposal", this.experimentProposal),
      ...keyIfDefined("treeId", this.submittedTree),
    };
  }

  private async checkSubmission(turn: number): Promise<BuilderSubmitOutcome> {
    if (this.deps.budget?.status() === "budget_limited") {
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
    this.experimentProposal = candidate.experimentProposal;
    // A repaired executable is a new submission condition even when the candidate files did not
    // change, so a valid candidate is keyed by its submission condition and a malformed one by its
    // committed contract-root tree. One identity, resolved once: the candidate memory keys its
    // remembered refusals and its no-op strikes on it, and the execution record compares
    // submissions on the same value, so none of the three can disagree about what "the same
    // candidate" means.
    const tree = candidateTreeIdentity(this.workspace, candidate.commit);
    this.submittedTree = tree;
    const candidateId = candidate.ok ? conditionKey(candidate) : tree;
    // Bundle findings, a missing installed tool among them, are ordinary repairable defects: the
    // refusal keeps the session, and it is the byte-identical resubmit that strikes.
    if (!candidate.ok) {
      return this.strike(candidateId, {
        ...candidate,
        findings: [...candidate.findings, ...(candidate.proposalFindings ?? [])],
      });
    }
    // Admission reads EXPERIMENT.json, which the key leaves out, so it is recomputed beside a
    // remembered refusal (A → B → A) rather than remembered with it.
    const cached = this.candidates.refusalFor(candidateId);
    if (cached !== undefined) {
      const admission = admissionFindings(candidate, this.pipelineInput());
      if (admission.length > 0 || cached.findings.length > 0) {
        return this.strike(
          candidateId,
          admission.length === 0
            ? { ...cached, commit: candidate.commit }
            : {
                ...cached,
                commit: candidate.commit,
                stage: "gates",
                findings: [...admission, ...cached.findings],
              },
        );
      }
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
   * run reports, but only a candidate clean through admission and conformance writes an iteration,
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
    const retryable = !memorable(report);
    const opened =
      /* SAFETY: assigned inside runDir; the control-flow narrowing of a closure write is lost. */ iteration as Iteration | null;
    // A clean candidate whose gate run another call executed opens its iteration here.
    const settling =
      opened ?? (report.refusals.every((refusal) => refusal.stage === "gates") ? this.openIteration() : null);
    const { outcome, executed } =
      settling !== null && report.harness !== null && report.gated !== null
        ? await this.settle(candidate, report.harness, report.gated, settling, turn)
        : this.unsettled(candidate, report);
    // Safeguard 33: the preview promises parity with submit on unchanged bytes, so a clear check
    // followed by a refused submit of the same snapshot says the two paths diverged, and nothing
    // else records the pair. Admission is left out because it reads EXPERIMENT.json, which the
    // preview judged separately and may have seen change since.
    if (clear !== undefined && !outcome.ok && executed.findings.length > 0) {
      safeguardTriggered(
        "33-preview-clear-submit-refused",
        `candidate ${candidate.snapshotId.slice(0, 12)}: correctness_check was clear under condition ${clear.conditionDigest ?? "null"}, submit refused at stage ${outcome.stage} with ${outcome.findings.map((finding) => finding.code).join(", ")}`,
        this.deps.safeguardContext,
      );
    }
    if (outcome.ok) return { outcome, retryable };
    safeguardRepeatedRefusalCode(outcome, this.deps.safeguardContext);
    this.candidates.remember(key, executed, retryable ? "retryable" : "verdict");
    return { outcome, retryable };
  }

  private openIteration(): Iteration {
    const ordinal = nextOrdinal(this.input.campaignDir);
    const dir = `${String(ordinal).padStart(2, "0")}-${this.input.slug}`;
    return { ordinal, dir, iterationDir: join(this.input.campaignDir, dir) };
  }

  /** The disk-replayed trailing run of blocked findings hashes, extended by this session's own
   *  settled iterations under the one shared rule, so a session that resumes a campaign continues
   *  the same streak rather than starting a fresh one. */
  private trailingBlockedFindingsHashes(): string[] {
    return this.iterations.reduce(extendTrailingBlockedFindings, this.memory.trailingBlockedFindingsHashes);
  }

  candidateCheckContext() {
    return {
      slug: this.input.slug,
      exactTasks: this.input.expectedTasks,
      ...keyIfDefined("minTasks", this.input.minTasks),
      ...keysIf(proposesExperiment(this.input), () => ({ experimentProposalRequired: true })),
    };
  }

  private pipelineInput(): PipelineInput {
    return {
      toolsProbes: this.deps.toolsProbes,
      ...keyIfDefined("feedback", this.input.priorEvidence?.feedback),
      ...keyIfDefined("priorPublicTaskFingerprints", this.input.priorPublicTaskFingerprints),
      ...keyIfDefined("experiment", this.input.experiment),
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
   *  remembered per candidate-and-tool condition and the attempt slot is reserved before any stage
   *  runs, so blocked and non-result outcomes spend it too and unchanged bytes never buy the
   *  validation sequence twice. Changed bytes may preview without limit (operator decision): under
   *  a ceiling, a build that reaches it spends the rest of the session submitting unchecked. */
  async preview(gates: Gate): Promise<GateReport> {
    const report = await previewCandidate(this.workspace, this.candidateCheckContext(), {
      input: this.pipelineInput(),
      gates,
      trialsDir: join(this.input.campaignDir, "trials"),
      memory: this.candidates.validation,
    });
    if (
      report.harness !== null &&
      report.gated !== null &&
      report.blocked === null &&
      report.refusals.length === 0
    ) {
      this.reviewClock.validatedProduct(report.harness.fingerprint);
    }
    return report;
  }

  /** At a quiescent tool checkpoint, reviews a validated repair on its own immutable snapshot, or
   *  the live draft when the backstop clock is what made the review due. An adopted product is
   *  reviewed after measurement instead, where there is a battery to read it against. */
  async reviewIfDue(): Promise<string | null> {
    if (this.deps.reviewAuthoring === undefined || this.terminalClause !== null) return null;
    const due = this.reviewClock.due();
    if (due === null) return null;
    const root =
      due.kind === "repair" ? ensureBundleSnapshot(this.workspace, due.fingerprint).dir : this.workspace;
    try {
      const advice = await this.deps.reviewAuthoring(root, due.kind);
      if (due.kind === "repair") this.reviewClock.read(due.fingerprint);
      return advice;
    } finally {
      this.reviewClock.restart();
    }
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
      priorBlockedFindingsHashes: this.trailingBlockedFindingsHashes(),
    });
    // Charged before the copy, so the iteration's copy carries the run's charge marker and a
    // replay counts the run once rather than again.
    const toolStrike =
      step.kind === "build-admissible" ? { terminal: false, findings: [] } : this.chargeToolNonResult(run);
    if (run.trialDir !== iterationDir) cpSync(run.trialDir, iterationDir, { recursive: true });
    const evidence = decorateIterationEvidence(step.evidence, {
      first: this.iterations.length === 0,
      hasResumedCarry: this.memory.carried.length > 0,
      repairOwner: null,
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
      stage: evidence.stage,
      focusOwner: evidence.focusOwner,
      findingsHash: evidence.findingsHash,
    });
    this.iterations.push(evidence);
    if (step.kind === "build-admissible") {
      this.accepted = {
        ...keyIfDefined("experimentProposal", candidate.experimentProposal),
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
      findings: [
        ...gated,
        ...(step.kind === "continue" && step.steering !== undefined ? [step.steering] : []),
        ...toolStrike.findings,
      ],
      ...keysIf(step.kind === "terminal" || toolStrike.terminal, () => ({ terminal: true })),
    };
    // Only the rows the bytes earned are remembered; steering and strike counts belong to this call.
    return { outcome: refused, executed: { ...refused, findings: gated } };
  }

  /** One strike per executed gate run whose host reached no completed tool run. At the declared
   *  ceiling the campaign settles as the `verifier-required` terminal, rather than opening another
   *  authoring round against the same failing tool. */
  private chargeToolNonResult(run: GateRun) {
    const strike = this.candidates.chargeToolNonResult(run.trialDir);
    if (strike?.terminal === true) this.terminalClause = "verifier-required";
    return {
      terminal: strike?.terminal === true,
      findings: strike === null ? [] : [toolNonResultFinding(strike)],
    };
  }

  /** A candidate refused before settlement writes no iteration, but a gate run it executed still
   *  ends the session on an unroutable blocking row and charges its tool non-result. */
  private unsettled(candidate: CandidateSnapshot, report: GateReport) {
    const refused = unsettledRefusal(candidate, report);
    if (report.gated === null) return refused;
    const clause = gateTerminalClause(report.gated.feedback);
    if (clause !== null) this.terminalClause = clause;
    const toolStrike = this.chargeToolNonResult(report.gated);
    if (clause === null && !toolStrike.terminal && toolStrike.findings.length === 0) return refused;
    const outcome: Refused = {
      ...refused.outcome,
      findings: [...refused.outcome.findings, ...toolStrike.findings],
      ...keysIf(clause !== null || toolStrike.terminal, () => ({ terminal: true })),
    };
    return { outcome, executed: refused.executed };
  }
}

/** Where a refusal is recorded: an admission refusal is a gate rule and a conformance refusal a
 *  bundle one, as submit's candidate evidence has always named them. */
function evidenceStage(admission: readonly unknown[], conformance: readonly unknown[]): Refused["stage"] {
  return admission.length === 0 && conformance.length > 0 ? "bundle" : "gates";
}

/** A candidate refused before settlement: every executed stage's findings, no iteration. The
 *  executed part is what a later call on the same condition may reuse. */
function unsettledRefusal(candidate: CandidateSnapshot, report: GateReport) {
  const rows = (stage: string) => report.refusals.find((refusal) => refusal.stage === stage)?.findings ?? [];
  const [admission, conformance, gated] = [rows("validation"), rows("conformance"), rows("gates")];
  const executed: Refused = {
    ok: false,
    stage: evidenceStage([], conformance),
    commit: candidate.commit,
    findings: [...conformance, ...gated],
  };
  const outcome: Refused = {
    ...executed,
    stage: evidenceStage(admission, conformance),
    findings: [...admission, ...executed.findings],
  };
  return { outcome, executed };
}

/** The advisory tools the session mounts beside submit: static inspection, one bounded solve-side
 *  rehearsal, the reopen reset and the pre-adoption validation preview. None of them is an
 *  acceptance authority, and all four run under submit's own candidate-check context: the same
 *  slug, task count and fresh-candidate contract, because a check made under different rules would
 *  advise the wrong repair. */
function mountAuthoringTools(
  input: BuilderCampaignInput,
  deps: BuilderCampaignDeps,
  controller: BuilderCampaignController,
  feedback: BuilderAuthorFeedback,
) {
  const toolContext = controller.candidateCheckContext();
  const inspect = createHarnessInspectTool({
    workspace: controller.workspace,
    context: toolContext,
    feedback,
    ...keyIfDefined("readHistory", input.readHistory),
  });
  const { builtSolver } = deps;
  const trial = createHarnessTrialTool({
    workspace: controller.workspace,
    context: toolContext,
    rehearsalDir: join(input.campaignDir, "rehearsals"),
    ...keyIfDefined(
      "builtSolver",
      builtSolver === undefined ? undefined : () => builtSolver(deps.providerBudget),
    ),
    ...keyIfDefined("verifierLifetime", deps.verifierLifetime),
  });
  const reset = createHarnessResetTool({
    workspace: controller.workspace,
    ...keyIfDefined("resetKey", input.rebuildReset),
  });
  // The preview is submit without adoption: the controller's own validation sequence over the
  // same workspace, candidate-check context, probe pack and gate, so the rows the Builder reads
  // here are the rows a submit refusal would carry. A scripted session that mounts no gate has no
  // validation sequence to preview and is given no such tool.
  const { gates } = deps;
  if (gates === undefined) return [inspect, trial, reset];
  const correctnessCheck = createCorrectnessCheckTool({
    preview: () => controller.preview(gates),
    expectedTasks: input.expectedTasks,
    ...keyIfDefined("minTasks", input.minTasks),
    feedback,
  });
  return [inspect, trial, reset, correctnessCheck];
}

/** One attempt gate for the campaign: the durable reservation when the budget provides one, else
 *  the caller's own. Availability is asserted here, before any session or workspace work. */
function withCanonicalAttemptGate(deps: BuilderCampaignDeps): BuilderCampaignDeps {
  const durableBudget = campaignAttemptGate(deps.budget);
  durableBudget?.assertAttemptAvailable();
  const gate = durableBudget ?? deps.attemptGate;
  return gate === deps.attemptGate ? deps : { ...deps, ...keyIfDefined("attemptGate", gate) };
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
  suppliedDeps: BuilderCampaignDeps,
): Promise<CampaignOutcome> {
  const deps = withCanonicalAttemptGate(suppliedDeps);
  const memory = resumeCampaignMemory(input.campaignDir, input.slug, hashJsonValue(input.kickoff));
  const refused = preSessionRefusal(input, memory);
  if (refused !== null) return refused;
  // A spent durable cap is a pre-session terminal, settled before any provider turn: it used to
  // be found only at the first submit, by which point the session had already been paid for.
  if (deps.budget?.status() === "budget_limited") {
    return { buildAdmissible: false, clauses: ["budget-limited"], iterations: [] };
  }
  const workspace = join(input.campaignDir, WORKSPACE_DIR);
  // A repair seeds from the adopted package once and resumes in-flight edits without overwriting them.
  const seedFrom = input.rebuildReset === undefined ? input.adoptedDir : undefined;
  const { created } = initWorkspace(workspace, seedFrom, true, deps.safeguardContext);
  const fresh: WorkspaceSeed = seedFrom === undefined ? "starter" : "adopted";
  const seed = created ? fresh : "resumed";
  const controller = new BuilderCampaignController(input, deps, memory);
  const feedback = new BuilderAuthorFeedback();
  const authoringTools = mountAuthoringTools(input, deps, controller, feedback);
  // One writer for checkpoints and the settled record, so a host kill between two writes leaves
  // the last checkpoint standing as evidence instead of a half-written pair.
  const writeExecution = builderExecutionEvidenceWriter(input.campaignDir);
  let outcome: Awaited<ReturnType<typeof runBuilderSession>>;
  try {
    outcome = await runBuilderSession(
      { ...builderSessionRequest(input, controller.workspace, controller.openingAdvisory()), seed },
      {
        open: deps.open,
        ...keyIfDefined("recordSession", deps.recordSession),
        ...keyIfDefined("conversation", deps.conversation),
        ...keysIf(deps.reviewAuthoring !== undefined, () => ({ afterTool: () => controller.reviewIfDue() })),
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
        ...keyIfDefined("transcriptDir", input.campaignDir),
        ...keyIfDefined("attemptGate", deps.attemptGate),
        ...keyIfDefined("providerBudget", deps.providerBudget),
        ...keyIfDefined("waitMs", deps.waitMs),
      },
    );
  } catch (error) {
    if (error instanceof BuildAgentTurnNonResult) controller.recordNonResult(error);
    throw error;
  }
  const admitted = controller.accepted;
  if (admitted !== null && outcome.ok) {
    return {
      buildAdmissible: true,
      ordinal: admitted.ordinal,
      iterationDir: admitted.iterationDir,
      acceptedSnapshot: admitted.snapshotDir,
      ...keyIfDefined("experimentScope", admitted.experimentScope),
      ...keyIfDefined("experimentProposal", admitted.experimentProposal),
      harness: admitted.harness,
      iterations: controller.iterations,
      unchangedCandidateSubmissions: unchangedCandidateSubmissions(memory, controller.iterations),
    };
  }
  const exhausted = deps.budget?.status() === "budget_limited";
  return {
    buildAdmissible: false,
    ...keyIfDefined("experimentProposal", controller.experimentProposal),
    clauses: [
      outcome.terminalClause ??
        controller.terminalClause ??
        (exhausted ? "budget-limited" : "iterations-exhausted"),
    ],
    iterations: controller.iterations,
  };
}
