/**
 * The one owner of an OpenRouter model pin and its provider routing, shared by every slot:
 *
 * - Which model entry a slug resolves to. The Pi catalogue omits live slugs such as `:free`
 *   variants and dated snapshots; a dated snapshot takes its listed base model's metadata (and
 *   `compat` flags) under the requested id, and anything else gets a generic entry.
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
 *  custom window must leave beside it. */
const CUSTOM_MAX_TOKENS = 16_384;
const MIN_INPUT_RESERVE = 8_192;

export interface OpenRouterEndpoint {
  /** The OpenAI-completions base a request is sent to, with `/chat/completions` appended. */
  baseUrl: string;
  /** The env var name holding this endpoint's key; the value is never logged. */
  apiKeyEnv: string;
  /** Somewhere other than OpenRouter, so it serves its own slugs and reads no upstream routing. */
  custom: boolean;
  /** The context window `CUSTOM_CONTEXT_WINDOW` declares; compaction reads it. */
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
 * named hosts, and `allow_fallbacks: false` refuses a substitute, so the served condition is fixed.
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
    // Output never promises more than half the window.
    maxTokens: Math.min(CUSTOM_MAX_TOKENS, Math.floor(contextWindow / 2)),
  } satisfies Model<"openai-completions">;
}

/**
 * The listed base model of a dated snapshot, re-identified as the requested slug:
 * `deepseek/deepseek-v4-flash-0731` takes `deepseek/deepseek-v4-flash`'s entry. Only a dated `-`
 * suffix qualifies; `:free` and other tags may change terms and pricing.
 */
function datedVariantOf(
  models: ReturnType<typeof createModels>,
  id: string,
): Model<"openai-completions"> | undefined {
  const baseId = DATED_VARIANT_ID.exec(id)?.[1];
  if (baseId === undefined) return undefined;
  const base =
    /* SAFETY: every entry of the one completions provider carries that transport. */ models.getModel(
      GENERATION_PROVIDER,
      baseId,
    ) as Model<"openai-completions"> | undefined;
  return base === undefined ? undefined : { ...base, id, name: id };
}

/**
 * Resolve one slug to the entry a turn will be served with, plus the pinned upstream provider.
 *
 * A `baseUrl` names a host other than OpenRouter, which answers for its own slugs; a catalogue
 * entry would carry OpenRouter's `baseUrl` and send the turn there instead. Its context window is
 * the declared one, else the conservative 128k default an unlisted slug gets.
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
    /* SAFETY: every entry of the one completions provider carries that transport. */ models.getModel(
      GENERATION_PROVIDER,
      id,
    ) as Model<"openai-completions"> | undefined;
  const entry = listed ?? datedVariantOf(models, id) ?? genericEntry(id);
  const routing = openRouterRouting(pin);
  const model =
    routing === undefined ? entry : { ...entry, compat: { ...entry.compat, openRouterRouting: routing } };
  return {
    model,
    source: listed ? MODEL_CATALOGUE_SOURCES.pi : MODEL_CATALOGUE_SOURCES.piUnlisted,
  };
}

/** A declared custom context window: a positive integer or nothing; anything else is refused. */
function declaredContextWindow(env: OptionalEnvValues): number | undefined {
  const raw = env.CUSTOM_CONTEXT_WINDOW?.trim();
  if (raw === undefined || raw === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`CUSTOM_CONTEXT_WINDOW must be a positive integer of tokens, got "${raw}"`);
  }
  // A window without room for the output allowance and an input reserve would fail every turn.
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
 * Any OpenAI-compatible server (llama.cpp, vLLM) can serve through this transport.
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
    // The window must be declared, because compaction reads it.
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
