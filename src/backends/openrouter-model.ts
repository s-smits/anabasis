/**
 * The one owner of an OpenRouter model pin and its provider routing, shared by the host transport
 * that serves the Builder and review slots and by the confined Built child, so all three resolve
 * one slug the same way.
 *
 * Two facts live here:
 *
 * - Which model entry a slug resolves to. The Pi catalogue is incomplete: it omits `:free` variants
 *   and dated snapshots, while OpenRouter's endpoint accepts any live slug. Refusing an unlisted
 *   slug would therefore reject real models, and synthesising a generic entry for one drops the
 *   catalogue's `compat` flags -- pi-ai auto-detects
 *   `requiresReasoningContentOnAssistantMessages` for DeepSeek, and a generic entry would lose it.
 *   A dated snapshot takes its listed base model's metadata under the requested id, and only a slug
 *   the catalogue cannot place at all falls back to the generic entry.
 * - Which upstream host serves it. `OPENROUTER_PROVIDER` names one or more provider slugs;
 *   pi-ai sends `model.compat.openRouterRouting` as the request's `provider` field.
 */
import { type Model, type OpenRouterRouting, createModels } from "@earendil-works/pi-ai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { EnvironmentRefusal } from "./environment-refusal.ts";
import { MODEL_CATALOGUE_SOURCES, type ModelSelectionEvidence } from "./model-selection.ts";
import type { OptionalEnvValues } from "./scrub-env.ts";
import { hasText } from "../meta/text.ts";

const GENERATION_PROVIDER = "openrouter" as const;
const DATED_VARIANT_ID = /^(.+)-(?:\d{4}(?:-\d{2}-\d{2})?|\d{8})$/;

/** The env var naming the upstream provider(s) OpenRouter may route to. */
const OPENROUTER_PROVIDER_ENV = "OPENROUTER_PROVIDER";

/** OpenRouter's own endpoint. Any other value is a different host using the same protocol. */
const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

/** The output allowance a synthesised entry promises, and the smallest input reserve a declared
 *  custom window must leave beside it. One pair owns both numbers, because the refusal below
 *  compares them against the declared window and they cannot be allowed to drift apart. */
const CUSTOM_MAX_TOKENS = 16_384;
const MIN_INPUT_RESERVE = 8_192;

export interface OpenRouterEndpoint {
  /** The OpenAI-completions base a request is sent to, with `/chat/completions` appended. */
  baseUrl: string;
  /** The env var name holding this endpoint's key. The name only: the value never enters this
   *  record, so nothing that logs an endpoint can log a credential. */
  apiKeyEnv: string;
  /** Somewhere other than OpenRouter, so it serves its own slugs and reads no upstream routing. */
  custom: boolean;
  /** The context window this host serves, when `CUSTOM_CONTEXT_WINDOW` declares one. Prompt
   *  admission and compaction both read it; an absent value keeps the conservative default rather
   *  than a guess. */
  contextWindow?: number;
}

interface OpenRouterModelPin {
  model: Model<"openai-completions">;
  /** How the entry was found: an exact catalogue id, or a slug the catalogue does not list. */
  source: ModelSelectionEvidence["source"];
}

/** Comma-separated provider slugs, in preference order. Absent or blank means "no pin". */
export function openRouterProviderPin(env: Record<string, string | undefined>): string[] | undefined {
  const raw = env[OPENROUTER_PROVIDER_ENV]?.trim();
  if (!hasText(raw)) return undefined;
  const slugs = raw.split(",").map((slug) => slug.trim());
  if (slugs.some((slug) => slug.length === 0)) {
    throw new Error(`${OPENROUTER_PROVIDER_ENV} contains an empty provider slug`);
  }
  if (new Set(slugs).size !== slugs.length) {
    throw new Error(`${OPENROUTER_PROVIDER_ENV} contains a duplicate provider slug`);
  }
  return slugs;
}

