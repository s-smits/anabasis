// The Claude backend replayed against Claude Code streams pi-claude-bridge recorded (e870bc89, MIT:
// tests/fixtures/sdk-streams/, copied verbatim into test/fixtures/claude-sdk-streams/). The recording
// served its tools as `mcp__custom-tools__*`; the replay renames them to this backend's `mcp__pi__*`.
// The real Agent SDK runs; the binary it launches is test/fixtures/fake-claude-cli.ts, passed the way
// the host passes the real one, which plays the stream back and records what the SDK launched it with.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  type Api,
  type AssistantMessage,
  type Message,
  type Model,
  normalizeContext,
  type ThinkingLevel,
  Type,
} from "@earendil-works/pi-ai";
import {
  type ClaudeCompaction,
  claudeProvider,
  REPORTED_COST,
  SWEEP_COMPACT_WINDOW,
} from "../src/backends/claude.ts";
import { dollars, freezePrices, priceKey, tokensOf } from "../src/kernel/meter.ts";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { capturedJsonParse } from "../src/meta/json-runtime.ts";
import { asRecord, isString, type JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";

/** What one launch of the CLI saw: its arguments, its environment and the SDK's lines to it. */
interface Launch {
  argv: string[];
  env: JsonObject;
  stdin: JsonObject[];
}

const FIXTURES = join(import.meta.dir, "fixtures", "claude-sdk-streams");
const read = { name: "read", description: "Read a file", parameters: Type.Object({ path: Type.String() }) };
const opening: Message = { role: "user", content: "Read the three files.", timestamp: 0 };
const home = mkdtempSync(join(tmpdir(), "ana-claude-backend-"));
// The binary the SDK launches: a launcher that runs the fake under this Bun, since the `bun` on PATH may
// be a shim that looks under HOME, which here is the solve's own.
const executable = join(home, "claude");
const fake = join(import.meta.dir, "fixtures", "fake-claude-cli.ts");
writeFileSync(executable, `#!/bin/sh\nexec '${runtimeProcess.execPath}' '${fake}' "$@"\n`, { mode: 0o755 });
const previousHome = Bun.env.HOME;
const sweep = claudeProvider({ executable, compaction: { window: SWEEP_COMPACT_WINDOW } });
// The model the fixtures were recorded on, so its list prices are the ones Claude Code billed.
const haiku = sweep.getModels().find((entry) => entry.id === "claude-haiku-4-5");
if (haiku === undefined) throw new Error("pi's Anthropic catalog has no claude-haiku-4-5");
const recorded: Model<Api> = haiku;

beforeAll(() => {
  Bun.env.HOME = home;
});

beforeEach(() => {
  writeFileSync(join(home, "launch.jsonl"), "");
});

afterAll(() => {
  Bun.env.HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

function replay(name: string, edit: (text: string) => string = (text) => text): void {
  const text = readFileSync(join(FIXTURES, name), "utf8").replaceAll("mcp__custom-tools__", "mcp__pi__");
  writeFileSync(join(home, "replay.jsonl"), edit(text));
}

/** The one launch since the test began. */
function launched(): Launch {
  const launch: Launch = { argv: [], env: {}, stdin: [] };
  for (const line of readFileSync(join(home, "launch.jsonl"), "utf8").trim().split("\n")) {
    const entry = asRecord(capturedJsonParse(line));
    const { argv, env, stdin } = entry ?? {};
    if (Array.isArray(argv)) launch.argv = argv.filter(isString);
    launch.env = asRecord(env) ?? launch.env;
    const sent = asRecord(stdin);
    if (sent) launch.stdin.push(sent);
  }
  return launch;
}

function flag(launch: Launch, name: string): string | undefined {
  const at = launch.argv.indexOf(name);
  return at < 0 ? undefined : launch.argv[at + 1];
}

function turn(
  messages: Message[],
  reasoning?: ThinkingLevel,
  compaction?: ClaudeCompaction,
): Promise<AssistantMessage> {
  const provider = compaction === undefined ? sweep : claudeProvider({ executable, compaction });
  const context = normalizeContext({ systemPrompt: "You are a solver.", messages, tools: [read] });
  const options = { sessionId: "solve-1", apiKey: "token", ...keyIfDefined("reasoning", reasoning) };
  return provider.streamSimple(recorded, context, options).result();
}

/** The tool results pi sends back for every call in `message`. */
function answered(message: AssistantMessage): Message[] {
  return message.content
    .filter((block) => block.type === "toolCall")
    .map((block) => ({
      role: "toolResult",
      toolCallId: block.id,
      toolName: block.name,
      content: [{ type: "text", text: "contents" }],
      isError: false,
      timestamp: 0,
    }));
}

describe("the Claude backend", () => {
  it("ends a turn at the API message's stop, with every parallel tool call, then takes their results", async () => {
    replay("parallel-tools.jsonl");
    const first = await turn([opening], "high");
    expect(first.errorMessage).toBeUndefined();
    expect(first.stopReason).toBe("toolUse");
    const toolCalls = first.content.filter((block) => block.type === "toolCall");
    expect(toolCalls.map((block) => block.name)).toEqual(["read", "read", "read"]);
    expect(first.usage.output).toBeGreaterThan(0);
    expect(first.responseModel).toBe("claude-haiku-4-5-20251001");

    const second = await turn([opening, first, ...answered(first)]);
    expect(second.stopReason).toBe("stop");
    expect(second.content.some((block) => block.type === "text" && block.text.length > 0)).toBe(true);
    const prompt = launched().stdin.find((line) => line.type === "user");
    expect(asRecord(prompt?.message)?.content).toBe("Read the three files.");
  });

  it("launches Claude Code as the sweep did, with the pi tools alone and nothing of the host's", async () => {
    replay("text.jsonl");
    await turn([opening], "high");
    const launch = launched();
    expect(flag(launch, "--model")).toBe("claude-haiku-4-5");
    expect(flag(launch, "--effort")).toBe("high");
    expect(flag(launch, "--tools")).toBe("");
    expect(flag(launch, "--allowedTools")).toBe("mcp__pi__read");
    expect(flag(launch, "--permission-mode")).toBe("dontAsk");
    expect(launch.argv).toContain("--strict-mcp-config");
    expect(launch.argv).toContain("--setting-sources=");
    // The preset prompt is the CLI's own, so the SDK sends only what is appended to it.
    const init = asRecord(
      launch.stdin.find((line) => asRecord(line.request)?.subtype === "initialize")?.request,
    );
    expect(init?.appendSystemPrompt).toBe("You are a solver.");
    expect(init?.systemPrompt).toBeUndefined();
    expect(init?.skills).toEqual([]);
    expect(init?.sdkMcpServers).toEqual(["pi"]);
    const { env } = launch;
    expect(env.CLAUDE_CONFIG_DIR).toBe(join(home, "claude-config"));
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("token");
    expect(env.ENABLE_CLAUDEAI_MCP_SERVERS).toBe("0");
    expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe("300000");
    expect(env.DISABLE_AUTO_COMPACT).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("asks for the long-context id of a model the sweep ran at a million tokens", async () => {
    replay("text.jsonl");
    const opus = sweep.getModels().find((entry) => entry.id === "claude-opus-5");
    if (opus === undefined) throw new Error("pi's Anthropic catalog has no claude-opus-5");
    const context = normalizeContext({
      systemPrompt: "You are a solver.",
      messages: [opening],
      tools: [read],
    });
    await sweep.streamSimple(opus, context, { sessionId: "solve-1", apiKey: "token" }).result();
    expect(flag(launched(), "--model")).toBe("claude-opus-5[1m]");
  });

  it("switches Claude Code's compaction off when the condition says off, and refuses a window it would drop", async () => {
    replay("text.jsonl");
    await turn([opening], undefined, "off");
    const { env } = launched();
    expect(env.DISABLE_AUTO_COMPACT).toBe("1");
    expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBeUndefined();
    expect(() => claudeProvider({ executable, compaction: { window: 50_000 } })).toThrow("100000 to 1000000");
  });

  it("bills the turns' token classes at what Claude Code reported the query cost", async () => {
    const prices = freezePrices([haiku]);
    for (const [fixture, reported] of [
      ["text.jsonl", 0.020421],
      ["parallel-tools.jsonl", 0.0056776],
    ] as const) {
      replay(fixture);
      const turns = [await turn([opening])];
      for (let last = turns[0]; last?.stopReason === "toolUse"; last = turns.at(-1)) {
        turns.push(await turn([opening, last, ...answered(last)]));
      }
      const diagnostic = turns.at(-1)?.diagnostics?.find((entry) => entry.type === REPORTED_COST);
      expect(diagnostic?.details?.totalCostUsd).toBeCloseTo(reported, 10);
      const { billed } = dollars(prices, priceKey(haiku), tokensOf(turns.map((message) => message.usage)));
      expect(Math.abs(billed - reported) / reported).toBeLessThan(0.01);
    }
  });

  it("fails the turn on a refusal, so it reads as the provider's non-result and not the solver's stop", async () => {
    replay("text.jsonl", (text) => text.replaceAll('"stop_reason":"end_turn"', '"stop_reason":"refusal"'));
    const refused = await turn([opening]);
    expect(refused.stopReason).toBe("error");
    expect(refused.errorMessage).toContain("refusal");
  });

  it("refuses a second prompt once Claude Code holds the conversation", async () => {
    replay("text.jsonl");
    const answer = await turn([opening]);
    expect(answer.stopReason).toBe("stop");
    const follow: Message = { role: "user", content: "Again.", timestamp: 0 };
    const refused = await turn([opening, answer, follow]);
    expect(refused.stopReason).toBe("error");
    expect(refused.errorMessage).toContain("one prompt");
  });
});
