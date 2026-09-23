/** The build step of one round: refuse a fixed-policy boundary, reuse the adopted tree, or open
 *  one Builder session and settle what it produced. */
import { join } from "../meta/path.ts";
import { FROZEN_MANIFEST_PATH } from "../critic/manifest.ts";
import { unchangedCandidateCommit } from "../author/campaign-memory.ts";
import type { AdmissionLineage, DiagnosisInput, PriorEvidence } from "../author/campaign-types.ts";
import { POLICY } from "../critic/policy.ts";
import type { HarnessExperiment } from "../critic/types.ts";
import { type RunObserver, campaignProgressOptions } from "../observe/run-observer.ts";
import { candidateExperimentAuthoring, type ExperimentAuthoring } from "./experiment-freeze.ts";
import { readLatestRebuildAdvice, renderRebuildAdvice } from "../author/rebuild-advice.ts";
import {
  type AdmittedClimbRow,
  type ClimbBatteriesRead,
  climbThresholds,
  priorPublicFingerprints,
  readClimbBatteries,
} from "./climb-history.ts";
import { readReadoutHistory, renderProbeSizing, renderReadout } from "./climb-readout.ts";
import { fingerprintSlug } from "../claim/fingerprint.ts";
import { recordedVerifierEnvironmentHash } from "../claim/conformance-evidence.ts";
import { harnessBundleIdentity } from "./climb-battery-admission.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { hashJsonBytes } from "../meta/json-runtime.ts";
import { selectedProductDir } from "./product-versions.ts";
import { type ProbeLanding, adoptedTaskCount, batterySizingGate } from "./battery-sizing.ts";
import { claimsDirFor } from "./claim-write.ts";
import { fixedProductBoundary } from "./fixed-product-policy.ts";
import type { FullRunDeps, FullRunOutcome } from "./full-run.ts";
import type { HarnessBuildOptions } from "./harness-build.ts";
import type { IterationInput } from "./full-run-round.ts";
import { type NextMove, epochPassOf } from "./next-move.ts";
import type { RecordedDifficultyDecision } from "./difficulty-decision.ts";
import { keyIfDefined, keyIfNotNull, keysIf } from "../meta/optional-key.ts";
import { safeguardJudgeAdviceThenEvaluatorRepair } from "../analyse/judge-safeguards.ts";
import { errorMessage } from "../meta/runtime-values.ts";

type BuildStepResult = {
  build: FullRunOutcome["build"];
  clauses: string[];
  /** Which experiment the session ran under; null when no session opened. */
  experiment: HarnessExperiment | null;
  experimentAuthoring?: ExperimentAuthoring;
};

type BuildOutcome = Awaited<ReturnType<FullRunDeps["build"]>>;

/** What the round already knows when it reaches the build: the kickoff text, the evidence the
 *  last round left, the lineage the admission carried and the recorded climb readout. */
type BuildStepContext = {
  readonly kickoff: string;
  readonly prior: PriorEvidence | null;
  readonly lineage: AdmissionLineage | null;
  readonly difficulty: RecordedDifficultyDecision | null;
};

/** The three outcomes settled before any Builder session: a fixed-policy refusal, a reused
 *  adopted tree, or a controller stop. Null means the round opens a session. */
function buildBeforeSession(input: IterationInput, decision: NextMove): BuildStepResult | null {
  const { observer } = input;
  const { move } = decision;
  const fixedBoundary = fixedProductBoundary(input.args.productPolicy, move);
  if (fixedBoundary !== null) {
    observer.phase({ phase: "build", state: "failed", summary: fixedBoundary });
    return { build: "stopped", clauses: [fixedBoundary], experiment: null };
  }
  if (move === "measure") {
    observer.phase({ phase: "build", state: "completed", summary: "Current adopted harness reused" });
    observer.phase({ phase: "adopt", state: "completed", summary: "Current domain tree already adopted" });
    return { build: "reused", clauses: [], experiment: null, ...remeasuredAuthoring(input) };
  }
  if (move === "stop") {
    observer.phase({
      phase: "build",
      state: "failed",
      summary: `Controller stopped before build: ${decision.reason}`,
    });
    return { build: "stopped", clauses: [decision.reason], experiment: null };
  }
  return null;
}