/**
 * A pin is ordered and exclusive: `order` preserves preference, `only` restricts routing to the
 * named hosts, and `allow_fallbacks: false` refuses a substitute. Without the refusal a run that
 * silently moved to another host would compare two servings of the same slug as one condition.
 */
function openRouterRouting(pin: readonly string[] | undefined): OpenRouterRouting | undefined {
  if (pin === undefined) return undefined;
  if (pin.length === 0 || pin.some((slug) => slug.length === 0 || slug !== slug.trim())) {
    throw new Error("OpenRouter provider pin must contain trimmed non-empty provider slugs");
  }
  if (new Set(pin).size !== pin.length) throw new Error("OpenRouter provider pin contains a duplicate slug");
  return { order: [...pin], only: [...pin], allow_fallbacks: false };
}

/** A generic entry for a slug the catalogue does not list, and whose base model it does not list
 *  either. An invalid slug then produces an OpenRouter API error when requested. */
function genericEntry(
  id: string,
  baseUrl = OPENROUTER_DEFAULT_BASE_URL,
  contextWindow = 128_000,
): Model<"openai-completions"> {
  return {
    id,
    name: id,
    api: "openai-completions",
    provider: GENERATION_PROVIDER,
    baseUrl,
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    // Output never promises more than half the window, so a small declared context cannot be
    // handed an output allowance the server has no room to serve.
    maxTokens: Math.min(CUSTOM_MAX_TOKENS, Math.floor(contextWindow / 2)),
  } satisfies Model<"openai-completions">;
}

/**
 * The listed base model of a dated snapshot, re-identified as the requested slug:
 * `deepseek/deepseek-v4-flash-0731` takes `deepseek/deepseek-v4-flash`'s entry. Only a dated `-`
 * suffix qualifies, because a snapshot date carries its base model's context window, compat flags
 * and thinking levels unchanged, while `:free` and the other tags change the terms of service
 * enough to price differently.
 */
function datedVariantOf(
  models: ReturnType<typeof createModels>,
  id: string,
): Model<"openai-completions"> | undefined {
  const baseId = DATED_VARIANT_ID.exec(id)?.[1];
  if (baseId === undefined) return undefined;
  const base =
    /* SAFETY: the catalogue serves one completions provider, so every entry it returns for it
     *  carries that transport. */
    models.getModel(GENERATION_PROVIDER, baseId) as Model<"openai-completions"> | undefined;
  return base === undefined ? undefined : { ...base, id, name: id };
}

/**
 * Resolve one slug to the entry a turn will be served with, plus the pinned upstream provider.
 *
 * A `baseUrl` is given only when the turn goes somewhere other than OpenRouter, and that host
 * answers for its own slugs: every catalogue entry carries OpenRouter's own `baseUrl`, so returning
 * one would send the turn to OpenRouter while the operator believed they had pinned their host.
 *
 * A custom host's context window is a declared fact rather than an inferred one, because this
 * endpoint abstraction serves any OpenAI-compatible host and there is nothing to infer it from. An
 * undeclared window falls back to the same conservative 128k default an unlisted OpenRouter slug
 * gets, and an operator with a larger or smaller server names it through `CUSTOM_CONTEXT_WINDOW`.
 * Compaction reads this value, so an inflated default would compact too late and fail at the server
 * boundary.
 */
export function resolveOpenRouterModelPin(
  id: string,
  pin?: readonly string[],
  baseUrl?: string,
  contextWindow?: number,
): OpenRouterModelPin {
  if (baseUrl !== undefined) {
    return {
      model: genericEntry(id, baseUrl, contextWindow ?? 128_000),
      source: MODEL_CATALOGUE_SOURCES.piUnlisted,
    };
  }
  const models = createModels();
  models.setProvider(openrouterProvider());
  const listed =
    /* SAFETY: the catalogue serves one completions provider, so every entry it returns for it
     *  carries that transport. */
    models.getModel(GENERATION_PROVIDER, id) as Model<"openai-completions"> | undefined;
  const entry = listed ?? datedVariantOf(models, id) ?? genericEntry(id);
  const routing = openRouterRouting(pin);
  const model =
    routing === undefined ? entry : { ...entry, compat: { ...entry.compat, openRouterRouting: routing } };
  return {
    model,
    source: listed ? MODEL_CATALOGUE_SOURCES.pi : MODEL_CATALOGUE_SOURCES.piUnlisted,
  };
}

