/**
 * The one provider layer every model slot runs on: the Builder and the review slot on the host,
 * the Built solver in its confined child. A slot names a kind, a model and an effort; this module
 * turns that into a pi model, the stream function that serves it and the credential behind it.
 *
 * - claude: the vendored pi-claude-bridge drives the official Claude CLI through the Agent SDK,
 *   signed in with the CLI's own CLAUDE_CODE_OAUTH_TOKEN;
 * - codex: pi's openai-codex provider on the ChatGPT login the Codex CLI keeps in `auth.json`;
 * - openrouter: pi's openrouter provider, or any OpenAI-completions host `CUSTOM_ADDRESS` names.
 *
 * Each caller keeps its own harness around the model — the Builder's session, the review turns,
 * the Built worker — so the three stay separately customisable while serving one condition shape.
 */
import { existsSync } from "../meta/filesystem.ts";
import { dirname, join } from "../meta/path.ts";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  type Api,
  type AssistantMessage,
  type Credential,
  type CredentialStore,
  type Model,
  type ModelThinkingLevel,
  type Provider,
  createModels,
  fauxProvider,
  getSupportedThinkingLevels,
} from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { createClaudeBridge } from "../../vendor/pi-claude-bridge/provider.ts";
import { isRecord, isString } from "../meta/json-shape.ts";
import { keyIfDefined, keysIf } from "../meta/optional-key.ts";
import { runtimeProcess } from "../meta/process.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { hasText } from "../meta/text.ts";
import type { BackendKind, BackendSlot } from "./backend-kinds.ts";
import { COMPACTION_MODES, CONTEXT_COMPACT_WINDOW, type CompactionMode } from "./backend-types.ts";
import { loadRepoEnv } from "./env.ts";
import { EnvironmentRefusal } from "./environment-refusal.ts";
import { codexLogin } from "./login-state.ts";
import { refreshOpenAICodex } from "./oauth/openai-codex.ts";
import { refreshCodexAuthJson } from "./oauth/storage.ts";
import { MODEL_CATALOGUE_SOURCES, type ModelSelectionEvidence } from "./model-selection.ts";
import {
  type OpenRouterEndpoint,
  openRouterEndpointFrom,
  resolveOpenRouterModelPin,
} from "./openrouter-model.ts";
import { type OptionalEnvValues, scrubSecretEnv } from "./scrub-env.ts";

export interface PiProfile {
  provider: "anthropic" | "openai-codex" | "openrouter";
  transport: "claude" | "codex" | "openrouter";
  model: string;
  thinkingLevel: ModelThinkingLevel;
  // Every optional field below is part of the served condition, so it enters the condition digest.
  /** Upstream hosts the routed provider may serve this model from (openrouter only). */
  providerPin?: string[];
  /** Server-side web search for the agent. */
  webSearch?: boolean;
  /** The OpenAI-completions host serving this model when it is not OpenRouter (openrouter only). */
  baseUrl?: string;
  /** The context window this host declared (`CUSTOM_CONTEXT_WINDOW`), which compaction depends on. */
  contextWindow?: number;
  /** Claude only: who compacts this slot's context (`CLAUDE_COMPACTION`). */
  compaction?: CompactionMode;
}

/** A pi credential, or the Claude CLI's setup-token, which only ever reaches the CLI's environment. */
export type PiCredential = Credential | { type: "bearer"; token: string };

/** What a slot asks for: the resolved kind, model, effort and routing pin. */
export interface PiSlotChoice {
  kind: BackendKind;
  model: string | null;
  reasoningEffort?: string | undefined;
  providerPin?: readonly string[] | undefined;
}

/** The effort a slot opens at when it pins none, and whether it asks for server-side search. */
export interface PiSlotDefaults {
  effort: string;
  webSearch: boolean;
}

/** One slot's served condition and its credential. Codex's supplier reads `auth.json` again on
 *  every call and refreshes a due login first; every other credential is read on first use and kept. */
export interface PiSlotRuntime {
  profile: PiProfile;
  auth: () => Promise<PiCredential>;
}

/** A model a pi Agent can run: the catalogue entry, the stream that serves it and the evidence
 *  naming what was selected. */
