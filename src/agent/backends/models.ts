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
  type Provider,
  type StreamOptions,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { existsSync } from "../../meta/filesystem.ts";
import { asRecord, isString } from "../../meta/json-shape.ts";
import {
  CLAUDE_API_PROVIDER,
  type ClaudeOptions,
  claudeCompactionMode,
  claudeProvider,
  servedByClaude,
} from "./claude.ts";
import { CODEX_AUTH, codexAuthFile, codexCredential } from "./codex-auth.ts";
import { durableCompactionMode } from "./compaction.ts";
import type { ConversationRetryPolicy } from "@earendil-works/pi-durable";

export { CODEX_AUTH };

const CODEX = "openai-codex";

const DEEPSEEK_FLASH = {
  cost: { input: 0.098, output: 0.294, cacheRead: 0.00294, cacheWrite: 0 },
  maxTokens: 131_072,
};

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

export interface BackendOptions {
  readonly claude: ClaudeOptions;
}

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

export function retryPolicy(provider: string): ConversationRetryPolicy {
  const enabled =
    provider === CODEX || provider === "openrouter" || ENDPOINTS.some(({ id }) => id === provider);
  return { enabled, maxRetries: 3, baseDelayMs: 2000 };
}

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

export function compactionMode(
  model: Pick<Model<Api>, "provider" | "id" | "contextWindow">,
  options: BackendOptions,
): string {
  return servedByClaude(model.provider)
    ? claudeCompactionMode(options.claude.compaction, model.id)
    : durableCompactionMode(model);
}
