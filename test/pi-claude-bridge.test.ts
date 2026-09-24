import { describe, expect, it, mock } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Api, Message, Model, StopReason } from "@earendil-works/pi-ai";
import type { Options } from "claude-agent-sdk-bridge";
import type { BridgeProviderSettings } from "../vendor/pi-claude-bridge/provider.ts";
import { QueryContext } from "../vendor/pi-claude-bridge/query-state.ts";
import { getSessionPath } from "cc-session-io";
import { mkdirSync, mkdtempSync, writeFileSync } from "../src/meta/filesystem.ts";
import { type QueryTally, compactSummaries } from "../vendor/pi-claude-bridge/compact-summary.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { double, required } from "./helpers/doubles.ts";
const CONTENT_BLOCK_STOP = "content_block_stop";
const CONTENT_BLOCK_START = "content_block_start";
const CONTENT_BLOCK_DELTA = "content_block_delta";
const TOOL_USE = "tool_use";

interface OpenedQuery {
  options?: Options;
  count: number;
}
const opened: OpenedQuery = { count: 0 };
/** The one pi event field set every assertion here reads. */
type PiEvent = {
  type: string;
  contentIndex?: number;
  delta?: string;
  content?: string;
  reason?: string;
};

/** One SDK stream event as the CLI spells it. The fixtures write only the fields the bridge
 *  reads, which is the point: a field the translation starts needing fails its test here. */
type SdkStreamEvent = {
  type: string;
  index?: number;
  message?: { id?: string; model?: string; usage?: Record<string, number> };
  content_block?: { type: string; id?: string; name?: string; input?: Record<string, string> };
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    signature?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  usage?: Record<string, number>;
};

/** The MCP server's tool as the CLI names it, with the pi name the bridge maps it back to. */
const MCP_WRITE = "mcp__custom-tools__write_answer";
/** The turn fields the bridge writes back: the provider's message id and the model it served. */
type TurnOutput = { responseId?: string; responseModel?: string };

/** The one answer the recorded turns carry. */
const FACT = "the fact is 42";
/** What the CLI answers: one assistant message and its successful result, unless a test says. */
const ANSWERED: readonly unknown[] = [
  { type: "assistant", message: { id: "answer", content: [{ type: "text", text: "ok" }] } },
  { type: "result", subtype: "success", is_error: false, result: "ok", modelUsage: {} },
];
let cliMessages: readonly unknown[] = ANSWERED;
/** Set, the CLI stays live after its messages, as it does while a tool call waits, until closed. */
let holdOpen = false;

// Replace only the authenticated CLI call; prompt and MCP construction run through the real provider.
await mock.module("claude-agent-sdk-bridge", () => ({
  query: ({ options }: { options: Options }) => {
    opened.options = options;
    opened.count += 1;
    const messages = cliMessages;
    const held = holdOpen;
    const { promise: closed, resolve: close } = Promise.withResolvers<void>();
    async function* response() {
      for (const message of messages) yield message;
      if (held) await closed;
    }
    return Object.assign(response(), { interrupt: async () => {}, close });
  },
}));
const { consumeQueryForTest, createClaudeBridge } = await import("../vendor/pi-claude-bridge/provider.ts");

/** A turn recorder: the context the bridge writes into, and the pi events it emitted. */
function openTurn() {
  const events: PiEvent[] = [];
  let ended = false;
  const context = new QueryContext();
  context.turnOutput = double({
    role: "assistant",
    content: [],
    stopReason: "stop",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  });
  context.currentPiStream = double({
    push: (event: PiEvent) => {
      events.push(event);
    },
    end: () => {
      ended = true;
    },
  });
  return { context, events, ended: () => ended };
}

/** A model whose cost table calculateCost can read, since every usage update recomputes cost. */
const testModel = (id = "claude-opus-5"): Model<Api> =>
  double({
    id,
    api: "anthropic-messages",
    provider: "anthropic",
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  });

const registered = () =>
  new Map([
    [MCP_WRITE, "write_answer"],
    ["mcp__custom-tools__bash", "bash"],
  ]);

/** Drive the SDK messages through the real consumer into one open turn. */
async function drive(
  messages: readonly unknown[],
  options: {
    context?: QueryContext;
    toPi?: Map<string, string>;
    model?: unknown;
    settings?: BridgeProviderSettings;
  } = {},
): Promise<{ context: QueryContext; events: PiEvent[]; ended: () => boolean }> {
  const events: PiEvent[] = [];
  const turn =
    options.context === undefined ? openTurn() : { context: options.context, events, ended: () => false };
  async function* stream() {
    for (const message of messages) yield message;
  }
  await consumeQueryForTest(
    options.settings ?? {},
    double(stream()),
    { toPi: options.toPi ?? registered(), model: double(options.model ?? testModel()) },
    turn.context,
    { aborted: false, compactions: 0, sessionId: undefined },
  );
  return turn;
}

/** One SDK partial-assistant message carrying a single stream event. */
const streamed = (event: SdkStreamEvent) => ({ type: "stream_event", event });

