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
import { asRecord, isString } from "../../meta/json-shape.ts";
import { keyIfDefined, keysIf } from "../../meta/optional-key.ts";
import { dirname, join } from "../../meta/path.ts";
import { runtimeProcess, warn } from "../../meta/process.ts";
import { type BackendSpend, claudeSpend } from "../../kernel/meter.ts";
import { errorMessage } from "../../meta/runtime-values.ts";
import {
  CLAUDE_PROJECT_DIR,
  type ClaudeFork,
  type ClaudePersist,
  savePersistedTranscript,
  stageForkTranscript,
} from "./claude-transcript.ts";

const CLAUDE_PROVIDER = "claude";
export const CLAUDE_API_PROVIDER = "claude-api";
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

const SERVER = "custom-tools";
const TOOL_PREFIX = `mcp__${SERVER}__`;
const CLI_TOOLS = ["WebSearch"];
const INTERRUPT_MS = 1000;
const USAGE_MS = 5000;
const QUIET_MS = 30 * 60_000;
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
  readonly parked: Map<string, (result: McpResult) => void>;
  readonly early: Map<string, McpResult>;
  reading: boolean;
  readonly quiet: number;
  readonly provider: string;
  readonly configDir: string;
  readonly persist?: ClaudePersist | undefined;
  sdkSessionId?: string | undefined;
}

type TurnEnd = Extract<StopReason, "stop" | "length" | "toolUse">;

const FINAL_STOPS: ReadonlyMap<string, TurnEnd> = new Map([
  ["end_turn", "stop"],
  ["stop_sequence", "stop"],
  ["max_tokens", "length"],
  ["model_context_window_exceeded", "length"],
]);

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
const reads = new Map<string, Promise<BackendSpend | null>>();

export const CLAUDE_COMPACTED = "claude-code-compaction";

type ClaudeCompaction = { readonly window: number } | "off";

export const SWEEP_COMPACT_WINDOW = 300_000;

const WINDOW_BOUNDS = [100_000, 1_000_000] as const;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export interface ClaudeOptions {
  readonly executable: string;
  readonly compaction: ClaudeCompaction;
  readonly home: string;
  readonly cwd?: string;
  readonly webSearch?: boolean;
  readonly cacheTtl?: "5m" | "1h";
  readonly shutdown?: AbortSignal | undefined;
  readonly quiet?: number;
  readonly persist?: ClaudePersist | undefined;
  readonly fork?: ClaudeFork | undefined;
}

const BARE_WINDOW = 200_000;

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

export function servedByClaude(provider: string): boolean {
  return ACCOUNTS.has(provider);
}

