/**
 * Which isolation modes each Builder capability requests.
 *
 * Declared here means isolated; absent means research. `session-evidence.ts` reads this map, so a
 * new path capability without a declaration is recorded as unisolated research.
 */
import type { IsolationMode } from "./candidate-isolation.ts";

/** The workshop capability's name, shared so every `guardPath` caller spells it the same. */
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
