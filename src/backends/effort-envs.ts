import type { BackendKind, BackendSlot } from "./backend-kinds.ts";

/** Per-slot `<KIND>_<SLOT>_REASONING_EFFORT` variables, which win over the slot default. A kind
 *  absent here has no effort variable; each transport still validates the resolved effort. */
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
