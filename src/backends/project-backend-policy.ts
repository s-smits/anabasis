import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { join } from "../meta/path.ts";
import { assertPathSegment } from "../meta/path-segment.ts";
import {
  BACKEND_KINDS,
  type BackendKind,
  type BackendSlot,
  backendDescriptor,
  isBackendKind,
} from "./backend-kinds.ts";
import { OPERATOR_BACKENDS_DIR } from "./operator-selection.ts";

export type ProjectBackendSlot = BackendSlot;
export type ProjectBackendSelection = BackendKind | "disabled" | "inherit";

export interface ProjectBackendChoice {
  value: ProjectBackendSelection;
  label: string;
  supported: boolean;
}

const COMPLETE_INTERFACES = {
  // Every kind serves every slot: the Builder and review slots run the one pi host session
  // (pi-session.ts) with the campaign's host-enforced tools, and the Built slot runs pi in its
  // confined child.
  builder: ["claude", "codex", "openrouter"],
  built: ["codex", "claude", "openrouter"],
  review: ["codex", "claude", "openrouter"],
} satisfies Readonly<Record<ProjectBackendSlot, readonly [BackendKind, ...BackendKind[]]>>;

/** Defaults are independent of support order, so adding support cannot silently move a run. */
const SLOT_DEFAULTS = {
  builder: "claude",
  built: "claude",
} satisfies Readonly<Record<Exclude<ProjectBackendSlot, "review">, BackendKind>>;

export function backendSupportsSlot(slot: ProjectBackendSlot, kind: BackendKind): boolean {
  return COMPLETE_INTERFACES[slot].includes(kind);
}

/**
 * Refuse a resolved slot whose kind has no complete interface, beside the table that decides it.
 *
 * `harness-build.ts` and `harness-measure.ts` each spelled this guard themselves, and the Builder's
 * remedy also spelled the table back as prose — "pin builder to claude, codex, or openrouter" — so
 * a kind gaining support had to be written in two files for the refusal to stay true. The reason
 * clause stays with the caller, because what an incomplete slot costs differs: a Builder cannot
 * author the bundle, a Built battery cannot be verified.
 */
export function requireSlotSupport(
  slot: ProjectBackendSlot,
  kind: BackendKind,
  source: string,
  slug: string,
  reason: string,
): void {
  if (backendSupportsSlot(slot, kind)) return;
  throw new Error(
    `${slot} slot resolved to "${kind}" (source: ${source}): ${reason}. Pin ${slot} to one of ` +
      `${COMPLETE_INTERFACES[slot].join(", ")} in .harness/backends/${slug}.json or ` +
      `HARNESS_${slot.toUpperCase()}_BACKEND`,
  );
}

export function defaultBackendFor(slot: Exclude<ProjectBackendSlot, "review">): BackendKind {
  const kind = SLOT_DEFAULTS[slot];
  if (!backendSupportsSlot(slot, kind)) {
    throw new Error(
      `slot ${slot} defaults to ${kind}, which its completeness row does not support — a default must be a supported kind`,
    );
  }
  return kind;
}

export function projectBackendChoices(slot: ProjectBackendSlot): ProjectBackendChoice[] {
  const kinds = BACKEND_KINDS.map((kind) => ({
    value: kind,
    label: backendDescriptor(kind).shortLabel,
    supported: backendSupportsSlot(slot, kind),
  }));
  if (slot !== "review") return kinds;
  return [
    { value: "disabled", label: "Disabled", supported: true },
    { value: "inherit", label: "Same as Built Harness", supported: true },
    ...kinds,
  ];
}

export function assertProjectBackendSelection(
  slot: ProjectBackendSlot,
  selection: ProjectBackendSelection,
): void {
  if (selection === "disabled" || selection === "inherit") {
    if (slot !== "review") throw new Error(`${slot} cannot be ${selection}`);
    return;
  }
  if (!isBackendKind(selection)) throw new Error(`unknown backend ${capturedJsonStringify(selection)}`);
  if (!backendSupportsSlot(slot, selection)) {
    const supported = COMPLETE_INTERFACES[slot].join(", ");
    throw new Error(`${selection} does not support the ${slot} role; choose ${supported || "none"}`);
  }
}

export function operatorBackendsPath(repoRoot: string, projectId: string): string {
  try {
    assertPathSegment("project", projectId);
  } catch {
    throw new Error(`project id ${capturedJsonStringify(projectId)} is invalid; use one path segment`);
  }
  return join(repoRoot, OPERATOR_BACKENDS_DIR, `${projectId}.json`);
}
