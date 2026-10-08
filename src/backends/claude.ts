/**
 * The Claude backend: Claude Code, run through the Agent SDK, served to pi as a provider.
 *
 * One pi session is one live SDK query. pi's tools reach Claude Code as an in-process MCP server whose
 * handlers park until pi has run the call and sent the result back, and one pi turn is one API message
 * with a pi tool call in it, or the last of the query's prompt. That design is pi-claude-bridge's
 * (e870bc89), and its four leaf modules come over verbatim; its index.ts does not. A headless solve has
 * no steering or UI, so the glue a solve needs is this file.
 *
 * The query runs under the options sweep veryhard-hb-4c67fc's solves did (harness-builder-v4 at 7af7315,
 * `vendor/pi-claude-bridge/provider.ts:384-450`), wherever an option changes what the solver sees: the
 * MCP server's name, which every tool name carries (`turn-translation.ts:19-20`); the CLI's WebSearch
 * beside the pi tools (`src/backends/pi-built-child.ts:193-196`); bypassed permissions; summarized
 * thinking; the effort each model was served; and a working directory outside any repository, as v1's
 * worker bundle directory was (`src/backends/pi-built.ts:236-238`), since Claude Code writes its
 * directory and git state into its prompt. A nudge is a further user message into the same query, where v1 resumed the session in a
 * fresh one (`provider.ts:525-560`); the model reads the same history either way.
 *
 * One difference is left, and it reaches no model: v1 spawned its worker with an empty environment
 * (`pi-built-process.ts:529-533`) and spread that into Claude Code's (`provider.ts:420`); here HOME, the
 * solve's own, PATH and TMPDIR are set as well.
 */
import {
  type EffortLevel,
  type Query,
  query,
  type SDKAssistantMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  calculateCost,
  createAssistantMessageEventStream,
  createProvider,
  envApiKeyAuth,
  getCurrentSystemPrompt,
  getCurrentTools,
  type Model,
  type Provider,
  type SimpleStreamOptions,
  type StopReason,
  type ThinkingLevel,
  type TranscriptContext,
  type Usage,
  type UserMessage,
} from "@earendil-works/pi-ai";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import { extractAllToolResults, type McpResult } from "../../vendor/pi-claude-bridge/extract-tool-results.ts";
import { createToolServer } from "../../vendor/pi-claude-bridge/mcp-server.ts";
import {
  makePromptStream,
  type PromptStream,
  userMessage,
} from "../../vendor/pi-claude-bridge/prompt-stream.ts";
import { updateUsage } from "../../vendor/pi-claude-bridge/usage.ts";
import { existsSync, mkdirSync } from "../meta/filesystem.ts";
import { asRecord, isString } from "../meta/json-shape.ts";
import { keyIfDefined, keyIfTruthy } from "../meta/optional-key.ts";
import { dirname, join } from "../meta/path.ts";
import { runtimeProcess } from "../meta/process.ts";
import { errorMessage } from "../meta/runtime-values.ts";

export const CLAUDE_PROVIDER = "claude";
const API = "claude-agent-sdk";
/** turn-translation.ts:19-20. */
const SERVER = "custom-tools";
const TOOL_PREFIX = `mcp__${SERVER}__`;
/** The CLI's own tools the solver is given, all server-side: pi-built-child.ts:193-196, under the
 *  `webSearch: true` every Claude profile set (`src/backends/pi-built.ts:136`). */
const CLI_TOOLS = ["WebSearch"];
/** provider.ts:222-224: the bridge's table, for a level the model's own map does not name. */
const EFFORTS: Readonly<Partial<Record<ThinkingLevel, EffortLevel>>> = {
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "max",
};

interface Session {
  readonly query: Query;
  readonly prompt: PromptStream;
  readonly abort: AbortController;
  /** Handlers Claude Code is blocked in, by tool_use id. */
  readonly parked: Map<string, (result: McpResult) => void>;
  /** Results pi sent before Claude Code called their handler. */
  readonly early: Map<string, McpResult>;
}

