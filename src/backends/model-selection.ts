import piAgentPackage from "@earendil-works/pi-agent-core/package.json" with { type: "json" };
import type { CompactionMode } from "./backend-types.ts";

/** Native source names for the small evidence emitted after an exact model pin is accepted. */
export const MODEL_CATALOGUE_SOURCES = {
  pi: "pi-provider-catalogue",
  /** A live provider slug the Pi catalogue does not list, so no catalogue confirmation is claimed. */
  piUnlisted: "pi-provider-slug-unlisted",
  faux: "faux-provider",
} as const;

/** One installed Pi runtime identity shared by preflight and completed-turn evidence. */
export const PI_AGENT_RUNTIME = { id: "pi-agent-core", version: piAgentPackage.version } as const;

type CatalogueSource = (typeof MODEL_CATALOGUE_SOURCES)[keyof typeof MODEL_CATALOGUE_SOURCES];

export type ModelSelectionEvidence = {
  resolvedModel: string;
  effort: string;
  source: CatalogueSource;
  /** Upstream hosts a routed provider was pinned to (OpenRouter's `provider.only`); absent when it
   *  routes freely. Mutable, because a readonly array is not assignable to `JsonValue`. */
  providerPin?: string[];
  /** Claude only: who compacted the slot's context, a serving condition. */
  compaction?: CompactionMode;
};
