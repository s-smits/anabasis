// The Claude backend replayed against Claude Code streams pi-claude-bridge recorded (e870bc89, MIT:
// tests/fixtures/sdk-streams/, copied verbatim into test/fixtures/claude-sdk-streams/). The recording
// served its tools as `mcp__custom-tools__*`, as v1 and this backend do. Each test is its own solve,
// whose signal ends the query it left open. The real Agent SDK runs; the binary it launches is test/fixtures/fake-claude-cli.ts, passed the way
// the host passes the real one, which plays the stream back and records what the SDK launched it with.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
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
  CLAUDE_COMPACTED,
  type ClaudeCompaction,
  claudeEffort,
  claudeProvider,
  REPORTED_COST,
  reportedCost,
  SWEEP_COMPACT_WINDOW,
} from "../src/backends/claude.ts";
import { read as readLog } from "../src/kernel/log.ts";
import { dollars, freezePrices, priceKey, tokensOf } from "../src/kernel/meter.ts";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { capturedJsonParse } from "../src/meta/json-runtime.ts";
import { asRecord, isString, type JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { traceSink } from "../src/solve/run.ts";

/** What one launch of the CLI saw: its arguments, its environment and the SDK's lines to it. */
interface Launch {
  argv: string[];
  env: JsonObject;
  stdin: JsonObject[];
  cwd: string;
}

/** A recorded stream of one turn that answers in text. */
const TEXT = "text.jsonl";
const FIXTURES = join(import.meta.dir, "fixtures", "claude-sdk-streams");
const read = { name: "read", description: "Read a file", parameters: Type.Object({ path: Type.String() }) };
const opening: Message = { role: "user", content: "Read the three files.", timestamp: 0 };
const home = mkdtempSync(join(tmpdir(), "ana-claude-backend-"));
// The binary the SDK launches: a launcher that runs the fake under this Bun, since the `bun` on PATH may
// be a shim that looks under HOME, which here is the solve's own.
const executable = join(home, "claude");
const fake = join(import.meta.dir, "fixtures", "fake-claude-cli.ts");
writeFileSync(executable, `#!/bin/sh\nexec '${runtimeProcess.execPath}' '${fake}' "$@"\n`, { mode: 0o755 });
const sweep = claudeProvider({ executable, compaction: { window: SWEEP_COMPACT_WINDOW }, home });
// The model the fixtures were recorded on, so its list prices are the ones Claude Code billed.
const haiku = sweep.getModels().find((entry) => entry.id === "claude-haiku-4-5");
if (haiku === undefined) throw new Error("pi's Anthropic catalog has no claude-haiku-4-5");
const recorded: Model<Api> = haiku;

let solve = new AbortController();
let solves = 0;
beforeEach(() => {
  writeFileSync(join(home, "launch.jsonl"), "");
  solve = new AbortController();
  solves += 1;
});
afterEach(() => {
  solve.abort();
});

/** The options of one turn of this test's solve. */
function solveOptions() {
  return { sessionId: `solve-${String(solves)}`, apiKey: "token", signal: solve.signal };
}

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

function replay(name: string, edit: (text: string) => string = (text) => text): void {
  const text = readFileSync(join(FIXTURES, name), "utf8");
  writeFileSync(join(home, "replay.jsonl"), edit(text));
}

/** The one launch since the test began: the last to start, since the launch of the test before may
 *  still be writing what its close sent it. */
function launched(): Launch {
  const launch: Launch = { argv: [], env: {}, stdin: [], cwd: "" };
  const entries = readFileSync(join(home, "launch.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => asRecord(capturedJsonParse(line)) ?? {});
  const last = entries.findLast((entry) => Array.isArray(entry.argv))?.pid;
  for (const entry of entries.filter(({ pid }) => pid === last)) {
    const { argv, env, stdin, cwd } = entry;
    if (isString(cwd)) launch.cwd = cwd;
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
  const provider = compaction === undefined ? sweep : claudeProvider({ executable, compaction, home });
  const context = normalizeContext({ systemPrompt: "You are a solver.", messages, tools: [read] });
  const options = { ...solveOptions(), ...keyIfDefined("reasoning", reasoning) };
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

  it("launches Claude Code as the sweep did but for its prompt, with the pi tools alone and nothing of the host's", async () => {
    replay(TEXT);
    await turn([opening], "high");
    const launch = launched();
    expect(flag(launch, "--model")).toBe("claude-haiku-4-5");
    expect(flag(launch, "--effort")).toBe("high");
    // v1's options (provider.ts:384-450 at 7af7315): WebSearch beside the pi tools, permissions
    // bypassed, thinking summarized under an effort.
    expect(flag(launch, "--tools")).toBe("WebSearch");
    expect(flag(launch, "--allowedTools")).toBeUndefined();
    expect(flag(launch, "--permission-mode")).toBe("bypassPermissions");
    expect(launch.argv).toContain("--allow-dangerously-skip-permissions");
    expect(flag(launch, "--thinking-display")).toBe("summarized");
    // Claude Code writes its cwd and git state into its prompt; its home is outside any repository.
    expect(realpathSync.native(launch.cwd)).toBe(realpathSync.native(home));
    expect(launch.argv).toContain("--strict-mcp-config");
    expect(launch.argv).toContain("--setting-sources=");
    // The session's prompt is the whole prompt: Claude Code's own, which the sweep's solver read
    // first, describes tools no session here has.
    const init = asRecord(
      launch.stdin.find((line) => asRecord(line.request)?.subtype === "initialize")?.request,
    );
    expect(init?.systemPrompt).toEqual(["You are a solver."]);
    expect(init?.appendSystemPrompt).toBeUndefined();
    expect(init?.skills).toEqual([]);
    expect(init?.sdkMcpServers).toEqual(["custom-tools"]);
    const { env } = launch;
    expect(env.CLAUDE_CONFIG_DIR).toBe(join(home, "claude-config"));
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("token");
    expect(env.ENABLE_CLAUDEAI_MCP_SERVERS).toBe("0");
    expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe("300000");
    expect(env.DISABLE_AUTO_COMPACT).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  // An Examiner and a reviewer run on the host's tools alone; a solver and a Builder keep the CLI's
  // search beside them.
  it("sends a session no built-in tool when the options say so", async () => {
    const context = normalizeContext({
      systemPrompt: "You are the Examiner.",
      messages: [opening],
      tools: [read],
    });
    const started = async (webSearch: boolean) => {
      replay(TEXT);
      const provider = claudeProvider({ executable, compaction: "off", home, webSearch });
      const options = { ...solveOptions(), sessionId: `own-${String(solves)}-${String(webSearch)}` };
      await provider.streamSimple(recorded, context, options).result();
      const launch = launched();
      const init = asRecord(
        launch.stdin.find((line) => asRecord(line.request)?.subtype === "initialize")?.request,
      );
      return {
        tools: flag(launch, "--tools"),
        system: init?.systemPrompt,
        appended: init?.appendSystemPrompt,
      };
    };
    expect(await started(false)).toEqual({
      tools: "",
      system: ["You are the Examiner."],
      appended: undefined,
    });
    writeFileSync(join(home, "launch.jsonl"), "");
    expect(await started(true)).toEqual({
      tools: "WebSearch",
      system: ["You are the Examiner."],
      appended: undefined,
    });
  });

  it("asks for the long-context id of a model the sweep ran at a million tokens", async () => {
    const context = normalizeContext({
      systemPrompt: "You are a solver.",
      messages: [opening],
      tools: [read],
    });
    for (const id of ["claude-opus-5", "claude-opus-5-5", "claude-sonnet-5-5"]) {
      replay(TEXT);
      const model = sweep.getModels().find((entry) => entry.id === id);
      if (model === undefined) throw new Error(`pi's Anthropic catalog has no ${id}`);
      await sweep.streamSimple(model, context, { ...solveOptions(), sessionId: `solve-${id}` }).result();
      expect(flag(launched(), "--model")).toBe(`${id}[1m]`);
    }
  });

  // Which account spends is the operator's to name. An API key is a provider of its own, so the
  // name is on the command line and in every condition, and a key in the host's environment never
  // reaches a solve asked of the login.
  it("hands Claude Code the one credential of the account its provider names", async () => {
    const onKey = claudeProvider({ executable, compaction: { window: 300_000 }, home }, "claude-api");
    const model = onKey.getModels().find(({ id }) => id === recorded.id);
    if (model === undefined) throw new Error(`the catalog has no ${recorded.id}`);
    expect(model.provider).toBe("claude-api");
    replay(TEXT);
    const context = normalizeContext({
      systemPrompt: "You are a solver.",
      messages: [opening],
      tools: [read],
    });
    const said = await onKey.streamSimple(model, context, { ...solveOptions(), apiKey: "key" }).result();
    expect(said.errorMessage).toBeUndefined();
    const { env } = launched();
    expect(env.ANTHROPIC_API_KEY).toBe("key");
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    // The rest of the CLI's environment is the login's: its own configuration, its compaction.
    expect(env.CLAUDE_CONFIG_DIR).toBe(join(home, "claude-config"));
    expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe("300000");
    expect(() => claudeProvider({ executable, compaction: "off", home }, "claude-max")).toThrow(
      "claude-max is no account of the Claude backend",
    );
  });

  it("switches Claude Code's compaction off when the condition says off, and refuses a window it would drop", async () => {
    replay(TEXT);
    await turn([opening], undefined, "off");
    const { env } = launched();
    expect(env.DISABLE_AUTO_COMPACT).toBe("1");
    expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBeUndefined();
    expect(() => claudeProvider({ executable, compaction: { window: 50_000 }, home })).toThrow(
      "100000 to 1000000",
    );
  });

  it("bills the turns' token classes at what Claude Code reported the query cost", async () => {
    const prices = freezePrices([haiku]);
    for (const [fixture, reported] of [
      [TEXT, 0.020421],
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

  it("logs a compaction Claude Code ran before the turn, as v1's onCompaction read it", async () => {
    const boundary = JSON.stringify({
      type: "system",
      subtype: "compact_boundary",
      compact_metadata: { trigger: "auto", pre_tokens: 312_000, duration_ms: 4_200 },
      session_id: "00000000-0000-4000-8000-000000000001",
      uuid: "00000000-0000-4000-8000-0000000000ff",
    });
    replay(TEXT, (text) => text.replace("\n", `\n${boundary}\n`));
    const message = await turn([opening]);
    const types = message.diagnostics?.map((entry) => entry.type);
    expect(types).toEqual([CLAUDE_COMPACTED, REPORTED_COST]);
    const log = join(home, "trace.jsonl");
    traceSink(log, "solve", "s-1", () => 1)({ type: "turn_end", message, toolResults: [] });
    const compacted = readLog(log).find(({ kind }) => kind === "solve.compacted");
    expect(compacted?.data).toEqual({
      solve: "s-1",
      tokensBefore: 312_000,
      seconds: 4.2,
      usages: [],
      error: null,
    });
  });

  it("fails the turn on a refusal, so it reads as the provider's non-result and not the solver's stop", async () => {
    replay(TEXT, (text) => text.replaceAll('"stop_reason":"end_turn"', '"stop_reason":"refusal"'));
    const refused = await turn([opening]);
    expect(refused.stopReason).toBe("error");
    expect(refused.errorMessage).toContain("refusal");
  });

  // A submit ends pi's loop while Claude Code still waits on the call's result; the solve's abort,
  // not a later turn, is what ends that query. It interrupts the turn first: Claude Code left to
  // find its stdin closed goes on with the turn and asks the model again.
  it("interrupts and ends a query left open when the solve's signal aborts between turns", async () => {
    replay("parallel-tools.jsonl");
    const context = (messages: Message[]) =>
      normalizeContext({ systemPrompt: "You are a solver.", messages, tools: [read] });
    const options = solveOptions();
    const first = await sweep.streamSimple(recorded, context([opening]), options).result();
    expect(first.stopReason).toBe("toolUse");
    const interrupted = () =>
      launched().stdin.some((sent) => asRecord(sent.request)?.subtype === "interrupt");
    expect(interrupted()).toBe(false);
    solve.abort();
    for (let waited = 0; waited < 2000 && !interrupted(); waited += 20) await Bun.sleep(20);
    expect(interrupted()).toBe(true);
    const next = { ...options, signal: new AbortController().signal };
    const after = await sweep
      .streamSimple(recorded, context([opening, first, ...answered(first)]), next)
      .result();
    expect(after.errorMessage).toContain("no live Claude Code query");
  });

  // A session that ends on its own call, `finish` or `submit`, leaves the query's `result`, which
  // alone carries Claude Code's cost, to come after its last turn. On buffer (12 October) 10.19 of
  // 13.35 billed dollars had no figure of Claude Code's beside them for it.
  it("takes Claude Code's cost from the result that follows a session's last call, at its close", async () => {
    replay("parallel-tools.jsonl");
    const context = normalizeContext({
      systemPrompt: "You are a solver.",
      messages: [opening],
      tools: [read],
    });
    const options = solveOptions();
    const last = await sweep.streamSimple(recorded, context, options).result();
    expect(last.stopReason).toBe("toolUse");
    expect(last.diagnostics ?? []).toEqual([]);
    solve.abort();
    expect(await reportedCost(options.sessionId, [last])).toBeCloseTo(0.0056776, 10);
    // A turn that read its own result carries it, and no provider but Claude Code reports one.
    replay(TEXT);
    const other = new AbortController();
    const own = { ...options, sessionId: `${options.sessionId}-text`, signal: other.signal };
    const stopped = await sweep.streamSimple(recorded, context, own).result();
    other.abort();
    expect(await reportedCost(own.sessionId, [stopped])).toBeCloseTo(0.020421, 10);
    expect(await reportedCost("solve-elsewhere", [])).toBeNull();
  });

  it("takes a nudge into the live query, as v1 did (provider.ts:525-560)", async () => {
    replay(TEXT);
    const answer = await turn([opening]);
    expect(answer.stopReason).toBe("stop");
    const nudge: Message = { role: "user", content: "Again.", timestamp: 0 };
    const again = await turn([opening, answer, nudge]);
    expect(again.stopReason).toBe("stop");
    const launch = launched();
    expect(
      launch.stdin.filter((line) => line.type === "user").map((line) => asRecord(line.message)?.content),
    ).toEqual(["Read the three files.", "Again."]);
  });

  // An abort listener never fires for a signal that has already aborted, so a turn asked under one
  // launched Claude Code and ran its query to the end.
  it("starts no query for a turn whose signal has already aborted", async () => {
    replay(TEXT);
    solve.abort();
    const refused = await turn([opening]);
    expect(refused.stopReason).toBe("aborted");
    expect(refused.errorMessage).toContain("was aborted before its turn");
    const launches = readFileSync(join(home, "launch.jsonl"), "utf8")
      .trim()
      .split("\n")
      .filter((line) => line.includes('"argv"'));
    expect(launches).toEqual([]);
  });

  it("refuses a later prompt with no live query to hold the conversation", async () => {
    replay(TEXT);
    const answer = await turn([opening]);
    solve.abort();
    solve = new AbortController();
    const nudge: Message = { role: "user", content: "Again.", timestamp: 0 };
    const refused = await turn([opening, answer, nudge]);
    expect(refused.stopReason).toBe("error");
    expect(refused.errorMessage).toContain("holds this conversation");
  });

  it("asks for v1's effort: the model's own map, then the bridge's table", () => {
    const opus = sweep.getModels().find((entry) => entry.id === "claude-opus-5");
    if (opus === undefined) throw new Error("pi's Anthropic catalog has no claude-opus-5");
    expect(claudeEffort(opus, "xhigh")).toBe("xhigh");
    expect(claudeEffort(recorded, "xhigh")).toBe("max");
    expect(claudeEffort(recorded, "max")).toBeUndefined();
    expect(claudeEffort(opus, "medium")).toBe("medium");
    expect(claudeEffort(opus, "minimal")).toBe("low");
    expect(claudeEffort(opus, undefined)).toBeUndefined();
  });
});
