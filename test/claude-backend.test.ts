// The Claude backend replayed against Claude Code streams pi-claude-bridge recorded (e870bc89, MIT:
// tests/fixtures/sdk-streams/, copied verbatim into test/fixtures/claude-sdk-streams/). The recording
// served its tools as `mcp__custom-tools__*`; the replay renames them to this backend's `mcp__pi__*`.
import { describe, expect, it, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Options, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  type Api,
  type AssistantMessage,
  type Message,
  type Model,
  normalizeContext,
  type ThinkingLevel,
  Type,
} from "@earendil-works/pi-ai";
import { dollars, freezePrices, priceKey, tokensOf } from "../src/kernel/meter.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";

interface Call {
  options: Options;
  prompts: SDKUserMessage[];
  pumpFailure?: unknown;
}

const FIXTURES = join(import.meta.dir, "fixtures", "claude-sdk-streams");
const read = { name: "read", description: "Read a file", parameters: Type.Object({ path: Type.String() }) };
const opening: Message = { role: "user", content: "Read the three files.", timestamp: 0 };
const calls: Call[] = [];
let replay: SDKMessage[] = [];

await mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  query: ({ prompt, options }: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => {
    const call: Call = { options, prompts: [] };
    calls.push(call);
    // Stands in for the SDK's stdin pump, which is what acknowledges each prompt push.
    pump(prompt, call.prompts).catch((cause: unknown) => {
      call.pumpFailure = cause;
    });
    return (async function* () {
      yield* replay;
    })();
  },
}));

const { claudeProvider, REPORTED_COST } = await import("../src/backends/claude.ts");
const provider = claudeProvider();
// The model the fixtures were recorded on, so its list prices are the ones Claude Code billed.
const haiku = provider.getModels().find((entry) => entry.id === "claude-haiku-4-5");
if (haiku === undefined) throw new Error("pi's Anthropic catalog has no claude-haiku-4-5");
const recorded: Model<Api> = haiku;

async function pump(prompt: AsyncIterable<SDKUserMessage>, into: SDKUserMessage[]): Promise<void> {
  for await (const message of prompt) into.push(message);
}

function load(name: string): SDKMessage[] {
  return readFileSync(join(FIXTURES, name), "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      // SAFETY: each line is one SDK message Claude Code emitted, as the upstream recorder wrote it.
      return JSON.parse(line.replaceAll("mcp__custom-tools__", "mcp__pi__")) as SDKMessage;
    });
}

function turn(messages: Message[], reasoning?: ThinkingLevel): Promise<AssistantMessage> {
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
    replay = load("parallel-tools.jsonl");
    const first = await turn([opening], "high");
    expect(first.stopReason).toBe("toolUse");
    const toolCalls = first.content.filter((block) => block.type === "toolCall");
    expect(toolCalls.map((block) => block.name)).toEqual(["read", "read", "read"]);
    expect(first.usage.output).toBeGreaterThan(0);
    expect(first.responseModel).toBe("claude-haiku-4-5-20251001");

    const call = calls.at(-1);
    expect(call?.options.tools).toEqual([]);
    expect(call?.options.allowedTools).toEqual(["mcp__pi__read"]);
    expect(call?.options.effort).toBe("high");
    expect(call?.options.systemPrompt).toBe("You are a solver.");
    expect(call?.prompts[0]?.message.content).toBe("Read the three files.");

    const second = await turn([opening, first, ...answered(first)]);
    expect(second.stopReason).toBe("stop");
    expect(second.content.some((block) => block.type === "text" && block.text.length > 0)).toBe(true);
    expect(call?.pumpFailure).toBeUndefined();
  });

  it("bills the turns' token classes at what Claude Code reported the query cost", async () => {
    const prices = freezePrices([haiku]);
    for (const [fixture, reported] of [
      ["text.jsonl", 0.020421],
      ["parallel-tools.jsonl", 0.0056776],
    ] as const) {
      replay = load(fixture);
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

  it("refuses a second prompt once Claude Code holds the conversation", async () => {
    replay = load("text.jsonl");
    const answer = await turn([opening]);
    expect(answer.stopReason).toBe("stop");
    const follow: Message = { role: "user", content: "Again.", timestamp: 0 };
    const refused = await turn([opening, answer, follow]);
    expect(refused.stopReason).toBe("error");
    expect(refused.errorMessage).toContain("one prompt");
  });
});
