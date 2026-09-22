/**
 * What a run checks and records about its model slots before any paid turn.
 *
 * The Builder and review slots resolve through the shared provider layer: the slot's credential
 * and the pi catalogue's model and effort gate. Neither makes a
 * provider call. The Built slot starts its exact confined worker once under the solve policy.
 */
import type { ModelSelectionEvidence } from "../backends/model-selection.ts";
import {
  type PiSlotChoice,
  type PiSlotRuntime,
  claudeCliExecutable,
  piModelSelection,
} from "../backends/pi-providers.ts";
import { type PiBuiltRuntime, preflightPiBuilt } from "../backends/pi-built.ts";
import type { ResolvedSlots, ReviewChoice } from "../backends/resolve.ts";
import { reviewSlot } from "../review/review-session.ts";
import { builderSlot } from "./builder-backend.ts";
import { type HostRuntimeIdentity, hostRuntimeIdentity } from "./host-runtime-policy.ts";
import { SOURCE_IDENTITY, type SourceIdentity } from "./source-identity.ts";

type CampaignModelSelections = {
  builder: ModelSelectionEvidence | null;
  built: ModelSelectionEvidence;
  review: ModelSelectionEvidence | null;
};

/** Where a campaign records its backend startup evidence, for the authoring wall and the battery. */
export const BACKENDS_FILE = "backends.json";

export type BackendStartupEvidence = ResolvedSlots & {
  source: SourceIdentity | null;
  hostRuntime: HostRuntimeIdentity;
  modelSelections: CampaignModelSelections;
};

/** One preflight: the host slots it checks, the Built runtime whose credential is already resolved,
 *  and which phase is asking. Authoring checks the Builder; both phases check the review slot,
 *  because the Epoch Reviewer reads during authoring and the Main Judge during measurement. */
type ModelPreflight = {
  readonly builder: PiSlotChoice;
  readonly review: ReviewChoice;
  readonly repoRoot: string;
  readonly builtRuntime: PiBuiltRuntime;
  readonly phase?: "authoring" | "measurement" | undefined;
};

/**
 * What a run records about the condition it is about to measure.
 *
 * Built in two places before this: the measurement driver puts it on its result and the Builder
 * runtime writes it to `BACKENDS_FILE`. AGENTS.md asks every opening tuple to match the intended
 * condition before battery spend, and two constructions of one record cannot promise that — a
 * field added to the type reaches whichever of them the author happened to open.
 */
export function backendStartupEvidence(
  slots: ResolvedSlots,
  hostRuntime: HostRuntimeIdentity,
  modelSelections: CampaignModelSelections,
): BackendStartupEvidence {
  return { ...slots, source: SOURCE_IDENTITY, hostRuntime, modelSelections };
}

/** A host slot is ready when its credential resolved, its model and effort pass the catalogue gate
 *  and, on the claude transport, the CLI the bridge drives is installed. No provider call. */
async function hostSlotSelection(slot: PiSlotRuntime): Promise<ModelSelectionEvidence> {
  if (slot.profile.transport === "claude") claudeCliExecutable();
  await slot.auth();
  return piModelSelection(slot.profile);
}

export async function preflightCampaignModels(request: ModelPreflight) {
  const { builder, review, repoRoot, builtRuntime } = request;
  const authoring = (request.phase ?? "authoring") === "authoring";
  // Host slots first: a missing login refuses before the Built worker spawns.
  const builderSelection = authoring ? await hostSlotSelection(builderSlot(builder, repoRoot)) : null;
  const reviewSelection = review.enabled ? await hostSlotSelection(reviewSlot(review, repoRoot)) : null;
  const hostRuntime = hostRuntimeIdentity();
  const builtSession = await preflightPiBuilt(builtRuntime);
  return {
    hostRuntime,
    modelSelections: {
      builder: builderSelection,
      built: builtSession.modelSelection,
      review: reviewSelection,
    },
    builtSession,
  };
}
