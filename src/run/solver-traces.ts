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
import { readMargins, renderMargins } from "../solve/published-margin.ts";
import { CASE_ARTIFACT_FILE, readRecordedBatteryRecord } from "../truth/battery-record.ts";
import { publishedMargins } from "../truth/numeric-boundary.ts";
import { readValidatedBrief } from "../truth/public-resources.ts";
import { DEFAULT_HARNESS_SETTINGS } from "../truth/harness-config.ts";
import { type AdmittedClimbRow, recordedPublicTasks, retainedRunDir } from "./climb-history.ts";

const DEFAULT_WALL_MINUTES = DEFAULT_HARNESS_SETTINGS.solveMs / 60_000;

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
    const margins = measuredMargins(runDir, runId);
    return row.authoring.passedTaskIds.flatMap((taskId): ContextDocument[] => {
      const artifact = recordedEvidence(runDir, `cases/${taskId}/${CASE_ARTIFACT_FILE}`, violations);
      const task = recordedPublicTasks(runDir, [taskId], violations);
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
      if (!artifact.ok || !("tasks" in task)) return [solve];
      const [publicTask] = task.tasks;
      const submittedArtifact = capturedJsonParse(artifact.bytes);
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

/** The limits the brief this battery was scored under publishes; none when that brief cannot be read
 *  back or no longer matches the scoring program the battery recorded. */
function measuredMargins(runDir: string, runId: string) {
  const productDir = dirname(dirname(runDir));
  let scoringHash: unknown;
  try {
    const snapshot: unknown = readRecordedBatteryRecord(runDir, runId).bundleSnapshot;
    scoringHash = isRecord(snapshot) ? snapshot.scoringHash : null;
  } catch {
    return [];
  }
  if (!isString(scoringHash) || scoringClosureHash(join(productDir, "correctness-model")) !== scoringHash) {
    return [];
  }
  const brief = readValidatedBrief(productDir);
  return brief === null ? [] : publishedMargins(brief);
}
