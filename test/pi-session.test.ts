/**
 * The host session every slot runs on, driven through pi's faux provider so that none of it reaches
 * the network. What the session owes its caller is an honest account of the turn: text, reasoning
 * and tool calls forwarded as shared turn events with the calls counted, a throwing tool recorded
 * as a failed call carrying the error in its preview, and a turn that fails, that completes on a
 * retry the session made itself, or that aborts at its cap or on the caller's signal, saying which.
 *
 * The rest is identity and continuity. A turn attests the model that answered even when the caller
 * stopped it, and the Codex route falls back to its response id when nothing named a model.
 * `configure` runs the next prompt on new tools and framing inside the same conversation, and adds
 * no system message when neither changed. Compaction then has to put that framing back, which is
 * why the current framing and tools are replayed ahead of the summary both on a threshold
 * compaction and on the overflow that retries the turn: the opening turn is the oldest part of the
 * conversation and so the first part a compaction drops.
 */
import { describe, expect, it } from "bun:test";
import {
  type AssistantMessage,
  type FauxResponseFactory,
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
  getCurrentSystemPrompt,
  getCurrentTools,
  registerSessionResourceCleanup,
} from "@earendil-works/pi-ai";
import type { AgentTurnEvent } from "../src/backends/backend-types.ts";
import type { PiSlotRuntime } from "../src/backends/pi-providers.ts";
import { type PiTool, openHostSession, piSessionPolicy, settledStatus } from "../src/backends/pi-session.ts";
import { double, toolDouble } from "./helpers/doubles.ts";

const SLOT: PiSlotRuntime = {
  profile: { provider: "openrouter", transport: "openrouter", model: "faux-host", thinkingLevel: "off" },
  auth: () => {
    throw new Error("a scripted session reads no credential");
  },
};

/** A step that answers only once the request is aborted, so the turn's interrupt decides it.
 *  `fakeResponses` is typed as messages, and pi's faux provider takes a factory in the same list. */
const UNTIL_ABORTED = double<AssistantMessage>((async (_context, options) => {
  await new Promise<void>((resolve) => {
    options?.signal?.addEventListener("abort", () => resolve(), { once: true });
    setTimeout(resolve, 5_000);
  });
  return fauxAssistantMessage("late");
}) satisfies FauxResponseFactory);

function probe(result: () => Promise<string>): PiTool {
  return toolDouble({
    name: "probe",
    description: "Probe one value.",
    parameters: { type: "object", properties: { q: { type: "string" } } },
    execute: async () => ({ content: [{ type: "text", text: await result() }], details: null }),
  });
}

async function turn(fakeResponses: AssistantMessage[], tools: readonly PiTool[] = []) {
  const session = await openHostSession({ slot: SLOT, tools, systemPrompt: "framing", fakeResponses });
  const events: AgentTurnEvent[] = [];
  const result = await session.runTurn({ prompt: "go", onEvent: (event) => events.push(event) });
  await session.dispose();
  return { result, events };
}

