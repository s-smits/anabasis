/** A recorded battery's solves, read back so a later battery can grade them again instead of paying
 *  the Built solver for bytes it already produced. Grading is the only step that runs again: each
 *  reused case goes through `gradeCase` exactly as a fresh solve would, so the host verifier stays
 *  the one owner of every pass, and a recorded unaccepted attempt or solver non-result reclassifies
 *  to the same kind because `gradeCase` reads it from the same recorded solver facts.
 *
 *  A case is reusable only when its recorded public task is the one the new battery poses, byte for
 *  byte, and its final-submission fact is internally sound. An artifact graded against inputs it
 *  was not written for would be a different exam under the old case id. */
import { type EvidenceLogViolation, recordedEvidence, verifyRunDir } from "../claim/evidence-log.ts";
import { parseJsonAs } from "../meta/json-runtime.ts";
import { isString } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import type { FinalSubmission } from "../solve/final-submission.ts";
import { type BatteryRecord, type CaseRecord, readRecordedBatteryRecord } from "./battery-record.ts";
import type { SolvedCase } from "./solve-case.ts";
import { commitPublicTask } from "./task-split.ts";
import type { BuildTask } from "./tasks.ts";

/** The per-case solve evidence `solveCase` writes, carried into the new run directory so a trace
 *  reader, the diagnosis reader and a later replay find each reused case where a fresh one would
 *  be. The first two are required; the rest exist only for some solves. */
export const PUBLIC_TASK_FILE = "public-task.json";
export const FINAL_SUBMISSION_FILE = "final-submission.json";
/** The Built solver's trace of one case, under `cases/<taskId>/`. */
export const CASE_TRACE_FILE = "trace.json";
const OPTIONAL_SOLVE_FILES = [
  "built-registration.json",
  "worker-binding.json",
  "built-runtime.json",
  CASE_TRACE_FILE,
  "draft-checkpoints.json",
] as const;

interface RecordedSolve {
  record: CaseRecord;
  final: FinalSubmission | null;
  publicTaskDigest: string;
  /** File name under `cases/<taskId>/` to its recorded bytes. */
  evidence: ReadonlyMap<string, string>;
}

/** Recorded solves a battery grades instead of solving. `of` names the battery they came from. */
export interface BatteryReuse {
  of: string;
  /** The capability disclosure the recorded solves ran under. */
  capabilities: readonly string[];
  solves: ReadonlyMap<string, RecordedSolve>;
}

type Read<T> = { ok: true; value: T } | { ok: false; refusal: string };

function recordedSolve(
  runDir: string,
  row: CaseRecord,
  violations: EvidenceLogViolation[],
): Read<RecordedSolve> {
  const evidence = new Map<string, string>();
  for (const name of [PUBLIC_TASK_FILE, FINAL_SUBMISSION_FILE, ...OPTIONAL_SOLVE_FILES]) {
    const rel = `cases/${row.taskId}/${name}`;
    const read = recordedEvidence(runDir, rel, violations);
    if (read.ok) evidence.set(name, read.bytes);
    else if (name === PUBLIC_TASK_FILE || name === FINAL_SUBMISSION_FILE) {
      return { ok: false, refusal: `${rel}: ${read.refusal}` };
    }
  }
  const task = parseJsonAs<{ taskId?: unknown; publicTaskDigest?: unknown }>(
    evidence.get(PUBLIC_TASK_FILE) ?? "null",
  );
  if (task?.taskId !== row.taskId || !isString(task.publicTaskDigest)) {
    return { ok: false, refusal: `cases/${row.taskId}/${PUBLIC_TASK_FILE} does not bind its case` };
  }
  const final = parseJsonAs<(FinalSubmission & { falsifiedFact?: unknown }) | null>(
    evidence.get(FINAL_SUBMISSION_FILE) ?? "null",
  );
  // A falsified fact is a defect of the submission authority; grading it again would repeat a
  // claim-blocking record rather than regrade an answer.
  if (final?.falsifiedFact !== undefined) {
    return { ok: false, refusal: `cases/${row.taskId}/${FINAL_SUBMISSION_FILE} records a falsified fact` };
  }
  return { ok: true, value: { record: row, final, publicTaskDigest: task.publicTaskDigest, evidence } };
}

/** The recorded solves of `taskIds` in battery `runId`, refused whole when any one of them cannot be
 *  vouched for through the run's evidence manifest. */
export function readRecordedSolves(
  runDir: string,
  runId: string,
  taskIds: readonly string[],
): Read<BatteryReuse> {
  let battery: Pick<BatteryRecord, "cases" | "capabilities">;
  try {
    battery = readRecordedBatteryRecord(runDir, runId);
  } catch (error) {
    return { ok: false, refusal: errorMessage(error) };
  }
  const byId = new Map(battery.cases.map((row) => [row.taskId, row] as const));
  const violations = verifyRunDir(runDir);
  const solves = new Map<string, RecordedSolve>();
  for (const id of taskIds) {
    const row = byId.get(id);
    if (row === undefined) return { ok: false, refusal: `battery ${runId} recorded no case "${id}"` };
    const solve = recordedSolve(runDir, row, violations);
    if (!solve.ok) return solve;
    solves.set(id, solve.value);
  }
  return { ok: true, value: { of: runId, capabilities: [...battery.capabilities], solves } };
}

/** Whether the recorded case posed exactly `task`'s public bytes. */
export function recordedTaskMatches(
  task: BuildTask,
  solve: Pick<RecordedSolve, "publicTaskDigest">,
): boolean {
  return commitPublicTask(task).publicTaskDigest === solve.publicTaskDigest;
}

/** The recorded solve as the `SolvedCase` `gradeCase` consumes. The solver facts are the recorded
 *  ones, runtime identities included, so the claim's identity census reads the turns that actually
 *  produced the artifact. The final submission is parsed again from its recorded bytes, so grading
 *  holds its own copy. */
export function recordedSolvedCase(task: BuildTask, solve: RecordedSolve): SolvedCase {
  const committed = commitPublicTask(task);
  if (committed.publicTaskDigest !== solve.publicTaskDigest) {
    throw new Error(`recorded case "${task.taskId}" posed different public task bytes`);
  }
  const { solver } = solve.record;
  const final = parseJsonAs<FinalSubmission | null>(solve.evidence.get(FINAL_SUBMISSION_FILE) ?? "null");
  return {
    task,
    committed,
    solved: {
      turns: solver.turns,
      completedTurns: solver.completedTurns,
      errors: [...solver.errors],
      ...keyIfDefined("toolCalls", solver.toolCalls ?? undefined),
      ...keyIfDefined("startedToolCalls", solver.startedToolCalls ?? undefined),
      runtimeIdentities: [...solver.runtimeIdentities],
      ...keyIfDefined("nonResult", solver.nonResult ?? undefined),
    },
    final,
    finalDefect: null,
    acceptedSubmit: final?.accepted === true,
    instants: { startedAt: solver.startedAt, endedAt: solver.endedAt },
  };
}