it("keeps the confined SDK settings and every explicitly registered tool", async () => {
  const client = new Client({ name: "bridge-test", version: "1" });
  try {
    const stream = createClaudeBridge({ builtinTools: ["WebSearch"] })(testModel(), {
      systemPrompt: "  controller-owned prompt  ",
      messages: [{ role: "user", content: "answer", timestamp: 0 }],
      tools: ["write_answer", "AskClaude"].map((name) => ({
        name,
        description: name,
        parameters: double({ type: "object", properties: {} }),
      })),
    });
    expect((await stream.result()).content).toEqual([{ type: "text", text: "ok" }]);
    const options = required(opened.options, "SDK options");
    expect(options.systemPrompt).toBe("controller-owned prompt");
    expect(options.settingSources).toEqual([]);
    expect(options.skills).toEqual([]);
    expect(options.extraArgs?.["strict-mcp-config"]).toBeNull();
    expect(options.env?.ENABLE_CLAUDEAI_MCP_SERVERS).toBe("0");
    expect(options.env?.DISABLE_AUTO_COMPACT).toBe("1");
    expect(options.tools).toEqual(["WebSearch"]);
    const server = required(options.mcpServers?.["custom-tools"], "registered tools server");
    if (server.type !== "sdk") throw new Error("expected in-process MCP server");
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.instance.connect(serverTransport);
    await client.connect(clientTransport);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["write_answer", "AskClaude"]);
  } finally {
    await client.close();
  }
});

// Two bridges in one process: the Builder's and a Built worker's CLI must not share an account or a
// session directory, so each child starts from its own bridge's environment, never this process's.
it("starts each CLI child from its own bridge's environment", async () => {
  const messages = [{ role: "user" as const, content: "answer", timestamp: 0 }];
  await createClaudeBridge({ env: { CLAUDE_CONFIG_DIR: "/builder", MARK: "builder" } })(testModel(), {
    messages,
  }).result();
  const builder = required(opened.options, "SDK options").env;
  await createClaudeBridge({ env: { CLAUDE_CONFIG_DIR: "/worker" } })(testModel(), { messages }).result();
  const worker = required(opened.options, "SDK options").env;
  expect(builder?.CLAUDE_CONFIG_DIR).toBe("/builder");
  expect(builder?.MARK).toBe("builder");
  expect(worker?.CLAUDE_CONFIG_DIR).toBe("/worker");
  expect(worker?.MARK).toBeUndefined();
  expect(worker?.PATH).toBeUndefined();
});

// pi 0.86's agent loop hands the provider a transcript whose prompt and tools ride a leading
// system message; the bridge must still append the prompt and register the tools from it.
it("reads the prompt and tools from a transcript system message", async () => {
  const stream = createClaudeBridge({})(testModel(), {
    messages: [
      {
        role: "system",
        content: "  transcript prompt  ",
        toolsAdded: [
          { name: "write_answer", description: "w", parameters: double({ type: "object", properties: {} }) },
        ],
        timestamp: 0,
      },
      { role: "user", content: "answer", timestamp: 0 },
    ],
  });
  expect((await stream.result()).content).toEqual([{ type: "text", text: "ok" }]);
  const options = required(opened.options, "SDK options");
  expect(options.systemPrompt).toBe("transcript prompt");
  expect(Object.keys(options.mcpServers ?? {})).toEqual(["custom-tools"]);
});

// The Built solver has run under the CLI's own preset since its first measured claude condition;
// every other caller's prompt is the whole system prompt.
it("puts the CLI preset ahead of the prompt only for a caller that asks for it", async () => {
  const messages = [{ role: "user" as const, content: "answer", timestamp: 0 }];
  await createClaudeBridge({ claudeCodePreset: true })(testModel(), {
    systemPrompt: "built",
    messages,
  }).result();
  expect(required(opened.options, "SDK options").systemPrompt).toEqual({
    type: "preset",
    preset: "claude_code",
    append: "built",
  });
  await createClaudeBridge({})(testModel(), { messages }).result();
  expect(required(opened.options, "SDK options").systemPrompt).toBe("");
});

// A CLI that exits cleanly before any result answered nothing, whatever text it streamed first.
it("fails a turn whose CLI ended without a result", async () => {
  cliMessages = ANSWERED.slice(0, 1);
  try {
    const message = await createClaudeBridge({})(testModel(), {
      messages: [{ role: "user", content: "answer", timestamp: 0 }],
    }).result();
    expect(message.stopReason).toBe("error");
    expect(message.errorMessage).toBe("claude stream ended before the turn completed");
  } finally {
    cliMessages = ANSWERED;
  }
});

