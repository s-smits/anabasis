/**
 * `harness_trial`: one authored task, solved blind by the measured Built solver and graded by the
 * existing host verifier.
 *
 * The solver receives only the public task and the tools the Builder wrote; it never sees the
 * hidden expectations, the reference solve or the author's intent. What comes back is one aggregate
 * pass/fail bit over the bytes it submitted, plus how far it got. Failing check ids,
 * counterexamples, the artifact and every verifier diagnostic stay protected, and submit remains
 * the sole admission path.
 *
 * This is the only instrument in the authoring loop that can observe a battery being easier than
 * its stated target, which is why no prompt has to exhort the Builder about difficulty: a round
 * that wants tasks its solver misses can measure one before paying for twenty-five. The solve is
 * the measured solver's own, not a call sequence the Builder supplies, which would be the author
 * playing solver while holding the answer key. A round that rehearses nothing tends to declare a
 * pass count far under what it then measures.
 */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import {
  type CandidateCheckContext,
  fingerprintRefusal,
  loadValidatedBundle,
} from "../author/candidate-check.ts";
import type { BuilderCustomToolSemantic } from "../author/builder-execution.ts";
import { fingerprintSlug } from "../claim/fingerprint.ts";
import { bundleSnapshotIdOf, ensureBundleSnapshot } from "../claim/bundle-snapshot.ts";
import { asRecord, isBoolean, isNumber, isString } from "../meta/json-shape.ts";
import { keyIfDefined, keysIf } from "../meta/optional-key.ts";
import { existsSync, mkdirSync } from "../meta/filesystem.ts";
import { dirname, join } from "../meta/path.ts";
import { compilePublicArtifactSchema } from "../solve/public-artifact-schema.ts";
import { defineTool } from "../solve/define-tool.ts";
import { SUBMIT_MAX_ATTEMPTS } from "../truth/battery-record.ts";
import { commitPublicTask } from "../truth/task-split.ts";
import { builtStarterFactoryForSolver } from "../truth/solve.ts";
import type { Solver } from "../truth/solve.ts";
import { authorFindingOverview } from "./author-feedback.ts";
import { visibleError } from "./read-window.ts";
import type { VerifierLifetime } from "../verify/verifier-lifetime.ts";
import {
  type SolveCaseEvidence,
  type SolvedCase,
  rehearseCase,
  solveCase,
  solverBlockerOf,
} from "../truth/solve-case.ts";
import { writeJsonFile } from "../meta/completed-json.ts";
import type { RehearsalReading, RehearsalRow } from "../author/experiment-plan.ts";
import { harnessSettings } from "../truth/harness-config.ts";
import type { RehearsalTraces } from "./context-tool.ts";
import { effortPhrase, type SolveEffort, solverTraceLines, traceEffort } from "./solver-trace-text.ts";

const Params = Type.Object({
  taskId: Type.String({ minLength: 1, maxLength: 256 }),
});

interface HarnessTrialBinding {
  /** The Builder's candidate workspace. The model cannot name another path. */
  workspace: string;
  /** The same authoring contract static inspection and submit use. */
  context: CandidateCheckContext;
  /** The measured Built solver, under the battery's own runtime, isolation and turn cap. Absent for
   *  a scripted runtime with no Built slot, and the tool then refuses rather than substituting a
   *  different solver, because a rehearsal against another agent measures nothing about the battery
   *  the round is authoring. */
  builtSolver?: () => Solver;
  /** Where each rehearsal's solve evidence is written, one directory per call. Absent in tests. */
  rehearsalDir?: string;
  verifierLifetime?: VerifierLifetime;
  /** This round's passing rehearsals, which the context tool offers as traces. */
  rehearsals?: RehearsalTraces;
  /** Records each rehearsal that reached a solve into the round plan's evidence and returns the
   *  plan's advice after it. The plan reads the aggregate verdict and the solve's effort; the bytes
   *  the solver submitted go to the authoring review alone, and never back to the Builder. */
  onRehearsal?: (row: RehearsalRow, submitted: SubmittedRehearsal) => RehearsalReading;
}

