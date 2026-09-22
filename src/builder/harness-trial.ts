/** `harness_trial`: one authored task, solved blind by the measured Built solver and graded by the
 *  host verifier.
 *
 * The solver receives only the public task and the Builder's tools. The Builder gets back one
 * aggregate pass/fail bit and how far the solve got; check ids, counterexamples, the artifact and
 * verifier output stay protected. It lets a round see that a battery is too easy before paying to
 * measure it; submit remains the only admission path.
 */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { type CandidateCheckContext, loadValidatedBundle } from "../author/candidate-check.ts";
import type { BuilderCustomToolSemantic } from "../author/builder-execution.ts";
import { fingerprintSlug } from "../claim/fingerprint.ts";
import { bundleSnapshotIdOf, ensureBundleSnapshot } from "../claim/bundle-snapshot.ts";
import { asRecord, isBoolean, isNumber, isString } from "../meta/json-shape.ts";
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
  REHEARSAL_VERIFIER_DEADLINE_MS,
  type SolveCaseEvidence,
  type SolvedCase,
  rehearseCase,
  solveCase,
  solverBlockerOf,
} from "../truth/solve-case.ts";
import { writeJsonFile } from "../meta/completed-json.ts";

/** Blind rehearsals per authoring session; each costs one measured case. */
const MAX_REHEARSALS = 6;

const Params = Type.Object({
  taskId: Type.String({ minLength: 1, maxLength: 256 }),
});

interface HarnessTrialBinding {
  /** The Builder's candidate workspace. The model cannot name another path. */
  workspace: string;
  /** The same authoring contract static inspection and submit use. */
  context: CandidateCheckContext;
  /** The measured Built solver. Without it the trial refuses rather than substitute another. */
  builtSolver?: () => Solver;
  /** Where each rehearsal's solve evidence is written, one directory per call. Absent in tests. */
  rehearsalDir?: string;
  verifierLifetime?: VerifierLifetime;
}

type LoadedTrial = Extract<ReturnType<typeof loadTrialCandidate>, { ok: true }>;

/** One blind grading: the snapshot binding, the source binding, the loaded trial, the solved case
 *  and the candidate id when the trial opened. */
type BlindGrade = {
  readonly binding: HarnessTrialBinding;
  readonly sourceBinding: HarnessTrialBinding;
  readonly loaded: LoadedTrial;
  readonly solved: SolvedCase;
  readonly openedCandidateId: string | null;
};

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
        nextAction: "Use harness_inspect summary and typecheck, then repair the candidate before trial.",
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
        nextAction: "Use harness_inspect inventory to choose an authored public task.",
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

/** The rehearsal's evidence directory: `rehearsal-<ordinal>`, or the next free ordinal, so a later
 *  session never overwrites an earlier session's solve. */
function claimRehearsalDir(dir: string, ordinal: number): string {
  let path = join(dir, `rehearsal-${String(ordinal)}`);
  for (let next = ordinal + 1; existsSync(path); next += 1) path = join(dir, `rehearsal-${String(next)}`);
  return path;
}

/** Writes a rehearsal's solve evidence into one directory, claimed on its first write. Without a
 *  directory the evidence is discarded. */
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

/** Solves the task once, exactly as a measured case does; the solver is not told it is a
 *  rehearsal. */
async function solveBlind(
  binding: HarnessTrialBinding,
  loaded: LoadedTrial,
  ordinal: number,
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
      write: rehearsalWriter(binding.rehearsalDir, ordinal),
    },
    loaded.task,
  );
}

