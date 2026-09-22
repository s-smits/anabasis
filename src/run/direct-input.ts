/**
 * The model-visible direct input: the user's exact prompt and immutable public context.
 * Project identity and launch ordering live in full-run-launch.ts; this file contributes no
 * routing, domain inference, researched facts, or controller state.
 */
import type { PreparedUserContext } from "../builder/user-context.ts";
import { contextManifest } from "../builder/user-context.ts";
import type { AskManifest } from "./ask-manifest.ts";
import { BATTERY_SIZE } from "./battery-sizing.ts";

/** Adds operating labels, not researched facts, hints, or a rewritten specification. */
export function directKickoff(prompt: string, context: PreparedUserContext): string {
  return [
    "USER REQUEST (verbatim)",
    prompt,
    "",
    contextManifest(context),
    "",
    "Research and build a harness for this request from public sources. Do not invent extra requirements, and do not drop or replace the ones the request names: every capability it asks for belongs in the verified tasks.",
  ].join("\n");
}

/** Routing metadata only. No lookup or inferred domain content occurs; identity stays this run's. */
export function directManifest(projectId: string): AskManifest {
  return {
    slug: projectId,
    domain: projectId,
    expectedTasks: BATTERY_SIZE.default,
  };
}