/** What a rehearsal's solver submitted: the accepted artifact's bytes, or null when it accepted
 *  none, with the candidate it was given to solve. */
export interface SubmittedRehearsal {
  ordinal: number;
  artifact: string | null;
  candidateId: string | null;
}

type LoadedTrial = Extract<ReturnType<typeof loadTrialCandidate>, { ok: true }>;

/** One blind grading: the snapshot it grades against, the source tree it was authored in, the
 *  loaded trial, the case the solver produced and the candidate the session had open at the time.
 *  All five travel together because a verdict that cannot name the bytes it graded is not evidence
 *  a later reader can use. */
type BlindGrade = {
  readonly binding: HarnessTrialBinding;
  readonly sourceBinding: HarnessTrialBinding;
  readonly loaded: LoadedTrial;
  readonly solved: SolvedCase;
  readonly openedCandidateId: string | null;
  readonly ordinal: number;
  /** This rehearsal's evidence directory, shared by the solve and the grading. */
  readonly write: ReturnType<typeof rehearsalWriter>;
  /** The harness's solve wall, read from the snapshot the solve ran under. */
  readonly wallMinutes: number;
};

/** Whether the round plan counts a rehearsal's verdict as calibration. */
type Calibration = "counted" | "uncounted";

/** What this round's rehearsals have measured so far. A rehearsal that reached no verdict measures
 *  nothing and stays out of the denominator, which is the same rule a measured battery applies to a
 *  typed non-result. */
interface RoundRehearsals {
  graded: number;
  passed: number;
  /** Passes the solver reached without needing a second turn. A task it solves in one is not near
   *  any limit, and the turn count is the part of that a pass/fail alone cannot say. */
  passedInOneTurn: number;
}

/** The fields of a grading result this boundary reads, and the only ones it can name. `kind` and
 *  `truthOk` are optional because the grading path returns them on the outcomes that have them, and
 *  a result carrying neither is a run that reached neither. Nothing here validates a record at
 *  runtime: `gradeBlind` passes `rehearseCase`'s own return, so the call site is what proves the two
 *  still agree, and a producer that changed shape fails to compile rather than being interpreted. */
interface RehearsalResult {
  status: string;
  kind?: string;
  truthOk?: boolean | null;
}

/**
 * The whole of what a verifier result may tell the author who wrote it. This type is rule 4's
 * boundary rather than a convenience shape: a field not named here cannot cross, however much the
 * grading path grows.
 *
 * How far the execution got and what the checks decided travel separately because they have separate
 * readers. The status chooses the sentence the round gets back; the bit means nothing at all unless
 * the run reached the check program, so a caller that reads one without the other is reading a
 * verdict that was never taken.
 */
interface RehearsalVerdict {
  execution: { status: string; kind?: string };
  truthOk: boolean | null;
}

function candidateId(binding: HarnessTrialBinding): string | null {
  const fingerprint = fingerprintSlug(binding.workspace, { slug: binding.context.slug });
  return fingerprint.ok ? bundleSnapshotIdOf(fingerprint) : null;
}

