import { describe, expect, it } from "bun:test";
import { repairToolPairing } from "cc-session-io";

import { isString } from "../src/meta/json-shape.ts";
import { convertPiMessages, messageContentToText } from "../vendor/pi-claude-bridge/convert.ts";

import type { Message as PiMessage } from "@earendil-works/pi-ai";
import type { ContentBlock, Message as SessionMessage, ToolResultBlock, ToolUseBlock } from "cc-session-io";

/**
 * The bridge replays pi's message history into a Claude Code session file so the CLI
 * can resume a conversation it did not itself produce. That conversion is lossy on
 * purpose — a thinking block without an Anthropic signature cannot be replayed, and
 * only text, images and tool calls have a counterpart — but two things have to hold
 * on the other side: every tool result still names the call it answers, and no turn
 * arrives empty, because the API rejects both.
 *
 * Nothing tested this file before. These cases are what the session sees.
 */

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function user(content: PiMessage["content"]): PiMessage {
  // SAFETY: UserMessage is the one arm of the union whose content this signature accepts.
  return { role: "user", content, timestamp: 0 } as PiMessage;
}

function assistant(
  content: readonly unknown[],
  overrides: { readonly provider?: string; readonly api?: string } = {},
): PiMessage {
  // SAFETY: the fixture builds the AssistantMessage arm; `content` holds pi block literals
  // the test writes by hand, which is the shape this arm names.
  return {
    role: "assistant",
    content,
    api: overrides.api ?? "anthropic",
    provider: overrides.provider ?? "claude-bridge",
    model: "claude-opus-5",
    usage,
    stopReason: "stop",
    timestamp: 0,
  } as PiMessage;
}

function toolResult(toolCallId: string, content: readonly unknown[], isError = false): PiMessage {
  // SAFETY: the fixture builds the ToolResultMessage arm with the literals this test writes.
  return {
    role: "toolResult",
    toolCallId,
    toolName: "read",
    content,
    isError,
    timestamp: 0,
  } as PiMessage;
}

/** The converted messages, as the session file will hold them. */
function converted(messages: readonly PiMessage[], tools?: Map<string, string>): SessionMessage[] {
  return convertPiMessages([...messages], tools);
}

function blocks(message: SessionMessage): ContentBlock[] {
  if (isString(message.content)) throw new Error("expected content blocks, got text");
  return message.content;
}

function toolUses(message: SessionMessage): ToolUseBlock[] {
  return blocks(message).filter((block) => block.type === "tool_use");
}

function toolResults(message: SessionMessage): ToolResultBlock[] {
  return blocks(message).filter((block) => block.type === "tool_result");
}

describe("messageContentToText", () => {
  // A whole pi image block: the function reads `type` and `text` and nothing else.
  const image = { type: "image", data: "AAAA", mimeType: "image/png" };

  it("passes a string through unchanged", () => {
    expect(messageContentToText("already text")).toBe("already text");
  });

  it("joins the text blocks with a newline and skips the images", () => {
    expect(
      messageContentToText([{ type: "text", text: "first" }, image, { type: "text", text: "second" }]),
    ).toBe("first\nsecond");
  });

  it("names a block kind it cannot render, in place", () => {
    expect(
      messageContentToText([
        { type: "text", text: "before" },
        { type: "document" },
        { type: "text", text: "after" },
      ]),
    ).toBe("before\n[document]\nafter");
  });

  it("returns nothing when no block carried text, whatever else was there", () => {
    expect(messageContentToText([{ type: "document" }, { type: "video" }])).toBe("");
    expect(messageContentToText([image])).toBe("");
    expect(messageContentToText([])).toBe("");
  });

  it("treats an empty text block as no text", () => {
    expect(messageContentToText([{ type: "text", text: "" }])).toBe("");
  });
});