describe("the Pi Claude bridge compaction", () => {
  it("lets the CLI compact at the caller's window instead of disabling it", async () => {
    const stream = createClaudeBridge({ autoCompactWindow: 300_000 })(testModel(), {
      messages: [{ role: "user", content: "answer", timestamp: 0 }],
    });
    await stream.result();
    const { env } = required(opened.options, "SDK options");
    expect(env?.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe("300000");
    expect(env?.DISABLE_AUTO_COMPACT).toBeUndefined();
  });

  it("reports each CLI compaction boundary with its token count", async () => {
    const seen: number[] = [];
    await drive(
      [
        {
          type: "system",
          subtype: "compact_boundary",
          compact_metadata: { trigger: "auto", pre_tokens: 301_234 },
        },
        { type: "system", subtype: "init", session_id: "s" },
      ],
      { context: new QueryContext(), settings: { onCompaction: (tokens) => seen.push(tokens) } },
    );
    expect(seen).toEqual([301_234]);
  });

  it("reports a compaction that lands between tool round-trips, with no Pi stream open", async () => {
    const seen: number[] = [];
    const context = new QueryContext();
    context.turnOutput = null;
    context.currentPiStream = null;
    await drive(
      [
        {
          type: "system",
          subtype: "compact_boundary",
          compact_metadata: { trigger: "auto", pre_tokens: 12 },
        },
      ],
      { context, settings: { onCompaction: (tokens) => seen.push(tokens) } },
    );
    expect(seen).toEqual([12]);
  });

  it("counts the boundaries a query saw, so the summaries can be read before the transcript goes", async () => {
    const boundary = {
      type: "system",
      subtype: "compact_boundary",
      compact_metadata: { trigger: "auto", pre_tokens: 1 },
    };
    const tally: QueryTally = { aborted: false, compactions: 0, sessionId: undefined };
    await consumeQueryForTest(
      {},
      double(
        (async function* () {
          yield boundary;
          yield boundary;
        })(),
      ),
      { toPi: registered(), model: double(testModel()) },
      new QueryContext(),
      tally,
    );
    expect(tally.compactions).toBe(2);
  });

  it("reads the newest compaction summaries from the CLI transcript, and nothing from a missing one", () => {
    const dir = mkdtempSync(join(tmpdir(), "compact-summary-"));
    const transcript = join(dir, "s.jsonl");
    const summary = (text: string) =>
      JSON.stringify({ type: "user", isCompactSummary: true, message: { role: "user", content: text } });
    const blocks = JSON.stringify({
      type: "user",
      isCompactSummary: true,
      message: { role: "user", content: [{ type: "text", text: "third" }] },
    });
    const plain = JSON.stringify({ type: "user", message: { role: "user", content: "not a summary" } });
    writeFileSync(transcript, [summary("first"), plain, summary("second"), blocks, "{broken"].join("\n"));
    expect(compactSummaries(transcript, 2)).toEqual(["second", "third"]);
    expect(compactSummaries(join(dir, "absent.jsonl"), 1)).toEqual([]);
  });
});

describe("the Pi Claude bridge after a stopped query", () => {
  const toolUse = [
    streamed({
      type: CONTENT_BLOCK_START,
      index: 0,
      content_block: { type: TOOL_USE, id: "call-1", name: MCP_WRITE, input: {} },
    }),
    streamed({ type: CONTENT_BLOCK_STOP, index: 0 }),
    streamed({ type: "message_stop" }),
  ];
  /** The transcript's leading system message, which registers the tool the CLI calls. */
  const tools = double<Message>({
    role: "system",
    content: "",
    toolsAdded: [
      { name: "write_answer", description: "w", parameters: double({ type: "object", properties: {} }) },
    ],
    timestamp: 0,
  });
  const compacted = [
    tools,
    { role: "user" as const, content: "summary of the earlier turns", timestamp: 0 },
    double<Message>({
      role: "assistant",
      content: [{ type: "toolCall", id: "call-1", name: "write_answer", arguments: {} }],
      stopReason: "toolUse",
      timestamp: 0,
    }),
    double<Message>({
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "write_answer",
      content: [{ type: "text", text: "written" }],
      isError: false,
      timestamp: 0,
    }),
  ];

  /** The CLI's plain answer to the first prompt, as pi records it. */
  const answer = double<Message>({
    role: "assistant",
    content: [{ type: "text", text: "ok" }],
    timestamp: 0,
  });

  // With the query left running, each tool result would go to the CLI's uncompacted history, and
  // pi would keep compacting while the CLI's own context grew unchecked.
  it("stops the live query, and opens the next one on the compacted history", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ana-bridge-restart-"));
    const bridge = createClaudeBridge({ env: { CLAUDE_CONFIG_DIR: dir } });
    const before = opened.count;
    cliMessages = toolUse;
    holdOpen = true;
    try {
      const first = await bridge(testModel(), {
        messages: [tools, { role: "user", content: "go", timestamp: 0 }],
      }).result();
      expect(first.stopReason).toBe("toolUse");
      bridge.historyRewritten();
      cliMessages = ANSWERED;
      holdOpen = false;
      const next = bridge(testModel(), { messages: compacted });
      // The tool result opened a query of its own instead of reaching the stopped one.
      expect(opened.count).toBe(before + 2);
      expect(required(opened.options, "SDK options").resume).toBeString();
      expect((await next.result()).content).toEqual([{ type: "text", text: "ok" }]);
    } finally {
      cliMessages = ANSWERED;
      holdOpen = false;
    }
  });

  // An accepted submit aborts the Builder's query, and in the live check of 2026-09-22 the next
  // round's prompt arrived before the stopped CLI exited: it was routed into that query as a steer
  // and failed as aborted, instead of forking the session the CLI had compacted.
  it("forks the stopped session for a prompt that arrives before the stopped query settles", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ana-bridge-abort-"));
    const bridge = createClaudeBridge({ env: { CLAUDE_CONFIG_DIR: dir }, autoCompactWindow: 300_000 });
    const asked = [tools, { role: "user" as const, content: "go", timestamp: 0 }];
    cliMessages = [{ type: "system", subtype: "init", session_id: "session-1" }, ...ANSWERED];
    await bridge(testModel(), { messages: asked }).result();
    const ending = [...asked, answer, { role: "user" as const, content: "end the round", timestamp: 0 }];
    const stop = new AbortController();
    cliMessages = toolUse;
    holdOpen = true;
    try {
      const first = await bridge(testModel(), { messages: ending }, { signal: stop.signal }).result();
      expect(first.stopReason).toBe("toolUse");
      stop.abort();
      cliMessages = ANSWERED;
      holdOpen = false;
      const before = opened.count;
      const next = bridge(testModel(), {
        messages: [...ending, ...compacted.slice(2), { role: "user", content: "round two", timestamp: 0 }],
      });
      expect(opened.count).toBe(before + 1);
      const options = required(opened.options, "SDK options");
      expect(options.resume).toBe("session-1");
      expect(options.forkSession).toBe(true);
      expect((await next.result()).content).toEqual([{ type: "text", text: "ok" }]);
    } finally {
      cliMessages = ANSWERED;
      holdOpen = false;
    }
  });

  // An accepted submit ends the Builder's turn by aborting its query, which is the path a round
  // most often ends on. The summary the CLI wrote when it compacted is still in its transcript
  // then, and it has to be handed over before the turn record that owns it closes.
  it("hands over the compaction summary of a query that is stopped rather than settled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ana-bridge-abort-summary-"));
    const summaries: string[] = [];
    const bridge = createClaudeBridge({
      env: { CLAUDE_CONFIG_DIR: dir },
      cwd: dir,
      onCompactionSummary: (summary) => summaries.push(summary),
    });
    const transcript = getSessionPath("session-1", dir, dir);
    mkdirSync(dirname(transcript), { recursive: true });
    writeFileSync(
      transcript,
      JSON.stringify({
        type: "user",
        isCompactSummary: true,
        message: { role: "user", content: "what came before" },
      }),
    );
    const stop = new AbortController();
    cliMessages = [
      { type: "system", subtype: "init", session_id: "session-1" },
      { type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "auto", pre_tokens: 9 } },
      ...toolUse,
    ];
    holdOpen = true;
    try {
      const turn = bridge(
        testModel(),
        { messages: [tools, { role: "user", content: "go", timestamp: 0 }] },
        { signal: stop.signal },
      );
      expect((await turn.result()).stopReason).toBe("toolUse");
      stop.abort();
      expect(summaries).toEqual(["what came before"]);
    } finally {
      cliMessages = ANSWERED;
      holdOpen = false;
    }
  });

  // A 529 arrives as an is_error result from a CLI that exits cleanly, and pi retries the same
  // history. Counted as answered, the retry saw a shorter history than the session and opened a CLI
  // session holding only its prompt.
  it("gives a retried turn the history a refused turn never answered", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ana-bridge-refused-"));
    const bridge = createClaudeBridge({ env: { CLAUDE_CONFIG_DIR: dir } });
    const asked = [tools, { role: "user" as const, content: "go", timestamp: 0 }];
    cliMessages = [{ type: "system", subtype: "init", session_id: "session-1" }, ...ANSWERED];
    await bridge(testModel(), { messages: asked }).result();
    const retried = [...asked, answer, { role: "user" as const, content: "next", timestamp: 0 }];
    cliMessages = [
      { type: "system", subtype: "init", session_id: "session-1" },
      {
        type: "result",
        subtype: "success",
        is_error: true,
        result: "API Error: 529 Overloaded",
        modelUsage: {},
      },
    ];
    try {
      expect((await bridge(testModel(), { messages: retried }).result()).stopReason).toBe("error");
      // Pi retries after a backoff, by which time the refused query has settled.
      await Bun.sleep(1);
      cliMessages = ANSWERED;
      await bridge(testModel(), { messages: retried }).result();
      expect(opened.options?.resume).toBeString();
    } finally {
      cliMessages = ANSWERED;
    }
  });

  // A prompt that opens straight after the last one answered reuses the shared top context before
  // the last query's own cleanup has run; that cleanup used to drop the context from the set tool
  // results route by, so the new query's results ended the turn as orphans.
  it("routes a tool result to the query that reclaimed the context before the last one settled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ana-bridge-reclaim-"));
    const bridge = createClaudeBridge({ env: { CLAUDE_CONFIG_DIR: dir } });
    const asked = [tools, { role: "user" as const, content: "go", timestamp: 0 }];
    await bridge(testModel(), { messages: asked }).result();
    const stop = new AbortController();
    cliMessages = toolUse;
    holdOpen = true;
    try {
      const again = [...asked, answer, { role: "user" as const, content: "write it", timestamp: 0 }];
      const first = await bridge(testModel(), { messages: again }, { signal: stop.signal }).result();
      expect(first.stopReason).toBe("toolUse");
      const before = opened.count;
      const delivered = bridge(
        testModel(),
        { messages: [...again, ...compacted.slice(2)] },
        { signal: stop.signal },
      );
      stop.abort();
      // Delivered, the result's turn ends with the query that received it; an orphan ends at once.
      expect((await delivered.result()).stopReason).toBe("aborted");
      expect(opened.count).toBe(before);
    } finally {
      cliMessages = ANSWERED;
      holdOpen = false;
    }
  });

  it("stops nothing at a turn boundary, where the next prompt already opens a query", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ana-bridge-boundary-"));
    const bridge = createClaudeBridge({ env: { CLAUDE_CONFIG_DIR: dir } });
    await bridge(testModel(), { messages: [{ role: "user", content: "go", timestamp: 0 }] }).result();
    const before = opened.count;
    bridge.historyRewritten();
    expect(opened.count).toBe(before);
    // A tool result with no query behind it still ends the turn rather than opening one.
    const orphan = await bridge(testModel(), { messages: compacted }).result();
    expect(orphan.content).toEqual([]);
    expect(opened.count).toBe(before);
  });
});

