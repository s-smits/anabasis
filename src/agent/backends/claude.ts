/**
 * The Claude backend: Claude Code, run through the Agent SDK, served to pi as a provider.
 *
 * One pi session is one live SDK query. pi's tools reach Claude Code as an in-process MCP server whose
 * handlers park until pi has run the call and sent the result back, and one pi turn is one API message
 * with a pi tool call in it, or the last of the query's prompt. That design is pi-claude-bridge's
 * (e870bc89), and its four leaf modules come over verbatim; its index.ts does not. A headless solve has
 * no steering or UI, so the glue a solve needs is this file.
 *
 * The query runs under the options v1's sweep solves ran under, wherever an option changes what the
 * solver sees: the MCP server's name, which every tool name carries; the CLI's WebSearch beside the
 * pi tools; bypassed permissions; summarized thinking; the effort each model was served; and a
 * working directory outside any repository, as v1's worker bundle directory was, since Claude Code
 * writes its directory and git state into its prompt. A nudge is a further user message into the
 * same query, where v1 resumed the session in a fresh one; the model reads the same history either
 * way.
 * A request's signal interrupts only the turn being read; the query closes on the seat's shutdown
 * signal (`ClaudeOptions.shutdown`), including while tools run between turns.
 *
 * One of the sweep's options is not kept: its solver read Claude Code's own system prompt with the
 * harness's appended. That prompt is a coding assistant's, about a repository and Claude Code's own
 * tools, none of which a session here has: every tool is pi's, served through the MCP server. So
 * every session, a solver's, a Builder's, an Examiner's and a reviewer's alike, is sent its own
 * prompt and nothing before it. A solver's is pi coding-agent's (`src/solver/prompt.ts`).
 *
 * One difference is left, and it reaches no model: v1 ran Claude Code in an empty environment; here
 * HOME, the solve's own, PATH and TMPDIR are set as well.
 * Backend cost is the query's closing or last diagnostic total, taken once; it neither replaces
 * nor constrains the host's calculated billing, and is null where no total was reported.
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
import {
  extractAllToolResults,
  type McpResult,
} from "../../../vendor/pi-claude-bridge/extract-tool-results.ts";
import { createToolServer } from "../../../vendor/pi-claude-bridge/mcp-server.ts";
import {
  makePromptStream,
  type PromptStream,
  userMessage,
} from "../../../vendor/pi-claude-bridge/prompt-stream.ts";
import { updateUsage } from "../../../vendor/pi-claude-bridge/usage.ts";
import { existsSync, mkdirSync } from "../../meta/filesystem.ts";
import { asRecord, isNumber, isString } from "../../meta/json-shape.ts";
import { keyIfDefined } from "../../meta/optional-key.ts";
import { dirname, join } from "../../meta/path.ts";
import { runtimeProcess } from "../../meta/process.ts";
import { errorMessage } from "../../meta/runtime-values.ts";

const CLAUDE_PROVIDER = "claude";
/**
 * The same backend on an Anthropic API key in place of a Claude Code login: the same CLI, the same
 * models and the same prompt, billed to the key's account. It is a provider of its own, so that
 * which account spends is named on the command line (`--solver claude-api/<model>`) and stands in
 * every condition and every price key the log holds. A key in the host's environment never moves
 * a solve asked of `claude`: the CLI is handed one credential, the one its provider names.
 */
export const CLAUDE_API_PROVIDER = "claude-api";
/** What each of the two is called, and the one variable that holds its credential: in the host's
 *  environment, where pi reads it, and in the CLI's, where Claude Code does. */
const ACCOUNTS = new Map([
  [
    CLAUDE_PROVIDER,
    {
      name: "Claude Code (Agent SDK)",
      holds: "Claude Code OAuth token",
      variable: "CLAUDE_CODE_OAUTH_TOKEN",
    },
  ],
  [
    CLAUDE_API_PROVIDER,
    {
      name: "Claude Code (Agent SDK), on an API key",
      holds: "Anthropic API key",
      variable: "ANTHROPIC_API_KEY",
    },
  ],
]);
const API = "claude-agent-sdk";

