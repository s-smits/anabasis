/**
 * The Claude backend: Claude Code, run through the Agent SDK, served to pi as a provider.
 *
 * One pi session is one live SDK query. pi's tools reach Claude Code as an in-process MCP server whose
 * handlers park until pi has run the call and sent the result back, and one pi turn is one API message,
 * which ends at the stream's `message_stop`. That design is pi-claude-bridge's (e870bc89), and its four
 * leaf modules come over verbatim; its index.ts does not. A headless solve has no steering, compaction,
 * session resume or UI, so the glue a solve needs is this file.
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
import { asRecord, isString } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { errorMessage } from "../meta/runtime-values.ts";

const PROVIDER = "claude";
const API = "claude-agent-sdk";
const SERVER = "pi";
const TOOL_PREFIX = `mcp__${SERVER}__`;
const EFFORTS: Readonly<Partial<Record<ThinkingLevel, EffortLevel>>> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
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

const sessions = new Map<string, Session>();

/**
 * The diagnostic the query's last turn carries: `details.totalCostUsd` is the whole query's cost as
 * Claude Code reports it, which the meter's billed dollars are held to.
 */
export const REPORTED_COST = "claude-code-total-cost";

/** pi's Anthropic catalog, served through Claude Code: the same ids and the same list prices. */
export function claudeProvider(): Provider {
  return createProvider({
    id: PROVIDER,
    name: "Claude Code (Agent SDK)",
    auth: { apiKey: envApiKeyAuth("Claude Code OAuth token", ["CLAUDE_CODE_OAUTH_TOKEN"]) },
    // `compat` tunes pi's own Anthropic request, which Claude Code never sends.
    models: getBuiltinModels("anthropic").map(({ compat: _unsent, ...model }) => ({
      ...model,
      provider: PROVIDER,
      api: API,
    })),
    api: { stream: streamClaude, streamSimple: streamClaude },
  });
}

function streamClaude(
  model: Model<Api>,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const out = createAssistantMessageEventStream();
  const turn = emptyTurn(model);
  runTurn(model, context, options ?? {}, turn, out).catch((cause: unknown) => {
    turn.stopReason = options?.signal?.aborted === true ? "aborted" : "error";
    turn.errorMessage = errorMessage(cause);
    out.push({ type: "error", reason: turn.stopReason, error: turn });
    out.end();
  });
  return out;
}

async function runTurn(
  model: Model<Api>,
  context: TranscriptContext,
  options: SimpleStreamOptions,
  turn: AssistantMessage,
  out: AssistantMessageEventStream,
): Promise<void> {
  const key = options.sessionId;
  if (key === undefined) throw new Error("the Claude backend needs a sessionId: one per Claude Code query");
  const { results } = extractAllToolResults(context.messages.map((message) => ({ ...message })));
  let session = sessions.get(key);
  if (results.length > 0) {
    if (!session) throw new Error(`no live Claude Code query in session ${key} takes these tool results`);
    for (const result of results) deliver(session, result);
  } else {
    if (session || context.messages.some((message) => message.role === "assistant")) {
      throw new Error(
        "Claude Code holds the conversation: a session takes one prompt, then only tool results",
      );
    }
    session = open(model, context, options, key);
    await session.prompt.push(userMessage(promptText(context)));
  }
  out.push({ type: "start", partial: turn });
  const done = new AbortController();
  const live = session;
  options.signal?.addEventListener("abort", () => close(key, live), { once: true, signal: done.signal });
  try {
    const reason = await readTurn(key, live, model, turn);
    turn.stopReason = reason;
    out.push({ type: "done", reason, message: turn });
    out.end();
  } finally {
    done.abort();
  }
}

function open(
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
  const live = query({
    prompt: prompt.stream,
    options: {
      model: model.id,
      ...keyIfDefined("effort", effort(options.reasoning)),
      systemPrompt: getCurrentSystemPrompt(context.messages),
      // The harness's pi tools are the only tools: no built-in, no setting file, no other MCP server.
      tools: [],
      mcpServers: { [SERVER]: createToolServer(SERVER, tools) },
      allowedTools: tools.map((tool) => TOOL_PREFIX + tool.name),
      strictMcpConfig: true,
      settingSources: [],
      persistSession: false,
      includePartialMessages: true,
      abortController: abort,
      env: { ...Bun.env, ANTHROPIC_API_KEY: undefined, CLAUDE_CODE_OAUTH_TOKEN: options.apiKey },
    },
  });
  const session: Session = { query: live, prompt, abort, parked, early };
  sessions.set(key, session);
  return session;
}

function effort(level: ThinkingLevel | undefined): EffortLevel | undefined {
  if (level === undefined) return undefined;
  const served = EFFORTS[level];
  if (served === undefined) throw new Error(`Claude Code takes no "${level}" effort`);
  return served;
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

/** Read one API message into `turn`, and say how it stopped. */
async function readTurn(
  key: string,
  session: Session,
  model: Model<Api>,
  turn: AssistantMessage,
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
      return "toolUse";
    } else if (message.type === "result") {
      close(key, session);
      turn.diagnostics = [
        { type: REPORTED_COST, timestamp: Date.now(), details: { totalCostUsd: message.total_cost_usd } },
      ];
      if (message.subtype !== "success") {
        throw new Error(`Claude Code: ${message.subtype}: ${message.errors.join("; ")}`);
      }
      if (message.is_error) throw new Error(`Claude Code: ${message.result}`);
      return apiStop === "max_tokens" ? "length" : "stop";
    }
  }
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
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}