describe("the Pi Claude bridge result identity", () => {
  /** Fold one SDK result into a turn whose Pi stream a tool call already closed. */
  type Usage = { inputTokens?: number; outputTokens?: number };
  const served = async (modelUsage: Record<string, Usage>, requested?: string) => {
    const context = new QueryContext();
    const output: TurnOutput = { responseId: "provider-message" };
    context.turnOutput = double(output);
    context.currentPiStream = null;
    await drive([{ type: "result", uuid: "result", modelUsage }], {
      context,
      model: requested === undefined ? {} : { id: requested },
    });
    return output;
  };
  const used = { inputTokens: 10, outputTokens: 2 };

  it.each([
    [
      "the only model in the table, after a tool call closed the stream",
      "claude-opus-4-8",
      undefined,
      "claude-opus-4-8",
    ],
    // The CLI runs under `--model claude-opus-5[1m]`, so its table carries that spelling while the
    // identity pin holds the API id; a different model keeps its distinct identity.
    [
      "the registered id for the CLI's long-context spelling",
      "claude-opus-5[1m]",
      "claude-opus-5",
      "claude-opus-5",
    ],
    ["the registered id unchanged", "claude-opus-5", "claude-opus-5", "claude-opus-5"],
    ["another registered long-context model", "claude-fable-5-1[1m]", "claude-fable-5-1", "claude-fable-5-1"],
    [
      "a long-context model other than the one requested",
      "claude-fable-5-1[1m]",
      "claude-opus-5",
      "claude-fable-5-1[1m]",
    ],
    ["a model with no long-context suffix", "claude-haiku-4-5", "claude-opus-5", "claude-haiku-4-5"],
  ])("records as served %s", async (_case, servedKey, requested, expected) => {
    const output = await served({ [servedKey]: used }, requested);
    expect(output).toEqual({ responseId: "provider-message", responseModel: expected });
  });

  it("does not invent a served model when the SDK result has no unambiguous model table", async () => {
    const output = await served({ "claude-opus-4-8": {}, "claude-sonnet-4-6": {} });
    expect(output).toEqual({ responseId: "provider-message" });
  });

  it("captures the session id the CLI reports at init", async () => {
    const context = new QueryContext();
    context.turnOutput = null;
    context.currentPiStream = null;
    async function* init() {
      yield { type: "system", subtype: "init", session_id: "session-7" };
    }
    const tally: QueryTally = { aborted: false, compactions: 0, sessionId: undefined };
    await consumeQueryForTest({}, double(init()), { toPi: new Map(), model: testModel() }, context, tally);
    expect(tally.sessionId).toBe("session-7");
  });
});

