// pi's loop compacts before a model call that would cross the window less pi's reserve: the older
// span goes to the served model for a summary, which leads the retained tail, and usage reported
// before that compaction no longer counts. A failed summary leaves the context as it was, and a
// Claude model is left to Claude Code's own compaction.
import { describe, expect, it } from "bun:test";
import type { AgentMessage, PrepareRequestContext } from "@earendil-works/pi-agent-core";
import {
  type AssistantMessage,
  createInitialSystemMessage,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { type Compacted, compactBeforeRequest } from "../src/backends/pi-compaction.ts";

/** A solve's shape: one prompt, then `rounds` shell calls whose results are 2,000 tokens each. */
function transcript(rounds: number): AgentMessage[] {
  const system = createInitialSystemMessage("You solve the task.", []);
  const messages: AgentMessage[] = [
    ...(system === undefined ? [] : [system]),
    { role: "user", content: "Solve the task.", timestamp: 0 },
  ];
  for (let round = 0; round < rounds; round++) {
    const id = `call-${String(round)}`;
    messages.push(
      fauxAssistantMessage(fauxToolCall("shell", { command: `step ${String(round)}` }, { id }), {
        stopReason: "toolUse",
      }),
      {
        role: "toolResult",
        toolCallId: id,
        toolName: "shell",
        content: [{ type: "text", text: "x".repeat(8_000) }],
        isError: false,
        timestamp: 0,
      },
    );
  }
  return messages;
}

function setup(responses: AssistantMessage[]) {
  const faux = fauxProvider({ models: [{ id: "faux-solver", contextWindow: 60_000 }] });
  faux.setResponses(responses);
  const models = createModels();
  models.setProvider(faux.provider);
  const events: Compacted[] = [];
  const hook = compactBeforeRequest(
    (model, context, options) => models.streamSimple(model, context, options),
    (event) => events.push(event),
  );
  const ask = async (messages: AgentMessage[], model = faux.getModel()) =>
    (await hook({ context: { messages }, model, thinkingLevel: "off" } satisfies PrepareRequestContext))
      ?.context?.messages;
  return { faux, events, ask };
}

describe("pi's loop compaction", () => {
  it("leaves a context inside the window alone", async () => {
    const { faux, events, ask } = setup([]);
    expect(await ask(transcript(5))).toBeUndefined();
    expect(faux.state.callCount).toBe(0);
    expect(events).toEqual([]);
  });

  it("summarises the older span and keeps the recent one behind the summary", async () => {
    const { faux, events, ask } = setup([fauxAssistantMessage("Ran steps 0 to 19.")]);
    const before = transcript(30);
    const after = await ask(before);
    expect(faux.state.callCount).toBe(1);
    expect(after?.[0]?.role).toBe("system");
    expect(JSON.stringify(after?.[1])).toContain("Ran steps 0 to 19.");
    // The cut lands on a call, never between a call and its result.
    expect(after?.[2]?.role).toBe("assistant");
    expect(after?.at(-1)).toBe(before.at(-1));
    expect(after?.length).toBeLessThan(before.length);
    expect(events).toHaveLength(1);
    expect(events[0]?.error).toBeNull();
    expect(events[0]?.usages).toHaveLength(1);
    expect(events[0]?.tokensBefore).toBeGreaterThan(60_000 - 16_384);
  });

  it("does not count usage reported before the compaction against the compacted context", async () => {
    const { faux, ask } = setup([fauxAssistantMessage("Summary.")]);
    const before = transcript(30);
    const call = before.findLast((message) => message.role === "assistant");
    if (call?.role !== "assistant") throw new Error("the transcript holds a call");
    call.usage = { ...call.usage, totalTokens: 59_000 };
    const after = await ask(before);
    expect(after).toBeDefined();
    // Three more rounds keep the compacted context well inside the window.
    expect(await ask([...(after ?? []), ...transcript(33).slice(-6)])).toBeUndefined();
    expect(faux.state.callCount).toBe(1);
  });

  it("leaves the context as it was when the summary fails", async () => {
    const { events, ask } = setup([
      fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded" }),
    ]);
    expect(await ask(transcript(30))).toBeUndefined();
    expect(events[0]?.error).toContain("overloaded");
    expect(events[0]?.usages).toEqual([]);
  });

  it("leaves a Claude model to Claude Code's own compaction", async () => {
    const { faux, ask } = setup([]);
    expect(await ask(transcript(30), { ...faux.getModel(), provider: "claude" })).toBeUndefined();
    expect(faux.state.callCount).toBe(0);
  });
});