/** How one API message can end a pi turn; a failure ends it by throwing. */
type TurnEnd = Extract<StopReason, "stop" | "length" | "toolUse">;

/**
 * How the query's last API message ends the turn, by its stop reason. The set is the Messages API's
 * `BetaStopReason` (`@anthropic-ai/sdk` 0.129.0, `resources/beta/messages/messages.d.ts:3579`), which the
 * Agent SDK's stream events carry. `model_context_window_exceeded` cut the answer at the window, as
 * `max_tokens` cuts it at the output cap. Every other reason is no answer of the solver's own and fails
 * the turn, so the runner types it as the provider's non-result: `refusal` is the model declining;
 * `tool_use`, `pause_turn` and `compaction` mean Claude Code stopped with the turn unfinished, since it
 * runs pi's tools, resumes a paused server tool and finishes its own compaction before it reports; and
 * a reason this list does not know is not read as an ordinary end.
 */
const FINAL_STOPS: ReadonlyMap<string, TurnEnd> = new Map([
  ["end_turn", "stop"],
  ["stop_sequence", "stop"],
  ["max_tokens", "length"],
  ["model_context_window_exceeded", "length"],
]);

/**
 * The models the sweep asked Claude Code for by their long-context id, which is what gives them a
 * million-token window on a subscription token; the CLI serves a bare id at its own default window,
 * under which a 300K compaction window is clamped. v1 measured each (`vendor/pi-claude-bridge/models.ts:17-50`
 * at 7af7315, under the `plan: "pro"` settings of `provider.ts:60`); every other model went bare. Opus
 * 5.5 and Sonnet 5.5 came after; on 2026-10-08 the CLI served each a million tokens under its
 * `[1m]` id.
 */
const LONG_CONTEXT = new Set([
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-fable-5",
  "claude-fable-5-1",
  "claude-sonnet-5",
  "claude-opus-5-5",
  "claude-sonnet-5-5",
]);

const sessions = new Map<string, Session>();

/**
 * The diagnostic the query's last turn carries: `details.totalCostUsd` is the whole query's cost as
 * Claude Code reports it, which the meter's billed dollars are held to.
 */
export const REPORTED_COST = "claude-code-total-cost";

/**
 * How Claude Code fits a full context: its own auto-compaction at a window of this many tokens, or not
 * at all, in which case a context that outgrows the model ends the query on the API's refusal.
 */
export type ClaudeCompaction = { readonly window: number } | "off";

/**
 * The sweep's window: v1's `CONTEXT_COMPACT_WINDOW` (`src/backends/backend-types.ts:32` at 7af7315),
 * which its Claude solves ran under (`src/backends/pi-built-child.ts:191`).
 */
export const SWEEP_COMPACT_WINDOW = 300_000;

/**
 * The window bounds Claude Code 0.3.285 accepts. Its resolver drops a window outside them without a
 * word and falls back to the model's own (`gXe=1e5,ggt=1e6` in the bundled CLI of
 * `@anthropic-ai/claude-agent-sdk-darwin-arm64`), so a condition that pinned one would run another.
 */
const WINDOW_BOUNDS = [100_000, 1_000_000] as const;

export interface ClaudeOptions {
  /** The Claude Code binary the query runs, as `claudeExecutable()` resolved it on the host. */
  readonly executable: string;
  readonly compaction: ClaudeCompaction;
  /** Claude Code's HOME, which holds its configuration and transcripts: one per solve, outside the
   *  command wall, so no command reads them and no host Claude state reaches the query. */
  readonly home: string;
}

/**
 * The window Claude Code gives a bare id, `fq=200000` in the bundled CLI 0.3.285. Its resolver clamps
 * the compaction window to the model's own (`window: Math.min(g, ye)` in `XA`), so a larger window
 * pinned for a bare id would run at this one.
 */
