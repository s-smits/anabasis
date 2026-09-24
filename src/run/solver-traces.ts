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
 */
import type { ContextDocument } from "../builder/context-tool.ts";
import { solverTraceLines } from "../builder/solver-trace-text.ts";
import { recordedEvidence } from "../claim/evidence-log.ts";
import { parseJsonAs } from "../meta/json-runtime.ts";
import { DEFAULT_HARNESS_SETTINGS } from "../truth/harness-config.ts";
import { type AdmittedClimbRow, retainedRunDir } from "./climb-history.ts";

const DEFAULT_WALL_MINUTES = DEFAULT_HARNESS_SETTINGS.solveMs / 60_000;

export function measuredSolverTraces(
  domainDir: string,
  history: readonly AdmittedClimbRow[],
): ContextDocument[] {
  return history.toReversed().flatMap((row) => {
    const { runId } = row.battery;
    const wall = row.authoring.solveWallMinutes ?? DEFAULT_WALL_MINUTES;
    return row.authoring.passedTaskIds.map(
      (taskId): ContextDocument => ({
        id: `traces/${runId}/${taskId}`,
        source: "traces",
        title: `the passing solve of ${taskId} in battery ${runId}`,
        text: () => {
          const runDir = retainedRunDir(domainDir, runId);
          if (runDir === null) return `Battery ${runId} has no unique retained run directory.`;
          const recorded = recordedEvidence(runDir, `cases/${taskId}/trace.json`);
          if (!recorded.ok) return `The trace of ${taskId} cannot be vouched for: ${recorded.refusal}`;
          let trace: unknown;
          try {
            trace = parseJsonAs<unknown>(recorded.bytes);
          } catch {
            return `The trace of ${taskId} in ${runId} is not JSON.`;
          }
          return solverTraceLines(`${taskId} in ${runId}`, trace, wall).join("\n");
        },
      }),
    );
  });
}