/** Whether a recorded battery measured the adopted tree itself: its harness and its task set, or
 *  null when the tree does not fingerprint. Each caller states what an unbindable product means to
 *  it: sizing has no landing to attribute, remeasurement would lose a declaration. */
function adoptedProductRow(domainDir: string): ((row: AdmittedClimbRow) => boolean) | null {
  const fingerprint = fingerprintSlug(domainDir);
  if (!fingerprint.ok) return null;
  const harnessId = harnessBundleIdentity(fingerprint, recordedVerifierEnvironmentHash(domainDir));
  return (row) =>
    harnessId !== null &&
    row.harnessId === harnessId &&
    row.authoring.taskSetHash === fingerprint.taskSetHash;
}

/** The whole scored result of the adopted product's latest admitted battery, the sizing reads. A
 *  product that does not fingerprint has no landing this round may attribute to it, which sizes the
 *  round at the requested count: the conservative direction, since a size only ever buys a saving. */
function adoptedProbeLanding(read: ClimbBatteriesRead, domainDir: string): ProbeLanding | null {
  const matches = adoptedProductRow(domainDir);
  if (matches === null) return null;
  const latest = read.admitted.findLast(matches);
  return latest === undefined ? null : { passes: latest.battery.passed, n: latest.battery.n };
}

/** Remeasurement keeps the declaration of which tasks changed, so their result remains separate
 * from unchanged tasks. A round that loses the declaration records one count over the whole
 * battery, and the changed subset's own result is gone. Recover only byte-matched public authoring
 * metadata; no score or verdict is carried forward. */
function remeasuredAuthoring(input: IterationInput): Pick<BuildStepResult, "experimentAuthoring"> {
  const { repoRoot, manifest } = input;
  const domainDir = selectedProductDir(repoRoot, manifest.slug);
  const rows = readClimbBatteries(
    domainDir,
    input.runPin,
    claimsDirFor(repoRoot, manifest.slug),
    join(repoRoot, FROZEN_MANIFEST_PATH),
  ).history.filter((row) => row.authoring.experimentAuthoring !== undefined);
  if (rows.length === 0) return {};
  const bound = adoptedProductRow(domainDir);
  if (bound === null) {
    throw new Error("remeasurement cannot bind the adopted task authoring to its fingerprint");
  }
  const matches = rows.filter(bound);
  const declarations = new Map(
    matches.map(
      (row) => [hashJsonValue(row.authoring.experimentAuthoring), row.authoring.experimentAuthoring] as const,
    ),
  );
  if (declarations.size > 1) {
    throw new Error("remeasurement has conflicting authored experiments for one fixed task set");
  }
  return keyIfDefined("experimentAuthoring", declarations.values().next().value);
}

/** The refusal alone leaves the campaign free to open another session on the same tree, so the
 *  same clause repeats against one commit invocation after invocation with nothing counting them.
 *  `unchangedCandidateSubmissions` is the durable per-commit tally counting this record, so
 *  reaching the ceiling adds the exact `authoring-stalled` literal the terminal reads, beside a
 *  clause naming the commit and the count. */
function unchangedCandidateClauses(outcome: BuildOutcome, unchangedCommit: string): string[] {
  const records = outcome.buildAdmissible ? outcome.unchangedCandidateSubmissions : 0;
  if (records < POLICY.loop.unchangedCandidateStrikes) return ["candidate-unchanged"];
  return [
    "authoring-stalled",
    `candidate-unchanged: workspace commit ${unchangedCommit.slice(0, 9)} was recorded unchanged ${records} time(s), at the declared ceiling of ${POLICY.loop.unchangedCandidateStrikes}`,
  ];
}

/** Settle what one Builder session produced: an unchanged candidate is refused with its tally, a
 *  failed build reaches the progress stream with its typed clause, and an admissible one is
 *  adopted or becomes the round's candidate. */