const BARE_WINDOW = 200_000;

/**
 * The compaction a condition pins for a Claude solve on `modelId`, in the words the CLI's own
 * settings use. A window the id's served context cannot hold is refused, where the CLI would clamp it
 * without a word: a bare id such as `claude-haiku-4-5` is served 200K, under which a 300K window
 * would run.
 */
export function claudeCompactionMode(compaction: ClaudeCompaction, modelId: string): string {
  if (compaction === "off") return "off";
  const served = LONG_CONTEXT.has(modelId) ? WINDOW_BOUNDS[1] : BARE_WINDOW;
  if (compaction.window > served) {
    throw new Error(
      `Claude Code serves ${modelId} a ${String(served)}-token context, so a ${String(compaction.window)}-token compaction window would be clamped`,
    );
  }
  return `autoCompactWindow=${String(compaction.window)}`;
}

/**
 * The Claude Code binary the Agent SDK ships in its platform package, resolved on the host. The SDK
 * resolves it itself from its own module URL (`SV` in `sdk.mjs` 0.3.285), which fails inside a bundled
 * worker and would point into the repository the solve wall denies; the host resolves it here instead,
 * passes it in and reopens it read-only, as v1 did (`src/backends/pi-built.ts:212-229` at 7af7315).
 */
export function claudeExecutable(): string {
  const sdk = dirname(Bun.resolveSync("@anthropic-ai/claude-agent-sdk", import.meta.dir));
  const platform = `@anthropic-ai/claude-agent-sdk-${runtimeProcess.platform}-${runtimeProcess.arch}`;
  const cli = join(dirname(Bun.resolveSync(`${platform}/package.json`, sdk)), "claude");
  if (!existsSync(cli)) throw new Error(`${platform} ships no Claude Code binary at ${cli}`);
  return cli;
}

/** pi's Anthropic catalog, served through Claude Code: the same ids and the same list prices. */
export function claudeProvider(options: ClaudeOptions): Provider {
  const { compaction } = options;
  if (
    compaction !== "off" &&
    (compaction.window < WINDOW_BOUNDS[0] || compaction.window > WINDOW_BOUNDS[1])
  ) {
    throw new Error(`Claude Code compacts at a window of ${WINDOW_BOUNDS.join(" to ")} tokens`);
  }
  const stream = (model: Model<Api>, context: TranscriptContext, request?: SimpleStreamOptions) =>
    streamClaude(options, model, context, request);
  return createProvider({
    id: CLAUDE_PROVIDER,
    name: "Claude Code (Agent SDK)",
    auth: { apiKey: envApiKeyAuth("Claude Code OAuth token", ["CLAUDE_CODE_OAUTH_TOKEN"]) },
    // `compat` tunes pi's own Anthropic request, which Claude Code never sends.
    models: getBuiltinModels("anthropic").map(({ compat: _unsent, ...model }) => ({
      ...model,
      provider: CLAUDE_PROVIDER,
      api: API,
    })),
    api: { stream, streamSimple: stream },
  });
}

function streamClaude(
  claude: ClaudeOptions,
  model: Model<Api>,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const out = createAssistantMessageEventStream();
  const turn = emptyTurn(model);
  // The turn starts before the query opens, as pi's own Anthropic stream starts before its request.
  out.push({ type: "start", partial: turn });
  runTurn(claude, model, context, options ?? {}, turn).then(
    (reason) => {
      turn.stopReason = reason;
      out.push({ type: "done", reason, message: turn });
      out.end();
    },
    (cause: unknown) => {
      turn.stopReason = options?.signal?.aborted === true ? "aborted" : "error";
      turn.errorMessage = errorMessage(cause);
      out.push({ type: "error", reason: turn.stopReason, error: turn });
      out.end();
    },
  );
  return out;
}