export function claudeExecutable(): string {
  const sdk = dirname(Bun.resolveSync("@anthropic-ai/claude-agent-sdk", import.meta.dir));
  const platform = `@anthropic-ai/claude-agent-sdk-${runtimeProcess.platform}-${runtimeProcess.arch}`;
  const cli = join(dirname(Bun.resolveSync(`${platform}/package.json`, sdk)), "claude");
  if (!existsSync(cli)) throw new Error(`${platform} ships no Claude Code binary at ${cli}`);
  return cli;
}

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
  if (options.signal?.aborted === true) throw new Error(`session ${key} was aborted before its turn`);
  if (claude.shutdown?.aborted === true) throw new Error(`session ${key} was shut down before its turn`);
  const { results, stopIdx } = extractAllToolResults(context.messages.map((message) => ({ ...message })));
  const steers = context.messages.slice(stopIdx + 1).flatMap((message) =>
    message.role === "user"
      ? [
          isString(message.content)
            ? message.content
            : message.content
                .map((part) => {
                  if (part.type !== "text") throw new Error("the Claude backend opens a query on text alone");
                  return part.text;
                })
                .join("\n\n"),
        ]
      : [],
  );
  let session = sessions.get(key);
  if (session?.reading === true) {
    throw new Error(`session ${key} already has a turn in flight: concurrent seats need distinct sessionIds`);
  }
  if (results.length > 0) {
    if (!session) throw new Error(`no live Claude Code query in session ${key} takes these tool results`);
  } else {
    if (!session && context.messages.some((message) => message.role === "assistant")) {
      throw new Error(`no live Claude Code query in session ${key} holds this conversation`);
    }
    if (steers.length === 0) throw new Error("the transcript has no user message to open the query with");
    session ??= open(claude, model, context, options, key);
  }
  session.reading = true;
  try {
    if (steers.length > 0) {
      await session.prompt.push(userMessage(steers.join("\n\n"), results.length > 0 ? "next" : undefined));
    }
    for (const result of results) deliver(session, result);
    return await readTurn(key, session, model, turn, options.signal);
  } finally {
    session.reading = false;
  }
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
        if (!ready) {
          parked.set(toolCallId, resolve);
          return;
        }
        early.delete(toolCallId);
        resolve(ready);
      }),
  }));
  const prompt = makePromptStream();
  const abort = new AbortController();
  const effort = claudeEffort(model, options.reasoning);
  const own = getCurrentSystemPrompt(context.messages).trim();
  mkdirSync(claude.home, { recursive: true });
  const configDir = join(claude.home, "claude-config");
  const staged = claude.fork === undefined ? undefined : stageForkTranscript(configDir, claude.fork);
  const keepTranscript = claude.persist !== undefined || claude.fork !== undefined;
  const live = query({
    prompt: prompt.stream,
    options: {
      pathToClaudeCodeExecutable: claude.executable,
      cwd: claude.cwd ?? claude.home,
      model: LONG_CONTEXT.has(model.id) ? `${model.id}[1m]` : model.id,
      ...keyIfDefined("effort", effort),
      ...keyIfDefined("extraArgs", effort && { "thinking-display": "summarized" }),
      ...keyIfDefined("resume", staged?.resume),
      ...keysIf(staged !== undefined, () => ({ forkSession: true })),
      ...keyIfDefined("resumeSessionAt", staged?.resumeSessionAt),
      systemPrompt: own,
      tools: claude.webSearch === false ? [] : CLI_TOOLS,
      skills: [],
      mcpServers: { [SERVER]: createToolServer(SERVER, tools) },
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      strictMcpConfig: true,
      settingSources: [],
      persistSession: keepTranscript,
      includePartialMessages: true,
      abortController: abort,
      env: claudeEnv(claude, keepTranscript, { provider: model.provider, token: options.apiKey }),
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
    provider: model.provider,
    configDir,
    ...keyIfDefined("persist", claude.persist),
  };
  sessions.set(key, session);
  claude.shutdown?.addEventListener("abort", () => close(key, session), {
    once: true,
    signal: abort.signal,
  });
  return session;
}

function claudeEffort(model: Model<Api>, level: ThinkingLevel | undefined): EffortLevel | undefined {
  if (level === undefined) return undefined;
  // SAFETY: a catalog map spells its levels in the effort set Claude Code takes, as v1 relied on.
  return (model.thinkingLevelMap?.[level] as EffortLevel | null | undefined) ?? EFFORTS[level];
}

function claudeEnv(
  { cacheTtl, compaction, home }: ClaudeOptions,
  keepTranscript: boolean,
  credential: { readonly provider: string; readonly token: string | undefined },
): Record<string, string> {
  const account = ACCOUNTS.get(credential.provider);
  const { token } = credential;
  if (account === undefined || token === undefined) {
    throw new Error(
      `the Claude backend needs ${account === undefined ? "an account" : `a ${account.holds}`}`,
    );
  }
  const config = join(home, "claude-config");
  mkdirSync(config, { recursive: true });
  return {
    HOME: home,
    ...keyIfDefined("PATH", Bun.env.PATH),
    ...keyIfDefined("TMPDIR", Bun.env.TMPDIR),
    CLAUDE_CONFIG_DIR: config,
    ...keysIf(keepTranscript, () => ({ CLAUDE_CODE_PROJECT_DIR_NAME: CLAUDE_PROJECT_DIR })),
    [account.variable]: token,
    ENABLE_CLAUDEAI_MCP_SERVERS: "0",
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    ...(compaction === "off"
      ? { DISABLE_AUTO_COMPACT: "1" }
      : { CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(compaction.window) }),
    ...keyIfDefined("CLAUDE_CODE_PROMPT_CACHE_TTL", cacheTtl),
  };
}

function deliver(session: Session, result: McpResult): void {
  const id = result.toolCallId;
  if (id === undefined) throw new Error("a tool result carries no toolCallId to pair it with its call");
  const resolve = session.parked.get(id);
  if (!resolve) {
    session.early.set(id, result);
    return;
  }
  session.parked.delete(id);
  resolve(result);
}

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
  reads.delete(key);
  signal?.addEventListener("abort", interrupt, { once: true });
  if (signal?.aborted === true) interrupt();
  try {
    return await readMessages(key, session, model, turn, { spent, signal });
  } finally {
    signal?.removeEventListener("abort", interrupt);
    for (const usage of spent) addUsage(turn.usage, usage);
    trySaveTranscript(session);
  }
}