describe("the Pi Claude bridge streamed turn", () => {
  /** The events for one whole text block, streamed as the SDK delivers it. */
  const textBlock = (index: number, chunks: readonly string[]) => [
    streamed({ type: CONTENT_BLOCK_START, index, content_block: { type: "text" } }),
    ...chunks.map((text) =>
      streamed({ type: CONTENT_BLOCK_DELTA, index, delta: { type: "text_delta", text } }),
    ),
    streamed({ type: CONTENT_BLOCK_STOP, index }),
  ];

  it("names the provider message and served model from message_start, before any content", async () => {
    const { context, events } = await drive([
      streamed({
        type: "message_start",
        message: { id: "msg-stream", model: "claude-opus-5", usage: { input_tokens: 40 } },
      }),
    ]);
    expect(context.turnOutput?.responseId).toBe("msg-stream");
    expect(context.turnOutput?.responseModel).toBe("claude-opus-5");
    expect(context.turnOutput?.usage.input).toBe(40);
    // Identity is not content: nothing has been emitted to pi yet.
    expect(events).toEqual([]);
  });

  it("emits one turn start, then the text block's own lifecycle", async () => {
    const { context, events } = await drive(textBlock(0, ["the ", "fact ", "is 42"]));
    expect(events.map((event) => event.type)).toEqual([
      "start",
      "text_start",
      "text_delta",
      "text_delta",
      "text_delta",
      "text_end",
    ]);
    expect(events.filter((event) => event.type === "text_delta").map((event) => event.delta)).toEqual([
      "the ",
      "fact ",
      "is 42",
    ]);
    expect(events.at(-1)?.content).toBe(FACT);
    expect(context.turnBlocks).toEqual([{ type: "text", text: FACT }]);
    expect(context.turnStarted).toBe(true);
  });

  it("starts the turn once across two content blocks", async () => {
    const { events } = await drive([...textBlock(0, ["a"]), ...textBlock(1, ["b"])]);
    expect(events.filter((event) => event.type === "start")).toHaveLength(1);
    expect(events.map((event) => event.contentIndex).filter((index) => index !== undefined)).toEqual([
      0, 0, 0, 1, 1, 1,
    ]);
  });

  it("keeps a thinking signature on the block without emitting it as content", async () => {
    const { context, events } = await drive([
      streamed({ type: CONTENT_BLOCK_START, index: 0, content_block: { type: "thinking" } }),
      streamed({
        type: CONTENT_BLOCK_DELTA,
        index: 0,
        delta: { type: "thinking_delta", thinking: "weigh it" },
      }),
      streamed({
        type: CONTENT_BLOCK_DELTA,
        index: 0,
        delta: { type: "signature_delta", signature: "sig-" },
      }),
      streamed({
        type: CONTENT_BLOCK_DELTA,
        index: 0,
        delta: { type: "signature_delta", signature: "abc" },
      }),
      streamed({ type: CONTENT_BLOCK_STOP, index: 0 }),
    ]);
    expect(events.map((event) => event.type)).toEqual([
      "start",
      "thinking_start",
      "thinking_delta",
      "thinking_end",
    ]);
    expect(context.turnBlocks).toEqual([
      { type: "thinking", thinking: "weigh it", thinkingSignature: "sig-abc" },
    ]);
  });

  it("accumulates a tool call's arguments across partial JSON and closes the turn on it", async () => {
    const { context, events, ended } = await drive([
      streamed({
        type: CONTENT_BLOCK_START,
        index: 0,
        content_block: { type: TOOL_USE, id: "call-1", name: MCP_WRITE, input: {} },
      }),
      streamed({
        type: CONTENT_BLOCK_DELTA,
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"answer":' },
      }),
      streamed({
        type: CONTENT_BLOCK_DELTA,
        index: 0,
        delta: { type: "input_json_delta", partial_json: '"42"}' },
      }),
      streamed({ type: CONTENT_BLOCK_STOP, index: 0 }),
      streamed({ type: "message_stop" }),
    ]);
    expect(events.map((event) => event.type)).toEqual([
      "start",
      "toolcall_start",
      "toolcall_delta",
      "toolcall_delta",
      "toolcall_end",
      "done",
    ]);
    expect(context.turnBlocks).toEqual([
      { type: "toolCall", id: "call-1", name: "write_answer", arguments: { answer: "42" } },
    ]);
    expect(context.turnToolCallIds).toEqual(["call-1"]);
    expect(context.turnOutput?.stopReason).toBe("toolUse");
    expect(events.at(-1)?.reason).toBe("toolUse");
    // The MCP handler now holds the SDK generator until pi delivers the result.
    expect(context.currentPiStream).toBeNull();
    expect(ended()).toBe(true);
  });

  it("keeps the last parsable arguments when the tool input never completes", async () => {
    const { context } = await drive([
      streamed({
        type: CONTENT_BLOCK_START,
        index: 0,
        content_block: { type: TOOL_USE, id: "call-1", name: MCP_WRITE, input: { answer: "draft" } },
      }),
      streamed({
        type: CONTENT_BLOCK_DELTA,
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"answer":' },
      }),
      streamed({ type: CONTENT_BLOCK_STOP, index: 0 }),
    ]);
    expect(context.turnBlocks).toEqual([expect.objectContaining({ arguments: { answer: "draft" } })]);
  });

  it("renames the CLI's file argument and gives bash the timeout pi has no default for", async () => {
    const call = async (name: string, input: Record<string, string>) => {
      const { context } = await drive(
        [
          streamed({
            type: CONTENT_BLOCK_START,
            index: 0,
            content_block: { type: TOOL_USE, id: "c", name, input },
          }),
          streamed({ type: CONTENT_BLOCK_STOP, index: 0 }),
        ],
        {
          toPi: new Map([
            ["mcp__custom-tools__bash", "bash"],
            ["Read", "read"],
            ["Edit", "edit"],
          ]),
        },
      );
      return context.turnBlocks[0];
    };
    expect(await call("Read", { file_path: "/a" })).toEqual(
      expect.objectContaining({ name: "read", arguments: { path: "/a" } }),
    );
    expect(await call("Edit", { file_path: "/a", old_string: "x", new_string: "y" })).toEqual(
      expect.objectContaining({ arguments: { path: "/a", oldText: "x", newText: "y" } }),
    );
    expect(await call("mcp__custom-tools__bash", { command: "ls" })).toEqual(
      expect.objectContaining({ name: "bash", arguments: { command: "ls", timeout: 120 } }),
    );
  });

  it("leaves a CLI-owned builtin out of the streamed turn as well", async () => {
    const seen: string[] = [];
    const { context, events } = await drive(
      [
        streamed({
          type: CONTENT_BLOCK_START,
          index: 0,
          content_block: {
            type: TOOL_USE,
            id: "call-1",
            name: "WebSearch",
            input: { query: "public fact" },
          },
        }),
        ...textBlock(1, [FACT]),
        streamed({ type: "message_stop" }),
      ],
      { settings: { builtinTools: ["WebSearch"], onBuiltinTool: (call) => seen.push(call.name) } },
    );
    expect(seen).toEqual(["WebSearch"]);
    expect(context.turnBlocks).toEqual([{ type: "text", text: FACT }]);
    expect(context.turnSawToolCall).toBe(false);
    expect(events.map((event) => event.type)).not.toContain("toolcall_start");
  });

  it("records the stop reason and the final usage from message_delta", async () => {
    const { context } = await drive([
      ...textBlock(0, ["done"]),
      streamed({
        type: "message_delta",
        delta: { stop_reason: "max_tokens" },
        usage: { output_tokens: 7, cache_read_input_tokens: 5 },
      }),
    ]);
    expect(context.turnOutput?.stopReason).toBe("length");
    expect(context.turnOutput?.usage.output).toBe(7);
    expect(context.turnOutput?.usage.cacheRead).toBe(5);
    expect(context.turnOutput?.usage.totalTokens).toBe(12);
  });

  it("ignores a delta for a block it never opened, and one whose kind does not match", async () => {
    const { context, events } = await drive([
      streamed({ type: CONTENT_BLOCK_START, index: 0, content_block: { type: "text" } }),
      streamed({ type: CONTENT_BLOCK_DELTA, index: 9, delta: { type: "text_delta", text: "lost" } }),
      streamed({
        type: CONTENT_BLOCK_DELTA,
        index: 0,
        delta: { type: "thinking_delta", thinking: "wrong kind" },
      }),
      streamed({ type: CONTENT_BLOCK_STOP, index: 0 }),
    ]);
    expect(context.turnBlocks).toEqual([{ type: "text", text: "" }]);
    expect(events.map((event) => event.type)).toEqual(["start", "text_start", "text_end"]);
  });

  it("stops writing to a stream a tool call already closed", async () => {
    const { context, events } = await drive([
      streamed({
        type: CONTENT_BLOCK_START,
        index: 0,
        content_block: { type: TOOL_USE, id: "call-1", name: MCP_WRITE, input: { answer: "42" } },
      }),
      streamed({ type: CONTENT_BLOCK_STOP, index: 0 }),
      streamed({ type: "message_stop" }),
      ...textBlock(1, ["arriving late"]),
    ]);
    expect(events.at(-1)?.type).toBe("done");
    expect(context.turnBlocks).toHaveLength(1);
  });

  it("falls back to the result text only when no stream event carried the turn", async () => {
    const { events } = await drive([{ type: "result", subtype: "success", result: FACT, modelUsage: {} }]);
    expect(events.map((event) => event.type)).toEqual(["start", "text_start", "text_delta", "text_end"]);
    expect(events.at(-1)?.content).toBe(FACT);

    const streamedTurn = await drive([
      ...textBlock(0, ["streamed answer"]),
      { type: "result", subtype: "success", result: FACT, modelUsage: {} },
    ]);
    expect(streamedTurn.context.turnBlocks).toEqual([{ type: "text", text: "streamed answer" }]);

    // After a tool result the SDK carries the turn as one assistant message, with no stream event.
    const completedTurn = await drive([
      { type: "assistant", message: { id: "answer", content: [{ type: "text", text: FACT }] } },
      { type: "result", subtype: "success", result: FACT, modelUsage: {} },
    ]);
    expect(completedTurn.context.turnBlocks).toEqual([{ type: "text", text: FACT }]);
  });

  // A refusal arrives as a result with is_error set, often with subtype "success" and the refusal
  // as its text. Read as the answer, it settled a dead provider as completed turns.
  it("fails the turn on an error result instead of answering with its text", async () => {
    const { context, events, ended } = await drive([
      {
        type: "result",
        subtype: "success",
        is_error: true,
        api_error_status: 429,
        result: "You've hit your limit · resets 6:30pm (Europe/Amsterdam)",
        modelUsage: {},
      },
    ]);
    expect(events.map((event) => event.type)).toEqual(["error"]);
    expect(ended()).toBe(true);
    expect(context.turnOutput?.stopReason).toBe("error");
    expect(context.turnOutput?.errorMessage).toBe(
      "Claude Code returned an error result: You've hit your limit · resets 6:30pm (Europe/Amsterdam) (status 429)",
    );
    expect(context.turnBlocks).toEqual([]);

    const failed = await drive([
      {
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        errors: [" overloaded ", ""],
        modelUsage: {},
      },
    ]);
    expect(failed.context.turnOutput?.errorMessage).toBe("Claude Code returned an error result: overloaded");
  });
});