describe("openHostSession events", () => {
  it("hands back only this turn's last message, never an earlier turn's", async () => {
    const session = await openHostSession({
      slot: SLOT,
      tools: [probe(async () => "probe result")],
      systemPrompt: "framing",
      fakeResponses: [
        fauxAssistantMessage("first answer"),
        fauxAssistantMessage([fauxToolCall("probe", { q: "x" }, { id: "c2" })], { stopReason: "toolUse" }),
        fauxAssistantMessage([]),
      ],
    });
    const first = await session.runTurn({ prompt: "one" });
    const second = await session.runTurn({ prompt: "two" });
    await session.dispose();
    expect(first.finalText).toBe("first answer");
    expect(second.status).toBe("completed");
    expect(second.finalText).toBeUndefined();
  });

  it("forwards text, reasoning and tool calls as shared turn events and counts the calls", async () => {
    const { result, events } = await turn(
      [
        fauxAssistantMessage(
          [
            fauxThinking("weigh it"),
            fauxText("calling probe"),
            fauxToolCall("probe", { q: "x" }, { id: "c1" }),
          ],
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("done"),
      ],
      [probe(async () => "probe result")],
    );
    const observed = events
      .filter((event) => event.type !== "assistant_text")
      .map((event) =>
        event.type === "turn_ended" ? { type: event.type, stopReason: event.stopReason } : event,
      );
    expect(observed).toEqual([
      { type: "turn_started" },
      { type: "reasoning_text", text: "weigh it" },
      { type: "message_text", text: "calling probe" },
      { type: "tool_started", toolName: "probe", toolCallId: "c1", args: { q: "x" } },
      {
        type: "tool_ended",
        toolName: "probe",
        toolCallId: "c1",
        isError: false,
        resultPreview: "probe result",
      },
      { type: "message_text", text: "done" },
      { type: "turn_ended", stopReason: "stop" },
    ]);
    const streamed = events.flatMap((event) => (event.type === "assistant_text" ? [event.delta] : []));
    expect(streamed.join("")).toBe("calling probedone");
    expect(result.status).toBe("completed");
    expect(result.assistantText).toBe("calling probe\ndone");
    expect(result.finalText).toBe("done");
    expect(result.toolCalls).toEqual({ byName: { probe: 1 }, failedByName: {}, failed: 0, total: 1 });
    expect(result.runtimeIdentity?.schema).toBe("runtime-model-identity/v2");
    const identity = result.runtimeIdentity;
    if (identity?.schema !== "runtime-model-identity/v2") throw new Error("expected a v2 identity");
    expect(identity.provider.id).toBe("openrouter");
    expect(identity.agentRuntime.sessionId).toMatch(/^pi-/);
  });

  it("records a throwing tool as a failed call with the error in its preview", async () => {
    const { result, events } = await turn(
      [
        fauxAssistantMessage(fauxToolCall("probe", { q: "x" }, { id: "c1" }), { stopReason: "toolUse" }),
        fauxAssistantMessage("gave up"),
      ],
      [
        probe(async () => {
          throw new Error("probe exploded");
        }),
      ],
    );
    const ended = events.find((event) => event.type === "tool_ended");
    expect(ended).toMatchObject({ type: "tool_ended", toolName: "probe", isError: true });
    expect(ended?.type === "tool_ended" ? ended.resultPreview : undefined).toContain("probe exploded");
    expect(result.status).toBe("completed");
    expect(result.toolCalls).toEqual({
      byName: { probe: 1 },
      failedByName: { probe: 1 },
      failed: 1,
      total: 1,
    });
  });
});

describe("HostSession.dispose", () => {
  it("releases the provider resources pi holds for this session and no other", async () => {
    const released: (string | undefined)[] = [];
    const unregister = registerSessionResourceCleanup((sessionId) => released.push(sessionId));
    try {
      const session = await openHostSession({
        slot: SLOT,
        tools: [],
        systemPrompt: "framing",
        fakeResponses: [],
      });
      expect(released).toEqual([]);
      await session.dispose();
      expect(released).toEqual([session.sessionId]);
    } finally {
      unregister();
    }
  });
});

describe("openHostSession terminate", () => {
  /** A batch of two calls where only `submit` may end the prompt, then one more answer that is
   *  requested only if the prompt goes on. The first request's signal is kept: on the Claude CLI
   *  it is what closes the query that spans the prompt. */
  async function batch(terminate: boolean, transport: PiSlotRuntime["profile"]["transport"] = "openrouter") {
    let followUps = 0;
    let signal: AbortSignal | undefined;
    const submit = toolDouble({
      name: "submit",
      description: "Submit the answer.",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ content: [{ type: "text", text: "accepted" }], details: null, terminate }),
    });
    const session = await openHostSession({
      slot: { ...SLOT, profile: { ...SLOT.profile, transport } },
      tools: [submit, probe(async () => "probed")],
      systemPrompt: "framing",
      fakeResponses: [
        double<AssistantMessage>(((_context, options) => {
          signal = options?.signal;
          return fauxAssistantMessage(
            [fauxToolCall("submit", {}, { id: "c1" }), fauxToolCall("probe", { q: "x" }, { id: "c2" })],
            { stopReason: "toolUse" },
          );
        }) satisfies FauxResponseFactory),
        double<AssistantMessage>((() => {
          followUps += 1;
          return fauxAssistantMessage("after the answer");
        }) satisfies FauxResponseFactory),
      ],
    });
    const events: AgentTurnEvent[] = [];
    const result = await session.runTurn({ prompt: "go", onEvent: (event) => events.push(event) });
    const closed = signal?.aborted === true;
    await session.dispose();
    return { result, events, followUps, closed };
  }

  it("ends the prompt after a turn whose batch carried one terminating result", async () => {
    const { result, events, followUps, closed } = await batch(true);
    // Pi alone ends only a batch whose every call terminates; here the probe did not.
    expect(followUps).toBe(0);
    expect(closed).toBe(false);
    expect(result.status).toBe("completed");
    expect(result.toolCalls).toEqual({
      byName: { submit: 1, probe: 1 },
      failedByName: {},
      failed: 0,
      total: 2,
    });
    expect(events.at(-1)).toMatchObject({ type: "turn_ended", stopReason: "toolUse" });
  });

  it("also closes the prompt's request on the Claude transport, and still completes the turn", async () => {
    const { result, followUps, closed } = await batch(true, "claude");
    expect(followUps).toBe(0);
    expect(closed).toBe(true);
    expect(result.status).toBe("completed");
  });

  it("goes on to the next request when no result terminates", async () => {
    const { result, followUps, closed } = await batch(false, "claude");
    expect(followUps).toBe(1);
    expect(closed).toBe(false);
    expect(result).toMatchObject({ status: "completed", assistantText: "after the answer" });
  });
});

