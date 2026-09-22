/** Build opens the product; an explicit climb fixes it and authors the battery. Accepted bytes
 * determine whether a product proposal is an evaluation correction, recorded as evaluation. */
export type HarnessAuthoring = "build" | "climb";
export type HarnessExperiment = HarnessAuthoring | "evaluation";
