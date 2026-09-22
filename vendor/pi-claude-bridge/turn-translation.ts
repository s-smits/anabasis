// One assistant turn, translated from the Claude Code SDK's vocabulary into pi's.
//
// The SDK delivers a turn's content twice over: as stream events while it arrives, and as an
// assistant message once it is complete — and, when neither carried it, as the text on the result.
// Pi wants the same events from all three: a turn start, then per block a start, its deltas and
// its end, then a done. Before this module the provider wrote that sequence out three times and
// the streamed spelling alone measured 52 cyclomatic branches.
//
// Here one block translation serves all three. `applyStreamEvent` opens a block, feeds it and
// closes it as the events arrive; `applyCompletedBlocks` does the same three steps back to back
// for content that is already whole. The bridge test asserts they agree.

import { capturedJsonParse } from "../../src/meta/json-runtime.ts";
import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Model,
  calculateCost,
} from "@earendil-works/pi-ai";
import type { SDKAssistantMessage, SDKPartialAssistantMessage } from "claude-agent-sdk-bridge";
import { type JsonObject, asRecord, isString } from "../../src/meta/json-shape.ts";
import type { QueryContext, TurnBlock } from "./query-state.js";
import { hasText } from "../../src/meta/text.ts";

export const MCP_SERVER_NAME = "custom-tools";
export const MCP_TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

/** What the translation needs from the provider: the model whose rates price the usage, the
 *  registered tool names, and the settings-dependent question of whether the CLI keeps a call. */
/** The stream-event fields this translation reads, named once so each handler states its input. */
type StreamDelta = {
  type?: string;
  text?: string;
  thinking?: string;
  signature?: string;
  partial_json?: string;
  stop_reason?: string;
};
type StreamMessageHeader = { id?: string; model?: string; usage?: UsageCounts };

export type TurnTools = {
  readonly model: Model<Api>;
  readonly toPi: Map<string, string>;
  readonly cliKeepsTool: (
    name: string,
    call: { id: string; input: unknown },
    toPi: Map<string, string>,
  ) => boolean;
};

// --- Names and arguments ---

const SDK_TO_PI_TOOL_NAME = new Map([
  ["read", "read"],
  ["write", "write"],
  ["edit", "edit"],
  ["bash", "bash"],
  ["glob", "glob"],
  ["grep", "grep"],
  ["ls", "list"],
  ["webfetch", "webfetch"],
  ["websearch", "websearch"],
  ["todowrite", "todowrite"],
  ["notebookedit", "notebookedit"],
]);

// Renames for Claude Code SDK param names that differ from pi's native names.
// Keys not listed here pass through unchanged, so new pi params work automatically.
const SDK_KEY_RENAMES = new Map([
  ["read", new Map([["file_path", "path"]])],
  ["write", new Map([["file_path", "path"]])],
  [
    "edit",
    new Map([
      ["file_path", "path"],
      ["old_string", "oldText"],
      ["new_string", "newText"],
      ["old_text", "oldText"],
      ["new_text", "newText"],
    ]),
  ],
]);

// --- Usage and stop reason ---

type UsageCounts = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  reasoning_tokens?: number | null;
  thinking_tokens?: number | null;
};

// --- Turn lifecycle ---

const completedStreams = new WeakSet<object>();

export function mapToolName(name: string, customToolNameToPi?: Map<string, string>): string {
  const normalized = name.toLowerCase();
  const builtin = SDK_TO_PI_TOOL_NAME.get(normalized);
  if (hasText(builtin)) return builtin;
  const mapped = customToolNameToPi?.get(name) ?? customToolNameToPi?.get(normalized);
  if (hasText(mapped)) return mapped;
  return normalized.startsWith(MCP_TOOL_PREFIX) ? name.slice(MCP_TOOL_PREFIX.length) : name;
}

