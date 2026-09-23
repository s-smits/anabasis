import type { BackendKind, BackendSlot } from "./backend-kinds.ts";

interface SlotDefaults {
  model?: string;
  reasoningEffort?: string;
}

/** Role-specific transport defaults. A transport upgrade belongs here rather than in the shared
 *  descriptor fallback, because a slot is what an operator reasons about: changing the fallback
 *  moves every slot at once, including the ones whose recorded condition was meant to stay put.
 *  Explicit slot and transport env pins still win over this table in resolve.ts. */
const BACKEND_SLOT_DEFAULTS = new Map<BackendKind, Partial<Record<BackendSlot, SlotDefaults>>>([
  [
    "codex",
    {
      builder: { model: "gpt-5.6-luna", reasoningEffort: "xhigh" },
      built: { model: "gpt-5.6-luna", reasoningEffort: "xhigh" },
      review: { model: "gpt-5.6-luna", reasoningEffort: "xhigh" },
    },
  ],
]);

function defaultsFor(kind: BackendKind, slot: BackendSlot): SlotDefaults | undefined {
  const bySlot = BACKEND_SLOT_DEFAULTS.get(kind);
  return bySlot?.[slot];
}

export function slotModelDefault(
  kind: BackendKind,
  slot: BackendSlot,
  fallback: string | undefined,
): string | undefined {
  return defaultsFor(kind, slot)?.model ?? fallback;
}

export function slotReasoningDefault(
  kind: BackendKind,
  slot: BackendSlot,
  fallback: string | undefined,
): string | undefined {
  return defaultsFor(kind, slot)?.reasoningEffort ?? fallback;
}
