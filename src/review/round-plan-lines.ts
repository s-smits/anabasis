/**
 * What the round set out to do, as the Epoch Reviewer reads it.
 *
 * The Builder records its intent in `EXPERIMENT.json` before every preview or submit: the gap it
 * saw, the change it made, the result it expects, a target count and a pass probability per task.
 * The reviewer is the one component that reads the measured tree against the original request, and
 * without the plan it can only ask whether the result was earned in general, not whether the round
 * did what it claimed to be doing. So the plan is rendered here whole, and beside a measured battery
 * it is set against what that battery measured: the target met or missed, and the predictions
 * scored by the same `predictionScore` the author's rehearsals are scored by.
 *
 * Nothing protected crosses. The plan is the Builder's own public-facing text, and the battery side
 * is the aggregate a measured battery publishes anyway: a pass count and a Brier score over the
 * per-task verdicts, never a task's verdict, a check or a failure location.
 */
import { EXPERIMENT_FILE } from "../author/builder-memory.ts";
import { type ExperimentSubmission, predictionScore } from "../author/experiment-plan.ts";
import type { IterationAnalysis } from "../analyse/iteration-analysis.ts";
import { classifyCaseOutcome } from "../claim/case-record.ts";

/** Each case's verdict as a prediction is scored against it: a pass is true, a verified fail and an
 *  unaccepted attempt are false, and a non-result says nothing about the task and is left out. */
function batteryVerdicts(analysis: IterationAnalysis): Map<string, boolean> {
  return new Map(
    analysis.cases.flatMap((row): Array<[string, boolean]> => {
      const outcome = classifyCaseOutcome(row);
      return outcome === "non-result" ? [] : [[row.taskId, outcome === "pass"]];
    }),
  );
}

function targetLine(plan: ExperimentSubmission, analysis: IterationAnalysis | null): string {
  const { comparator, verifiedPasses } = plan.target;
  const stated = `Target: ${comparator === "at-most" ? "at most" : "at least"} ${String(verifiedPasses)} verified passes`;
  if (analysis === null) return `${stated}.`;
  const { passed } = analysis.battery.summary;
  const met = comparator === "at-most" ? passed <= verifiedPasses : passed >= verifiedPasses;
  return `${stated}; this battery passed ${String(passed)}, so the target was ${met ? "met" : "missed"}.`;
}

function predictionLine(plan: ExperimentSubmission, analysis: IterationAnalysis | null): string {
  const sum = Math.round(plan.predictions.reduce((total, row) => total + row.pass, 0) * 10) / 10;
  const count = plan.predictions.length;
  const stated = `Predictions: ${String(count)} ${count === 1 ? "task" : "tasks"} summing to ${String(sum)} expected passes`;
  if (analysis === null) return `${stated}.`;
  const score = predictionScore(plan.predictions, batteryVerdicts(analysis));
  if (score === null) return `${stated}; none of the predicted tasks reached a verdict in this battery.`;
  return `${stated}; scored against the ${String(score.scored)} predicted ${score.scored === 1 ? "task" : "tasks"} that reached a verdict, ${String(score.observed)} passed where ${String(score.expected)} were expected (Brier ${String(score.brier)}; one half for every task scores 0.25).`;
}

/** The plan block of the orientation. A measured battery reads the plan recorded with it; a
 *  checkpoint reads the plan in the workspace, with nothing yet measured against it. */
export function roundPlanLines(
  plan: ExperimentSubmission | null,
  analysis: IterationAnalysis | null,
): string[] {
  if (plan === null) {
    return [
      analysis === null
        ? `Round plan: the Builder has not yet written an ${EXPERIMENT_FILE} for this round.`
        : `Round plan: no ${EXPERIMENT_FILE} was recorded with this battery, so there is no stated intent to read it against.`,
    ];
  }
  const families = plan.families.map((row) => `${row.family} at ${row.level} — ${row.move}`).join("; ");
  return [
    `Round plan (${EXPERIMENT_FILE}, ${plan.scope} scope), the Builder's stated intent for this round:`,
    `Gap: ${plan.gap}`,
    `Change: ${plan.change}`,
    `Expected result: ${plan.expectedResult}`,
    targetLine(plan, analysis),
    `Families: ${families}`,
    predictionLine(plan, analysis),
  ];
}