// Maps SDK tool args to pi tool args via key renaming + pass-through.
// Pi's own prepareArguments hooks handle any structural transforms (e.g. edit oldText/newText → edits[]).
// Arguments cross as JsonObject: this port renames keys and passes the values through unopened.
export function mapToolArgs(toolName: string, args: JsonObject | undefined): JsonObject {
  const renames = SDK_KEY_RENAMES.get(toolName.toLowerCase());
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(args ?? {})) {
    const piKey = renames?.get(key) ?? key;
    if (!(piKey in result)) result[piKey] = value; // first alias wins
  }
  // Pi bash has no default timeout; add a safety default
  if (toolName.toLowerCase() === "bash" && result.timeout == null) result.timeout = 120;
  return result;
}

export function parsePartialJson(input: string, fallback: JsonObject): JsonObject {
  if (!input) return fallback;
  try {
    return asRecord(capturedJsonParse(input)) ?? fallback;
  } catch {
    return fallback;
  }
}

function updateUsage(output: AssistantMessage, usage: UsageCounts, model: Model<Api>): void {
  if (usage.input_tokens != null) output.usage.input = usage.input_tokens;
  if (usage.output_tokens != null) output.usage.output = usage.output_tokens;
  if (usage.cache_read_input_tokens != null) output.usage.cacheRead = usage.cache_read_input_tokens;
  if (usage.cache_creation_input_tokens != null) output.usage.cacheWrite = usage.cache_creation_input_tokens;
  // Claude Code may report reasoning/thinking tokens separately, while pi's Usage type does not model that field.
  const reasoning = usage.reasoning_tokens ?? usage.thinking_tokens;
  if (reasoning != null) {
    // SAFETY: widens pi's Usage by one field it does not model; every reader of the extra key checks for it.
    (output.usage as typeof output.usage & { reasoning?: number }).reasoning = reasoning;
  }
  output.usage.totalTokens =
    output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
  calculateCost(model, output.usage);
}

export function completeStream(stream: AssistantMessageEventStream | null): void {
  if (stream) completedStreams.add(stream);
  stream?.end();
}

function ensureTurnStarted(c: QueryContext): void {
  if (!c.turnStarted && c.currentPiStream && c.turnOutput) {
    c.liveStream.push({ type: "start", partial: c.turnOutput });
    c.turnStarted = true;
  }
}

export function finalizeCurrentStream(c: QueryContext, stopReason?: string): void {
  if (!c.currentPiStream || !c.turnOutput) return;
  ensureTurnStarted(c);
  c.liveStream.push({
    type: "done",
    reason: stopReason === "length" ? "length" : "stop",
    message: c.turnOutput,
  });
  completeStream(c.currentPiStream);
  c.currentPiStream = null;
}

/** v4 boundary: ends the open turn as failed, so the message pi records carries the reason the
 *  controller's retry and non-result readers classify. The thrown-query path settles the same way. */
export function failCurrentStream(c: QueryContext, errorMessage: string): void {
  if (!c.currentPiStream || !c.turnOutput) return;
  c.turnOutput.stopReason = "error";
  c.turnOutput.errorMessage = errorMessage;
  c.currentPiStream.push({ type: "error", reason: "error", error: c.turnOutput });
  completeStream(c.currentPiStream);
  c.currentPiStream = null;
}

/** Ends the pi stream on a tool call so pi can execute it. The SDK still yields this turn's
 *  assistant message, which `currentPiStream === null` then skips, and the MCP handler holds the
 *  generator until pi delivers the result through the next streamSimple call. */
function finalizeOnToolCall(c: QueryContext): void {
  if (!c.turnSawToolCall || !c.currentPiStream || !c.turnOutput) return;
  c.turnOutput.stopReason = "toolUse";
  c.liveStream.push({ type: "done", reason: "toolUse", message: c.turnOutput });
  completeStream(c.currentPiStream);
  c.currentPiStream = null;
}

// --- One block, opened, fed and closed ---

/** Opens a block on the turn and reports its pi content index, or null when the CLI keeps the
 *  call for itself. `index` pairs later stream deltas to this block and stays undefined for
 *  content that arrived whole. */
