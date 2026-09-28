/**
 * What the round set out to do, as the Epoch Reviewer reads it.
 *
 * The Builder may record its intent in `EXPERIMENT.json`: the gap it saw, the change it made, the
 * families it changed and the verified passes it expects. The reviewer is the one component that
 * reads the measured tree against the original request, and without the plan it can only ask
 * whether the result was earned in general, not whether the round did what it claimed to be doing.
 * So the plan comes with its scores: the declared families against the families whose public tasks
 * changed, inputs or rules, and once a battery is measured, the pass range against its verified
 * count.
 *
 * Nothing protected crosses. The plan is the Builder's own public-facing text.
 */
import { EXPERIMENT_FILE } from "../author/builder-memory.ts";
import { type RoundPlan, planScoreLine, statedRange } from "../author/experiment-plan.ts";
import type { IterationAnalysis } from "../analyse/iteration-analysis.ts";

/** The plan block of the orientation. A measured battery reads the plan recorded with it; a
 *  checkpoint reads the plan in the workspace, with nothing yet measured against it. */
export function roundPlanLines(round: RoundPlan, analysis: IterationAnalysis | null): string[] {
  const { plan } = round;
  if (plan === null) {
    return [
      analysis === null
        ? `Round plan: the Builder has not yet written an ${EXPERIMENT_FILE} for this round.`
        : `Round plan: no ${EXPERIMENT_FILE} was recorded with this battery, so there is no stated intent to read it against.`,
    ];
  }
  const scored = planScoreLine(round, analysis === null ? null : analysis.battery.summary.passed);
  // A scored plan names its families and its range in the score, so each is listed alone only
  // while it has nothing to be scored against.
  const unscoredFamilies = round.changedFamilies === null ? plan.families : undefined;
  const unscoredRange = analysis === null ? plan.expectedPasses : undefined;
  return [
    `Round plan (${EXPERIMENT_FILE}), the Builder's stated intent for this round:`,
    ...(plan.gap === undefined ? [] : [`Gap: ${plan.gap}`]),
    ...(plan.change === undefined ? [] : [`Change: ${plan.change}`]),
    ...(unscoredFamilies === undefined
      ? []
      : [`Families named as changed: ${unscoredFamilies.join(", ") || "none"}`]),
    ...(unscoredRange === undefined ? [] : [`Expected verified passes: ${statedRange(unscoredRange)}`]),
    ...(scored === null ? [] : [`Scored: ${scored}.`]),
  ];
}