async function runTurn(
  claude: ClaudeOptions,
  model: Model<Api>,
  context: TranscriptContext,
  options: SimpleStreamOptions,
  turn: AssistantMessage,
): Promise<TurnEnd> {
  const key = options.sessionId;
  if (key === undefined) throw new Error("the Claude backend needs a sessionId: one per Claude Code query");
  const { results } = extractAllToolResults(context.messages.map((message) => ({ ...message })));
  let session = sessions.get(key);
  if (results.length > 0) {
    if (!session) throw new Error(`no live Claude Code query in session ${key} takes these tool results`);
    for (const result of results) deliver(session, result);
  } else {
    // A later prompt, a nudge, goes into the live query, which holds the history itself.
    if (!session && context.messages.some((message) => message.role === "assistant")) {
      throw new Error(`no live Claude Code query in session ${key} holds this conversation`);
    }
    session ??= open(claude, model, context, options, key);
    await session.prompt.push(userMessage(promptText(context)));
  }
  return await readTurn(key, session, model, turn);
}

function open(
  claude: ClaudeOptions,
  model: Model<Api>,
  context: TranscriptContext,
  options: SimpleStreamOptions,
  key: string,
): Session {
  const parked = new Map<string, (result: McpResult) => void>();
  const early = new Map<string, McpResult>();
  const tools = getCurrentTools(context.messages).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters,
    handler: (toolCallId: string) =>
      new Promise<McpResult>((resolve) => {
        const ready = early.get(toolCallId);
        if (!ready) return void parked.set(toolCallId, resolve);
        early.delete(toolCallId);
        resolve(ready);
      }),
  }));
  const prompt = makePromptStream();
  const abort = new AbortController();
  const effort = claudeEffort(model, options.reasoning);
  // Claude Code's working directory, which its prompt names: the solve's own, as v1's was its worker's.
  mkdirSync(claude.home, { recursive: true });
  const live = query({
    prompt: prompt.stream,
    options: {
      pathToClaudeCodeExecutable: claude.executable,
      cwd: claude.home,
      model: LONG_CONTEXT.has(model.id) ? `${model.id}[1m]` : model.id,
      ...keyIfDefined("effort", effort),
      // Thinking arrives summarized rather than omitted whenever an effort is set (`provider.ts:405-408`).
      ...keyIfDefined("extraArgs", effort && { "thinking-display": "summarized" }),
      // Claude Code's own prompt with the harness's appended, as the sweep ran (`provider.ts:439-442`):
      // the solver reads the same preamble around the same Built prompt.
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        ...keyIfTruthy("append", getCurrentSystemPrompt(context.messages).trim()),
      },
      // The harness's pi tools and the CLI's WebSearch are the only tools: no other built-in, no setting
      // file, no skill, no other MCP server (`provider.ts:430-434,445`).
      tools: CLI_TOOLS,
      skills: [],
      mcpServers: { [SERVER]: createToolServer(SERVER, tools) },
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      strictMcpConfig: true,
      settingSources: [],
      persistSession: false,
      includePartialMessages: true,
      abortController: abort,
      env: claudeEnv(claude, options.apiKey),
    },
  });
  const session: Session = { query: live, prompt, abort, parked, early };
  sessions.set(key, session);
  // The signal is the solve's, the same on every turn, so its abort ends the query whether it comes
  // inside a turn, at the wall, or after the loop stopped with the query still open: on a submit,
  // which ends pi's loop while Claude Code waits on the result, or once the last nudge is answered,
  // which leaves the query open for a prompt that never comes.
  options.signal?.addEventListener("abort", () => sessions.get(key) === session && close(key, session), {
    once: true,
  });
  return session;
}

/**
 * The effort v1 asked Claude Code for at `level` (`provider.ts:396-400`): the model's own map, then the
 * table; none, so the CLI's default, where neither names one.
 */