function loadTrialCandidate(binding: HarnessTrialBinding, taskId: string) {
  const bundle = loadValidatedBundle(binding.workspace, binding.context, "rehearsal");
  const publicArtifactSchema =
    bundle.brief === null || bundle.corpus === null
      ? null
      : compilePublicArtifactSchema(
          bundle.brief.artifactSchema,
          bundle.corpus.accept.map((row) => row.artifact),
        );
  const { findings } = bundle;
  if (
    bundle.brief === null ||
    bundle.battery === null ||
    bundle.corpus === null ||
    bundle.toolsSpec === null ||
    publicArtifactSchema === null
  ) {
    return {
      ok: false as const,
      body: {
        status: "blocked",
        stage: "candidate",
        findings: authorFindingOverview(findings),
        nextAction: "Use harness_inspect readiness, then repair the candidate before trial.",
      },
    };
  }
  const task = bundle.battery.tasks.find((row) => row.taskId === taskId);
  if (task === undefined) {
    return {
      ok: false as const,
      body: {
        status: "blocked",
        stage: "task",
        taskId,
        availableTaskIds: bundle.battery.tasks.slice(0, 20).map((row) => row.taskId),
        totalTasks: bundle.battery.tasks.length,
        nextAction:
          "Use harness_inspect readiness to choose an authored public task; name a family there for all of its task ids.",
      },
    };
  }
  return {
    ok: true as const,
    brief: bundle.brief,
    findings,
    task,
    committed: commitPublicTask(task),
    publicArtifactSchema,
  };
}

/**
 * What of a verifier result may cross to its author, decided here rather than inherited from
 * whatever shape the grading path happens to return.
 *
 * `rehearseCase` computes far more than it returns. The sentence naming the tool and the check that
 * reached no completed run, and the ids of the externally grounded checks that ran no tool, are
 * both composed in `acceptedOutcome` and both dropped on the way out — and a Builder holding a
 * check id holds a piece of its own answer key. Copying the result whole would make that discard,
 * in another module, the only thing standing between those ids and an authoring prompt, which is
 * not where rule 4's boundary belongs. So this reads the two fields permitted to cross and builds a
 * fresh object from them, and a field added upstream arrives nowhere.
 */
export function verifierView(verifier: RehearsalResult): RehearsalVerdict {
  return {
    execution: { status: verifier.status, ...keyIfDefined("kind", verifier.kind) },
    truthOk: verifier.truthOk ?? null,
  };
}

function candidateView(
  openedCandidateId: string | null,
  closedCandidateId: string | null,
  findings: Parameters<typeof authorFindingOverview>[0],
) {
  const stable = openedCandidateId !== null && openedCandidateId === closedCandidateId;
  return {
    candidateId: stable ? openedCandidateId : null,
    stable,
    staticFindings: authorFindingOverview(findings),
  };
}

/** The directory this rehearsal's evidence goes in: its session ordinal, or the next free name
 *  above it. The ordinal counts rehearsals within one session while the directory belongs to the
 *  campaign, so a second authoring session would start at `rehearsal-1` again and write over the first
 *  session's solve — exactly the record each session is asked to keep. Taking the next free name
 *  instead follows `claimEvidencePath`, which answers the same collision for the execution
 *  record. */
function claimRehearsalDir(dir: string, ordinal: number): string {
  let path = join(dir, `rehearsal-${String(ordinal)}`);
  for (let next = ordinal + 1; existsSync(path); next += 1) path = join(dir, `rehearsal-${String(next)}`);
  return path;
}

/** One directory per rehearsal under the campaign, so a solve the Builder paid for stays readable
 *  after the session that bought it has ended. A binding with no directory discards the evidence
 *  and changes nothing else. The name is claimed on the first write of a rehearsal, so every later
 *  file belonging to that one solve joins it rather than starting another. */
function rehearsalWriter(dir: string | undefined, ordinal: number) {
  let claimed: string | undefined;
  return (path: string, value: SolveCaseEvidence): void => {
    if (dir === undefined) return;
    claimed ??= claimRehearsalDir(dir, ordinal);
    const file = join(claimed, path);
    mkdirSync(dirname(file), { recursive: true });
    writeJsonFile(file, value);
  };
}

/** Solves the selected task once, exactly as a measured case solves it: the Built runtime's own
 *  turn cap and solve wall, the generated tools as registered, the controller's submission
 *  authority. Nothing here tells the solver it is rehearsing, because a solver that knew would be
 *  answering a different question from the one the battery will ask. */
