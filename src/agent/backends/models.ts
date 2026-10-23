/**
 * The three backends as one pi `Models` collection: Codex on the ChatGPT login the Codex CLI keeps,
 * OpenRouter on `OPENROUTER_API_KEY`, and Claude Code on `CLAUDE_CODE_OAUTH_TOKEN`, or, as the
 * provider `claude-api`, on `ANTHROPIC_API_KEY`. The Builder and the Built Harness both resolve
 * their models here.
 */
import {
  type Api,
  type CredentialStore,
  createModels,
  type Model,
  type MutableModels,
  type OAuthCredential,
  type Provider,
} from "@earendil-works/pi-ai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { existsSync, readFileSync } from "../../meta/filesystem.ts";
import { asRecord, isNumber, isString } from "../../meta/json-shape.ts";
import { capturedJsonParse } from "../../meta/json-runtime.ts";
import { homedir } from "../../meta/os.ts";
import { join } from "../../meta/path.ts";
import {
  CLAUDE_API_PROVIDER,
  type ClaudeOptions,
  claudeCompactionMode,
  claudeProvider,
  servedByClaude,
} from "./claude.ts";
import { durableCompactionMode } from "./compaction.ts";
import type { ConversationRetryPolicy } from "@earendil-works/pi-durable";

const CODEX = "openai-codex";

/** What the host decides about the backends a process serves. */
export interface BackendOptions {
  readonly claude: ClaudeOptions;
}

/**
 * The Codex CLI's login, read afresh on every request and never refreshed here. Codex rotates the
 * refresh token on use, so a refresh by this process would sign the CLI out. When the access token
 * runs short, running `codex` renews it.
 */
const codexLogin: CredentialStore = {
  read: async (providerId) =>
    providerId === CODEX && existsSync(codexAuthFile()) ? codexCredential() : undefined,
  list: async () => (existsSync(codexAuthFile()) ? [{ providerId: CODEX, type: "oauth" }] : []),
  modify: async (providerId) => {
    throw new Error(`${providerId}: this store only reads the Codex CLI's login; run \`codex\` to renew it`);
  },
  delete: async (providerId) => {
    throw new Error(
      `${providerId}: this store only reads the Codex CLI's login; run \`codex logout\` to end it`,
    );
  },
};

export function backends(options: BackendOptions): MutableModels {
  const models = createModels({ credentials: codexLogin });
  models.setProvider(openaiCodexProvider());
  models.setProvider(openrouter());
  models.setProvider(claudeProvider(options.claude));
  models.setProvider(claudeProvider(options.claude, CLAUDE_API_PROVIDER));
  return models;
}

/** Durable owns retries for the two providers previously wrapped here, with the same backoff. */
export function retryPolicy(provider: string): ConversationRetryPolicy {
  return { enabled: provider === CODEX || provider === "openrouter", maxRetries: 3, baseDelayMs: 2_000 };
}

/**
 * OpenRouter as pi serves it, with DeepSeek V4.1 Flash of 17 October held to one endpoint: pi's own
 * entry for the release, with what OpenRouter lists differently for DeepInfra fp8, its prices per
 * million tokens and output limit, and that endpoint alone, with no fallback (operator, 21 October).
 * OpenRouter otherwise picks one of the release's 26 endpoints for each call, at fp4, fp8 or an
 * unnamed quantization, so two solves of one model could run on different weights, and pi's entry
 * prices it at OpenRouter's list price. The study's solver (`studies/shared/pi-solve.ts`) serves its
 * models from here too.
 */
export function openrouter(): Provider<"anthropic-messages" | "openai-completions"> {
  const router = openrouterProvider();
  const dated = router.getModels().find(({ id }) => id === "deepseek/deepseek-v4.1-flash-1017");
  const pinned = dated && {
    ...dated,
    cost: { input: 0.098, output: 0.294, cacheRead: 0.00294, cacheWrite: 0 },
    maxTokens: 131_072,
    compat: { ...dated.compat, openRouterRouting: { only: ["deepinfra/fp8"], allow_fallbacks: false } },
  };
  const pin = <M extends { readonly id: string }>(model: M) => (model.id === pinned?.id ? pinned : model);
  return {
    ...router,
    getModels: () => router.getModels().map(pin),
    getAllModels: () => (router.getAllModels?.() ?? router.getModels()).map(pin),
  };
}

/** The compaction a solve on `model` runs under, as the condition pins it. */
export function compactionMode(
  model: Pick<Model<Api>, "provider" | "id" | "contextWindow">,
  options: BackendOptions,
): string {
  return servedByClaude(model.provider)
    ? claudeCompactionMode(options.claude.compaction, model.id)
    : durableCompactionMode(model);
}

function codexAuthFile(): string {
  return join(Bun.env.CODEX_HOME ?? join(homedir(), ".codex"), "auth.json");
}

function codexCredential(): OAuthCredential {
  const tokens = asRecord(asRecord(capturedJsonParse(readFileSync(codexAuthFile(), "utf8")))?.tokens);
  const access = tokens?.access_token;
  const refresh = tokens?.refresh_token;
  if (!isString(access) || !isString(refresh)) throw new Error(`${codexAuthFile()} holds no ChatGPT login`);
  // The access token is a JWT; its `exp` claim, in seconds, is when the login lapses.
  const claims = asRecord(
    capturedJsonParse(Buffer.from(access.split(".")[1] ?? "", "base64url").toString("utf8")),
  );
  const expires = claims?.exp;
  if (!isNumber(expires)) throw new Error(`${codexAuthFile()}: the access token carries no expiry`);
  return { type: "oauth", access, refresh, expires: expires * 1000 };
}
