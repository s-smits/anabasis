/**
 * Resolve the Builder and Built Harness slots. This was split out of resolve.ts after live-run-02
 * failed preflight: `resolveSide` hardcoded an unconfigured default of codex while the support
 * table did not then list a Codex authoring session, so every fresh project failed before it built
 * anything. The defaults now come from project-backend-policy.ts, which also records slot support,
 * which means adding a transport no longer changes a default by itself.
 *
 * Selection precedence is unchanged: the operator file's kind, then the environment pin, then the
 * declared default. Unknown kinds and unavailable transports are refused together with the
 * configuration source that named them. Models resolve through the descriptor registry and its
 * named environment variables; operator files may not set them.
 */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import {
  BACKEND_KINDS,
  type BackendKind,
  type BackendSlot,
  backendDescriptor,
  denominateBackendModel,
  isBackendKind,
} from "./backend-kinds.ts";
import { reasoningEffortEnv } from "./effort-envs.ts";
import type { RepoEnv } from "./env.ts";
import { openRouterProviderPin } from "./openrouter-model.ts";
import type { OperatorPin } from "./operator-selection.ts";
import { defaultBackendFor } from "./project-backend-policy.ts";
import { slotModelDefault, slotReasoningDefault } from "./slot-defaults.ts";
import { keyIfTruthy } from "../meta/optional-key.ts";
import { isString } from "../meta/json-shape.ts";
import { hasText } from "../meta/text.ts";

export type SlotChoice = {
  kind: BackendKind;
  /** Resolved provider model, recorded as part of the run condition even when selected by default. */
  model: string | null;
  /** Present only for transports whose serving configuration includes reasoning effort. */
  reasoningEffort?: string;
  /** Ordered exclusive upstream route, resolved once with the slot rather than reread later. */
  providerPin?: string[];
  source: "operator" | "env" | "default";
};

export function backendConditionPin(choice: Pick<SlotChoice, "kind" | "model" | "providerPin">): string {
  const base = `${choice.kind}/${choice.model ?? "unresolved"}`;
  if (choice.kind !== "openrouter") return base;
  return `${base}@providers=${choice.providerPin?.join(",") ?? "unconstrained"}`;
}

export function requireKind(value: unknown, where: string): BackendKind {
  if (!isString(value) || !isBackendKind(value)) {
    throw new Error(
      `${where} names unknown backend kind ${capturedJsonStringify(value)}; choose one of [${BACKEND_KINDS.join(", ")}]`,
    );
  }
  return value;
}

export function requireVendoredTransport(kind: BackendKind, where: string): void {
  if (backendDescriptor(kind).transportVendored) return;
  const runnable = BACKEND_KINDS.filter((candidate) => backendDescriptor(candidate).transportVendored).join(
    ", ",
  );
  throw new Error(
    `${where} resolved to "${kind}" but v2 vendors no ${kind} transport — an unrunnable engine refuses at resolution, never silently runs another backend; choose one of [${runnable}] or vendor the ${kind} transport`,
  );
}

function nonEmptyEnv(env: Record<string, string>, name: string): string | undefined {
  const pin = env[name];
  if (pin === undefined) return undefined;
  const normalized = pin.trim();
  if (!normalized) {
    throw new Error(`env ${name} is empty — a model or reasoning-effort pin must be non-empty`);
  }
  return normalized;
}

function resolveModel(kind: BackendKind, env: Record<string, string>, side: BackendSlot): string | undefined {
  const descriptor = backendDescriptor(kind);
  if (descriptor.usesFixedModelLabel) return descriptor.fixedModelLabel;
  const slotEnv = descriptor.modelEnvBySlot?.[side];
  const slug =
    (hasText(slotEnv) ? nonEmptyEnv(env, slotEnv) : undefined) ??
    (side === "review" && kind !== "codex" ? nonEmptyEnv(env, "REVIEW_MODEL") : undefined) ??
    (hasText(descriptor.modelEnv) ? nonEmptyEnv(env, descriptor.modelEnv) : undefined) ??
    slotModelDefault(kind, side, descriptor.defaultModel);
  if (!hasText(slug)) {
    throw new Error(
      `${side} resolved to ${kind} but no model: set ${descriptor.modelEnv ?? "a model env"} — a modeless run denominates nothing`,
    );
  }
  return denominateBackendModel(kind, slug);
}

function resolveReasoningEffort(
  kind: BackendKind,
  env: Record<string, string>,
  side: BackendSlot,
): string | undefined {
  const descriptor = backendDescriptor(kind);
  const slotEnv = reasoningEffortEnv(kind, side);
  return (
    (hasText(slotEnv) ? nonEmptyEnv(env, slotEnv) : undefined) ??
    slotReasoningDefault(kind, side, descriptor.defaultReasoningEffort)
  );
}

export function resolvedSlot(
  kind: BackendKind,
  env: Record<string, string>,
  side: BackendSlot,
  source: SlotChoice["source"],
): SlotChoice {
  const model = resolveModel(kind, env, side);
  const reasoningEffort = resolveReasoningEffort(kind, env, side);
  const providerPin = kind === "openrouter" ? openRouterProviderPin(env) : undefined;
  return {
    kind,
    model: model ?? null,
    source,
    ...keyIfTruthy("reasoningEffort", reasoningEffort),
    ...keyIfTruthy("providerPin", providerPin),
  };
}

export function resolveSide(
  side: "builder" | "built",
  pin: OperatorPin,
  envVar: string,
  repo: RepoEnv,
): SlotChoice {
  const { side: operator, path: operatorPath } = pin;
  if (operator?.model !== undefined) {
    throw new Error(
      `${operatorPath}: ${side}.model is not an operator field — models are denominated by the descriptor registry (env for slug engines) so run records stay comparable`,
    );
  }
  // `disabled` and `inherit` belong to the review slot, the only slot with an off state. Ignoring
  // either here would resolve this slot to the standing default with no sign that the operator had
  // asked for anything else -- a silent slot substitution, which is the defect class this whole
  // file refuses.
  if (operator?.disabled !== undefined) {
    throw new Error(
      `${operatorPath}: ${side}.disabled is review-only; choose a backend kind or remove the key`,
    );
  }
  if (operator?.inherit !== undefined) {
    throw new Error(
      `${operatorPath}: ${side}.inherit is review-only; choose a backend kind or remove the key`,
    );
  }
  if (operator?.kind !== undefined) {
    const kind = requireKind(operator.kind, `${operatorPath}: ${side}.kind`);
    requireVendoredTransport(kind, `${operatorPath}: ${side}.kind`);
    return resolvedSlot(kind, repo.env, side, "operator");
  }
  const fromEnv = repo.env[envVar];
  if (fromEnv !== undefined) {
    const kind = requireKind(fromEnv, `env ${envVar}`);
    requireVendoredTransport(kind, `env ${envVar}`);
    return resolvedSlot(kind, repo.env, side, "env");
  }
  const kind = defaultBackendFor(side);
  requireVendoredTransport(kind, `${side} slot (unconfigured default)`);
  return resolvedSlot(kind, repo.env, side, "default");
}
