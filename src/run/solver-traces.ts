/**
 * The traces source of the `context` tool, for measured batteries: the solver's own record of every
 * case that passed, newest battery first.
 *
 * A passing solve is the one piece of evidence that shows how the harness actually reached an
 * answer — which tools carried it, how many turns it needed and how much of its wall it spent —
 * and nine recorded epochs never opened one, because no Builder path reached them. Only passing
 * cases are offered: a measured battery publishes each task's aggregate bit (rule 4), so which cases
 * passed is public, while a failing trace is where the failure is located and stays with the
 * controller. The trace is read through the evidence log, so bytes the eval runner did not write
 * are refused rather than shown, and `solverTraceLines` copies only the fields it names.
 *
 * Beside each trace sits the artifact that solve submitted, with its public task: a passing design
 * can beat the Builder's own reference solve, and without it the next round searches from behind a
 * design the product already found. Its bytes are vouched for when the list is built, so an
 * artifact the evidence log cannot vouch for is absent rather than refused. Under it sit the solver's
 * own margin lines against every limit the brief it was scored under publishes, so the next round
 * reads how much room a passing design left without re-deriving it; a brief that no longer matches
 * the battery's scoring program leaves no lines rather than lines about other rules.
 */
import type { ContextDocument } from "../builder/context-tool.ts";
import { solverTraceLines } from "../builder/solver-trace-text.ts";
import { recordedEvidence, verifyRunDir } from "../claim/evidence-log.ts";
import { scoringClosureHash } from "../claim/scoring-closure.ts";
import { capturedJsonParse, capturedJsonStringify, parseJsonAs } from "../meta/json-runtime.ts";
import { isRecord, isString } from "../meta/json-shape.ts";
import { dirname, join } from "../meta/path.ts";
import { marginLine, readMargins, renderMargins } from "../solve/published-margin.ts";
import { CASE_ARTIFACT_FILE, readRecordedBatteryRecord } from "../correctness-bundle/battery-record.ts";
import { publishedMargins, unreadBoundaryNames } from "../correctness-bundle/numeric-boundary.ts";
import type { Brief } from "../correctness-bundle/brief.ts";
import { readValidatedBrief } from "../correctness-bundle/public-resources.ts";
import { DEFAULT_HARNESS_SETTINGS } from "../correctness-bundle/harness-config.ts";
import { type AdmittedClimbRow, recordedPublicTasks, retainedRunDir } from "./climb-history.ts";

const DEFAULT_WALL_MINUTES = DEFAULT_HARNESS_SETTINGS.solveMs / 60_000;

/** How many readings the kickoff lists before it counts the rest. */
const RECORD_LINES = 30;

export function measuredSolverTraces(
  domainDir: string,
  history: readonly AdmittedClimbRow[],
): ContextDocument[] {
  return history.toReversed().flatMap((row) => {
    const { runId } = row.battery;
    const wall = row.authoring.solveWallMinutes ?? DEFAULT_WALL_MINUTES;
    const runDir = retainedRunDir(domainDir, runId);
    if (runDir === null) return [];
    const violations = verifyRunDir(runDir);
    const brief = scoredBrief(runDir, runId);
    const margins = brief === null ? [] : publishedMargins(brief);
    return row.authoring.passedTaskIds.flatMap((taskId): ContextDocument[] => {
      const passing = passingCase(runDir, taskId, violations);
      const solve: ContextDocument = {
        id: `traces/${runId}/${taskId}`,
        source: "traces",
        title: `the passing solve of ${taskId} in battery ${runId}`,
        text: () => {
          const recorded = recordedEvidence(runDir, `cases/${taskId}/trace.json`, violations);
          if (!recorded.ok) return `The trace of ${taskId} cannot be vouched for: ${recorded.refusal}`;
          let trace: unknown;
          try {
            trace = parseJsonAs<unknown>(recorded.bytes);
          } catch {
            return `The trace of ${taskId} in ${runId} is not JSON.`;
          }
          return solverTraceLines(`${taskId} in ${runId}`, trace, wall).join("\n");
        },
      };
      if (passing === null) return [solve];
      const { publicTask, submittedArtifact } = passing;
      return [
        solve,
        {
          id: `traces/${runId}/${taskId}/artifact`,
          source: "traces",
          title: `the artifact the passing solve of ${taskId} submitted in battery ${runId}`,
          text: () =>
            capturedJsonStringify({ runId, publicTask, submittedArtifact }, null, 2) +
            renderMargins(
              isRecord(publicTask)
                ? readMargins(
                    margins,
                    isString(publicTask.family) ? publicTask.family : "",
                    publicTask.publicInput,
                    submittedArtifact,
                  )
                : [],
              "the artifact this solve submitted",
            ),
        },
      ];
    });
  });
}