/** The MCP server's name, as the bridge spells it; every tool name carries it. */
const SERVER = "custom-tools";
const TOOL_PREFIX = `mcp__${SERVER}__`;
/** The CLI's own tools the solver is given, all server-side: v1's, under the `webSearch: true`
 *  every Claude profile of v1 set. */
const CLI_TOOLS = ["WebSearch"];
/** How long a closing query waits on its interrupt. One answered mid-turn in 16 ms. */
const INTERRUPT_MS = 1000;
/**
 * How long a turn waits for Claude Code's next message before it reads the query as hung. A turn
 * streams partial messages while the model writes, and Claude Code's own retries and compactions take
 * minutes at most. On 24 October the Builder b-2 of buffer-fresh-opus-v065-b had its tool results due
 * at 00:24Z and heard nothing after: its Claude Code idle, with no connection open and nothing queued
 * on either side of its pipes. Of 558 recorded turns whose calls ran over 10 minutes, it is the one
 * that never continued, and the session's 24-hour wall, which stops while host actions run, would
 * have ended it 22 hours later.
 */
const QUIET_MS = 30 * 60_000;
/** The bridge's table, for a level the model's own map does not name. */
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
  /** Whether a turn is reading the query, which then takes its result itself. */
  reading: boolean;
  /** How long a turn waits for the query's next message (`QUIET_MS`). */
  readonly quiet: number;
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
 * under which a 300K compaction window is clamped. v1 measured each of the first five; every other
 * model went bare. Opus 5.5 and Sonnet 5.5 came after; on 8 October the CLI served each a million
 * tokens under its `[1m]` id.
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

/** The live queries of this process, by the caller's session id: two sessions that run at once need
 *  two ids, or the second one's turns go into the first one's query. */
const sessions = new Map<string, Session>();
/** The cost Claude Code reported at the host's close of a query no turn was reading, by session id,
 *  until `reportedCost` takes it. */
const closings = new Map<string, Promise<number | null>>();

/**
 * The diagnostic the query's last turn carries: `details.totalCostUsd` is the whole query's cost as
 * Claude Code reports it, which the meter's billed dollars are held to.
 */
export const REPORTED_COST = "claude-code-total-cost";

/**
 * The diagnostic a turn carries for each compaction Claude Code ran before it: `details.tokensBefore`
 * and `details.seconds`, from the CLI's `compact_boundary`, as v1's `onCompaction` read it.
 */
export const CLAUDE_COMPACTED = "claude-code-compaction";

/**
 * How Claude Code fits a full context: its own auto-compaction at a window of this many tokens, or not
 * at all, in which case a context that outgrows the model ends the query on the API's refusal.
 */
export type ClaudeCompaction = { readonly window: number } | "off";

/**
 * The sweep's window: v1's `CONTEXT_COMPACT_WINDOW`, which its Claude solves ran under.
 */
export const SWEEP_COMPACT_WINDOW = 300_000;

/**
 * The window bounds Claude Code 0.3.285 accepts. Its resolver drops a window outside them without a
 * word and falls back to the model's own (`gXe=1e5,ggt=1e6` in the bundled CLI of
 * `@anthropic-ai/claude-agent-sdk-darwin-arm64`), so a condition that pinned one would run another.
 */
const WINDOW_BOUNDS = [100_000, 1_000_000] as const;