export function claudeEffort(model: Model<Api>, level: ThinkingLevel | undefined): EffortLevel | undefined {
  if (level === undefined) return undefined;
  // SAFETY: a catalog map spells its levels in the effort set Claude Code takes, as v1 relied on.
  return (model.thinkingLevelMap?.[level] as EffortLevel | null | undefined) ?? EFFORTS[level];
}

/**
 * The whole environment Claude Code runs in: HOME, the solve's own, PATH and TMPDIR; nothing else of
 * the host's reaches the CLI, so no host variable can move its compaction, its account or its MCP
 * servers.
 */
function claudeEnv({ compaction, home }: ClaudeOptions, token: string | undefined): Record<string, string> {
  if (token === undefined) throw new Error("the Claude backend needs a Claude Code OAuth token");
  // One configuration directory per solve home, as v1 kept one per worker (`pi-built-child.ts:178-183`),
  // so no host Claude state is read. It is not `.claude`, so a run on the host's own HOME still reads none.
  const config = join(home, "claude-config");
  mkdirSync(config, { recursive: true });
  return {
    HOME: home,
    ...keyIfDefined("PATH", Bun.env.PATH),
    ...keyIfDefined("TMPDIR", Bun.env.TMPDIR),
    CLAUDE_CONFIG_DIR: config,
    CLAUDE_CODE_OAUTH_TOKEN: token,
    // claude.ai's cloud MCP servers load past strict MCP config and empty setting sources unless this
    // is off, as the sweep set it (`provider.ts:410-414,421`).
    ENABLE_CLAUDEAI_MCP_SERVERS: "0",
    // `off` is real. In the bundled CLI 0.3.285 the auto-compact gate `Uf` is false when `rht` reads
    // DISABLE_AUTO_COMPACT or DISABLE_COMPACT, and `Uf` gates the threshold compaction (`hAe`), the
    // reactive one after a too-long prompt (`UEr`) and the precomputed summary (`x4n`); a context that
    // outgrows the model then ends the query. The sweep set the window (`pi-built-child.ts:191`, read at
    // `provider.ts:422-424`).
    ...(compaction === "off"
      ? { DISABLE_AUTO_COMPACT: "1" }
      : { CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(compaction.window) }),
  };
}

/** The opening user message: Claude Code gets it once and keeps the history itself. */
function promptText(context: TranscriptContext): string {
  const prompt = context.messages.findLast((message): message is UserMessage => message.role === "user");
  if (!prompt) throw new Error("the transcript has no user message to open the query with");
  if (isString(prompt.content)) return prompt.content;
  return prompt.content
    .map((block) => {
      if (block.type !== "text") throw new Error("the Claude backend opens a query on text alone");
      return block.text;
    })
    .join("\n\n");
}

function deliver(session: Session, result: McpResult): void {
  const id = result.toolCallId;
  if (id === undefined) throw new Error("a tool result carries no toolCallId to pair it with its call");
  const resolve = session.parked.get(id);
  if (!resolve) return void session.early.set(id, result);
  session.parked.delete(id);
  resolve(result);
}

/**
 * Read the next API message with a pi tool call into `turn`, or the last of the prompt, and say how it
 * stopped. A message that stopped on WebSearch alone is Claude Code's to run, so the turn reads on
 * into the next, as v1's ended only on a pi call (`turn-translation.ts:128-135`), and bills both.
 */
async function readTurn(
  key: string,
  session: Session,
  model: Model<Api>,
  turn: AssistantMessage,
): Promise<TurnEnd> {
  const spent: Usage[] = [];
  try {
    return await readMessages(key, session, model, turn, spent);
  } finally {
    for (const usage of spent) addUsage(turn.usage, usage);
    calculateCost(model, turn.usage);
  }
}