function settleBuildOutcome(
  move: NextMove["move"],
  outcome: BuildOutcome,
  requestedExperiment: HarnessExperiment,
  observer: IterationInput["observer"],
): BuildStepResult {
  const experiment =
    outcome.buildAdmissible && outcome.experimentScope !== undefined
      ? outcome.experimentScope.actual
      : requestedExperiment;
  const buildAdmissible = outcome.buildAdmissible && outcome.adopted;
  const outcomeClauses = outcome.buildAdmissible ? [] : outcome.clauses;
  const iteration = outcome.iterations.at(-1);
  // The commit of a candidate unchanged from the start of its round, through the same predicate
  // as the campaign's recorded count, so the refusal and the count cannot disagree about what
  // "unchanged" means. A fresh build has no round entry to be unchanged against.
  const unchangedCommit =
    move !== "rebuild" || iteration === undefined ? null : unchangedCandidateCommit(iteration);
  if (buildAdmissible && unchangedCommit !== null) {
    const clauses = unchangedCandidateClauses(outcome, unchangedCommit);
    observeBuildFailed(observer, move, clauses);
    return { build: "build-failed", clauses, experiment };
  }
  if (buildAdmissible) {
    // A span only a failure closes reads backwards: a run whose builds all succeed opens a build
    // span every round and closes none, so the stream shows a closed build step exactly when the
    // build has failed. The `adopt` row has the same shape: saying only "already adopted" leaves a
    // reader tallying adoptions counting the rounds that adopted nothing.
    observer.phase({ phase: "build", state: "completed", summary: `Build step completed (${move})` });
    if (move === "build") {
      observer.phase({ phase: "adopt", state: "completed", summary: "Built harness adopted" });
    }
  } else observeBuildFailed(observer, move, outcomeClauses);
  const admitted = move === "build" ? "adopted" : "candidate";
  return {
    build: buildAdmissible ? admitted : "build-failed",
    clauses: [...outcomeClauses],
    experiment,
  };
}

/** The model-visible memories an authoring session may read, assembled over one battery read.
 *
 *  A session reads the recorded climb readout — the one the round's decision was taken on, so the
 *  author reads what was recorded — whenever one exists, and a rebuild also reads the issue
 *  register's advice. A first build with nothing measured behind it reads neither: its reason
 *  states no measurement. The advice packet is families, kinds and counts by construction
 *  (rebuild-advice.ts), so nothing protected crosses. The same read supplies the admitted-history
 *  prints the repeat refusal compares a task-only experiment with and the sizing landing. The
 *  history pages read every recorded model pin and threshold manifest with its condition labels:
 *  another condition enters no placement or allowance, and its public tasks stay readable. */
function composeAuthoringMemory(
  input: IterationInput,
  decision: NextMove,
  domainDir: string,
  recorded: RecordedDifficultyDecision | null,
) {
  const { repoRoot, manifest } = input;
  const manifestPath = join(repoRoot, FROZEN_MANIFEST_PATH);
  const claimsDir = claimsDirFor(repoRoot, manifest.slug);
  const read = readClimbBatteries(domainDir, input.runPin, claimsDir, manifestPath);
  const rebuild = decision.move === "rebuild";
  const readout = recorded?.evidence.difficulty ?? null;
  const advice = rebuild ? readLatestRebuildAdvice(repoRoot, manifest.slug) : null;
  const advisoryNote = [
    rebuild || readout !== null ? renderReadout(readout, decision.reason) : null,
    advice === null ? null : renderRebuildAdvice(advice),
  ]
    .filter((part) => part !== null)
    .join("\n\n");
  const readHistory =
    readout === null
      ? undefined
      : (runId?: string, taskId?: string, offset?: number, limit?: number) =>
          readReadoutHistory(domainDir, readout, readClimbBatteries(domainDir, null, claimsDir).history, {
            runId,
            taskId,
            offset,
            limit,
          });
  return {
    read,
    advice,
    advisoryNote,
    readHistory,
    band: climbThresholds(manifestPath).band,
    priorPublicTaskFingerprints: rebuild ? priorPublicFingerprints(domainDir, read.admitted) : [],
  };
}

/** The reopening pass the build step binds its epoch on, with the starter reset when the redesign starts fresh. */
function epochBindingKeys(decision: NextMove): Pick<HarnessBuildOptions, "epochPass" | "rebuildReset"> {
  const epochPass = epochPassOf(decision);
  if (epochPass === undefined) return {};
  return { epochPass, ...keysIf(decision.seed === "starter", () => ({ rebuildReset: epochPass })) };
}

