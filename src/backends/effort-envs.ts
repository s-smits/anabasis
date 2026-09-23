import type { BackendKind, BackendSlot } from "./backend-kinds.ts";

/** Per-slot reasoning-effort environment variables for the transports that expose effort. This
 *  table defines the `<KIND>_<SLOT>_REASONING_EFFORT` names the resolver reads, and an explicit
 *  environment value takes precedence over the slot default. It lives beside slot-defaults.ts
 *  because it describes configuration precedence rather than backend identity. A kind absent here
 *  has no effort variable at all; each transport still validates the resolved effort against the
 *  values it supports before a session starts, so a name here is not a promise that any level
 *  works. */
const REASONING_EFFORT_ENV_BY_SLOT = {
  codex: {
    builder: "CODEX_BUILDER_REASONING_EFFORT",
    built: "CODEX_BUILT_REASONING_EFFORT",
    review: "CODEX_REVIEW_REASONING_EFFORT",
  },
  openrouter: {
    builder: "OPENROUTER_BUILDER_REASONING_EFFORT",
    built: "OPENROUTER_BUILT_REASONING_EFFORT",
    review: "OPENROUTER_REVIEW_REASONING_EFFORT",
  },
  claude: {
    builder: "CLAUDE_BUILDER_REASONING_EFFORT",
    built: "CLAUDE_BUILT_REASONING_EFFORT",
    review: "CLAUDE_REVIEW_REASONING_EFFORT",
  },
} satisfies Partial<Record<BackendKind, Record<BackendSlot, string>>>;

export function reasoningEffortEnv(kind: BackendKind, slot: BackendSlot): string | undefined {
  return REASONING_EFFORT_ENV_BY_SLOT[kind][slot];
}