export interface PiModel {
  model: Model<Api>;
  streamFn: StreamFn;
  modelSelection: ModelSelectionEvidence;
  /** Claude: pi rewrote the history the CLI session holds, so the CLI's next query rewrites that
   *  session from pi's history instead of resuming it. */
  historyRewritten?: () => void;
}

/** What the Claude transport needs beyond the profile: the CLI binary, the config directory its
 *  sessions and state live under, the environment it starts from and the directory it works in. */
export interface ClaudeCli {
  cliPath: string;
  configDir: string;
  baseEnv: OptionalEnvValues;
  cwd?: string | undefined;
  /** Put the CLI's own `claude_code` preset ahead of the controller's prompt (the Built solver);
   *  otherwise the prompt is the whole system prompt. */
  claudeCodePreset?: boolean;
}

/** Observers a caller may attach to the served model. */
export interface PiModelHooks {
  /** Claude under `claude-ss`: the CLI compacted its own context at CONTEXT_COMPACT_WINDOW. */
  onCompaction?: (tokensBefore: number) => void;
  /** Claude: the CLI answered a builtin (WebSearch) inside its own loop. */
  onBuiltinTool?: (call: { name: string; id: string; input: unknown }) => void;
}

const PROFILES = {
  claude: { provider: "anthropic", transport: "claude" },
  codex: { provider: "openai-codex", transport: "codex" },
  openrouter: { provider: "openrouter", transport: "openrouter" },
} as const;

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
/** The efforts the Claude CLI serves under their own names. */
const CLAUDE_EFFORTS: ReadonlySet<ModelThinkingLevel> = new Set(["low", "medium", "high", "xhigh", "max"]);

function piProfile(
  slot: BackendSlot,
  choice: PiSlotChoice,
  endpoint: OpenRouterEndpoint | null,
  defaults: PiSlotDefaults,
): PiProfile {
  if (!hasText(choice.model?.trim())) throw new Error(`${slot} model is unresolved`);
  const effort = choice.reasoningEffort ?? defaults.effort;
  const thinkingLevel = THINKING_LEVELS.find((known) => known === effort);
  if (thinkingLevel === undefined) throw new Error(`${slot} reasoning effort "${effort}" is unsupported`);
  const openrouter = choice.kind === "openrouter";
  // Upstream routing is OpenRouter's own; a custom host ignores a pin, so it declares none.
  const custom = openrouter && endpoint?.custom === true ? endpoint.baseUrl : undefined;
  const pin = openrouter && custom === undefined ? choice.providerPin : undefined;
  return {
    ...PROFILES[choice.kind],
    model: choice.model,
    thinkingLevel,
    ...keyIfDefined("providerPin", pin && [...pin]),
    ...keyIfDefined("baseUrl", custom),
    ...keyIfDefined("contextWindow", openrouter ? endpoint?.contextWindow : undefined),
    // Claude serves it as a CLI builtin and codex as a Responses tool; openrouter expresses search
    // through its own routing syntax and stays off until that path is proved live.
    ...keyIfDefined("webSearch", defaults.webSearch && !openrouter ? true : undefined),
  };
}

/**
 * The codex transport's credential. A login the Codex CLI's own rule makes due is refreshed first,
 * so a host that runs no Codex CLI still sends a current token. A failed refresh keeps a token that
 * has not expired, so the provider decides; an expired one is a login fault.
 */
async function codexCredential(env: OptionalEnvValues): Promise<Credential> {
  let login = codexLogin(env);
  let refreshFailure = "";
  if (login.ok && login.refreshToken !== null && login.refreshDueAt <= Date.now()) {
    try {
      await refreshCodexAuthJson(env, refreshOpenAICodex);
    } catch (cause) {
      refreshFailure = `; its refresh failed: ${errorMessage(cause)}`;
    }
    login = codexLogin(env);
  }
  const refused = (reason: string) =>
    new EnvironmentRefusal(
      `Codex authentication is unavailable (${reason}${refreshFailure}); run \`codex login\` or \`bun run login -- codex\``,
    );
  if (!login.ok) throw refused(login.reason);
  if (login.expiresAt <= Date.now() + 60_000) throw refused("auth.json access token is expired");
  // pi is given no refresh token: the refresh above is the one path, under the file's own lock.
  return { type: "oauth", access: login.token, refresh: "", expires: login.expiresAt };
}

