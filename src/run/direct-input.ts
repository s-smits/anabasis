/**
 * The model-visible direct input: the user's exact prompt and immutable public context.
 * Project identity and launch ordering live in full-run-launch.ts; this file contributes no
 * routing, domain inference, researched facts, or controller state.
 */
import type { PreparedUserContext } from "../builder/user-context.ts";
import { contextManifest } from "../builder/user-context.ts";
import type { AskManifest } from "./ask-manifest.ts";
import { BATTERY_SIZE } from "./battery-sizing.ts";

/** Adds operating labels, not researched facts, hints, or a rewritten specification. The closing
 *  line says only what the system prompt does not: that the request is researched from public
 *  sources and grows no requirement it does not name. Keeping every capability it does name is the
 *  system prompt's scope clause, which the Builder reads on every turn.
 *
 *  The line reads as the user's own, so its second half matters as much as its first. Without it, a
 *  Builder quotes "add no requirement it does not name" to decline the stricter routes its own notes
 *  found open, which leaves only size, and size alone asks nothing new. Asking more of an obligation
 *  the request names is the climb, not an addition to it (AGENTS.md "Goals and the climb"). */
export function directKickoff(prompt: string, context: PreparedUserContext): string {
  return [
    "USER REQUEST (verbatim)",
    prompt,
    "",
    contextManifest(context),
    "",
    "Research and build a harness for this request from public sources, and add no requirement it does not name; a stricter demand on one it does name is not an added requirement.",
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
