// The three fixes vendor/pi-agent-session/compaction/compaction.ts carries over from pi
// coding-agent's own compaction, which the v0.99.2 harness copy never received. Each case is the
// behaviour the upstream fix names; a reverted fix fails here.
import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { findCutPoint, getSummarizationFailure } from "../vendor/pi-agent-session/compaction/compaction.ts";
import type { Entry } from "../vendor/pi-agent-session/types.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistant(stopReason: AssistantMessage["stopReason"], errorMessage?: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "partial" }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "m",
    usage,
    stopReason,
    timestamp: 0,
    ...keyIfDefined("errorMessage", errorMessage),
  };
}

function entries(messages: AgentMessage[]): Entry[] {
  return messages.map((message, seq) => ({
    type: "message",
    id: `e${seq}`,
    parentId: seq === 0 ? null : `e${seq - 1}`,
    seq,
    timestamp: seq,
    message,
  }));
}

describe("the compaction fixes carried over from coding-agent", () => {
  // 97fa14e39: a summary cut at the token cap is partial and must not become the checkpoint.
  it("refuses a summary that stopped at its length cap, as it refuses an errored one", () => {
    expect(getSummarizationFailure(assistant("length"), "Summarization")).toBe(
      "Summarization failed: generation hit the token cap and the summary is incomplete",
    );
    expect(getSummarizationFailure(assistant("error", "boom"), "Summarization")).toBe(
      "Summarization failed: boom",
    );
    expect(getSummarizationFailure(assistant("stop"), "Summarization")).toBeUndefined();
  });

  // 8bdcd4498: when trailing tool results alone exceed the kept budget, the cut falls back to the
  // last valid cut point (their tool call), not the first message, so older history compacts.
  it("cuts at the tool call when trailing tool results alone exceed the kept budget", () => {
    const log = entries([
      { role: "user", content: [{ type: "text", text: "old request" }], timestamp: 0 },
      assistant("stop"),
      { role: "user", content: [{ type: "text", text: "run it" }], timestamp: 2 },
      {
        ...assistant("toolUse"),
        content: [{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "seq 1 99999" } }],
      },
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "bash",
        content: [{ type: "text", text: "x".repeat(40_000) }],
        isError: false,
        timestamp: 4,
      },
    ]);
    expect(findCutPoint(log, 0, log.length, 100).firstKeptEntryIndex).toBe(3);
  });
});
