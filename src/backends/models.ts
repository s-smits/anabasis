/**
 * The three backends as one pi `Models` collection: Codex on the ChatGPT login the Codex CLI keeps,
 * OpenRouter on `OPENROUTER_API_KEY`, and Claude Code on `CLAUDE_CODE_OAUTH_TOKEN`. The Builder and
 * the Built Harness both resolve their models here.
 */
import {
  type Api,
  type CredentialStore,
  createModels,
  type Model,
  type MutableModels,
  type OAuthCredential,
} from "@earendil-works/pi-ai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { existsSync, readFileSync } from "../meta/filesystem.ts";
import { asRecord, isNumber, isString } from "../meta/json-shape.ts";
import { capturedJsonParse } from "../meta/json-runtime.ts";
import { homedir } from "../meta/os.ts";
import { join } from "../meta/path.ts";
import { CLAUDE_PROVIDER, type ClaudeOptions, claudeCompactionMode, claudeProvider } from "./claude.ts";

const CODEX = "openai-codex";

/**
 * pi's own loop, which serves Codex and OpenRouter, never compacts: a context that outgrows the model
 * ends the solve.
 */
const PI_LOOP_COMPACTION = "off";

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
  models.setProvider(openrouterProvider());
  models.setProvider(claudeProvider(options.claude));
  return models;
}

/** The compaction a solve on `model` runs under, as the condition pins it. */
export function compactionMode(model: Pick<Model<Api>, "provider" | "id">, options: BackendOptions): string {
  return model.provider === CLAUDE_PROVIDER
    ? claudeCompactionMode(options.claude.compaction, model.id)
    : PI_LOOP_COMPACTION;
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
