/**
 * The three backends as one pi `Models` collection: Codex on the ChatGPT login the Codex CLI keeps,
 * OpenRouter on `OPENROUTER_API_KEY`, and Claude Code on `CLAUDE_CODE_OAUTH_TOKEN`, or, as the
 * provider `claude-api`, on `ANTHROPIC_API_KEY`. The Builder and the Built Harness both resolve
 * their models here.
 */
import {
  type Api,
  type AssistantMessage,
  appendAssistantMessageDiagnostic,
  type CredentialStore,
  createAssistantMessageEventStream,
  createModels,
  type Model,
  type MutableModels,
  type OAuthCredential,
  type Provider,
  type RetryPolicy,
  retryAssistantCall,
} from "@earendil-works/pi-ai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { existsSync, readFileSync } from "../meta/filesystem.ts";
import { asRecord, isNumber, isString } from "../meta/json-shape.ts";
import { capturedJsonParse } from "../meta/json-runtime.ts";
import { homedir } from "../meta/os.ts";
import { join } from "../meta/path.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import {
  CLAUDE_API_PROVIDER,
  type ClaudeOptions,
  claudeCompactionMode,
  claudeProvider,
  emptyTurn,
  servedByClaude,
} from "./claude.ts";
import { piCompactionMode } from "./pi-compaction.ts";

const CODEX = "openai-codex";

/** Pi coding-agent's retry of a transient provider failure, which v1 had through pi's session:
 *  three more attempts, at 2, 4 and 8 s. */
const RETRY: RetryPolicy = { enabled: true, maxRetries: 3, baseDelayMs: 2_000 };

/**
 * The diagnostic a turn carries when its call was made again: `details.retried`, what each attempt
 * before the last one said. A retry mends in silence otherwise, and how often a provider drops a
 * call is then in no log: two rounds of 8 October, run before the retry, lost 18 of their 33
 * finished solves to a closed WebSocket, 14.9 of 30.9 solve-hours.
 */
export const CALL_RETRIED = "call-retried";

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
  models.setProvider(retried(openaiCodexProvider()));
  // pi's catalogue lacks OpenRouter's dated 1017 release of DeepSeek V4.1 Flash (21 October), served
  // as its base. It is metered at OpenRouter's off-peak price, on the operator's word; peak is twice.
  const router = openrouterProvider();
  const base = router.getModels().find(({ id }) => id === "deepseek/deepseek-v4.1-flash");
  const cost = { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 };
  const dated = base === undefined ? [] : [{ ...base, id: `${base.id}-1017`, cost }];
  models.setProvider(retried({ ...router, getModels: () => [...router.getModels(), ...dated] }));
  models.setProvider(claudeProvider(options.claude));
  models.setProvider(claudeProvider(options.claude, CLAUDE_API_PROVIDER));
  return models;
}

/**
 * `provider` with a transient failure of a model call retried in place, by pi's own classifier. pi's
 * loop has no retry of its own, so a dropped call would fail the turn and the whole solve would be
 * run again: on 8 October Codex closed its WebSocket mid-response ("WebSocket closed 1000") 229 s
 * and 6,038 s into two solves, and pi rethrows a close once the response has begun. The stream
 * answers with the last attempt's message alone, which pi's loop takes as a whole message.
 */
export function retried<T extends Api>(provider: Provider<T>): Provider<T> {
  return {
    ...provider,
    streamSimple: (model, context, options) => {
      const stream = createAssistantMessageEventStream();
      const said: string[] = [];
      const call = () => provider.streamSimple(model, context, options).result();
      const settle = (message: AssistantMessage) => {
        if (said.length > 0) {
          const diagnostic = { type: CALL_RETRIED, timestamp: Date.now(), details: { retried: said } };
          appendAssistantMessageDiagnostic(message, diagnostic);
        }
        const { stopReason: reason } = message;
        if (reason === "error" || reason === "aborted") {
          stream.push({ type: "error", reason, error: message });
        } else if (reason !== "pending") {
          stream.push({ type: "done", reason, message });
        }
        stream.end(message);
      };
      const heard = {
        onRetryScheduled: (_n: number, _of: number, _ms: number, error: string) => void said.push(error),
      };
      retryAssistantCall(call, RETRY, options?.signal, heard).then(settle, (error: unknown) =>
        settle({ ...emptyTurn(model), stopReason: "error", errorMessage: errorMessage(error) }),
      );
      return stream;
    },
  };
}

/** The compaction a solve on `model` runs under, as the condition pins it. */
export function compactionMode(
  model: Pick<Model<Api>, "provider" | "id" | "contextWindow">,
  options: BackendOptions,
): string {
  return servedByClaude(model.provider)
    ? claudeCompactionMode(options.claude.compaction, model.id)
    : piCompactionMode(model);
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