/** A passing case's public task and submitted artifact, each vouched for by the evidence log; null
 *  when either cannot be. */
function passingCase(
  runDir: string,
  taskId: string,
  violations: ReturnType<typeof verifyRunDir>,
): { publicTask: unknown; submittedArtifact: unknown } | null {
  const artifact = recordedEvidence(runDir, `cases/${taskId}/${CASE_ARTIFACT_FILE}`, violations);
  const task = recordedPublicTasks(runDir, [taskId], violations);
  if (!artifact.ok || !("tasks" in task)) return null;
  return { publicTask: task.tasks[0], submittedArtifact: capturedJsonParse(artifact.bytes) };
}

/** The brief this battery was scored under; null when it cannot be read back or no longer matches the
 *  scoring program the battery recorded, so no line speaks about other rules. */
function scoredBrief(runDir: string, runId: string): Brief | null {
  const productDir = dirname(dirname(runDir));
  let scoringHash: unknown;
  try {
    const snapshot: unknown = readRecordedBatteryRecord(runDir, runId).bundleSnapshot;
    scoringHash = isRecord(snapshot) ? snapshot.scoringHash : null;
  } catch {
    return null;
  }
  if (!isString(scoringHash) || scoringClosureHash(join(productDir, "correctness-model")) !== scoringHash) {
    return null;
  }
  return readValidatedBrief(productDir);
}

/**
 * Where the latest admitted battery's passing solves landed against every limit its brief publishes,
 * for the kickoff; null when nothing passed or nothing could be read.
 *
 * A passing artifact is a witness the verifier accepted, as good as the Builder's own reference for
 * proving a limit feasible and often better: on the recorded truss runs the solver shipped lighter
 * than the Builder's best accept witness in 102 of 166 passing cases, and at a median 3.1% inside
 * the limit it was set. The context tool served these same lines beside each artifact, and a Builder
 * setting its next limits did not open them, so the kickoff now states them. A limit whose
 * boundary names no artifact path cannot be read against any solve, and the line says which, since
 * declaring the path is what lets both this reading and the solver's own writer see it. The readings
 * are of public artifacts against public limits, so nothing protected crosses.
 */
export function solverRecord(domainDir: string, history: readonly AdmittedClimbRow[]): string | null {
  const latest = history.findLast((row) => row.excludedReason === null);
  if (latest === undefined || latest.authoring.passedTaskIds.length === 0) return null;
  const { runId } = latest.battery;
  const runDir = retainedRunDir(domainDir, runId);
  if (runDir === null) return null;
  const brief = scoredBrief(runDir, runId);
  if (brief === null) return null;
  const margins = publishedMargins(brief);
  const violations = verifyRunDir(runDir);
  const readings = latest.authoring.passedTaskIds.flatMap((taskId) => {
    const passing = passingCase(runDir, taskId, violations);
    if (passing === null || !isRecord(passing.publicTask)) return [];
    const { family, publicInput } = passing.publicTask;
    return readMargins(margins, isString(family) ? family : "", publicInput, passing.submittedArtifact)
      .filter((reading) => reading.slack !== null)
      .map((reading) => `- ${taskId}: ${marginLine(reading)}`);
  });
  const unread = unreadBoundaryNames(brief);
  const unreadLine =
    unread.length === 0
      ? null
      : `No solve is read against ${unread.join(", ")}: ${unread.length === 1 ? "the boundary names" : "their boundaries name"} no artifact path, so neither this reading nor the solver's writer can compare an answer with it.`;
  if (readings.length === 0) return unreadLine;
  const rest = readings.length - RECORD_LINES;
  return [
    `Where the passing solves of battery ${runId} landed against the limits its brief publishes. Each is a submitted artifact the verifier accepted, so it proves its task feasible at the value it reached, as your reference does:`,
    readings.slice(0, RECORD_LINES).join("\n"),
    rest > 0
      ? `${String(rest)} further reading${rest === 1 ? " is" : "s are"} at traces/${runId}/<taskId>/artifact.`
      : null,
    unreadLine,
  ]
    .filter((part) => part !== null)
    .join("\n");
}
