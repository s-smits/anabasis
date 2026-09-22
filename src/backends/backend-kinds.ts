/**
 * The backend kinds each model slot may select, and their descriptors. A selection name may differ
 * from the runtime `BackendId` a turn reports. Dispatch is exhaustive over `BackendKind`, so adding
 * a kind here makes typechecking name every caller that must handle it.
 */
import { isString, type JsonValue } from "../meta/json-shape.ts";
import type { BackendId } from "./backend-types.ts";

/** The selectable engines, in display order. */
export const BACKEND_KINDS = ["codex", "openrouter", "claude"] as const;

/** A user/operator backend selection. */
export type BackendKind = (typeof BACKEND_KINDS)[number];

/** The three independently configured model slots. `review` serves three callers
 *  (review/review-session.ts). */
export type BackendSlot = "builder" | "built" | "review";

/** Everything a side needs to know about an engine that is not the act of running a turn. */
interface BackendKindDescriptor {
  kind: BackendKind;
  label: string;
  shortLabel: string;
  /** The runtime engine id this kind opens. */
  runtimeId: BackendId;
  /** Fixed-label engines (OAuth, no public slug) denominate runs by `fixedModelLabel`; slug engines by the resolved slug. */
  usesFixedModelLabel: boolean;
  fixedModelLabel?: string;
  /** For a slug engine, the env var that overrides its model. */
  modelEnv?: string;
  /** For a slug engine, the default model slug when no env override applies. */
  defaultModel?: string;
  /** A slot-specific model pin wins over `modelEnv`. */
  modelEnvBySlot?: Partial<Record<BackendSlot, string>>;
  /** Default reasoning effort when this transport exposes one. */
  defaultReasoningEffort?: string;
  /** The server-side env var holding this engine's API key, when it authenticates by key. */
  apiKeyEnv?: string;
  /** True when this engine authenticates via an account/OAuth session instead of an API key. */
  usesAccountAuth: boolean;
  /** For an account-auth engine whose login is delivered as an env token, that env var. */
  accountTokenEnv?: string;
  /** Whether this repository has a runnable transport for this kind; resolution refuses a kind
   *  without one rather than substituting another backend. */
  transportVendored: boolean;
}

/** Narrow an untrusted value (operator file, env var, form input) to a known kind. */
export function isBackendKind(value: JsonValue): value is BackendKind {
  return isString(value) && BACKEND_KINDS.some((known) => known === value);
}

/** `satisfies` forces an entry per kind and keeps each entry's literal types. */
const BACKEND_DESCRIPTORS = {
  codex: {
    kind: "codex",
    label: "Codex OAuth",
    shortLabel: "Codex",
    runtimeId: "codex",
    // OAuth names the credential, not the served model; the pi catalogue checks the pin.
    usesFixedModelLabel: false,
    modelEnv: "CODEX_MODEL",
    modelEnvBySlot: {
      builder: "CODEX_BUILDER_MODEL",
      built: "CODEX_BUILT_MODEL",
      review: "CODEX_REVIEW_MODEL",
    },
    defaultModel: "gpt-5.5",
    defaultReasoningEffort: "medium",
    usesAccountAuth: true,
    transportVendored: true,
  },
  openrouter: {
    kind: "openrouter",
    label: "OpenRouter (free-tier test session)",
    shortLabel: "OpenRouter",
    runtimeId: "openrouter",
    usesFixedModelLabel: false,
    modelEnv: "OPENROUTER_MODEL",
    defaultModel: "inclusionai/ling-3.0-flash:free",
    apiKeyEnv: "OPENROUTER_API_KEY",
    usesAccountAuth: false,
    transportVendored: true,
  },
  claude: {
    kind: "claude",
    label: "Claude (Anthropic)",
    shortLabel: "Claude",
    runtimeId: "claude",
    usesFixedModelLabel: false,
    modelEnv: "CLAUDE_MODEL",
    modelEnvBySlot: {
      builder: "CLAUDE_BUILDER_MODEL",
      built: "CLAUDE_BUILT_MODEL",
      review: "CLAUDE_REVIEW_MODEL",
    },
    defaultModel: "claude-opus-5",
    usesAccountAuth: true,
    accountTokenEnv: "CLAUDE_CODE_OAUTH_TOKEN",
    transportVendored: true,
  },
} satisfies Record<BackendKind, BackendKindDescriptor>;

export function backendDescriptor(kind: BackendKind): BackendKindDescriptor {
  return BACKEND_DESCRIPTORS[kind];
}

/**
 * Denominate a side's model for run records: the fixed label for fixed-label engines, otherwise
 * the provider slug the caller resolved.
 */
export function denominateBackendModel(kind: BackendKind, slug: string | undefined): string | undefined {
  const descriptor = backendDescriptor(kind);
  return descriptor.usesFixedModelLabel ? descriptor.fixedModelLabel : slug;
}