function credential(
  profile: PiProfile,
  loaded: Record<string, string>,
  endpoint: OpenRouterEndpoint | null,
): PiCredential {
  if (profile.provider === "openrouter") {
    if (endpoint === null) throw new Error("the openrouter route was not resolved");
    const { apiKeyEnv } = endpoint;
    // Only the key the endpoint names, so the OpenRouter key never reaches another host.
    const key = loaded[apiKeyEnv];
    if (hasText(key)) return { type: "api_key", key };
    // A keyless custom endpoint is deliberate and gets a non-secret placeholder.
    if (hasText(profile.baseUrl)) return { type: "api_key", key: "local-endpoint-no-key" };
    throw new EnvironmentRefusal(`${apiKeyEnv} is required for the openrouter transport`);
  }
  // The claude transport hands this token to the official Claude CLI as CLAUDE_CODE_OAUTH_TOKEN.
  // The CLI's own /login cannot serve it: its Keychain item is scoped to a config dir, and each
  // bridge runs under a private one. The setup-token needs no login state.
  if (hasText(loaded.CLAUDE_CODE_OAUTH_TOKEN)) {
    return { type: "bearer", token: loaded.CLAUDE_CODE_OAUTH_TOKEN };
  }
  if (hasText(loaded.ANTHROPIC_API_KEY)) return { type: "api_key", key: loaded.ANTHROPIC_API_KEY };
  throw new EnvironmentRefusal(
    "CLAUDE_CODE_OAUTH_TOKEN is required for the claude transport; run `claude setup-token`",
  );
}

/** Who compacts the Claude slots' context: `CLAUDE_COMPACTION`, else `claude-ss`. A value outside
 *  the closed set refuses the slot instead of serving a condition nobody named. */
function claudeCompaction(env: Record<string, string>): CompactionMode {
  const value = env.CLAUDE_COMPACTION?.trim();
  if (!hasText(value)) return "claude-ss";
  const mode = COMPACTION_MODES.find((known) => known === value);
  if (mode === undefined) {
    throw new Error(
      `CLAUDE_COMPACTION "${value}" is unsupported; choose one of ${COMPACTION_MODES.join(", ")}`,
    );
  }
  return mode;
}

/** Whether the Claude CLI compacts this slot's context itself: a claude slot that did not choose `pi`. */
export function claudeCompacts(profile: PiProfile): boolean {
  return profile.transport === "claude" && profile.compaction !== "pi";
}

/**
 * One slot's served condition and credential, read from the repository env chain. Only the
 * openrouter kind resolves an endpoint, so an incomplete custom endpoint cannot refuse another slot.
 */
export function resolvePiSlot(
  slot: BackendSlot,
  choice: PiSlotChoice,
  defaults: PiSlotDefaults,
  repoRoot: string,
  env: OptionalEnvValues = Bun.env,
): PiSlotRuntime {
  const repo = loadRepoEnv(repoRoot, env);
  const endpoint = choice.kind === "openrouter" ? openRouterEndpointFrom(repo.env) : null;
  const profile: PiProfile = {
    ...piProfile(slot, choice, endpoint, defaults),
    ...keyIfDefined("compaction", choice.kind === "claude" ? claudeCompaction(repo.env) : undefined),
  };
  let resolved: PiCredential | undefined;
  return {
    profile,
    // Read when first asked, so a caller that only reads the condition needs no login. A Codex
    // login can change under this process, so it is read again every time.
    auth:
      profile.provider === "openai-codex"
        ? () => codexCredential(repo.env)
        : async () => (resolved ??= credential(profile, repo.env, endpoint)),
  };
}

/** The aliased Agent SDK's bundled Claude CLI binary, resolved on the host. The confined child
 *  receives this path in its start frame, since its bundle breaks the SDK's own discovery. */
let cachedClaudeCli: string | null = null;
export function claudeCliExecutable(): string {
  if (hasText(cachedClaudeCli)) return cachedClaudeCli;
  const sdkDir = dirname(Bun.resolveSync("claude-agent-sdk-bridge", import.meta.dir));
  const platformPackage = `@anthropic-ai/claude-agent-sdk-${runtimeProcess.platform}-${runtimeProcess.arch}`;
  // Module resolution from the alias finds a nested copy first, then the hoisted one.
  let cli = join(sdkDir, "node_modules", platformPackage, "claude");
  try {
    cli = join(dirname(Bun.resolveSync(`${platformPackage}/package.json`, sdkDir)), "claude");
  } catch {
    // an unresolved platform package is reported by the existsSync check below
  }
  if (!existsSync(cli)) {
    throw new Error(
      `Claude bridge CLI binary is absent at ${cli}; install the aliased Agent SDK's platform package`,
    );
  }
  cachedClaudeCli = cli;
  return cli;
}