function trySaveTranscript(session: Session): void {
  if (session.persist === undefined || session.sdkSessionId === undefined) return;
  try {
    savePersistedTranscript(session.configDir, session.persist, session.sdkSessionId);
  } catch (error) {
    warn(`Claude transcript save skipped for ${session.persist.seat}: ${errorMessage(error)}`);
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
  let limited = "";
  for (;;) {
    const next = await heard(key, session);
    if (next.done === true) throw new Error("Claude Code ended the query without a result");
    const message = next.value;
    if (isString(message.session_id)) session.sdkSessionId = message.session_id;
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
      reads.set(key, Promise.resolve(claudeSpend(session.provider, message)));
      if (request.signal?.aborted === true) throw new Error("the Claude Code request was interrupted");
      const end = apiStop === null ? undefined : FINAL_STOPS.get(apiStop);
      if (message.subtype === "success" && !message.is_error && end !== undefined) return end;
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
  const longWrite = message.message.usage.cache_creation?.ephemeral_1h_input_tokens;
  if (longWrite !== undefined) turn.usage.cacheWrite1h = longWrite;
  updateUsage(turn, message.message.usage, model);
}

function close(key: string, session: Session): void {
  if (sessions.get(key) !== session) return;
  sessions.delete(key);
  session.prompt.end();
  const end = () => {
    try {
      trySaveTranscript(session);
    } finally {
      session.abort.abort();
    }
  };
  const interrupted = session.query.interrupt();
  if (session.reading) interrupted.then(end, end);
  else {
    interrupted.catch(end);
    const before = reads.get(key) ?? Promise.resolve(null);
    reads.set(
      key,
      resultAtClose(session)
        .then(async (read) => read ?? (await before))
        .finally(end),
    );
  }
  setTimeout(end, INTERRUPT_MS).unref();
  for (const resolve of session.parked.values()) {
    resolve({ content: [{ type: "text", text: "the query was closed" }] });
  }
  session.parked.clear();
  session.early.clear();
}

export async function claudeLedger(key: string): Promise<BackendSpend | null> {
  const read = (await reads.get(key)) ?? null;
  reads.delete(key);
  return read;
}

export async function claudeSpendNow(key: string): Promise<BackendSpend | null> {
  const session = sessions.get(key);
  if (session === undefined) return null;
  const read = session.query
    .usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })
    .then(({ session: { total_cost_usd, model_usage } }) => {
      const spend = claudeSpend(session.provider, { total_cost_usd, modelUsage: model_usage });
      const finite = Object.values(spend.ledger).every((each) => Object.values(each).every(Number.isFinite));
      return finite ? spend : null;
    })
    .catch(() => null);
  return await Promise.race([read, Bun.sleep(Math.min(USAGE_MS, session.quiet)).then(() => null)]);
}

async function resultAtClose(session: Session): Promise<BackendSpend | null> {
  const aborted = new Promise<null>((resolve) => {
    session.abort.signal.addEventListener("abort", () => resolve(null), { once: true });
  });
  for (;;) {
    const next = await Promise.race([session.query.next(), aborted]).catch(() => null);
    if (next === null || next.done === true) return null;
    if (next.value.type === "result") return claudeSpend(session.provider, next.value);
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

const UNIT_MS = new Map([
  ["ms", 1],
  ["s", 1000],
  ["m", 60_000],
  ["h", 3_600_000],
  ["d", 86_400_000],
]);

function delayOf(said: string, now: Date): Date | null {
  const seconds = /\b(?:resets_in_seconds|retry-after)"?\s*[:=]\s*(\d+)/i.exec(said)?.[1];
  if (seconds !== undefined) return new Date(now.getTime() + Number(seconds) * 1000);
  const phrase = /\btry again in\s+((?:\d+(?:\.\d+)?\s*[a-z]+[\s,]*(?:and\s+)?)+)/i.exec(said)?.[1];
  if (phrase === undefined) return null;
  let ms = 0;
  for (const [, amount = "", word = ""] of phrase.matchAll(/(\d+(?:\.\d+)?)\s*([a-z]+)/gi)) {
    const lower = word.toLowerCase();
    const unit = UNIT_MS.get(
      lower === "ms" || lower.startsWith("mil") ? "ms" : lower.startsWith("mi") ? "m" : (lower[0] ?? ""),
    );
    if (unit === undefined) return null;
    ms += Number(amount) * unit;
  }
  return new Date(now.getTime() + Math.ceil(ms));
}

export function resetOf(said: string, now: Date): Date | null {
  if (!/(?:\b|_)limit(?:\b|_)/i.test(said)) return null;
  const unix = /(?:limit reached\||\bresets_at"?\s*[:=]\s*)(\d{10})\b/i.exec(said)?.[1];
  if (unix !== undefined) return new Date(Number(unix) * 1000);
  const delayed = delayOf(said, now);
  if (delayed !== null) return delayed;
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
    const format = new Intl.DateTimeFormat("en-US", {
      ...keyIfDefined("timeZone", zone),
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
    const wall = (instant: number) => {
      const parts = format.formatToParts(instant);
      const part = (type: string) => Number(parts.find((one) => one.type === type)?.value);
      const [year, month, day] = [part("year"), part("month") - 1, part("day")];
      const offset =
        Date.UTC(year, month, day, part("hour"), part("minute")) - Math.floor(instant / 60_000) * 60_000;
      return { year, month, day, offset };
    };
    const { year, month, day, offset } = wall(now.getTime());
    const wraps = dated !== undefined && month - dated > 6;
    const local = Date.UTC(
      wraps ? year + 1 : year,
      dated ?? month,
      dated === undefined ? day : Number(date),
      hour,
      Number(m),
    );
    const at = local - wall(local - offset).offset;
    return new Date(at > now.getTime() || dated !== undefined ? at : at + 86_400_000);
  } catch {
    return null;
  }
}