async function solveBlind(
  binding: HarnessTrialBinding,
  loaded: LoadedTrial,
  write: ReturnType<typeof rehearsalWriter>,
): Promise<SolvedCase> {
  const solver = binding.builtSolver?.();
  if (solver === undefined) throw new Error("no Built solver is bound to this session");
  const createStarter = builtStarterFactoryForSolver(solver);
  if (createStarter === undefined) throw new Error("the Built solver registered no starter factory");
  return solveCase(
    {
      createStarter: (publicTask, submission, schema) =>
        createStarter(binding.workspace, publicTask, submission, schema),
      solver,
      publicArtifactSchema: loaded.publicArtifactSchema,
      maxSubmitAttempts: SUBMIT_MAX_ATTEMPTS,
      write,
    },
    loaded.task,
  );
}

/** What the solve did, with its effort as a plain fact: minutes against the solve wall, tool calls
 *  and cost. A fast pass and a slow one say the same about difficulty, which is nothing; the verdict
 *  is the evidence. */
function solveView(solved: SolvedCase, effort: SolveEffort, wallMinutes: number) {
  return {
    accepted: solved.acceptedSubmit,
    turns: solved.solved.turns,
    toolCalls: solved.solved.toolCalls ?? null,
    effort: effortPhrase(effort, wallMinutes),
    nonResult: solverBlockerOf(solved),
  };
}

async function runTrial(
  sourceBinding: HarnessTrialBinding,
  taskId: string,
  ordinal: number,
  signal?: AbortSignal,
) {
  if (taskId.trim() === "") return { status: "blocked", stage: "request", error: "taskId must not be blank" };
  let loaded: ReturnType<typeof loadTrialCandidate>;
  let binding = sourceBinding;
  let wallMinutes: number;
  try {
    const fingerprint = fingerprintSlug(binding.workspace, { slug: binding.context.slug });
    if (!fingerprint.ok) {
      return {
        status: "blocked",
        stage: "candidate",
        findings: authorFindingOverview(fingerprintRefusal(fingerprint.findings)),
      };
    }
    binding = { ...binding, workspace: ensureBundleSnapshot(binding.workspace, fingerprint).dir };
    loaded = loadTrialCandidate(binding, taskId);
    wallMinutes = harnessSettings(binding.workspace).solveMs / 60_000;
  } catch (error) {
    return { status: "blocked", stage: "candidate", error: visibleError(error) };
  }
  if (!loaded.ok) return loaded.body;
  const openedCandidateId = candidateId(binding);
  // The expensive half starts here: a Built solve runs under the harness's own wall, which may be
  // hours, and nothing reads the result of a cancelled call. A signal that reached only the verifier
  // stage would let a cancelled rehearsal pay for its whole solve first. `blocked` is
  // the faithful receipt kind for it — the action could not run, which is a separate count from a
  // failure — and it keeps the refund below to one condition.
  if (signal?.aborted === true) {
    return { status: "blocked", stage: "cancelled", error: "the call was cancelled before its solve began" };
  }
  let solved: SolvedCase;
  const write = rehearsalWriter(binding.rehearsalDir, ordinal);
  try {
    solved = await solveBlind(binding, loaded, write);
  } catch (error) {
    return {
      status: "non-result",
      stage: "solver",
      error: visibleError(error),
      candidate: { candidateId: openedCandidateId, stable: true },
    };
  }
  return gradeBlind(
    { binding, sourceBinding, loaded, solved, openedCandidateId, ordinal, write, wallMinutes },
    signal,
  );
}