function providerFor(id: PiProfile["provider"]): Provider {
  if (id === "anthropic") return anthropicProvider();
  if (id === "openai-codex") return openaiCodexProvider();
  return openrouterProvider();
}

/** The one model gate for every live transport: the profile's model must be servable and support
 *  the requested thinking level, and the evidence names both. The OAuth transports are
 *  catalogue-gated; OpenRouter also admits live slugs its catalogue omits, and says which applied. */
function catalogueSelection(models: ReturnType<typeof createModels>, profile: PiProfile) {
  const { provider, model: slug, thinkingLevel: requested, providerPin, baseUrl, contextWindow } = profile;
  const resolved =
    provider === "openrouter"
      ? resolveOpenRouterModelPin(slug, providerPin, baseUrl, contextWindow)
      : { model: models.getModel(provider, slug), source: MODEL_CATALOGUE_SOURCES.pi };
  const known = resolved.model;
  if (!known) {
    throw new Error(`unsupported model: ${provider}/${slug} is absent from the Pi provider catalogue`);
  }
  // A level the transport would serve as another one is refused, so the evidence never records an
  // effort the model did not run at (`off` sent as the API's `none` is the same level).
  const servedAs = known.thinkingLevelMap?.[requested];
  const renamed =
    (requested !== "off" && isString(servedAs) && servedAs !== requested) ||
    (profile.transport === "claude" && !CLAUDE_EFFORTS.has(requested));
  if (renamed || !getSupportedThinkingLevels(known).includes(requested)) {
    throw new Error(`unsupported reasoning effort: ${requested} is absent for ${provider}/${slug}`);
  }
  const modelSelection: ModelSelectionEvidence = {
    resolvedModel: known.id,
    effort: requested,
    source: resolved.source,
    ...keyIfDefined("providerPin", providerPin),
    ...keyIfDefined("compaction", profile.compaction),
  };
  return { known, modelSelection };
}

/** The model gate alone, with no provider call: what preflight records for a slot. */
export function piModelSelection(profile: PiProfile): ModelSelectionEvidence {
  const models = createModels();
  models.setProvider(providerFor(profile.provider));
  return catalogueSelection(models, profile).modelSelection;
}

/** A credential store over one supplier: every read and refresh asks it again, so the supplier
 *  owns renewal and pi's own OAuth refresh never runs. */
function suppliedCredentials(providerId: string, supply: () => Promise<Credential>): CredentialStore {
  const read = async (id: string) => (id === providerId ? await supply() : undefined);
  return {
    read,
    list: async () => [{ providerId, type: (await supply()).type }],
    modify: async (id) => read(id),
    delete: async () => {},
  };
}

/** The Claude CLI's environment: this process's own without its secrets, the slot's credential,
 *  and a private config dir, so the operator's memory and settings never reach it. The named
 *  entrypoint keeps a subscription from billing the calls as SDK extra usage. */
function claudeCliEnv(auth: PiCredential, cli: ClaudeCli): Record<string, string | undefined> {
  if (auth.type === "oauth") throw new Error("the claude transport takes a setup-token or an API key");
  return {
    ...scrubSecretEnv(cli.baseEnv),
    CLAUDE_CODE_ENTRYPOINT: "cli",
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    CLAUDE_CONFIG_DIR: cli.configDir,
    ...(auth.type === "bearer" ? { CLAUDE_CODE_OAUTH_TOKEN: auth.token } : { ANTHROPIC_API_KEY: auth.key }),
  };
}

/** Claude transport: pi keeps the Agent, tools and evidence; each turn runs through the vendored
 *  pi-claude-bridge, which drives the Claude CLI via the Agent SDK. Tools are exposed over MCP, and
 *  WebSearch is the one CLI builtin. Under `claude-ss` the CLI compacts at the shared window; under
 *  `pi` the pi session compacts and the CLI takes that history at its next query. */