describe("convertPiMessages: user turns", () => {
  it("carries a string message through", () => {
    const anthropicMessages = converted([user("hello")]);
    expect(anthropicMessages).toStrictEqual([{ role: "user", content: "hello" }]);
  });

  it("replaces an empty message rather than sending nothing", () => {
    // The API rejects an empty user turn, so the placeholder is the message.
    expect(converted([user("")])[0]?.content).toBe("[empty]");
  });

  it("keeps text and image blocks in the order they were written", () => {
    const anthropicMessages = converted([
      user([
        { type: "text", text: "look" },
        { type: "image", data: "AAAA", mimeType: "image/png" },
      ]),
    ]);
    expect(blocks(anthropicMessages[0]!)).toStrictEqual([
      { type: "text", text: "look" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
    ]);
  });

  it("drops an image that carries no data and says one was there", () => {
    const anthropicMessages = converted([user([{ type: "image", data: "", mimeType: "" }])]);
    expect(anthropicMessages[0]?.content).toBe("[image]");
  });

  it("says the turn was empty when it held no blocks at all", () => {
    expect(converted([user([])])[0]?.content).toBe("[empty]");
  });
});

describe("convertPiMessages: assistant turns", () => {
  it("keeps the text blocks", () => {
    const anthropicMessages = converted([assistant([{ type: "text", text: "done" }])]);
    expect(blocks(anthropicMessages[0]!)).toStrictEqual([{ type: "text", text: "done" }]);
  });

  it("replays a thinking block only with the signature the API will verify", () => {
    const signed = converted([assistant([{ type: "thinking", thinking: "why", thinkingSignature: "sig" }])]);
    expect(blocks(signed[0]!)).toStrictEqual([{ type: "thinking", thinking: "why", signature: "sig" }]);

    const unsigned = converted([assistant([{ type: "thinking", thinking: "why" }])]);
    expect(blocks(unsigned[0]!)).toStrictEqual([{ type: "text", text: "[incompatible content omitted]" }]);
  });

  it("drops a signed thinking block that another provider produced", () => {
    const other = converted([
      assistant([{ type: "thinking", thinking: "why", thinkingSignature: "sig" }], {
        provider: "openai",
        api: "openai-completions",
      }),
    ]);
    expect(blocks(other[0]!)).toStrictEqual([{ type: "text", text: "[incompatible content omitted]" }]);
  });

  it("keeps a signed thinking block from any provider speaking the Anthropic API", () => {
    const viaApi = converted([
      assistant([{ type: "thinking", thinking: "why", thinkingSignature: "sig" }], {
        provider: "openrouter",
        api: "anthropic",
      }),
    ]);
    expect(blocks(viaApi[0]!)[0]?.type).toBe("thinking");
  });

  it("never leaves an assistant turn with no content", () => {
    const anthropicMessages = converted([assistant([])]);
    expect(blocks(anthropicMessages[0]!)).toStrictEqual([
      { type: "text", text: "[incompatible content omitted]" },
    ]);
  });

  it("gives a tool call the name the CLI knows it by", () => {
    const anthropicMessages = converted([
      assistant([
        { type: "toolCall", id: "a", name: "read", arguments: { path: "x" } },
        { type: "toolCall", id: "b", name: "bash", arguments: {} },
      ]),
    ]);
    expect(blocks(anthropicMessages[0]!)).toStrictEqual([
      { type: "tool_use", id: "a", name: "Read", input: { path: "x" } },
      { type: "tool_use", id: "b", name: "Bash", input: {} },
    ]);
  });

  it("prefers the caller's own mapping, by exact name and by lowercase", () => {
    const tools = new Map([
      ["truss_solve", "mcp__pi__truss_solve"],
      ["shout", "mcp__pi__shout"],
    ]);
    const anthropicMessages = converted(
      [
        assistant([
          { type: "toolCall", id: "a", name: "truss_solve", arguments: {} },
          { type: "toolCall", id: "b", name: "SHOUT", arguments: {} },
        ]),
      ],
      tools,
    );
    expect(toolUses(anthropicMessages[0]!).map((block) => block.name)).toStrictEqual([
      "mcp__pi__truss_solve",
      "mcp__pi__shout",
    ]);
  });

  it("falls back to the CLI's spelling for a name nothing maps", () => {
    const anthropicMessages = converted([
      assistant([{ type: "toolCall", id: "a", name: "web_search", arguments: {} }]),
    ]);
    expect(toolUses(anthropicMessages[0]!)[0]?.name).toBe("WebSearch");
  });

  it("gives a call with no arguments an empty input rather than nothing", () => {
    const anthropicMessages = converted([assistant([{ type: "toolCall", id: "a", name: "read" }])]);
    expect(toolUses(anthropicMessages[0]!)[0]?.input).toStrictEqual({});
  });
});

describe("convertPiMessages: tool results", () => {
  it("arrives as a user turn naming the call it answers", () => {
    const anthropicMessages = converted([toolResult("a", [{ type: "text", text: "ok" }])]);
    expect(anthropicMessages[0]?.role).toBe("user");
    expect(blocks(anthropicMessages[0]!)).toStrictEqual([
      { type: "tool_result", tool_use_id: "a", content: "ok", is_error: false },
    ]);
  });

  it("carries the failure flag", () => {
    const anthropicMessages = converted([toolResult("a", [{ type: "text", text: "no such file" }], true)]);
    expect(toolResults(anthropicMessages[0]!)[0]?.is_error).toBe(true);
  });

  it("sends an empty string rather than nothing when the tool said nothing", () => {
    const anthropicMessages = converted([toolResult("a", [])]);
    expect(toolResults(anthropicMessages[0]!)[0]?.content).toBe("");
  });
});

describe("tool ids the session file can hold", () => {
  it("replaces the characters the id may not contain", () => {
    const anthropicMessages = converted([
      assistant([{ type: "toolCall", id: "call:1/a", name: "read", arguments: {} }]),
    ]);
    expect(toolUses(anthropicMessages[0]!)[0]?.id).toBe("call_1_a");
  });

  it("leaves an id that is already legal exactly as it was", () => {
    const anthropicMessages = converted([
      assistant([{ type: "toolCall", id: "toolu_01AbC-9", name: "read", arguments: {} }]),
    ]);
    expect(toolUses(anthropicMessages[0]!)[0]?.id).toBe("toolu_01AbC-9");
  });

  it("gives one pi id one session id, wherever it appears", () => {
    const anthropicMessages = converted([
      assistant([{ type: "toolCall", id: "call:1", name: "read", arguments: {} }]),
      toolResult("call:1", [{ type: "text", text: "ok" }]),
    ]);
    expect(toolUses(anthropicMessages[0]!)[0]?.id).toBe("call_1");
    expect(toolResults(anthropicMessages[1]!)[0]?.tool_use_id).toBe("call_1");
  });

  it("keeps two calls apart when their ids differ only in an illegal character", () => {
    // `call:1` and `call_1` both clean to `call_1`. Handing the session two tool_use
    // blocks with one id makes the second result answer the first call.
    const anthropicMessages = converted([
      assistant([
        { type: "toolCall", id: "call:1", name: "read", arguments: { path: "first" } },
        { type: "toolCall", id: "call_1", name: "bash", arguments: { command: "second" } },
      ]),
      toolResult("call:1", [{ type: "text", text: "first result" }]),
      toolResult("call_1", [{ type: "text", text: "second result" }]),
    ]);
    const ids = toolUses(anthropicMessages[0]!).map((block) => block.id);
    expect(new Set(ids).size).toBe(2);
    expect(toolResults(anthropicMessages[1]!).map((block) => block.tool_use_id)).toStrictEqual(ids);
  });

  it("hands the session a history whose pairing needs no repair", () => {
    const anthropicMessages = converted([
      user("read the file"),
      assistant([{ type: "toolCall", id: "call:1", name: "read", arguments: {} }]),
      toolResult("call:1", [{ type: "text", text: "ok" }]),
      assistant([{ type: "text", text: "done" }]),
    ]);
    expect(repairToolPairing(anthropicMessages)).toHaveLength(anthropicMessages.length);
  });

  it("answers parallel calls in one turn, so the repair keeps every result", () => {
    // One user turn per result let the repair keep the first and replace the second with
    // "[no tool result recorded]": every rewrite of pi6's Builder lost its parallel results.
    const anthropicMessages = repairToolPairing(
      converted([
        assistant([
          { type: "toolCall", id: "a", name: "read", arguments: {} },
          { type: "toolCall", id: "b", name: "bash", arguments: {} },
        ]),
        toolResult("a", [{ type: "text", text: "first result" }]),
        toolResult("b", [{ type: "text", text: "second result" }]),
        user("next"),
      ]),
    );
    expect(anthropicMessages.map((message) => message.role)).toStrictEqual(["assistant", "user", "user"]);
    expect(toolResults(anthropicMessages[1]!).map((block) => block.content)).toStrictEqual([
      "first result",
      "second result",
    ]);
  });

  it("leaves a result whose call never converted for the repair pass to drop", () => {
    // A thinking-only assistant turn loses its blocks, so a result naming one of them
    // has nothing to answer. Conversion keeps it; the repair is what removes it.
    const anthropicMessages = converted([
      assistant([{ type: "thinking", thinking: "why" }]),
      toolResult("call:1", [{ type: "text", text: "ok" }]),
    ]);
    expect(anthropicMessages).toHaveLength(2);
    expect(repairToolPairing(anthropicMessages).length).toBeLessThan(anthropicMessages.length);
  });
});

describe("convertPiMessages over a whole conversation", () => {
  it("keeps the turns in order and changes only what the session cannot hold", () => {
    const anthropicMessages = converted([
      user("start"),
      assistant([
        { type: "text", text: "thinking about it" },
        { type: "toolCall", id: "t:1", name: "read", arguments: { path: "a.txt" } },
      ]),
      toolResult("t:1", [{ type: "text", text: "contents" }]),
      assistant([{ type: "text", text: "finished" }]),
      user("thanks"),
    ]);
    expect(anthropicMessages.map((message) => message.role)).toStrictEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
    ]);
    expect(toolUses(anthropicMessages[1]!)[0]?.id).toBe("t_1");
    expect(toolResults(anthropicMessages[2]!)[0]?.tool_use_id).toBe("t_1");
  });
});