async function gradeBlind(grade: BlindGrade, signal?: AbortSignal) {
  const { binding, sourceBinding, loaded, solved, openedCandidateId, ordinal, write, wallMinutes } = grade;
  const candidate = candidateView(openedCandidateId, candidateId(sourceBinding), loaded.findings);
  // The battery's branch order decides this rather than convenience: `gradeOutcome` in
  // `src/truth/solve-case.ts` returns the solver's non-result before it ever looks at the accepted
  // artifact, because a solve the environment cut short has no truth to read whatever bytes it left
  // behind. A rehearsal that graded those bytes anyway would answer the round's difficulty question
  // with evidence the battery itself discards, so the verifier runs only when the candidate held
  // still, the solver accepted a submission and no non-result was typed.
  const blocker = solverBlockerOf(solved);
  const { execution, truthOk } = verifierView(
    candidate.stable && solved.acceptedSubmit && blocker === null
      ? await rehearseCase(binding.workspace, loaded.brief, solved, binding.verifierLifetime, {
          signal,
          // Host evidence beside the solve, for the operator; the author's view is `verifierView` alone.
          record: (checkRuns, toolRuns) => write("checks.json", { checkRuns, toolRuns }),
        })
      : { status: "not-run" },
  );
  let status = solved.acceptedSubmit ? "completed" : "unaccepted";
  if (blocker !== null) status = "non-result";
  if (execution.status === "execution-failed") status = "verifier-failed";
  if (execution.status === "non-result") status = "non-result";
  if (!candidate.stable) status = "candidate-changed";
  // Only the aggregate bit crosses, and only where there is one to cross. A rehearsal that never
  // reached the check program says not-run rather than reading as a failure, which the Builder would
  // otherwise answer by making a task easier on evidence that never graded it.
  const graded = candidate.stable && execution.status === "completed" ? truthOk : null;
  const verdict = graded === null ? "not-run" : graded ? "pass" : "fail";
  const { taskId, family } = loaded.task;
  // The solver's own count wins over the trace's, which a capture bound can cut short.
  const effort = {
    ...traceEffort(solved.solved.trace),
    ...keyIfDefined("toolCalls", solved.solved.toolCalls),
  };
  // A passing solve is the solver's own record of a task it can do, which the context tool offers
  // beside the measured passes; a failing one would show where a check bit, so it stays here.
  if (verdict === "pass") {
    const heading = `${taskId} in rehearsal ${String(ordinal)}`;
    binding.rehearsals?.add(
      `traces/rehearsal-${String(ordinal)}/${taskId}`,
      `the passing rehearsal of ${taskId}`,
      solverTraceLines(heading, solved.solved.trace, wallMinutes),
    );
  }
  const artifact = solved.final?.accepted === true ? solved.final.artifactJson : null;
  const { advice, counted } = binding.onRehearsal?.(
    { taskId, family: family ?? null, verdict, wallMinutes, ...effort },
    { ordinal, artifact, candidateId: openedCandidateId },
  ) ?? { advice: [], counted: true };
  return {
    status,
    task: { taskId, family, publicTaskDigest: loaded.committed.publicTaskDigest },
    candidate,
    solve: solveView(solved, effort, wallMinutes),
    verifier: candidate.stable ? execution : { status: "not-run", reason: "candidate-changed" },
    truth: { verdict },
    ...keysIf(!counted, () => ({ calibration: "uncounted" as const })),
    ...keysIf(advice.length > 0, () => ({ planAdvice: advice })),
  };
}

function trialOutcome(status: string, verdict: string): BuilderCustomToolSemantic["outcome"] {
  if (status === "non-result") return "non-result";
  if (status === "blocked" || status.endsWith("failed") || status === "candidate-changed") return "blocked";
  return verdict === "not-run" ? "incomplete" : "completed";
}

/** A rehearsal that never reached a solve has no solver verdict to report, so what the Builder
 *  needs back is the candidate's own cause instead. Stages that name their own keep it —
 *  `trialResultSummary` prefers the body's text, because the same fact written by two owners drifts
 *  — and this covers the ones that carry none. Without a branch per blocked stage, a blank taskId,
 *  an unreadable bundle and a refused fingerprint all read as "Your solver missed this task": a
 *  solver verdict for a call in which no solver ran, and the one reading that sends a Builder off
 *  to make its battery easier. */