function claudeModel(profile: PiProfile, auth: PiCredential, cli: ClaudeCli, hooks: PiModelHooks): PiModel {
  const models = createModels();
  models.setProvider(providerFor(profile.provider));
  const { known, modelSelection } = catalogueSelection(models, profile);
  const streamFn = createClaudeBridge({
    pathToClaudeCodeExecutable: cli.cliPath,
    env: claudeCliEnv(auth, cli),
    // The CLI works in the caller's directory: the Builder's workspace, else this process's.
    ...keyIfDefined("cwd", cli.cwd),
    ...keysIf(claudeCompacts(profile), () => ({ autoCompactWindow: CONTEXT_COMPACT_WINDOW })),
    ...keyIfDefined("claudeCodePreset", cli.claudeCodePreset),
    ...keyIfDefined("onCompaction", hooks.onCompaction),
    ...keysIf(profile.webSearch === true, () => ({
      builtinTools: ["WebSearch"],
      ...keyIfDefined("onBuiltinTool", hooks.onBuiltinTool),
    })),
  });
  return { model: known, streamFn, modelSelection, historyRewritten: streamFn.historyRewritten };
}

/** Adds the Responses built-in search tool, which pi's `Tool` type cannot express, through pi's
 *  payload hook. An unrecognised payload fails the turn rather than serving without search. */
function withServerWebSearch(stream: StreamFn): StreamFn {
  return (model, context, options) =>
    stream(model, context, {
      ...options,
      // Composed with, not replacing, the caller's own payload hook.
      onPayload: async (payload, hookModel) => {
        const base = (await options?.onPayload?.(payload, hookModel)) ?? payload;
        if (!isRecord(base)) throw new Error("web-search payload hook expected the Responses request body");
        const tools = Array.isArray(base.tools) ? base.tools : [];
        return { ...base, tools: [...tools, { type: "web_search" }] };
      },
    });
}

/**
 * The served model for one profile. The HTTP transports resolve their credential on every request
 * through pi's own auth path, so a failed read ends that request as a provider error instead of
 * throwing out of the agent loop; the claude transport hands its credential to the CLI once.
 */
export async function openPiModel(
  profile: PiProfile,
  auth: () => Promise<PiCredential>,
  claude: ClaudeCli | null,
  hooks: PiModelHooks = {},
): Promise<PiModel> {
  if (profile.transport === "claude") {
    if (claude === null) throw new Error("the claude transport requires the Claude CLI");
    return claudeModel(profile, await auth(), claude, hooks);
  }
  const supply = async () => {
    const current = await auth();
    if (current.type === "bearer") {
      throw new Error(`the ${profile.transport} transport takes no bearer token`);
    }
    return current;
  };
  // Read once before pi's store does, which would wrap a missing login's typed refusal.
  await supply();
  const models = createModels({ credentials: suppliedCredentials(profile.provider, supply) });
  models.setProvider(providerFor(profile.provider));
  if ((await models.getAuth(profile.provider)) === undefined) {
    throw new Error(`authentication unavailable for ${profile.provider}`);
  }
  const { known, modelSelection } = catalogueSelection(models, profile);
  const stream: StreamFn = (model, context, options) => models.streamSimple(model, context, options);
  // TODO(codex compaction): a `codex-ss` mode would add a `context_management` compaction entry
  // through the payload hook, as withServerWebSearch does. It waits on pi-ai carrying the returned
  // `compaction` output item into the next request.
  return {
    model: known,
    streamFn: profile.webSearch === true ? withServerWebSearch(stream) : stream,
    modelSelection,
  };
}

/** A scripted model for tests: pi's faux provider answering with the given rows in order. */
export function fakePiModel(profile: PiProfile, rows: AssistantMessage[]): PiModel {
  const faux = fauxProvider({
    provider: profile.provider,
    models: [{ id: profile.model, reasoning: profile.thinkingLevel !== "off" }],
  });
  faux.setResponses(rows);
  const model = faux.getModel();
  return {
    model,
    streamFn: faux.provider.streamSimple.bind(faux.provider),
    modelSelection: {
      resolvedModel: model.id,
      effort: profile.thinkingLevel,
      source: MODEL_CATALOGUE_SOURCES.faux,
    },
  };
}
