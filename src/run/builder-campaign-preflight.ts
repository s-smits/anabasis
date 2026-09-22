import { unchangedCandidateSubmissions } from "../author/campaign-memory.ts";
import { POLICY } from "../critic/policy.ts";
import type { CampaignOutcome } from "../author/campaign-types.ts";
import type { BuilderCampaignInput, CampaignMemory } from "./builder-campaign.ts";
import type { BuilderSessionInput } from "../author/builder-session.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { renderBatteryContract } from "./climb-readout.ts";
import { taskCountSentence } from "./battery-sizing.ts";

/** The pre-session facts these guards read: a structural subset of `BuilderCampaignInput`. */
type PreSessionInput = Pick<
  BuilderCampaignInput,
  "priorEvidence" | "campaignDir" | "adoptedDir" | "rebuildReset"
>;
/** A draft never opens scope: only the controller's adopted continuation does. */
export function proposesExperiment(
  input: Pick<BuilderCampaignInput, "adoptedDir" | "rebuildReset">,
): boolean {
  return input.adoptedDir !== undefined && input.rebuildReset === undefined;
}

/** Refuse exhausted authoring and environment blockers before opening a model session. */
export function preSessionRefusal(input: PreSessionInput, memory: CampaignMemory): CampaignOutcome | null {
  if (memory.clause !== null) return { buildAdmissible: false, clauses: [memory.clause], iterations: [] };
  // The durable half of the unchanged-candidate ceiling. The round that reached it recorded an
  // authoring-stalled terminal, but the terminal binds one invocation: truss-run1-sol-0830 opened
  // fourteen of them on the same campaign and each started its counters at zero, so the same
  // commit was submitted unchanged 21 times. Reading the replayed per-commit tally here makes a
  // relaunch continue the count rather than restart it, and costs no model turn.
  //
  // The tally counts strikes at the commit this campaign would resubmit. A rebuild resets the
  // workspace to the starter before any session opens, so the counted commit is exactly the tree
  // the round will not resubmit; refusing on it made every rebuild of a stalled epoch a permanent
  // stop, since the epoch key derives from the kickoff and no fresh epoch could open either.
  if (
    input.rebuildReset === undefined &&
    unchangedCandidateSubmissions(memory, []) >= POLICY.loop.unchangedCandidateStrikes
  ) {
    return { buildAdmissible: false, clauses: ["authoring-stalled"], iterations: [] };
  }
  const feedback = [...memory.carried, ...(input.priorEvidence?.feedback ?? [])];
  if (feedback.some((row) => row.severity === "blocking" && row.owner === "environment")) {
    return { buildAdmissible: false, clauses: ["environment-blocked"], iterations: [] };
  }
  return null;
}

/** What the authoring session opens on: the request, the workspace it writes in, the transport facts
 *  its prompt may state, and the controller's opening conditions. Composed beside the other
 *  before-the-session decisions rather than in the controller, which owns what happens after. */
export function builderSessionRequest(
  input: BuilderCampaignInput,
  workspace: string,
  advisory: string | undefined,
): BuilderSessionInput {
  const context = [
    taskCountSentence(input),
    renderBatteryContract(input.expectedTasks, input.minTasks, input.band, proposesExperiment(input)),
    advisory,
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    slug: input.slug,
    kickoff: input.kickoff,
    workspace,
    ...keyIfDefined("maxTurns", input.maxTurns),
    ...keyIfDefined("webSearch", input.webSearch),
    ...keyIfDefined("advisory", context || undefined),
  };
}
