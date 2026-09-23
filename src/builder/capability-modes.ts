/**
 * Which isolation modes each Builder capability requests.
 *
 * Split from `tools.ts` on 2026-08-20, when adding the destructive-command guard to `bash` would
 * have taken that file past its size limit. The map describes the access modes each tool requests;
 * registering the tools themselves stays in `tools.ts`, which re-exports this.
 *
 * The rule it carries is unchanged. Declared here means isolated, absent means research, and
 * `session-evidence.ts` reads exactly this map to tell the two apart — so a new path capability
 * that arrives without its declaration is recorded as unisolated research for any reader of that
 * evidence to see.
 */
import type { IsolationMode } from "./candidate-isolation.ts";

/** The workshop capability's name. The map below is keyed by plain strings, so the two files that
 *  pass this name to `guardPath` — verifier-workshop.ts and verifier-workshop-export.ts — agree
 *  through this export rather than through spelling it the same twice. */
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
