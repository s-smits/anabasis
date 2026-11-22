/**
 * Unified `pi-ai` `Models` registry combining all supported backends: Codex (using the Codex CLI's
 * ChatGPT login), OpenRouter (`OPENROUTER_API_KEY`), OpenAI-compatible endpoints declared in
 * `ENDPOINTS`, and Claude Code via OAuth (`CLAUDE_CODE_OAUTH_TOKEN`) or API key (`claude-api`,
 * `ANTHROPIC_API_KEY`). Both the Builder and solver seats resolve models here.
 *
 * Because `pi-ai`'s normalisation drops the served model identifier from Codex terminal responses,
 * `codexStream` preserves it as `responseModel` for trace logging and cost accounting. Codex usage
 * costs are estimated from the catalogue rather than reported by the backend, so Codex turns carry
 * no backend bill.
 */
import {
  type Api,
  type AssistantMessageEventStream,
  type CredentialStore,
  createModels,
  createProvider,
  envApiKeyAuth,
  lazyStream,
  type Model,
  type MutableModels,
  type OAuthCredential,
  type Provider,
  type StreamOptions,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
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
/** The file Codex keeps its login in, under `CODEX_HOME`; a snapshot or a search never copies one. */
export const CODEX_AUTH = "auth.json";

/** DeepSeek V4.1 Flash pricing (USD per million tokens) and output cap as served by DeepInfra at
 *  FP8 on both OpenRouter and direct DeepInfra routes. */
const DEEPSEEK_FLASH = {
  cost: { input: 0.098, output: 0.294, cacheRead: 0.00294, cacheWrite: 0 },
  maxTokens: 131_072,
};

/**
 * Direct OpenAI-compatible endpoints exposed as `<id>/<model id>` providers using `pi-ai`'s chat
 * completions API. DeepInfra mirrors the DeepSeek release pinned on OpenRouter at the same FP8
 * list price so a campaign can run against either billing account.
 */
const ENDPOINTS: readonly {
  readonly id: string;
  readonly baseUrl: string;
  readonly key: string;
  readonly models: readonly Pick<
    Model<"openai-completions">,
    "id" | "cost" | "contextWindow" | "maxTokens"
  >[];
}[] = [
  {
    id: "deepinfra",
    baseUrl: "https://api.deepinfra.com/v1/openai",
    key: "DEEPINFRA_KEY",
    models: [{ id: "deepseek-ai/DeepSeek-V4.1-Flash-1017", ...DEEPSEEK_FLASH, contextWindow: 1_048_576 }],
  },
];

/** Host-level configuration passed when constructing the backend registry. */
export interface BackendOptions {
  readonly claude: ClaudeOptions;
}

/**
 * Read-only credential store backed by the Codex CLI's auth file. Tokens are read afresh per
 * request and never refreshed here because Codex rotates refresh tokens on use, which would sign
 * out the CLI session.
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
  const codex: Provider = openaiCodexProvider();
  models.setProvider({
    ...codex,
    stream: (model, context, request) =>
      codexStream(
        model,
        (onProviderStreamEvent) => codex.stream<Api>(model, context, { ...request, onProviderStreamEvent }),
        request?.onProviderStreamEvent,
      ),
    streamSimple: (model, context, request) =>
      codexStream(
        model,
        (onProviderStreamEvent) => codex.streamSimple(model, context, { ...request, onProviderStreamEvent }),
        request?.onProviderStreamEvent,
      ),
  });
  models.setProvider(openrouter());
  for (const each of ENDPOINTS) models.setProvider(endpoint(each));
  models.setProvider(claudeProvider(options.claude));
  models.setProvider(claudeProvider(options.claude, CLAUDE_API_PROVIDER));
  return models;
}

/** Preserves the served model ID on normalised Codex terminal messages instead of inferring it from
 *  the requested model ID. */
function codexStream(
  model: Model<Api>,
  start: (observe: NonNullable<StreamOptions["onProviderStreamEvent"]>) => AssistantMessageEventStream,
  observe: StreamOptions["onProviderStreamEvent"],
): AssistantMessageEventStream {
  return lazyStream(model, async () => {
    let responseModel: string | undefined;
    const stream = start(async (event, asked) => {
      const data = asRecord(event);
      if (
        isString(data?.type) &&
        ["response.done", "response.completed", "response.incomplete", "response.failed"].includes(data.type)
      ) {
        const served = asRecord(data.response)?.model;
        responseModel = isString(served) ? served : undefined;
      }
      await observe?.(event, asked);
    });
    return {
      async *[Symbol.asyncIterator]() {
        for await (const event of stream) {
          const turn =
            event.type === "done" ? event.message : event.type === "error" ? event.error : undefined;
          if (turn !== undefined && responseModel !== undefined) turn.responseModel = responseModel;
          yield event;
        }
      },
    };
  });
}

/** Returns `pi-durable`'s retry policy for non-Claude providers that do not retry internally. */
export function retryPolicy(provider: string): ConversationRetryPolicy {
  const enabled =
    provider === CODEX || provider === "openrouter" || ENDPOINTS.some(({ id }) => id === provider);
  return { enabled, maxRetries: 3, baseDelayMs: 2000 };
}

/** Builds a `pi-ai` provider for a single entry in `ENDPOINTS`. */
function endpoint({ id, baseUrl, key, models }: (typeof ENDPOINTS)[number]): Provider<"openai-completions"> {
  return createProvider({
    id,
    baseUrl,
    auth: { apiKey: envApiKeyAuth(`${id} API key`, [key]) },
    models: models.map((model) => ({
      ...model,
      name: model.id,
      api: "openai-completions" as const,
      provider: id,
      baseUrl,
      input: ["text" as const],
      reasoning: true,
    })),
    api: openAICompletionsApi(),
  });
}

/**
 * Returns the OpenRouter provider with `deepseek/deepseek-v4.1-flash-1017` pinned exclusively to
 * DeepInfra FP8 (with fallbacks disabled) and priced at DeepInfra's list rate. Without pinning,
 * OpenRouter routes calls across heterogeneous quantisations and providers, confounding paired
 * comparisons. Shared by `studies/shared/pi-solve.ts`.
 */
export function openrouter(): Provider<"anthropic-messages" | "openai-completions"> {
  const router = openrouterProvider();
  const dated = router.getModels().find(({ id }) => id === "deepseek/deepseek-v4.1-flash-1017");
  const pinned = dated && {
    ...dated,
    ...DEEPSEEK_FLASH,
    compat: { ...dated.compat, openRouterRouting: { only: ["deepinfra/fp8"], allow_fallbacks: false } },
  };
  const pin = <M extends { readonly id: string }>(model: M) => (model.id === pinned?.id ? pinned : model);
  return {
    ...router,
    getModels: () => router.getModels().map(pin),
    getAllModels: () => (router.getAllModels?.() ?? router.getModels()).map(pin),
  };
}

/** Returns the compaction-mode string recorded in a solve condition for `model`. */
export function compactionMode(
  model: Pick<Model<Api>, "provider" | "id" | "contextWindow">,
  options: BackendOptions,
): string {
  return servedByClaude(model.provider)
    ? claudeCompactionMode(options.claude.compaction, model.id)
    : durableCompactionMode(model);
}

function codexAuthFile(): string {
  return join(Bun.env.CODEX_HOME ?? join(homedir(), ".codex"), CODEX_AUTH);
}

function codexCredential(): OAuthCredential {
  const tokens = asRecord(asRecord(capturedJsonParse(readFileSync(codexAuthFile(), "utf8")))?.tokens);
  const access = tokens?.access_token;
  const refresh = tokens?.refresh_token;
  if (!isString(access) || !isString(refresh)) throw new Error(`${codexAuthFile()} holds no ChatGPT login`);
  // Decode the JWT payload's `exp` claim (Unix seconds) to determine credential expiry.
  const claims = asRecord(
    capturedJsonParse(Buffer.from(access.split(".")[1] ?? "", "base64url").toString("utf8")),
  );
  const expires = claims?.exp;
  if (!isNumber(expires)) throw new Error(`${codexAuthFile()}: the access token carries no expiry`);
  return { type: "oauth", access, refresh, expires: expires * 1000 };
}
