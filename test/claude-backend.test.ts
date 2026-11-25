// The Claude backend replayed against Claude Code streams pi-claude-bridge recorded (MIT, verbatim in
// `test/fixtures/claude-sdk-streams/`). The real Agent SDK launches `test/fixtures/fake-claude-cli.ts`,
// which plays a stream back and records its launch.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  type Api,
  type AssistantMessage,
  type Message,
  type Model,
  createModels,
  normalizeContext,
  type ThinkingLevel,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  claudeLedger,
  claudeProvider,
  claudeSpendNow,
  SWEEP_COMPACT_WINDOW,
} from "../src/agent/backends/claude.ts";
import { sit } from "../src/agent/session.ts";
import type { Spent } from "../src/kernel/meter.ts";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { capturedJsonParse } from "../src/meta/json-runtime.ts";
import { asRecord, isString, type JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { claimed } from "../src/wall/seat-root.ts";

interface Launch {
  argv: string[];
  env: JsonObject;
  stdin: JsonObject[];
  cwd: string;
}

const TEXT = "text.jsonl";
const FIXTURES = join(import.meta.dir, "fixtures", "claude-sdk-streams");
const read = { name: "read", description: "Read a file", parameters: Type.Object({ path: Type.String() }) };
const opening: Message = { role: "user", content: "Read the three files.", timestamp: 0 };
const home = mkdtempSync(join(tmpdir(), "ana-claude-backend-"));
// Runs the fake under this Bun: the `bun` on PATH may be a shim that looks under HOME, the solve's own.
const executable = join(home, "claude");
const fake = join(import.meta.dir, "fixtures", "fake-claude-cli.ts");
writeFileSync(executable, `#!/bin/sh\nexec '${runtimeProcess.execPath}' '${fake}' "$@"\n`, { mode: 0o755 });
const USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  webSearchRequests: 0,
  costUSD: 0,
  contextWindow: 200_000,
  maxOutputTokens: 32_000,
  costBasis: "list",
};
let shutdown = new AbortController();
let sweep = claudeProvider({ executable, compaction: { window: SWEEP_COMPACT_WINDOW }, home });
const haiku = sweep.getModels().find((entry) => entry.id === "claude-haiku-4-5");
if (haiku === undefined) throw new Error("pi's Anthropic catalog has no claude-haiku-4-5");
const recorded: Model<Api> = haiku;

let solve = new AbortController();
let solves = 0;
beforeEach(() => {
  writeFileSync(join(home, "launch.jsonl"), "");
  writeFileSync(join(home, "usage.jsonl"), "");
  solve = new AbortController();
  shutdown = new AbortController();
  sweep = claudeProvider({
    executable,
    compaction: { window: SWEEP_COMPACT_WINDOW },
    home,
    shutdown: shutdown.signal,
  });
  solves += 1;
});
afterEach(() => {
  shutdown.abort();
});

function solveOptions() {
  return { sessionId: `solve-${String(solves)}`, apiKey: "token", signal: solve.signal };
}

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

function resulting(text: string, total: number, modelUsage: JsonObject): string {
  const lines = text.trim().split("\n");
  const result = asRecord(capturedJsonParse(lines.pop() ?? ""));
  if (result?.type !== "result") throw new Error("the recording does not end on its result");
  return `${[...lines, JSON.stringify({ ...result, total_cost_usd: total, modelUsage })].join("\n")}\n`;
}

function replay(name: string, edit: (text: string) => string = (text) => text): void {
  const text = readFileSync(join(FIXTURES, name), "utf8");
  writeFileSync(join(home, "replay.jsonl"), edit(text));
}

/** The last launch to start: the test before's launch may still be writing what its close sent. */
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
  if (at !== -1) return launch.argv[at + 1];
  return launch.argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

function turn(messages: Message[], reasoning?: ThinkingLevel): Promise<AssistantMessage> {
  return sweep
    .streamSimple(recorded, solverContext(messages), {
      ...solveOptions(),
      ...keyIfDefined("reasoning", reasoning),
    })
    .result();
}

function solverContext(messages: Message[]) {
  return normalizeContext({ systemPrompt: "You are a solver.", messages, tools: [read] });
}

