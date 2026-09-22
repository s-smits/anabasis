import piAgentPackage from "@earendil-works/pi-agent-core/package.json" with { type: "json" };
import type { CompactionMode } from "./backend-types.ts";

/** Native source names for the small evidence emitted after an exact model pin is accepted. */
export const MODEL_CATALOGUE_SOURCES = {
  pi: "pi-provider-catalogue",
  /** A live provider slug the Pi catalogue does not list. Kept separate from `pi` so the evidence
   *  never reports catalogue confirmation for an unlisted model. */
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
  /** Upstream hosts a routed provider was pinned to (OpenRouter's `provider.only`). Absent when
   *  the provider routes freely, which is a different serving condition from a pinned one.
   *  Not `readonly`: this row is recorded into the case record as JSON, and a readonly array is not
   *  assignable to `JsonValue`, which is required for storing the whole record. */
  providerPin?: string[];
  /** Claude only: who compacted the slot's context. A serving condition, recorded beside the model. */
  compaction?: CompactionMode;
};
