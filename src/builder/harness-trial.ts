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

/** How many blind rehearsals one authoring session may run. Each one costs a measured case, so the
 *  bound is the session's own experiment budget rather than a safety limit: two tasks read at the
 *  start of a round and two after hardening them, with two spare. A Builder that wants more
 *  measurement than that has submit. */
const MAX_REHEARSALS = 6;

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
  // hours, and nothing reads the result of a cancelled call. A signal that reached only the verifier
  // stage would let a cancelled rehearsal pay for its whole solve first. `blocked` is
  // the faithful receipt kind for it — the action could not run, which is a separate count from a
  // failure — and it keeps the refund below to one condition.
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
  // The battery's branch order decides this rather than convenience: `gradeOutcome` in
  // `src/truth/solve-case.ts` returns the solver's non-result before it ever looks at the accepted
  // artifact, because a solve the environment cut short has no truth to read whatever bytes it left
  // behind. A rehearsal that graded those bytes anyway would answer the round's difficulty question
  // with evidence the battery itself discards, so the verifier runs only when the candidate held
  // still, the solver accepted a submission and no non-result was typed.
  const verifier =
    candidate.stable && solved.acceptedSubmit && solved.solved.nonResult === undefined
      ? await rehearseCase(binding.workspace, loaded.brief, solved, binding.verifierLifetime, signal)
      : { status: "not-run" };
  let status = solved.acceptedSubmit ? "completed" : "unaccepted";
  if (solved.solved.nonResult !== undefined) status = "non-result";
  if (verifier.status === "execution-failed") status = "verifier-failed";
  if (verifier.status === "non-result") status = "non-result";
  if (!candidate.stable) status = "candidate-changed";
  // How far execution got and what the checks decided are separate facts with separate readers, so
  // the bit leaves in `truth` alone and the verifier view below keeps reporting execution only. Of
  // the four shapes `rehearseCase` returns — not-run, non-result, execution-failed and completed —
  // only `completed` carries `truthOk`, which is why the default sits in front of the spread: it
  // gives all four the key that the destructuring then takes back out.
  const { truthOk, ...execution } = { truthOk: null, ...verifier };
  // Only the aggregate bit crosses, and only where there is one to cross. A rehearsal that never
  // reached the check program says not-run rather than reading as a failure, which the Builder would
  // otherwise answer by making a task easier on evidence that never graded it.
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
 *  needs back is the candidate's own cause instead. Stages that name their own keep it —
 *  `trialResultSummary` prefers the body's text, because the same fact written by two owners drifts
 *  — and this covers the ones that carry none. Without a branch per blocked stage, a blank taskId,
 *  an unreadable bundle and a refused fingerprint all read as "Your solver missed this task": a
 *  solver verdict for a call in which no solver ran, and the one reading that sends a Builder off
 *  to make its battery easier. */
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
    // A body that already named its own cause keeps it. The status alone cannot tell a blank taskId
    // from an unreadable bundle, so recomputing here would write a vaguer sentence over the more
    // specific one the stage produced.
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
      // The bound rations measurement, and a rehearsal blocked before its solve measured nothing and
      // cost no case. Charging it would spend a sixth of the session's only difficulty instrument on
      // a mistyped taskId. Nothing was written under this ordinal either, so the next call reuses it
      // without colliding with an evidence directory that exists.
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
