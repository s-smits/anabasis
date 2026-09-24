import type { ExperimentPlan } from "../../src/author/experiment-plan.ts";

/** The fields an `experiment-plan/v2` plan carries beyond the gap, change, expected result and
 *  target, for fixtures whose subject is something else. */
export const PLAN_FIELDS: Pick<ExperimentPlan, "schema" | "families" | "predictions"> = {
  schema: "experiment-plan/v2",
  families: [{ family: "uppercase", level: "frontier", move: "Couple two published limits in one answer." }],
  predictions: [],
};