function solveView(solved: SolvedCase) {
  return {
    accepted: solved.acceptedSubmit,
    turns: solved.solved.turns,
    toolCalls: solved.solved.toolCalls ?? null,
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
  try {
    const fingerprint = fingerprintSlug(binding.workspace, { slug: binding.context.slug });
    if (!fingerprint.ok) return { status: "blocked", stage: "candidate" };
    binding = { ...binding, workspace: ensureBundleSnapshot(binding.workspace, fingerprint).dir };
    loaded = loadTrialCandidate(binding, taskId);
  } catch (error) {
    return { status: "blocked", stage: "candidate", error: visibleError(error) };
  }
  if (!loaded.ok) return loaded.body;
  const openedCandidateId = candidateId(binding);
  // A cancelled call skips the solve, which may take hours; `blocked` also refunds the rehearsal.
  if (signal?.aborted === true) {
    return { status: "blocked", stage: "cancelled", error: "the call was cancelled before its solve began" };
  }
  let solved: SolvedCase;
  try {
    solved = await solveBlind(binding, loaded, ordinal);
  } catch (error) {
    return {
      status: "non-result",
      stage: "solver",
      error: visibleError(error),
      candidate: { candidateId: openedCandidateId, stable: true },
    };
  }
  return gradeBlind({ binding, sourceBinding, loaded, solved, openedCandidateId }, signal);
}

async function gradeBlind(grade: BlindGrade, signal?: AbortSignal) {
  const { binding, sourceBinding, loaded, solved, openedCandidateId } = grade;
  const candidate = candidateView(openedCandidateId, candidateId(sourceBinding), loaded.findings);
  // A solver non-result outranks an accepted submit, as in a battery: its bytes are not graded.
  const verifier =
    candidate.stable && solved.acceptedSubmit && solved.solved.nonResult === undefined
      ? await rehearseCase(binding.workspace, loaded.brief, solved, binding.verifierLifetime, signal)
      : { status: "not-run" };
  let status = solved.acceptedSubmit ? "completed" : "unaccepted";
  if (solved.solved.nonResult !== undefined) status = "non-result";
  if (verifier.status === "execution-failed") status = "verifier-failed";
  if (verifier.status === "non-result") status = "non-result";
  if (!candidate.stable) status = "candidate-changed";
  // The truth bit moves to `truth`; the verifier view reports only how far execution got.
  const { truthOk, ...execution } = { truthOk: null, ...verifier };
  // A rehearsal that never reached the check program reads as not-run, not as a failure.
  const graded = candidate.stable && verifier.status === "completed" ? truthOk : null;
  return {
    status,
    task: {
      taskId: loaded.task.taskId,
      family: loaded.task.family,
      publicTaskDigest: loaded.committed.publicTaskDigest,
    },
    candidate,
    solve: solveView(solved),
    verifier: candidate.stable ? execution : { status: "not-run", reason: "candidate-changed" },
    truth: { verdict: graded === null ? "not-run" : graded ? "pass" : "fail" },
  };
}

function trialOutcome(status: string, verdict: string): BuilderCustomToolSemantic["outcome"] {
  if (status === "non-result") return "non-result";
  if (status === "blocked" || status.endsWith("failed") || status === "candidate-changed") return "blocked";
  return verdict === "not-run" ? "incomplete" : "completed";
}

/** The next step for a rehearsal blocked before any solve, by the stage that blocked it. */
function blockedNextAction(stage: string): string {
  if (stage === "request") {
    return "The call named no task, so nothing was rehearsed. Use harness_inspect inventory to choose an authored taskId and repeat it.";
  }
  if (stage === "cancelled") {
    return "The host cancelled this call before your solver ran, so nothing was measured and no rehearsal was spent. Repeat it if the round continues.";
  }
  return "The rehearsal stopped before your solver ran: this candidate could not be read as a bundle. Use harness_inspect summary and typecheck, repair it, then repeat the rehearsal.";
}

function trialNextAction(status: string, verdict: string, remaining: number, stage: string): string {
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
  if (verdict === "pass") {
    return `Your solver passed this task on its first unaided attempt, so a battery of tasks like it scores near its size. ${String(remaining)} rehearsals left.`;
  }
  return `Your solver missed this task. ${String(remaining)} rehearsals left; rehearse a task you believe is easier to find where the limit sits.`;
}

function trialResultSummary(value: unknown, remaining: number) {
  const row = asRecord(value);
  const solve = asRecord(row?.solve);
  const candidate = asRecord(row?.candidate);
  const recorded = asRecord(row?.truth)?.verdict;
  const verdict = isString(recorded) ? recorded : "not-run";
  const status = isString(row?.status) ? row.status : "blocked";
  const stage = isString(row?.stage) ? row.stage : "";
  const submitted = isBoolean(solve?.accepted) ? solve.accepted : false;
  const counted = { outcome: trialOutcome(status, verdict), submitted, truthVerdict: verdict };
  const receipt: BuilderCustomToolSemantic = { ...counted };
  if (isNumber(solve?.turns)) receipt.turns = solve.turns;
  if (isString(candidate?.candidateId)) receipt.candidateId = candidate.candidateId;
  if (stage !== "") receipt.stage = stage;
  return {
    validation: { ...counted, rehearsalsLeft: remaining },
    // A body's own, more specific next action wins over one derived from the status.
    nextAction: isString(row?.nextAction)
      ? row.nextAction
      : trialNextAction(status, verdict, remaining, stage),
    receipt,
  };
}

export function createHarnessTrialTool(binding: HarnessTrialBinding): AgentTool<typeof Params> {
  let spent = 0;
  return defineTool({
    name: "harness_trial",
    label: "Harness trial",
    description: `Measure one of your own tasks against your own solver. The Built Harness you wrote solves the named task blind — public input and your registered tools only, no hidden expectations, no reference solve, under the same turn cap, solve wall and confinement a measured battery uses — and the real check program then grades the bytes it submitted. You get one aggregate truth.verdict of pass, fail or not-run, whether it submitted at all, and how many turns it took: never which check decided, a counterexample, a failure location, the artifact or any verifier output. This is the only evidence in the round about how hard your battery actually is; your own reference solve cannot supply it, because it is the best answer you have rather than the one your agent finds. A task your solver passes first time is a task the battery will pass. At most ${MAX_REHEARSALS} rehearsals per round, each costing one measured case, and a ${REHEARSAL_VERIFIER_DEADLINE_MS / 1000}-second total verifier deadline over the accepted bytes. Use harness_inspect inventory to choose taskId; full battery and control coverage, candidate gates and adoption stay with submit.`,
    parameters: Params,
    executionMode: "sequential",
    run: async (params, signal) => {
      if (spent >= MAX_REHEARSALS) {
        return {
          text: capturedJsonStringify({
            status: "blocked",
            stage: "budget",
            rehearsalsLeft: 0,
            nextAction: `This round has spent all ${MAX_REHEARSALS} rehearsals. Decide the battery from what they measured and submit.`,
          }),
          details: { taskId: params.taskId, receipt: { outcome: "blocked", stage: "budget" } },
        };
      }
      spent += 1;
      const result = await runTrial(binding, params.taskId, spent, signal);
      // A rehearsal blocked before its solve cost no case and wrote nothing, so it is refunded
      // and its ordinal reused.
      if (result.status === "blocked") spent -= 1;
      const summary = trialResultSummary(result, MAX_REHEARSALS - spent);
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