function launches(): number {
  return readFileSync(join(home, "launch.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.includes('"argv"')).length;
}

function usageAnswer(input: number, dollars: number): void {
  const used = { ...USAGE, inputTokens: input, costUSD: dollars, canonicalModel: "claude-haiku-4-5" };
  const session = { total_cost_usd: dollars, model_usage: { "claude-haiku-4-5-20251001": used } };
  writeFileSync(join(home, "usage.jsonl"), `${JSON.stringify({ session })}\n`);
}

function interrupted(): boolean {
  return launched().stdin.some((sent) => asRecord(sent.request)?.subtype === "interrupt");
}

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
    expect(flag(launch, "--tools")).toBe("WebSearch");
    expect(flag(launch, "--allowedTools")).toBeUndefined();
    expect(flag(launch, "--permission-mode")).toBe("bypassPermissions");
    expect(launch.argv).toContain("--allow-dangerously-skip-permissions");
    expect(flag(launch, "--thinking-display")).toBe("summarized");
    expect(realpathSync.native(launch.cwd)).toBe(realpathSync.native(home));
    expect(launch.argv).toContain("--strict-mcp-config");
    expect(launch.argv).toContain("--setting-sources=");
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
    expect(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe("1");
    expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe("300000");
    expect(env.DISABLE_AUTO_COMPACT).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("sends a session no built-in tool when the options say so", async () => {
    const context = normalizeContext({
      systemPrompt: "You are the Examiner.",
      messages: [opening],
      tools: [read],
    });
    for (const [webSearch, expected] of [
      [false, ""],
      [true, "WebSearch"],
    ] as const) {
      writeFileSync(join(home, "launch.jsonl"), "");
      replay(TEXT);
      const provider = claudeProvider({
        executable,
        compaction: "off",
        home,
        webSearch,
        shutdown: shutdown.signal,
      });
      const options = { ...solveOptions(), sessionId: `own-${String(solves)}-${String(webSearch)}` };
      await provider.streamSimple(recorded, context, options).result();
      const launch = launched();
      const init = asRecord(
        launch.stdin.find((line) => asRecord(line.request)?.subtype === "initialize")?.request,
      );
      expect(flag(launch, "--tools")).toBe(expected);
      expect(init?.systemPrompt).toEqual(["You are the Examiner."]);
      expect(init?.appendSystemPrompt).toBeUndefined();
      expect(launch.env.DISABLE_AUTO_COMPACT).toBe("1");
      expect(launch.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBeUndefined();
    }
  });

  // An API key is its own provider, so a host key never reaches a solve asked of the login.
  it("hands Claude Code the one credential of the account its provider names", async () => {
    const onKey = claudeProvider(
      { executable, compaction: { window: 300_000 }, home, shutdown: shutdown.signal },
      "claude-api",
    );
    const model = onKey.getModels().find(({ id }) => id === recorded.id);
    if (model === undefined) throw new Error(`the catalog has no ${recorded.id}`);
    expect(model.provider).toBe("claude-api");
    replay(TEXT);
    const context = solverContext([opening]);
    const said = await onKey.streamSimple(model, context, { ...solveOptions(), apiKey: "key" }).result();
    expect(said.errorMessage).toBeUndefined();
    const { env } = launched();
    expect(env.ANTHROPIC_API_KEY).toBe("key");
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(env.CLAUDE_CONFIG_DIR).toBe(join(home, "claude-config"));
    expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe("300000");
    expect(() => claudeProvider({ executable, compaction: "off", home }, "claude-max")).toThrow("claude-max");
  });

  it("keeps the prompt cache as long as a seat's options say, and leaves the CLI its own choice otherwise", async () => {
    const context = normalizeContext({
      systemPrompt: "You are the Examiner.",
      messages: [opening],
      tools: [read],
    });
    for (const cacheTtl of ["5m", "1h", undefined] as const) {
      replay(TEXT);
      const provider = claudeProvider({
        executable,
        compaction: "off",
        home,
        shutdown: shutdown.signal,
        ...keyIfDefined("cacheTtl", cacheTtl),
      });
      const options = { ...solveOptions(), sessionId: `ttl-${String(solves)}-${String(cacheTtl)}` };
      await provider.streamSimple(recorded, context, options).result();
      expect(launched().env.CLAUDE_CODE_PROMPT_CACHE_TTL).toBe(cacheTtl);
    }
  });

  it("fails the turn on a refusal, so it reads as the provider's non-result and not the solver's stop", async () => {
    replay(TEXT, (text) => text.replaceAll('"stop_reason":"end_turn"', '"stop_reason":"refusal"'));
    const refused = await turn([opening]);
    expect(refused.stopReason).toBe("error");
    expect(refused.errorMessage).toContain("refusal");
  });

  it("keeps the query open when a completed request aborts while its tools run", async () => {
    replay("parallel-tools.jsonl");
    const options = solveOptions();
    const first = await sweep.streamSimple(recorded, solverContext([opening]), options).result();
    expect(first.stopReason).toBe("toolUse");
    expect(interrupted()).toBe(false);
    solve.abort();
    const next = { ...options, signal: new AbortController().signal };
    const after = await sweep
      .streamSimple(recorded, solverContext([opening, first, ...answered(first)]), next)
      .result();
    expect(after.errorMessage).toBeUndefined();
    expect(after.stopReason).toBe("stop");
    expect(interrupted()).toBe(false);
    expect(launches()).toBe(1);
  });

  it("interrupts an active request and takes a later prompt in the same query", async () => {
    const script = join(home, "interrupt-cli.ts");
    writeFileSync(
      script,
      readFileSync(fake, "utf8").replace(
        'if (message.type === "control_request") {',
        `if (message.type === "control_request" && JSON.parse(line).request.subtype === "interrupt") {
        process.stdout.write(readFileSync(join(home, "interrupted.jsonl"), "utf8"));
      }
      if (message.type === "control_request") {`,
      ),
    );
    const interruptCli = join(home, "claude-interrupt");
    writeFileSync(interruptCli, `#!/bin/sh\nexec '${runtimeProcess.execPath}' '${script}' "$@"\n`, {
      mode: 0o755,
    });
    replay(TEXT, (text) => {
      const lines = text.trim().split("\n");
      const result = lines.pop();
      if (result === undefined) throw new Error("the recording has no result");
      writeFileSync(join(home, "interrupted.jsonl"), `${result}\n`);
      return `${lines.join("\n")}\n`;
    });
    const provider = claudeProvider({
      executable: interruptCli,
      compaction: "off",
      home,
      shutdown: shutdown.signal,
    });
    const options = solveOptions();
    const pending = provider.streamSimple(recorded, solverContext([opening]), options).result();
    const prompted = () => readFileSync(join(home, "launch.jsonl"), "utf8").includes('"type":"user"');
    const deadline = Date.now() + 2000;
    while (!prompted() && Date.now() < deadline) await Bun.sleep(10);
    expect(prompted()).toBe(true);
    solve.abort();
    const first = await pending;
    expect(first.stopReason).toBe("aborted");
    replay(TEXT);
    const nudge: Message = { role: "user", content: "Again.", timestamp: 0 };
    const after = await provider
      .streamSimple(recorded, solverContext([opening, first, nudge]), {
        ...options,
        signal: new AbortController().signal,
      })
      .result();
    expect(after.stopReason).toBe("stop");
    expect(launches()).toBe(1);
  });

  it("reads a query's ledger by served model from its last result, side calls and hour-long writes included", async () => {
    replay(TEXT, (text) =>
      resulting(text, 0.75, {
        "claude-haiku-4-5-20251001": {
          ...USAGE,
          inputTokens: 10,
          outputTokens: 47,
          cacheCreationInputTokens: 10_088,
          cacheCreationEphemeral1hInputTokens: 10_000,
          canonicalModel: "claude-haiku-4-5",
          costUSD: 0.7,
        },
        "claude-side-model": { ...USAGE, inputTokens: 900, outputTokens: 30, costUSD: 0.05 },
      }),
    );
    const options = solveOptions();
    const own = await sweep.streamSimple(recorded, solverContext([opening]), options).result();
    expect(own.stopReason).toBe("stop");
    shutdown.abort();
    expect(await claudeLedger(options.sessionId)).toEqual({
      byServed: true,
      reported: 0.75,
      ledger: {
        "claude/claude-haiku-4-5": {
          input: 10,
          output: 47,
          cacheRead: 0,
          cacheWrite: 10_088,
          cacheWrite1h: 10_000,
          dollars: 0.7,
        },
        "claude/claude-side-model": {
          input: 900,
          output: 30,
          cacheRead: 0,
          cacheWrite: 0,
          cacheWrite1h: 0,
          dollars: 0.05,
        },
      },
    });
    expect(await claudeLedger(options.sessionId)).toBeNull();
  });

  it("takes the ledger from the result the close brings after a session's last call, and none for a session no query served", async () => {
    replay("parallel-tools.jsonl");
    const options = solveOptions();
    const last = await sweep.streamSimple(recorded, solverContext([opening]), options).result();
    expect(last.stopReason).toBe("toolUse");
    shutdown.abort();
    const taken = await claudeLedger(options.sessionId);
    expect(taken?.reported).toBeCloseTo(0.0056776, 10);
    expect(taken?.ledger["claude/claude-haiku-4-5"]).toMatchObject({
      input: 20,
      output: 312,
      cacheRead: 19_516,
      cacheWrite: 1073,
      cacheWrite1h: 0,
    });
    for (let waited = 0; waited < 2000 && !interrupted(); waited += 20) await Bun.sleep(20);
    expect(interrupted()).toBe(true);
    expect(await claudeLedger("solve-elsewhere")).toBeNull();
  });

  it("drops a result once a later turn begins, and takes the next one", async () => {
    replay(TEXT, (text) =>
      resulting(text, 0.1, { "claude-haiku-4-5": { ...USAGE, inputTokens: 1, costUSD: 0.1 } }),
    );
    const options = solveOptions();
    const first = await sweep.streamSimple(recorded, solverContext([opening]), options).result();
    replay(TEXT, (text) =>
      resulting(text, 0.3, { "claude-haiku-4-5": { ...USAGE, inputTokens: 3, costUSD: 0.3 } }),
    );
    const nudge: Message = { role: "user", content: "Again.", timestamp: 0 };
    await sweep.streamSimple(recorded, solverContext([opening, first, nudge]), options).result();
    shutdown.abort();
    expect((await claudeLedger(options.sessionId))?.reported).toBe(0.3);
  });

  it("reads a live query's spend so far from Claude Code's own count", async () => {
    usageAnswer(41_000, 0.75);
    await turn([opening]);
    expect(await claudeSpendNow(solveOptions().sessionId)).toEqual({
      ledger: {
        "claude/claude-haiku-4-5": {
          input: 41_000,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          cacheWrite1h: 0,
          dollars: 0.75,
        },
      },
      byServed: true,
      reported: 0.75,
    });
    expect(await claudeSpendNow("no query of this process")).toBeNull();
  });

  it.each([
    ["refuses the request", { error: "unsupported" }],
    ["answers without a session", {}],
    ["never answers", { silent: true }],
    ["answers in another shape", { session: { total_cost_usd: 1, model_usage: { m: { input_tokens: 1 } } } }],
  ])("reads no spend where Claude Code %s", async (_how, answer) => {
    writeFileSync(join(home, "usage.jsonl"), `${JSON.stringify(answer)}\n`);
    const compaction = { window: SWEEP_COMPACT_WINDOW };
    sweep = claudeProvider({ executable, compaction, home, shutdown: shutdown.signal, quiet: 200 });
    await turn([opening]);
    expect(await claudeSpendNow(solveOptions().sessionId)).toBeNull();
  });

  it("hands a seat what its session has spent so far, priced from the backend's own count", async () => {
    usageAnswer(41_000, 0.75);
    const models = createModels({
      authContext: {
        env: async (name) => (name === "CLAUDE_CODE_OAUTH_TOKEN" ? "token" : undefined),
        fileExists: async () => false,
      },
    });
    models.setProvider(sweep);
    let now: (() => Promise<Spent>) | undefined;
    let soFar: Spent | undefined;
    const sat = await sit({
      models: () => models,
      id: solveOptions().sessionId,
      model: recorded,
      effort: "medium",
      system: "An examiner.",
      opening: "Begin.",
      tools: [],
      turns: [],
      stops: [],
      spending: (reader) => {
        now = reader;
      },
      next: async () => {
        soFar = await now?.();
        return null;
      },
    });
    expect(sat.crash).toBeNull();
    expect(soFar?.billed).toBeCloseTo((recorded.cost.input * 41_000) / 1_000_000, 10);
  });

  async function seated(outlive: boolean): Promise<{ made: string; held: boolean }> {
    let made = "";
    let held = false;
    const sat = await sit({
      models: (own, closing) => {
        made = own;
        writeFileSync(join(own, "replay.jsonl"), readFileSync(join(FIXTURES, TEXT), "utf8"));
        if (outlive) writeFileSync(join(own, "outlive"), "");
        const models = createModels({
          authContext: {
            env: async (name) => (name === "CLAUDE_CODE_OAUTH_TOKEN" ? "token" : undefined),
            fileExists: async () => false,
          },
        });
        models.setProvider(
          claudeProvider({
            executable,
            compaction: { window: SWEEP_COMPACT_WINDOW },
            home: own,
            shutdown: closing,
          }),
        );
        return models;
      },
      id: `seat-${String(solves)}`,
      model: recorded,
      effort: "medium",
      system: "An examiner.",
      opening: "Begin.",
      tools: [],
      turns: [],
      stops: [],
      next: async () => {
        held = claimed(made);
        return null;
      },
    });
    expect(sat.crash).toBeNull();
    return { made, held };
  }
  const there = (path: string): boolean => lstatSync(path, { throwIfNoEntry: false }) !== undefined;

  it("claims the home it makes for a seat that has none, and lets it go with the claim once the seat has sat", async () => {
    const { made, held } = await seated(false);
    expect(made).not.toBe("");
    expect(held).toBe(true);
    expect([made, `${made}.owner`].map(there)).toEqual([false, false]);
  });

  // Claude Code lives on up to three seconds after its query closes, so the home goes after the ledger
  // is read. Linux ends no process by its folder.
  it.skipIf(runtimeProcess.platform !== "darwin")(
    "leaves nothing of a Claude Code that outlives its close and writes into its home on the way out",
    async () => {
      const { made } = await seated(true);
      await Bun.sleep(1500);
      expect(there(made)).toBe(false);
    },
    20_000,
  );

  // An abort listener never fires for a signal that has already aborted.
  it("starts no query for a turn whose signal has already aborted", async () => {
    replay(TEXT);
    solve.abort();
    const refused = await turn([opening]);
    expect(refused.stopReason).toBe("aborted");
    expect(launches()).toBe(0);
  });

  // A Builder's Claude Code can be silent for hours, and the session's wall stops during host actions.
  it("fails a turn whose Claude Code falls silent for the quiet bound, and closes its query", async () => {
    replay(TEXT, (text) => `${text.trim().split("\n").slice(0, -1).join("\n")}\n`);
    sweep = claudeProvider({ executable, compaction: "off", home, shutdown: shutdown.signal, quiet: 300 });
    const silent = await turn([opening]);
    expect(silent.stopReason).toBe("error");
    expect(Number(silent.errorMessage?.match(/[\d.]+/)?.[0])).toBe(300 / 60_000);
    replay(TEXT);
    const nudge: Message = { role: "user", content: "Again.", timestamp: 0 };
    const refused = await turn([opening, silent, nudge]);
    expect(refused.stopReason).toBe("error");
    expect(launches()).toBe(1);
  });

  it("refuses same-tick and in-flight concurrent turns on one sessionId instead of deadlocking", async () => {
    replay(TEXT, (text) => `${text.trim().split("\n").slice(0, -1).join("\n")}\n`);
    sweep = claudeProvider({ executable, compaction: "off", home, shutdown: shutdown.signal, quiet: 300 });
    const options = solveOptions();
    const first = sweep.streamSimple(recorded, solverContext([opening]), options).result();
    const sameTick = await sweep.streamSimple(recorded, solverContext([opening]), options).result();
    expect(sameTick.stopReason).toBe("error");
    expect(sameTick.errorMessage).toContain("already has a turn in flight");
    await Bun.sleep(20);
    const inFlight = await sweep.streamSimple(recorded, solverContext([opening]), options).result();
    expect(inFlight.stopReason).toBe("error");
    expect(inFlight.errorMessage).toContain("already has a turn in flight");
    shutdown.abort();
    await first;
  });
});