describe("the Pi Claude bridge CLI-owned builtin boundary", () => {
  /** One assistant message carrying a tool call and the answer that follows it. */
  const driveToolCall = async (name: string, settings: BridgeProviderSettings) => {
    const { context } = await drive(
      [
        {
          type: "assistant",
          message: {
            id: "msg-builtin",
            model: "claude-opus-5",
            content: [
              { type: TOOL_USE, id: "call-1", name, input: { query: "public fact" } },
              { type: "text", text: FACT },
            ],
          },
        },
      ],
      { settings },
    );
    return context;
  };

  // The CLI runs its own builtin and receives the result inside its own loop, and that result is
  // gone with the worker's configuration directory; so the call is reported to the host observer
  // for the Built trace, and kept out of pi, which would reject a tool that already ran.
  it.each<{
    tool: string;
    builtins: string[];
    observed: string[];
    blocks: Array<"text" | "toolCall">;
    toPi: string[];
    stop: StopReason;
  }>([
    {
      tool: "WebSearch",
      builtins: ["WebSearch"],
      observed: ["WebSearch"],
      blocks: ["text"],
      toPi: [],
      stop: "stop",
    },
    {
      tool: MCP_WRITE,
      builtins: ["WebSearch"],
      observed: [],
      blocks: ["toolCall", "text"],
      toPi: ["call-1"],
      stop: "toolUse",
    },
    {
      tool: MCP_WRITE,
      builtins: [],
      observed: [],
      blocks: ["toolCall", "text"],
      toPi: ["call-1"],
      stop: "toolUse",
    },
  ])("routes $tool with CLI builtins $builtins to Pi only when the CLI does not own it", async (row) => {
    const seen: Array<{ name: string; id: string; input: unknown }> = [];
    const context = await driveToolCall(row.tool, {
      builtinTools: row.builtins,
      onBuiltinTool: (call) => seen.push(call),
    });
    expect(seen).toEqual(
      row.observed.map((name) => ({ name, id: "call-1", input: { query: "public fact" } })),
    );
    expect(context.turnBlocks.map((block) => block.type)).toEqual(row.blocks);
    expect(context.turnSawToolCall).toBe(row.toPi.length > 0);
    expect(context.turnToolCallIds).toEqual(row.toPi);
    expect(context.turnOutput?.stopReason).toBe(row.stop);
  });

  it("leaves a call the CLI cannot route to the CLI, so the model's next valid call still reaches Pi", async () => {
    // The CLI answers a bare `bash` with "No such tool available" and the model retries through the
    // MCP tool. Forwarding the bare call would run it in pi and close the stream, so the retry would
    // never reach pi and its handler would wait until the silence wall.
    const assistant = (id: string, name: string) => ({
      type: "assistant",
      message: {
        id: "msg-" + id,
        model: "claude-opus-5",
        content: [{ type: TOOL_USE, id, name, input: { command: "sleep 1" } }],
      },
    });
    const { context } = await drive([
      assistant("call-bare", "bash"),
      assistant("call-mcp", "mcp__custom-tools__bash"),
    ]);
    expect(context.turnToolCallIds).toEqual(["call-mcp"]);
    expect(context.turnBlocks).toEqual([
      expect.objectContaining({ type: "toolCall", id: "call-mcp", name: "bash" }),
    ]);
    expect(context.turnOutput?.stopReason).toBe("toolUse");
  });
});