/** The months as a provider spells a dated reset, by their first three letters. */
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export interface ClaudeOptions {
  /** The Claude Code binary the query runs, as `claudeExecutable()` resolved it on the host. */
  readonly executable: string;
  readonly compaction: ClaudeCompaction;
  /** Claude Code's HOME, which holds its configuration and transcripts: one per solve, outside the
   *  command wall, so no command reads them and no host Claude state reaches the query. */
  readonly home: string;
  /** Whether the CLI's WebSearch stands beside the session's tools. Left out, it does, as it did for
   *  the sweep's solver. */
  readonly webSearch?: boolean;
  /** How long Claude Code keeps its prompt cache. Left out, it keeps it for an hour on a login and
   *  five minutes on an API key, as the CLI chooses. */
  readonly cacheTtl?: "5m" | "1h";
  /** The seat's lifetime, independent of the invocation signal pi passes to each request. */
  readonly shutdown?: AbortSignal | undefined;
  /** How long a turn waits for Claude Code's next message. Left out, `QUIET_MS`. */
  readonly quiet?: number;
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

/** Whether a model is served through Claude Code, on either account. */
export function servedByClaude(provider: string): boolean {
  return ACCOUNTS.has(provider);
}

/**
 * The Claude Code binary the Agent SDK ships in its platform package, resolved on the host. The SDK
 * resolves it itself from its own module URL (`SV` in `sdk.mjs` 0.3.285), which fails inside a bundled
 * worker and would point into the repository the solve wall denies; the host resolves it here instead,
 * passes it in and reopens it read-only, as v1 did.
 */
export function claudeExecutable(): string {
  const sdk = dirname(Bun.resolveSync("@anthropic-ai/claude-agent-sdk", import.meta.dir));
  const platform = `@anthropic-ai/claude-agent-sdk-${runtimeProcess.platform}-${runtimeProcess.arch}`;
  const cli = join(dirname(Bun.resolveSync(`${platform}/package.json`, sdk)), "claude");
  if (!existsSync(cli)) throw new Error(`${platform} ships no Claude Code binary at ${cli}`);
  return cli;
}

/** pi's Anthropic catalog, served through Claude Code: the same ids and the same list prices. `id`
 *  names the account, a Claude Code login unless it is `CLAUDE_API_PROVIDER`. */
export function claudeProvider(options: ClaudeOptions, id: string = CLAUDE_PROVIDER): Provider {
  const { compaction } = options;
  const account = ACCOUNTS.get(id);
  if (account === undefined) throw new Error(`${id} is no account of the Claude backend`);
  if (
    compaction !== "off" &&
    (compaction.window < WINDOW_BOUNDS[0] || compaction.window > WINDOW_BOUNDS[1])
  ) {
    throw new Error(`Claude Code compacts at a window of ${WINDOW_BOUNDS.join(" to ")} tokens`);
  }
  const stream = (model: Model<Api>, context: TranscriptContext, request?: SimpleStreamOptions) =>
    streamClaude(options, model, context, request);
  return createProvider({
    id,
    name: account.name,
    auth: { apiKey: envApiKeyAuth(account.holds, [account.variable]) },
    // `compat` tunes pi's own Anthropic request, which Claude Code never sends.
    models: getBuiltinModels("anthropic").map(({ compat: _unsent, ...model }) => ({
      ...model,
      provider: id,
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
      turn.stopReason =
        options?.signal?.aborted === true || claude.shutdown?.aborted === true ? "aborted" : "error";
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
  // An abort listener never fires for a signal that has already aborted, so a turn asked under one
  // would launch Claude Code and run its query to the end.
  if (options.signal?.aborted === true) throw new Error(`session ${key} was aborted before its turn`);
  if (claude.shutdown?.aborted === true) throw new Error(`session ${key} was shut down before its turn`);
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
  return await readTurn(key, session, model, turn, options.signal);
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
  const own = getCurrentSystemPrompt(context.messages).trim();
  // Claude Code's working directory, which its prompt names: the solve's own, as v1's was its worker's.
  mkdirSync(claude.home, { recursive: true });
  const live = query({
    prompt: prompt.stream,
    options: {
      pathToClaudeCodeExecutable: claude.executable,
      cwd: claude.home,
      model: LONG_CONTEXT.has(model.id) ? `${model.id}[1m]` : model.id,
      ...keyIfDefined("effort", effort),
      // Thinking arrives summarized rather than omitted whenever an effort is set.
      ...keyIfDefined("extraArgs", effort && { "thinking-display": "summarized" }),
      // The session's prompt is the whole of it: Claude Code's own is not sent before it.
      systemPrompt: own,
      // The harness's pi tools and the CLI's WebSearch are the only tools: no other built-in, no setting
      // file, no skill, no other MCP server. With WebSearch off there is no built-in at all.
      tools: claude.webSearch === false ? [] : CLI_TOOLS,
      skills: [],
      mcpServers: { [SERVER]: createToolServer(SERVER, tools) },
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      strictMcpConfig: true,
      settingSources: [],
      persistSession: false,
      includePartialMessages: true,
      abortController: abort,
      env: claudeEnv(claude, { provider: model.provider, token: options.apiKey }),
    },
  });
  const session: Session = {
    query: live,
    prompt,
    abort,
    parked,
    early,
    reading: false,
    quiet: claude.quiet ?? QUIET_MS,
  };
  sessions.set(key, session);
  claude.shutdown?.addEventListener("abort", () => close(key, session), {
    once: true,
    signal: abort.signal,
  });
  return session;
}

/**
 * The effort v1 asked Claude Code for at `level`: the model's own map, then the
 * table; none, so the CLI's default, where neither names one.
 */
function claudeEffort(model: Model<Api>, level: ThinkingLevel | undefined): EffortLevel | undefined {
  if (level === undefined) return undefined;
  // SAFETY: a catalog map spells its levels in the effort set Claude Code takes, as v1 relied on.
  return (model.thinkingLevelMap?.[level] as EffortLevel | null | undefined) ?? EFFORTS[level];
}

/**
 * The whole environment Claude Code runs in: HOME, the solve's own, PATH and TMPDIR; nothing else of
 * the host's reaches the CLI, so no host variable can move its compaction, its account or its MCP
 * servers. Its one credential is its provider's: a Claude Code login for `claude`, an API key for
 * `claude-api`, each under the variable Claude Code reads it from and never both.
 */
function claudeEnv(
  { cacheTtl, compaction, home }: ClaudeOptions,
  credential: { readonly provider: string; readonly token: string | undefined },
): Record<string, string> {
  const account = ACCOUNTS.get(credential.provider);
  const { token } = credential;
  if (account === undefined || token === undefined) {
    throw new Error(
      `the Claude backend needs ${account === undefined ? "an account" : `a ${account.holds}`}`,
    );
  }
  // One configuration directory per solve home, as v1 kept one per worker, so no host Claude state
  // is read. It is not `.claude`, so a run on the host's own HOME still reads none.
  const config = join(home, "claude-config");
  mkdirSync(config, { recursive: true });
  return {
    HOME: home,
    ...keyIfDefined("PATH", Bun.env.PATH),
    ...keyIfDefined("TMPDIR", Bun.env.TMPDIR),
    CLAUDE_CONFIG_DIR: config,
    [account.variable]: token,
    // claude.ai's cloud MCP servers load past strict MCP config and empty setting sources unless this
    // is off, as the sweep set it.
    ENABLE_CLAUDEAI_MCP_SERVERS: "0",
    // `off` is real. In the bundled CLI 0.3.285 the auto-compact gate `Uf` is false when `rht` reads
    // DISABLE_AUTO_COMPACT or DISABLE_COMPACT, and `Uf` gates the threshold compaction (`hAe`), the
    // reactive one after a too-long prompt (`UEr`) and the precomputed summary (`x4n`); a context that
    // outgrows the model then ends the query. The sweep set the window.
    ...(compaction === "off"
      ? { DISABLE_AUTO_COMPACT: "1" }
      : { CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(compaction.window) }),
    ...keyIfDefined("CLAUDE_CODE_PROMPT_CACHE_TTL", cacheTtl),
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
 * into the next, as v1's ended only on a pi call, and bills both.
 */
async function readTurn(
  key: string,
  session: Session,
  model: Model<Api>,
  turn: AssistantMessage,
  signal: AbortSignal | undefined,
): Promise<TurnEnd> {
  const spent: Usage[] = [];
  const interrupt = () => {
    session.query.interrupt().catch(() => close(key, session));
  };
  session.reading = true;
  signal?.addEventListener("abort", interrupt, { once: true });
  if (signal?.aborted === true) interrupt();
  try {
    return await readMessages(key, session, model, turn, { spent, signal });
  } finally {
    signal?.removeEventListener("abort", interrupt);
    session.reading = false;
    for (const usage of spent) addUsage(turn.usage, usage);
    calculateCost(model, turn.usage);
  }
}

async function readMessages(
  key: string,
  session: Session,
  model: Model<Api>,
  turn: AssistantMessage,
  request: { readonly spent: Usage[]; readonly signal: AbortSignal | undefined },
): Promise<TurnEnd> {
  let apiStop: string | null = null;
  // The reset of a limit the provider reported refusing on, said with a refused turn's error.
  let limited = "";
  for (;;) {
    const next = await heard(key, session);
    if (next.done === true) throw new Error("Claude Code ended the query without a result");
    const message = next.value;
    if (message.type === "assistant" && message.parent_tool_use_id === null) take(message, model, turn);
    else if (message.type === "system" && message.subtype === "compact_boundary") {
      const { pre_tokens: tokensBefore, duration_ms: ms } = message.compact_metadata;
      const details = { tokensBefore, seconds: ms === undefined ? null : ms / 1000 };
      turn.diagnostics = [
        ...(turn.diagnostics ?? []),
        { type: CLAUDE_COMPACTED, timestamp: Date.now(), details },
      ];
    } else if (message.type === "stream_event" && message.event.type === "message_delta") {
      apiStop = message.event.delta.stop_reason;
      updateUsage(turn, message.event.usage, model);
    } else if (
      message.type === "stream_event" &&
      message.event.type === "message_stop" &&
      apiStop === "tool_use"
    ) {
      if (request.signal?.aborted !== true && turn.content.some((block) => block.type === "toolCall")) {
        return "toolUse";
      }
      request.spent.push(turn.usage);
      turn.usage = emptyUsage();
    } else if (message.type === "rate_limit_event") {
      const { status, resetsAt } = message.rate_limit_info;
      limited = status === "rejected" && resetsAt !== undefined ? ` (limit reached|${String(resetsAt)})` : "";
    } else if (message.type === "result") {
      // The query stays open for a later prompt; the cost Claude Code reports is the query's so far.
      turn.diagnostics = [
        ...(turn.diagnostics ?? []),
        { type: REPORTED_COST, timestamp: Date.now(), details: { totalCostUsd: message.total_cost_usd } },
      ];
      if (request.signal?.aborted === true) throw new Error("the Claude Code request was interrupted");
      const end = apiStop === null ? undefined : FINAL_STOPS.get(apiStop);
      if (message.subtype === "success" && !message.is_error && end !== undefined) return end;
      // Claude Code reports the turn the host's own close interrupted as a run that failed.
      if (sessions.get(key) !== session) throw new Error("the host closed the query");
      close(key, session);
      if (message.subtype !== "success") {
        throw new Error(`Claude Code: ${message.subtype}: ${message.errors.join("; ")}${limited}`);
      }
      if (message.is_error) throw new Error(`Claude Code: ${message.result}${limited}`);
      throw new Error(`Claude Code: the model stopped on ${apiStop ?? "no stop reason"}`);
    }
  }
}

/**
 * The query's next message, or a throw once Claude Code has sent nothing for the session's quiet
 * bound. The query is closed first, so its parked handlers are answered and a turn asked of it again
 * finds none: the seat reads a provider failure, a solve is solved again, and a Builder's
 * conversation ends crashed while its campaign goes on.
 */
async function heard(key: string, session: Session) {
  const { promise: silent, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(() => {
    close(key, session);
    reject(new Error(`Claude Code sent nothing for ${String(session.quiet / 60_000)} minutes`));
  }, session.quiet);
  try {
    return await Promise.race([session.query.next(), silent]);
  } finally {
    clearTimeout(timer);
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

/**
 * End the query and answer every parked handler, so no Claude Code call is left waiting on pi.
 *
 * The turn is interrupted before the query is aborted. An abort alone closes Claude Code's stdin and
 * gives it two seconds before a signal, and Claude Code spends them on its turn: with a call still
 * parked it asks the model again, and no meter reads that request. On 8 October a query closed on a
 * parked `submit` called it again 975 ms and 1,812 ms after, and Claude Code's own logs of that
 * day's solves hold such a call after 14 of 35. Interrupted first, it called nothing and was gone
 * inside a second. The timer is for a child that never answers the interrupt.
 *
 * A query no turn is reading is read on to the result the interrupt brings, which carries the cost,
 * and ends there (`reportedCost`); a turn being read takes that result itself.
 */
function close(key: string, session: Session): void {
  if (sessions.get(key) !== session) return;
  sessions.delete(key);
  session.prompt.end();
  const end = () => session.abort.abort();
  const interrupted = session.query.interrupt();
  if (session.reading) void interrupted.then(end, end);
  else {
    void interrupted.catch(end);
    closings.set(key, costAtClose(session).finally(end));
  }
  setTimeout(end, INTERRUPT_MS).unref();
  for (const resolve of session.parked.values()) {
    resolve({ content: [{ type: "text", text: "the query was closed" }] });
  }
  session.parked.clear();
  session.early.clear();
}

/**
 * What Claude Code reported session `key`'s query cost, separate from the meter's calculated dollars,
 * or null where it reported none, as a provider other than Claude Code reports none. A session that
 * ended on a call of its own, `finish` or `submit`, leaves Claude Code waiting on that call's result,
 * and the query's `result` comes only after the host's close interrupts it: this waits on that close.
 * Until 12 October every reader took the cost from the turns alone, so a session that ended the
 * ordinary way had none, and only one that failed did: on buffer, 10.19 of 13.35 billed dollars had
 * no figure of Claude Code's beside them.
 */
export async function reportedCost(key: string, turns: readonly AssistantMessage[]): Promise<number | null> {
  const closing = await closings.get(key);
  closings.delete(key);
  const last = turns.flatMap((turn) => turn.diagnostics ?? []).findLast(({ type }) => type === REPORTED_COST);
  const reported = asRecord(last?.details)?.totalCostUsd;
  return closing ?? (isNumber(reported) ? reported : null);
}

/** The cost on the query's next `result`, or null where the query ends or is aborted first. */
async function costAtClose(session: Session): Promise<number | null> {
  const aborted = new Promise<null>((resolve) => {
    session.abort.signal.addEventListener("abort", () => resolve(null), { once: true });
  });
  for (;;) {
    const next = await Promise.race([session.query.next(), aborted]).catch(() => null);
    if (next === null || next.done === true) return null;
    if (next.value.type === "result") return next.value.total_cost_usd;
  }
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

/**
 * When the provider limit `said` names its reset, as the next such instant after `now`, or on the
 * date it names, or null where it names none or is no limit. Two spellings: a clock time after
 * "reset", with a date before it, am or pm and the zone in parentheses where given ("resets 3:50pm
 * (Europe/Amsterdam)", "resets Oct 15 at 9pm (Europe/Amsterdam)"; the host's zone where none is;
 * until 15 October a date read as the hour 15, host-local), and a
 * message ending in the instant's Unix seconds ("limit reached|1760276400"), which this backend
 * adds to a turn the provider refused on a limit it reported with its reset (`readMessages`).
 */
export function resetOf(said: string, now: Date): Date | null {
  // A connection "reset" with a number near it is no limit.
  if (!/\blimit\b/i.test(said)) return null;
  const unix = /limit reached\|(\d{10})\b/i.exec(said)?.[1];
  if (unix !== undefined) return new Date(Number(unix) * 1000);
  const clock =
    /\breset[s]?\b\D{0,24}?(?:\b([a-z]{3})[a-z]*\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:\(([A-Za-z_]+(?:\/[A-Za-z_+-]+)+)\))?/i.exec(
      said,
    );
  if (clock === null) return null;
  const [, named, date, h = "", m = "0", half, zone] = clock;
  const hour = half === undefined ? Number(h) : (Number(h) % 12) + (half.toLowerCase() === "pm" ? 12 : 0);
  const dated = named === undefined ? undefined : MONTHS.indexOf(named.toLowerCase());
  if (dated === -1 || hour > 23 || Number(m) > 59) return null;
  try {
    const wall = new Intl.DateTimeFormat("en-US", {
      ...keyIfDefined("timeZone", zone),
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    }).formatToParts(now);
    const part = (type: string) => Number(wall.find((one) => one.type === type)?.value);
    const [year, month, day] = [part("year"), part("month") - 1, part("day")];
    const offset =
      Date.UTC(year, month, day, part("hour"), part("minute")) - Math.floor(now.getTime() / 60_000) * 60_000;
    const at =
      Date.UTC(year, dated ?? month, dated === undefined ? day : Number(date), hour, Number(m)) - offset;
    return new Date(at > now.getTime() || dated !== undefined ? at : at + 86_400_000);
  } catch {
    // A zone the host does not know names no instant it can wait for.
    return null;
  }
}