function openBlock(
  c: QueryContext,
  tools: TurnTools,
  block: { type: string; id?: string; name?: string; input?: unknown },
  index?: number,
): number | null {
  if (block.type === "tool_use") {
    const id = block.id ?? "";
    const name = block.name ?? "";
    if (tools.cliKeepsTool(name, { id, input: block.input }, tools.toPi)) return null;
    ensureTurnStarted(c);
    c.turnSawToolCall = true;
    c.turnToolCallIds.push(id);
    c.turnBlocks.push({
      type: "toolCall",
      id,
      name: mapToolName(name, tools.toPi),
      arguments: asRecord(block.input) ?? {},
      partialJson: "",
      index,
    });
  } else if (block.type === "text") {
    ensureTurnStarted(c);
    c.turnBlocks.push({ type: "text", text: "", index });
  } else if (block.type === "thinking") {
    ensureTurnStarted(c);
    c.turnBlocks.push({ type: "thinking", thinking: "", thinkingSignature: "", index });
  } else {
    return null;
  }
  const contentIndex = c.turnBlocks.length - 1;
  const started = { text: "text_start", thinking: "thinking_start", toolCall: "toolcall_start" } as const;
  // SAFETY: openBlock pushed one of these three kinds above.
  const startedKind = c.turnBlocks[contentIndex]?.type as keyof typeof started;
  c.liveStream.push({ type: started[startedKind], contentIndex, partial: c.liveOutput });
  return contentIndex;
}

/** Closes the block at `contentIndex`, mapping a tool call's accumulated arguments as it goes. */
function closeBlock(c: QueryContext, contentIndex: number): void {
  // `located` returns -1 for an index the turn never opened, so this read can miss.
  const block: TurnBlock | undefined = c.turnBlocks[contentIndex];
  if (block === undefined) return;
  block.index = undefined;
  const partial = c.liveOutput;
  if (block.type === "text") {
    c.liveStream.push({ type: "text_end", contentIndex, content: block.text, partial });
  } else if (block.type === "thinking") {
    c.liveStream.push({ type: "thinking_end", contentIndex, content: block.thinking, partial });
  } else if (block.type === "toolCall") {
    block.arguments = mapToolArgs(block.name, parsePartialJson(block.partialJson ?? "", block.arguments));
    block.partialJson = undefined;
    c.liveStream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial });
  }
}

/** Content the SDK has already completed: the same open, feed and close, back to back. */
export function applyCompletedBlocks(
  c: QueryContext,
  tools: TurnTools,
  blocks: readonly {
    type: string;
    id?: string;
    name?: string;
    input?: unknown;
    text?: string;
    thinking?: string;
    signature?: string;
  }[],
): void {
  for (const block of blocks) {
    if (block.type === "text" && !hasText(block.text)) continue;
    const contentIndex = openBlock(c, tools, block, undefined);
    if (contentIndex === null) continue;
    const whole = c.turnBlocks[contentIndex];
    if (whole?.type === "text") {
      whole.text = block.text ?? "";
      c.liveStream.push({ type: "text_delta", contentIndex, delta: whole.text, partial: c.liveOutput });
    } else if (whole?.type === "thinking") {
      whole.thinking = block.thinking ?? "";
      whole.thinkingSignature = block.signature ?? "";
      if (whole.thinking) {
        c.liveStream.push({
          type: "thinking_delta",
          contentIndex,
          delta: whole.thinking,
          partial: c.liveOutput,
        });
      }
    }
    closeBlock(c, contentIndex);
  }
}

// --- The three delivery paths ---

/** Appends one delta's text to its block, and reports the pi event that announces it. Only a
 *  matching kind moves the block: a delta for the wrong kind is the SDK describing content this
 *  turn dropped, such as a tool call the CLI kept. */
function appendDelta(
  block: TurnBlock,
  delta: StreamDelta,
): { readonly event: "text_delta" | "thinking_delta" | "toolcall_delta"; readonly text: string } | null {
  if (delta.type === "text_delta" && block.type === "text") {
    const text = delta.text ?? "";
    block.text += text;
    return { event: "text_delta", text };
  }
  if (delta.type === "thinking_delta" && block.type === "thinking") {
    const text = delta.thinking ?? "";
    block.thinking += text;
    return { event: "thinking_delta", text };
  }
  if (delta.type === "input_json_delta" && block.type === "toolCall") {
    const text = delta.partial_json ?? "";
    block.partialJson = (block.partialJson ?? "") + text;
    block.arguments = parsePartialJson(block.partialJson, block.arguments);
    return { event: "toolcall_delta", text };
  }
  return null;
}