async function readMessages(
  key: string,
  session: Session,
  model: Model<Api>,
  turn: AssistantMessage,
  spent: Usage[],
): Promise<TurnEnd> {
  let apiStop: string | null = null;
  for (;;) {
    const next = await session.query.next();
    if (next.done === true) throw new Error("Claude Code ended the query without a result");
    const message = next.value;
    if (message.type === "assistant" && message.parent_tool_use_id === null) take(message, model, turn);
    else if (message.type === "stream_event" && message.event.type === "message_delta") {
      apiStop = message.event.delta.stop_reason;
      updateUsage(turn, message.event.usage, model);
    } else if (
      message.type === "stream_event" &&
      message.event.type === "message_stop" &&
      apiStop === "tool_use"
    ) {
      if (turn.content.some((block) => block.type === "toolCall")) return "toolUse";
      spent.push(turn.usage);
      turn.usage = emptyUsage();
    } else if (message.type === "result") {
      // The query stays open for a later prompt; the cost Claude Code reports is the query's so far.
      turn.diagnostics = [
        { type: REPORTED_COST, timestamp: Date.now(), details: { totalCostUsd: message.total_cost_usd } },
      ];
      const end = apiStop === null ? undefined : FINAL_STOPS.get(apiStop);
      if (message.subtype === "success" && !message.is_error && end !== undefined) return end;
      close(key, session);
      if (message.subtype !== "success") {
        throw new Error(`Claude Code: ${message.subtype}: ${message.errors.join("; ")}`);
      }
      if (message.is_error) throw new Error(`Claude Code: ${message.result}`);
      throw new Error(`Claude Code: the model stopped on ${apiStop ?? "no stop reason"}`);
    }
  }
}

function addUsage(into: Usage, usage: Usage): void {
  into.input += usage.input;
  into.output += usage.output;
  into.cacheRead += usage.cacheRead;
  into.cacheWrite += usage.cacheWrite;
  into.totalTokens += usage.totalTokens;
  if (usage.cacheWrite1h !== undefined) into.cacheWrite1h = (into.cacheWrite1h ?? 0) + usage.cacheWrite1h;
  if (usage.reasoning !== undefined) into.reasoning = (into.reasoning ?? 0) + usage.reasoning;
}

/**
 * One content block of the API message. Claude Code's `<synthetic>` reports of its own failures stay
 * out. The message names the snapshot that served it, which the condition's model id may only alias.
 */
function take(message: SDKAssistantMessage, model: Model<Api>, turn: AssistantMessage): void {
  if (message.message.model === "<synthetic>") return;
  turn.responseModel = message.message.model;
  for (const block of message.message.content) {
    if (block.type === "text") turn.content.push({ type: "text", text: block.text });
    else if (block.type === "thinking") {
      turn.content.push({ type: "thinking", thinking: block.thinking, thinkingSignature: block.signature });
    } else if (block.type === "tool_use" && block.name.startsWith(TOOL_PREFIX)) {
      const args = asRecord(block.input);
      if (!args) throw new Error(`${block.name}: Claude Code sent arguments that are not an object`);
      turn.content.push({
        type: "toolCall",
        id: block.id,
        name: block.name.slice(TOOL_PREFIX.length),
        arguments: args,
      });
    }
  }
  // pi-claude-bridge 0.9.1's updateUsage leaves pi's hour-long share of the cache writes unset, so pi
  // would bill Claude Code's writes, all of them an hour long, at the five-minute price.
  const longWrite = message.message.usage.cache_creation?.ephemeral_1h_input_tokens;
  if (longWrite !== undefined) turn.usage.cacheWrite1h = longWrite;
  updateUsage(turn, message.message.usage, model);
}

/** End the query and answer every parked handler, so no Claude Code call is left waiting on pi. */
function close(key: string, session: Session): void {
  sessions.delete(key);
  session.prompt.end();
  session.abort.abort();
  for (const resolve of session.parked.values()) {
    resolve({ content: [{ type: "text", text: "the query was closed" }] });
  }
  session.parked.clear();
  session.early.clear();
}

function emptyTurn(model: Model<Api>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage(),
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}