/** A declared custom context window: a positive integer or nothing at all. Anything else is a
 *  refusal that names the variable, rather than a silent fallback a later compaction would
 *  contradict. */
function declaredContextWindow(env: OptionalEnvValues): number | undefined {
  const raw = env.CUSTOM_CONTEXT_WINDOW?.trim();
  if (raw === undefined || raw === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`CUSTOM_CONTEXT_WINDOW must be a positive integer of tokens, got "${raw}"`);
  }
  // A window that cannot hold the output allowance plus a minimal input reserve would fail at the
  // provider on every turn, so refusing here names the fact instead of burning a paid turn to
  // discover it.
  if (parsed < CUSTOM_MAX_TOKENS + MIN_INPUT_RESERVE) {
    throw new Error(
      `CUSTOM_CONTEXT_WINDOW must allow ${CUSTOM_MAX_TOKENS} output tokens plus ${MIN_INPUT_RESERVE} input reserve, got ${String(parsed)}`,
    );
  }
  return parsed;
}

const endpointAt = (baseUrl: string, apiKeyEnv: string): OpenRouterEndpoint => ({
  baseUrl,
  apiKeyEnv,
  custom: new URL(baseUrl).origin !== new URL(OPENROUTER_DEFAULT_BASE_URL).origin,
});

/** Add the conventional `/v1` path when the configured host has no API path. */
function normalizeBaseUrl(configured: string): string {
  const trimmed = configured.replace(/\/+$/, "");
  try {
    return new URL(trimmed).pathname === "/" ? `${trimmed}/v1` : trimmed;
  } catch {
    return trimmed;
  }
}

/**
 * Resolve the OpenAI-completions endpoint and its credential name from one set of env values.
 *
 * A free remote tier can fail through rate limiting -- run 71 ended on a provider 429 -- and a
 * local server is another test option over the same protocol. Pi's openai-completions API reads
 * `model.baseUrl` and sends an ordinary chat completion, so llama.cpp, vLLM and other
 * OpenAI-compatible servers use this transport without a separate implementation.
 *
 * Host and key resolve together so a key can never be sent to a host it does not belong to.
 * `OPENROUTER_BASE_URL` may tune the path on OpenRouter's own origin; another origin must use the
 * explicit `CUSTOM_ADDRESS` + `CUSTOM_API_KEY` pair.
 */
export function openRouterEndpointFrom(env: OptionalEnvValues): OpenRouterEndpoint {
  const openrouter = env.OPENROUTER_BASE_URL?.trim();
  if (hasText(openrouter)) {
    const endpoint = endpointAt(normalizeBaseUrl(openrouter), "OPENROUTER_API_KEY");
    if (endpoint.custom) {
      throw new Error(
        "OPENROUTER_BASE_URL must use the OpenRouter origin; use CUSTOM_ADDRESS and CUSTOM_API_KEY for another host",
      );
    }
    return endpoint;
  }
  const custom = env.CUSTOM_ADDRESS?.trim();
  if (hasText(custom)) {
    // The window is a required declaration rather than a guess: compaction reads it, and a guessed
    // window burns a long turn before the provider rejects the prompt.
    const contextWindow = declaredContextWindow(env);
    if (contextWindow === undefined) {
      throw new EnvironmentRefusal(
        "CUSTOM_CONTEXT_WINDOW is required when CUSTOM_ADDRESS names another host — declare the window the server actually serves",
      );
    }
    return { ...endpointAt(normalizeBaseUrl(custom), "CUSTOM_API_KEY"), contextWindow };
  }
  return endpointAt(OPENROUTER_DEFAULT_BASE_URL, "OPENROUTER_API_KEY");
}