function applyDelta(c: QueryContext, contentIndex: number, delta: StreamDelta): void {
  const block: TurnBlock | undefined = c.turnBlocks[contentIndex];
  if (block === undefined) return;
  if (delta.type === "signature_delta" && block.type === "thinking") {
    // The signature is provider bookkeeping the next request replays, not turn content.
    block.thinkingSignature = (block.thinkingSignature ?? "") + (delta.signature ?? "");
    return;
  }
  const appended = appendDelta(block, delta);
  if (appended === null) return;
  c.liveStream.push({ type: appended.event, contentIndex, delta: appended.text, partial: c.liveOutput });
}

/** v4 boundary: the provider's own message id and served model, read while the stream is still
 *  open. A turn that called a tool has already closed this stream before the SDK result message
 *  arrives, so the result-message capture cannot own either fact; it is also ambiguous whenever a
 *  helper model leaves two modelUsage keys. */
function applyMessageStart(
  c: QueryContext,
  tools: TurnTools,
  message: StreamMessageHeader | undefined,
): void {
  c.turnToolCallIds = [];
  if (isString(message?.id)) c.liveOutput.responseId = message.id;
  if (isString(message?.model)) c.liveOutput.responseModel = message.model;
  if (message?.usage) updateUsage(c.liveOutput, message.usage, tools.model);
}

/** Content arriving as it is produced. Returns without effect once a tool call closed the stream. */
export function applyStreamEvent(
  message: SDKPartialAssistantMessage,
  tools: TurnTools,
  c: QueryContext,
): void {
  if (!c.currentPiStream || !c.turnOutput) return;
  c.turnSawStreamEvent = true;
  const { event } = message;
  const located = (index: number) => c.turnBlocks.findIndex((block) => block.index === index);

  switch (event?.type) {
    case "message_start":
      applyMessageStart(c, tools, event.message);
      break;
    case "content_block_start":
      if (event.content_block !== undefined) openBlock(c, tools, event.content_block, event.index);
      break;
    case "content_block_delta":
      applyDelta(c, located(event.index), event.delta);
      break;
    case "content_block_stop": {
      const contentIndex = located(event.index);
      if (contentIndex >= 0) closeBlock(c, contentIndex);
      break;
    }
    case "message_delta": {
      const reason = event.delta?.stop_reason;
      c.liveOutput.stopReason =
        reason === "tool_use" ? "toolUse" : reason === "max_tokens" ? "length" : "stop";
      if (event.usage !== undefined) updateUsage(c.liveOutput, event.usage, tools.model);
      break;
    }
    case "message_stop":
      finalizeOnToolCall(c);
      break;
    default:
      break;
  }
}

/** The completed twin of the streamed turn, and the primary content path whenever the SDK sends
 *  an assistant message before any stream event — as it does after a tool result is delivered. */
export function applyAssistantMessage(message: SDKAssistantMessage, tools: TurnTools, c: QueryContext): void {
  if (c.turnSawStreamEvent || !c.currentPiStream || !c.turnOutput) return;
  const assistant = message.message;
  if (assistant?.content === undefined) return;
  c.turnToolCallIds = [];
  // The non-streaming twin of the message_start capture, so both paths name the same facts.
  if (isString(assistant.id)) c.turnOutput.responseId = assistant.id;
  if (isString(assistant.model)) c.turnOutput.responseModel = assistant.model;
  applyCompletedBlocks(c, tools, assistant.content);
  if (assistant.usage !== undefined) updateUsage(c.turnOutput, assistant.usage, tools.model);
  finalizeOnToolCall(c);
}

/** The text on a successful result, when no stream event and no assistant message carried the
 *  turn. One text block, through the same translation. */
export function applyResultText(c: QueryContext, tools: TurnTools, text: string): void {
  applyCompletedBlocks(c, tools, [{ type: "text", text }]);
}