describe("the Pi Claude bridge delivers one turn translation on both paths", () => {
  /** Consecutive deltas of one kind fold together, so a block split into three chunks and the
   *  same block delivered whole read as the same event. */
  function summarize(events: readonly PiEvent[]): string[] {
    const folded: string[] = [];
    let open: string | null = null;
    for (const event of events) {
      if (event.type.endsWith("_delta") && event.type !== "toolcall_delta") {
        const tag = `${event.type}#${String(event.contentIndex)}`;
        if (open === tag) {
          folded[folded.length - 1] = `${String(folded.at(-1))}${event.delta ?? ""}`;
          continue;
        }
        open = tag;
        folded.push(`${tag} ${event.delta ?? ""}`);
        continue;
      }
      open = null;
      // The streamed path also reports the tool input arriving as partial JSON; the whole-block
      // path has the input already, so that one event is the only difference between them.
      if (event.type !== "toolcall_delta") folded.push(`${event.type}#${String(event.contentIndex)}`);
    }
    return folded;
  }

  const blocks = [
    { type: "thinking", thinking: "weigh it", signature: "sig" },
    { type: "text", text: FACT },
    { type: TOOL_USE, id: "call-1", name: MCP_WRITE, input: { answer: "42" } },
  ];

  it("emits the same events and leaves the same blocks whether the SDK streams or completes them", async () => {
    const whole = await drive([
      { type: "assistant", message: { id: "msg-1", model: "claude-opus-5", content: blocks } },
    ]);
    const delta = (index: number, value: NonNullable<SdkStreamEvent["delta"]>) =>
      streamed({ type: CONTENT_BLOCK_DELTA, index, delta: value });
    const piecemeal = await drive([
      streamed({ type: "message_start", message: { id: "msg-1", model: "claude-opus-5" } }),
      streamed({ type: CONTENT_BLOCK_START, index: 0, content_block: { type: "thinking" } }),
      delta(0, { type: "thinking_delta", thinking: "weigh " }),
      delta(0, { type: "thinking_delta", thinking: "it" }),
      delta(0, { type: "signature_delta", signature: "sig" }),
      streamed({ type: CONTENT_BLOCK_STOP, index: 0 }),
      streamed({ type: CONTENT_BLOCK_START, index: 1, content_block: { type: "text" } }),
      delta(1, { type: "text_delta", text: "the fact " }),
      delta(1, { type: "text_delta", text: "is 42" }),
      streamed({ type: CONTENT_BLOCK_STOP, index: 1 }),
      streamed({ type: CONTENT_BLOCK_START, index: 2, content_block: blocks[2]! }),
      streamed({ type: CONTENT_BLOCK_STOP, index: 2 }),
      streamed({ type: "message_stop" }),
    ]);

    expect(summarize(piecemeal.events)).toEqual(summarize(whole.events));
    expect(piecemeal.context.turnBlocks).toEqual(whole.context.turnBlocks);
    expect(piecemeal.context.turnOutput?.responseId).toBe(whole.context.turnOutput?.responseId);
    expect(piecemeal.context.turnOutput?.responseModel).toBe(whole.context.turnOutput?.responseModel);
    expect(piecemeal.context.turnOutput?.stopReason).toBe(whole.context.turnOutput?.stopReason);
    expect(piecemeal.context.turnToolCallIds).toEqual(whole.context.turnToolCallIds);
    expect(piecemeal.context.currentPiStream).toBeNull();
    expect(whole.context.currentPiStream).toBeNull();
  });
});
