/**
 * Which isolation modes each Builder capability requests.
 *
 * Split from `tools.ts` on 2026-08-20 when adding the destructive-command guard to `bash`
 * would have exceeded that file's size limit. This map describes the access modes each tool
 * requests; tool registration remains in `tools.ts`. `session-evidence.ts` reads the map
 * to distinguish capabilities with declared isolation modes from research capabilities.
 * The recorded classification follows these declarations.
 *
 * The rule it carries is unchanged. Declared here means isolated, absent means research, so a new
 * path capability must include its declaration or the session evidence records it as unisolated
 * research for anyone to see.
 */

import type { IsolationMode } from "./candidate-isolation.ts";

/** The workshop capability's name. The map below is keyed by plain strings, so the two files
 *  that pass this name to `guardPath` agree through this export rather than through spelling. */
export const VERIFIER_WORKSHOP = "verifier_workshop";

/** The isolation modes each capability requests, declared beside the roster it describes. */
export const BUILDER_CAPABILITY_MODES = new Map<string, readonly IsolationMode[]>([
  ["read", ["read"]],
  ["grep", ["read"]],
  ["find", ["read"]],
  ["ls", ["read"]],
  ["edit", ["write"]],
  ["write", ["write"]],
  ["bash", ["exec"]],
  ["public_source", ["write"]],
  [VERIFIER_WORKSHOP, ["read", "write", "exec"]],
]);