describe("openHostSession turn status", () => {
  it("fails a turn whose provider error is not transient, and says why", async () => {
    const { result, events } = await turn([
      fauxAssistantMessage("", { stopReason: "error", errorMessage: "invalid request: bad schema" }),
    ]);
    expect(result.status).toBe("failed");
    expect(result.errorMessages).toEqual(["invalid request: bad schema"]);
    expect(result.runtimeIdentity).toBeUndefined();
    expect(events.at(-1)).toMatchObject({ type: "turn_failed", errorMessage: "invalid request: bad schema" });
  });

  it("completes a turn the session's own retry recovered, reporting the retry's answer", async () => {
    let calls = 0;
    const count = (message: AssistantMessage) =>
      double<AssistantMessage>((() => {
        calls += 1;
        return message;
      }) satisfies FauxResponseFactory);
    const { result } = await turn([
      count(fauxAssistantMessage("", { stopReason: "error", errorMessage: "503 service unavailable" })),
      count(fauxAssistantMessage("recovered")),
    ]);
    expect(calls).toBe(2);
    expect(result.status).toBe("completed");
    expect(result.assistantText).toBe("recovered");
    expect(result.errorMessages).toBeUndefined();
  });

  it("aborts a turn at its cap and names the cap", async () => {
    const { result, events } = await (async () => {
      const session = await openHostSession({
        slot: SLOT,
        tools: [],
        systemPrompt: "framing",
        fakeResponses: [UNTIL_ABORTED],
      });
      const seen: AgentTurnEvent[] = [];
      const settled = await session.runTurn({
        prompt: "go",
        turnTimeoutMs: 50,
        onEvent: (event) => seen.push(event),
      });
      await session.dispose();
      return { result: settled, events: seen };
    })();
    expect(result.status).toBe("aborted");
    expect(result.errorMessages?.[0]).toBe("the turn reached its 50 ms cap");
    expect(events.at(-1)).toMatchObject({ type: "turn_ended", stopReason: "aborted" });
  });

  it("aborts on the caller's signal, before the turn starts and while it runs", async () => {
    const session = await openHostSession({
      slot: SLOT,
      tools: [],
      systemPrompt: "framing",
      fakeResponses: [UNTIL_ABORTED],
    });
    const before = await session.runTurn({ prompt: "go", signal: AbortSignal.abort() });
    expect(before).toEqual({
      status: "aborted",
      errorMessages: ["the caller cancelled the turn before it started"],
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const during = await session.runTurn({ prompt: "go", signal: controller.signal });
    expect(during.status).toBe("aborted");
    expect(during.errorMessages?.[0]).toBe("the caller cancelled the turn");
    await session.dispose();
  });

  it("attests the model that answered before the caller stopped the turn", async () => {
    const served = { ...fauxAssistantMessage(fauxToolCall("probe", { q: "x" }), { stopReason: "toolUse" }) };
    served.responseModel = "served-model";
    const session = await openHostSession({
      slot: SLOT,
      tools: [probe(async () => "probe result")],
      systemPrompt: "framing",
      fakeResponses: [served, UNTIL_ABORTED],
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const result = await session.runTurn({ prompt: "go", signal: controller.signal });
    await session.dispose();
    expect(result.status).toBe("aborted");
    const identity = result.runtimeIdentity;
    if (identity?.schema !== "runtime-model-identity/v2") throw new Error("expected a v2 identity");
    expect(identity.provider.model).toBe("served-model");
  });

  it("attests the Codex route's response id when no model was named, and nothing when nothing answered", async () => {
    const answered = fauxAssistantMessage(fauxToolCall("probe", { q: "x" }), {
      stopReason: "toolUse",
      responseId: "resp_1",
    });
    const stop = async (fakeResponses: AssistantMessage[]) => {
      const session = await openHostSession({
        slot: SLOT,
        tools: [probe(async () => "probe result")],
        systemPrompt: "framing",
        fakeResponses,
      });
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 20);
      const result = await session.runTurn({ prompt: "go", signal: controller.signal });
      await session.dispose();
      return result;
    };
    const idOnly = await stop([answered, UNTIL_ABORTED]);
    expect(idOnly.status).toBe("aborted");
    const identity = idOnly.runtimeIdentity;
    if (identity?.schema !== "runtime-model-identity/v2") throw new Error("expected a v2 identity");
    expect(identity.provider).toMatchObject({ model: null, resultId: "resp_1" });
    const unanswered = await stop([UNTIL_ABORTED]);
    expect(unanswered.status).toBe("aborted");
    expect(unanswered.runtimeIdentity).toBeUndefined();
  });

  it("reads a settled prompt's status from its last assistant message", () => {
    const message = (stopReason: AssistantMessage["stopReason"]) => fauxAssistantMessage("x", { stopReason });
    expect(settledStatus(undefined)).toBe("failed");
    expect(settledStatus(message("error"))).toBe("failed");
    expect(settledStatus(message("aborted"))).toBe("aborted");
    expect(settledStatus(message("stop"))).toBe("completed");
    expect(settledStatus(message("toolUse"))).toBe("completed");
  });
});

describe("HostSession.configure", () => {
  type Seen = { prompt: string; tools: string[]; systemMessages: number; userMessages: number };

  function watching(seen: Seen[], answer: string): AssistantMessage {
    return double<AssistantMessage>(((context) => {
      const { messages } = context;
      seen.push({
        prompt: getCurrentSystemPrompt(messages),
        tools: getCurrentTools(messages).map((tool) => tool.name),
        systemMessages: messages.filter((message) => message.role === "system").length,
        userMessages: messages.filter((message) => message.role === "user").length,
      });
      return fauxAssistantMessage(answer);
    }) satisfies FauxResponseFactory);
  }

  const named = (name: string) => toolDouble({ name, execute: async () => ({ content: [], details: null }) });

  it("runs the next prompt on the new tools and framing, in the same conversation", async () => {
    const seen: Seen[] = [];
    const session = await openHostSession({
      slot: SLOT,
      tools: [named("read")],
      systemPrompt: "first framing",
      fakeResponses: [watching(seen, "one"), watching(seen, "two")],
    });
    await session.runTurn({ prompt: "round one" });
    session.configure([named("read"), named("submit")], "second framing");
    await session.runTurn({ prompt: "round two" });
    await session.dispose();

    // The kept transcript carries round one; pi announces the new roster and the framing section
    // is replaced by one more system message.
    expect(seen).toEqual([
      { prompt: "first framing", tools: ["read"], systemMessages: 1, userMessages: 1 },
      { prompt: "second framing", tools: ["read", "submit"], systemMessages: 3, userMessages: 2 },
    ]);
  });

  it("adds no system message when the framing and tools are unchanged", async () => {
    const seen: Seen[] = [];
    const tools = [named("read")];
    const session = await openHostSession({
      slot: SLOT,
      tools,
      systemPrompt: "same framing",
      fakeResponses: [watching(seen, "one"), watching(seen, "two")],
    });
    await session.runTurn({ prompt: "round one" });
    session.configure(tools, "same framing");
    await session.runTurn({ prompt: "round two" });
    await session.dispose();

    expect(seen.map(({ prompt, systemMessages }) => ({ prompt, systemMessages }))).toEqual([
      { prompt: "same framing", systemMessages: 1 },
      { prompt: "same framing", systemMessages: 1 },
    ]);
  });
});

describe("HostSession compaction", () => {
  it("compacts in this session unless a Claude slot left it to the CLI", () => {
    const claude = {
      provider: "anthropic",
      transport: "claude",
      model: "claude-opus-5",
      thinkingLevel: "medium",
    } as const;
    expect(piSessionPolicy(SLOT.profile).compaction).toMatchObject({ enabled: true, window: 300_000 });
    expect(piSessionPolicy(claude).compaction.enabled).toBe(false);
    expect(piSessionPolicy({ ...claude, compaction: "claude-ss" }).compaction.enabled).toBe(false);
    expect(piSessionPolicy({ ...claude, compaction: "pi" }).compaction).toMatchObject({
      enabled: true,
      window: 300_000,
    });
  });

  // The faux model's window is 128,000 tokens, so compaction admits above 111,616; the faux
  // provider counts four characters a token, so each bulk prompt is 62,500 tokens.
  const BULK = "x".repeat(250_000);
  const SUMMARY = fauxAssistantMessage("SUMMARY-OF-ROUND-ONE");
  type Seen = {
    prompt: string;
    tools: string[];
    systemMessages: number;
    summarised: boolean;
    stale: boolean;
  };

  function watching(seen: Seen[], answer: string): AssistantMessage {
    return double<AssistantMessage>(((context) => {
      const { messages } = context;
      const text = JSON.stringify(messages);
      seen.push({
        prompt: getCurrentSystemPrompt(messages),
        tools: getCurrentTools(messages).map((tool) => tool.name),
        systemMessages: messages.filter((message) => message.role === "system").length,
        summarised: text.includes("SUMMARY-OF-ROUND-ONE"),
        stale: text.includes("first framing"),
      });
      return fauxAssistantMessage(answer);
    }) satisfies FauxResponseFactory);
  }

  const named = (name: string) => toolDouble({ name, execute: async () => ({ content: [], details: null }) });
  const AFTER = {
    prompt: "second framing",
    tools: ["read", "submit"],
    systemMessages: 1,
    summarised: true,
    stale: false,
  };

  it("replays the current framing and tools ahead of the summary after threshold compaction", async () => {
    const seen: Seen[] = [];
    const session = await openHostSession({
      slot: SLOT,
      tools: [named("read")],
      systemPrompt: "first framing",
      fakeResponses: [watching(seen, "one"), watching(seen, "two"), SUMMARY, watching(seen, "three")],
    });
    await session.runTurn({ prompt: `round one ${BULK}` });
    session.configure([named("read"), named("submit")], "second framing");
    const compacting = await session.runTurn({ prompt: `round two ${BULK}` });
    await session.runTurn({ prompt: "round three" });
    await session.dispose();

    expect(compacting.compactions?.map(({ compacted }) => compacted)).toEqual([true]);
    expect(seen.at(-1)).toEqual(AFTER);
  });

  it("replays the current framing when an overflow compacts and retries the turn", async () => {
    const seen: Seen[] = [];
    const overflow = fauxAssistantMessage("", { stopReason: "error", errorMessage: "prompt is too long" });
    const session = await openHostSession({
      slot: SLOT,
      tools: [named("read")],
      systemPrompt: "first framing",
      fakeResponses: [watching(seen, "one"), overflow, SUMMARY, watching(seen, "two")],
    });
    await session.runTurn({ prompt: `round one ${BULK}` });
    session.configure([named("read"), named("submit")], "second framing");
    const retried = await session.runTurn({ prompt: `round two ${BULK}` });
    await session.dispose();

    expect(retried.status).toBe("completed");
    expect(seen.at(-1)).toEqual(AFTER);
  });

  async function cancelledWhileCompacting(stop: "signal" | "timeout") {
    const calls: string[] = [];
    const late = double<AssistantMessage>((() => {
      calls.push("model requested");
      return fauxAssistantMessage(fauxToolCall("probe", { q: "x" }, { id: "late" }));
    }) satisfies FauxResponseFactory);
    const session = await openHostSession({
      slot: SLOT,
      tools: [probe(async () => (calls.push("probe ran"), "ok"))],
      systemPrompt: "framing",
      // The third step is the summary request, held until the cancel aborts it.
      fakeResponses: [fauxAssistantMessage("one"), UNTIL_ABORTED, UNTIL_ABORTED, late],
    });
    await session.runTurn({ prompt: `round one ${BULK}` });
    // An aborted answer skips compaction after its run, so the next prompt compacts first.
    await session.runTurn({ prompt: `round two ${BULK}`, turnTimeoutMs: 50 });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const result = await session.runTurn(
      stop === "signal"
        ? { prompt: "round three", signal: controller.signal }
        : { prompt: "round three", turnTimeoutMs: 50 },
    );
    await Bun.sleep(300);
    await session.dispose();
    // The abandoned compaction still reaches the aborted turn's result.
    return {
      status: result.status,
      calls,
      compactions: result.compactions?.map(({ compacted }) => compacted),
    };
  }

  it("starts no request and no tool once the caller cancels during pre-prompt compaction", async () => {
    expect(await cancelledWhileCompacting("signal")).toEqual({
      status: "aborted",
      calls: [],
      compactions: [false],
    });
  });

  it("starts no request and no tool once the turn cap stops pre-prompt compaction", async () => {
    expect(await cancelledWhileCompacting("timeout")).toEqual({
      status: "aborted",
      calls: [],
      compactions: [false],
    });
  });
});
