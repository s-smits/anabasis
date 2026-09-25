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
 * artifact the evidence log cannot vouch for is absent rather than refused.
 */
import type { ContextDocument } from "../builder/context-tool.ts";
import { solverTraceLines } from "../builder/solver-trace-text.ts";
import { recordedEvidence, verifyRunDir } from "../claim/evidence-log.ts";
import { capturedJsonParse, capturedJsonStringify, parseJsonAs } from "../meta/json-runtime.ts";
import { CASE_ARTIFACT_FILE } from "../truth/battery-record.ts";
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
          text: () => capturedJsonStringify({ runId, publicTask, submittedArtifact }, null, 2),
        },
      ];
    });
  });
}