export async function runBuildStep(
  input: IterationInput,
  decision: NextMove,
  context: BuildStepContext,
): Promise<BuildStepResult> {
  const { kickoff, prior, lineage, difficulty } = context;
  const early = buildBeforeSession(input, decision);
  if (early !== null) return early;
  const { args, repoRoot, manifest, userContext, deps, observer } = input;
  const { move } = decision;
  const domainDir = selectedProductDir(repoRoot, manifest.slug);
  const memory = composeAuthoringMemory(input, decision, domainDir, difficulty);
  const { priorPublicTaskFingerprints, advice, band } = memory;
  const tasks = batterySizingGate(
    manifest.expectedTasks,
    adoptedTaskCount(domainDir),
    () => adoptedProbeLanding(memory.read, domainDir),
    band,
  );
  const advisory = [memory.advisoryNote, renderProbeSizing(tasks, manifest.expectedTasks) ?? ""]
    .filter((part) => part !== "")
    .join("\n\n");
  const buildPhase = observer.phase({
    phase: "build",
    state: "started",
    summary: `Build step started (${move})`,
  });
  // The evidence the authoring session was handed, bound by digest into its iteration record: the
  // rebuild-advice packet for a rebuild that read one.
  const diagnosis: DiagnosisInput | undefined =
    // The digest binds the diagnosis input, so the packet the author read is auditable from
    // `iteration.json` rather than inferred from the prompt.
    move === "rebuild" && advice !== null
      ? { kind: "rebuild-advice", digest: hashJsonBytes(advice) }
      : undefined;
  const outcome = await deps
    .build(
      {
        ...manifest,
        expectedTasks: tasks.max,
        ...keysIf(tasks.min !== tasks.max, () => ({ minTasks: tasks.min })),
      },
      {
        repoRoot,
        resolvedSlots: input.slots,
        kickoff,
        ...keysIf(advisory !== "", () => ({ advisoryNote: advisory })),
        userContext,
        ...campaignProgressOptions(manifest.slug),
        ...keyIfNotNull("priorEvidence", prior),
        ...keyIfNotNull("admissionLineage", lineage),
        ...keyIfDefined("diagnosisInput", diagnosis),
        ...keyIfDefined("turnBudget", args.turnBudget),
        ...keyIfDefined("providerBudget", input.providerBudget),
        ...keyIfDefined("verifierLifetime", input.verifierLifetime),
        ...keyIfDefined("builderConversation", input.builderConversation),
        ...keyIfDefined("maxBuilderTurns", args.maxBuilderTurns),
        ...keyIfDefined("safeguardContext", input.safeguardContext),
        experiment: "build",
        productVersionId: input.runId,
        band,
        priorPublicTaskFingerprints,
        ...keyIfDefined("readHistory", memory.readHistory),
        // Reopen on the exact evidence identity. Repair starts from adopted bytes; a deliberate
        // redesign resets to the starter. Reusing this epoch preserves in-flight edits on resume.
        ...epochBindingKeys(decision),
        observer: observer.child(buildPhase),
      },
    )
    .catch((cause: unknown) => {
      observeBuildFailed(observer, move, [`build-threw: ${errorMessage(cause)}`]);
      throw cause;
    });
  const result = settleBuildOutcome(move, outcome, "build", observer);
  safeguardJudgeAdviceThenEvaluatorRepair(
    move,
    advice,
    result.build === "build-failed" ? null : result.experiment,
    input.safeguardContext,
  );
  if (
    outcome.buildAdmissible &&
    outcome.experimentProposal !== undefined &&
    outcome.experimentScope?.operation !== undefined &&
    result.experiment !== null
  ) {
    result.experimentAuthoring = candidateExperimentAuthoring(
      outcome.experimentProposal,
      outcome.experimentScope.operation,
      result.experiment,
      domainDir,
      outcome.acceptedSnapshot,
    );
  }
  return result;
}

/** A failed build step must reach the progress stream with its typed clause. Without this row a
 *  pre-session refusal ends the stream at "Build step started (<move>)", because the campaign
 *  rethrows a `BuildAgentTurnNonResult` before any row is written. */
function observeBuildFailed(observer: RunObserver, move: string, clauses: readonly string[]): void {
  const detail = clauses.length > 0 ? clauses.join("; ") : "no clause recorded";
  observer.phase({ phase: "build", state: "failed", summary: `Build step failed (${move}): ${detail}` });
}