function blockedNextAction(stage: string): string {
  if (stage === "request") {
    return "The call named no task, so nothing was rehearsed. Use harness_inspect readiness to choose an authored taskId and repeat it.";
  }
  if (stage === "cancelled") {
    return "The host cancelled this call before your solver ran, so nothing was measured or charged. Repeat it if the round continues.";
  }
  return "The rehearsal stopped before your solver ran: this candidate could not be read as a bundle. Use harness_inspect readiness, repair it, then repeat the rehearsal.";
}

function countRehearsal(
  tally: RoundRehearsals,
  verdict: string,
  turns: number | null,
  calibration: Calibration,
): void {
  if (calibration === "uncounted" || (verdict !== "pass" && verdict !== "fail")) return;
  tally.graded += 1;
  if (verdict !== "pass") return;
  tally.passed += 1;
  if (turns === 1) tally.passedInOneTurn += 1;
}

/**
 * The round's record so far, in one clause, added to the sentence that already reads this call's
 * verdict. Nothing here is new information: it is the sum of bits this tool has already returned,
 * so it crosses the rule-4 boundary on exactly the terms the single aggregate verdict does.
 *
 * It is here because a per-call sentence is the wrong unit for the decision it feeds. The band a
 * battery is aimed at is stated as a rate -- 5 to 12 verified of 25 -- and a Builder holding six
 * separate sentences has to add them up itself, from a conversation pi compacts as it goes, whose
 * oldest turns are the first to be cut. Three recorded campaigns rehearsed and shipped anyway: of
 * 16 rehearsals carrying a verdict, 12 passed and 3 failed, and every single pass came back at one
 * turn. Each of those twelve results said, correctly, that a battery of tasks like this one scores
 * near its size. None of them said it twelve times.
 */
function roundClause(tally: RoundRehearsals): string {
  if (tally.graded < 2) return "";
  const inOneTurn =
    tally.passedInOneTurn === 0 ? "" : `, ${String(tally.passedInOneTurn)} of them inside a single turn`;
  return ` Across this round your solver has now passed ${String(tally.passed)} of ${String(tally.graded)} graded rehearsals${inOneTurn}.`;
}

function trialNextAction(
  status: string,
  verdict: string,
  stage: string,
  tally: RoundRehearsals,
  calibration: Calibration,
): string {
  if (status === "blocked") return blockedNextAction(stage);
  if (status === "non-result" || status === "verifier-failed") {
    return "The rehearsal reached no verdict, so this task is unmeasured: it is neither hard nor easy evidence. Repair the named stage and repeat it.";
  }
  if (status === "candidate-changed") {
    return "Candidate bytes changed during the rehearsal. Repeat it on unchanged files.";
  }
  if (status === "unaccepted") {
    return "The solver ran and submitted no accepted artifact. That is a solver miss, not a check failure: it counts towards difficulty only if a correct answer is reachable from the public task with the tools you published. Read your own tool roster and brief before treating it as a hard task.";
  }
  if (calibration === "uncounted" && (verdict === "pass" || verdict === "fail")) {
    return `Your solver ${verdict === "pass" ? "passed" : "missed"} this task, but a preview of this candidate rejected one of its own accept controls, so the verdict may measure the check program rather than the task and says nothing about how a battery of tasks like it scores. Preview the repaired candidate, then rehearse again.`;
  }
  if (verdict === "pass") {
    return `Your solver passed this task on its first unaided attempt, so a battery of tasks like it scores near its size.${roundClause(tally)}`;
  }
  // Stated as the mirror of the pass sentence, and with no next task: a miss is the aim of a first
  // battery, so a sentence steering towards an easier task would choose the course for the Builder.
  return `Your solver missed this task on its first unaided attempt, so a battery of tasks like it scores near zero.${roundClause(tally)}`;
}

/** Counts this call into the round before it reads the round back, so a result speaks for every
 *  rehearsal including its own. The tally is updated here rather than by the caller because this is
 *  where the row has already been parsed, and a second parse of the same bytes is a second thing to
 *  keep right. */
