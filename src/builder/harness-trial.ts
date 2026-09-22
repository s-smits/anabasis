/** One authored task, solved blind by the measured Built solver and graded by the existing host.
 *
 * The solver receives only the public task and the tools the Builder wrote; it never sees the
 * hidden expectations, the reference solve or the author's intent. What comes back is one
 * aggregate pass/fail bit over the bytes it submitted, plus how far it got. Failing check ids,
 * counterexamples, the artifact and every verifier diagnostic stay protected, and submit remains
 * the sole admission path.
 *
 * This is the only instrument in the authoring loop that can observe a battery being easier than
 * its stated target, and it is why no prompt has to exhort the Builder about difficulty: a round
 * that wants tasks its solver misses can measure one before paying for twenty-five. Until
 * 2026-09-19 this tool ran a call sequence the Builder supplied, which made it the author playing
 * solver while holding the answer key; across eight recorded authoring sessions it was called
 * twice, and the three campaigns that used none of it each declared "at most 2 verified passes"
 * and measured six of six.
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

/** How many blind rehearsals one authoring session may run. Each one costs a measured case, so
 *  the bound is the session's own experiment budget: two tasks read at the start of a round and
 *  two after hardening them, with two spare. A Builder that wants more measurement has submit. */
const MAX_REHEARSALS = 6;

const Params = Type.Object({
  taskId: Type.String({ minLength: 1, maxLength: 256 }),
});

interface HarnessTrialBinding {
  /** The Builder's candidate workspace. The model cannot name another path. */
  workspace: string;
  /** The same authoring contract static inspection and submit use. */
  context: CandidateCheckContext;
  /** The measured Built solver, under the battery's own runtime, isolation and turn cap. Absent
   *  for a scripted runtime with no Built slot; the tool then refuses rather than substituting a
   *  different solver, because a rehearsal against another agent measures nothing. */
  builtSolver?: () => Solver;
  /** Where each rehearsal's solve evidence is written, one directory per call. Absent in tests. */
  rehearsalDir?: string;
  verifierLifetime?: VerifierLifetime;
}

type LoadedTrial = Extract<ReturnType<typeof loadTrialCandidate>, { ok: true }>;

/** One blind grading: the snapshot it grades against, the source tree it was authored in, the
 *  loaded trial, the case the solver produced and the candidate the session has open. */
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

/** The directory this rehearsal's evidence goes in: its session ordinal, or the next free name
 *  above it. The ordinal counts rehearsals within one session and the directory is the campaign's,
 *  so a second authoring session started at `rehearsal-1` again and wrote over the first session's
 *  solve — the record rule 6 asks each session to keep. Taking the next free name instead follows
 *  `claimEvidencePath`, which answered the same collision for the execution record. */
function claimRehearsalDir(dir: string, ordinal: number): string {
  let path = join(dir, `rehearsal-${String(ordinal)}`);
  for (let next = ordinal + 1; existsSync(path); next += 1) path = join(dir, `rehearsal-${String(next)}`);
  return path;
}

/** One directory per rehearsal under the campaign, so a solve the Builder paid for stays readable
 *  after the session. A binding with no directory discards it; nothing else changes. The name is
 *  claimed on the first write of a rehearsal, so every later file of that one solve joins it. */
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

/** Solve the selected task once, exactly as a measured case solves it: the Built runtime's own
 *  turn cap and solve wall, the generated tools as registered, the controller's submission
 *  authority. Nothing here tells the solver which task it is rehearsing. */
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
  // The expensive half starts here: a Built solve runs under the harness's own wall, which may be
  // hours, and nothing reads the result of a cancelled call. The caller's signal reached only the
  // verifier stage, so a cancelled rehearsal still paid for its whole solve first. `blocked` is the
  // faithful receipt kind for it — the action could not run, which is a separate count from a
  // failure (AGENTS.md working rule 6) — and it keeps the refund below to one condition.
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
  const verifier =
    candidate.stable && solved.acceptedSubmit
      ? await rehearseCase(binding.workspace, loaded.brief, solved, binding.verifierLifetime, signal)
      : { status: "not-run" };
  let status = solved.acceptedSubmit ? "completed" : "unaccepted";
  if (solved.solved.nonResult !== undefined) status = "non-result";
  if (verifier.status === "execution-failed") status = "verifier-failed";
  if (verifier.status === "non-result") status = "non-result";
  if (!candidate.stable) status = "candidate-changed";
  // Execution and truth are separate facts with separate readers, so the bit lives in `truth` alone
  // and the verifier view keeps reporting only how far execution got. Only one of the rehearsal's
  // three shapes carries the bit, so the default in front of the spread gives every one of them the
  // key the rest then removes.
  const { truthOk, ...execution } = { truthOk: null, ...verifier };
  // The aggregate bit alone. A rehearsal that never reached the check program says so rather than
  // reading as a failure, and a non-result stays a non-result.
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

/** A rehearsal that never reached a solve has no solver verdict to report, so what the Builder
 *  needs back is the candidate's own cause. Stages that name their own keep it — the reader below
 *  prefers the body's text, because the same fact under two owners drifts — and this covers the
 *  ones that carry none. Until 2026-09-20 no branch here read `blocked` at all, so a blank taskId,
 *  an unreadable bundle and a refused fingerprint each came back as "Your solver missed this task":
 *  a solver verdict for a call in which no solver ran. */
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
    // A body that already named its own cause keeps it, rather than having the reading recomputed
    // from the status alone and written over the more specific sentence the stage produced.
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
      // The bound rations measurement, and a rehearsal blocked before its solve measured nothing
      // and cost no case. Charging it spent a sixth of the session's only difficulty instrument on
      // a mistyped taskId. Nothing was written under this ordinal either, so the next call reuses
      // it without colliding.
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