function trialResultSummary(value: unknown, tally: RoundRehearsals, calibration: Calibration) {
  const row = asRecord(value);
  const solve = asRecord(row?.solve);
  const candidate = asRecord(row?.candidate);
  const recorded = asRecord(row?.truth)?.verdict;
  const verdict = isString(recorded) ? recorded : "not-run";
  const status = isString(row?.status) ? row.status : "blocked";
  const stage = isString(row?.stage) ? row.stage : "";
  const submitted = isBoolean(solve?.accepted) ? solve.accepted : false;
  const semantic = { outcome: trialOutcome(status, verdict), submitted, truthVerdict: verdict };
  const receipt: BuilderCustomToolSemantic = { ...semantic };
  if (isNumber(solve?.turns)) receipt.turns = solve.turns;
  if (isString(candidate?.candidateId)) receipt.candidateId = candidate.candidateId;
  if (stage !== "") receipt.stage = stage;
  countRehearsal(tally, verdict, isNumber(solve?.turns) ? solve.turns : null, calibration);
  return {
    validation: { ...semantic, round: { ...tally } },
    // A body that already named its own cause keeps it. The status alone cannot tell a blank taskId
    // from an unreadable bundle, so recomputing here would write a vaguer sentence over the more
    // specific one the stage produced.
    nextAction: isString(row?.nextAction)
      ? row.nextAction
      : trialNextAction(status, verdict, stage, tally, calibration),
    receipt,
  };
}

export function createHarnessTrialTool(binding: HarnessTrialBinding): AgentTool<typeof Params> {
  let ordinal = 0;
  // Round-scoped, like `ordinal`, and for the same reason: the tool instance is the round, so neither
  // count outlives it and neither has anywhere else to live. Nothing here rations rehearsals: each one
  // is a Built solve charged to the run's provider budget, which already owns that spend.
  const tally: RoundRehearsals = { graded: 0, passed: 0, passedInOneTurn: 0 };
  return defineTool({
    name: "harness_trial",
    label: "Harness trial",
    description: `Measure one of your own tasks against your own solver. The Built Harness you wrote solves the named task blind — public input and your registered tools only, no hidden expectations, no reference solve, under the same turn cap, solve wall and confinement a measured battery uses — and the real check program then grades the bytes it submitted. You get one aggregate truth.verdict of pass, fail or not-run, whether it submitted at all, how many turns it took and what the solve spent (minutes against the solve wall, tool calls, cost), and any advice where your EXPERIMENT.json target or predictions disagree with the round's rehearsals: never which check decided, a counterexample, a failure location, the artifact or any verifier output. This is the only evidence in the round about how hard your battery actually is; your own reference solve cannot supply it, because it is the best answer you have rather than the one your agent finds. A task your solver passes on its first attempt will most likely pass in the battery too. Each rehearsal costs one measured case from the run's provider budget, and the accepted bytes are graded under the same per-check wall your agent/config.yaml sets for the battery. Use harness_inspect readiness to choose taskId; full battery and control coverage, candidate gates and adoption stay with submit.`,
    parameters: Params,
    executionMode: "sequential",
    run: async (params, signal) => {
      ordinal += 1;
      const result = await runTrial(binding, params.taskId, ordinal, signal);
      // A rehearsal blocked before its solve wrote nothing under this ordinal, so the next call reuses
      // it without colliding with an evidence directory that exists.
      if (result.status === "blocked") ordinal -= 1;
      // A verdict the plan does not count as calibration joins no round count that reads as one either.
      const summary = trialResultSummary(result, tally, "calibration" in result ? "uncounted" : "counted");
      return {
        text: capturedJsonStringify({
          ...result,
          validation: summary.validation,
          nextAction: summary.nextAction,
        }),
        details: { taskId: params.taskId, receipt: summary.receipt },
      };
    },
  });
}
