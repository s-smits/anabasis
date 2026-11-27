import { afterAll, describe, expect, it } from "bun:test";
import {
  type Api,
  type AssistantMessage,
  createModels,
  type Message,
  type Model,
  normalizeContext,
  type ThinkingLevel,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  CLAUDE_COMPACTED,
  type ClaudeOptions,
  claudeCompactionMode,
  claudeLedger,
  claudeProvider,
  claudeSpendNow,
  servedByClaude,
  SWEEP_COMPACT_WINDOW,
} from "../src/agent/backends/claude.ts";
import { CLAUDE_PROJECT_DIR } from "../src/agent/backends/claude-transcript.ts";
import { runAgent } from "../src/agent/session.ts";
import type { Spent } from "../src/kernel/meter.ts";
import {
  existsSync,
  lstatSync,
  mkdirSync,
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
import { claimed } from "../src/sandbox/sandbox-root.ts";

interface Launch {
  argv: string[];
  env: JsonObject;
  stdin: JsonObject[];
  cwd: string;
}

const FIXTURES = join(import.meta.dir, "fixtures", "claude-sdk-streams");
const FAKE = join(import.meta.dir, "fixtures", "fake-claude-cli.ts");
const TEXT = "text.jsonl";
const PARALLEL = "parallel-tools.jsonl";
const READ_TOOL = { name: "read", description: "Read", parameters: Type.Object({ path: Type.String() }) };
const OPENING: Message = { role: "user", content: "Read the three files.", timestamp: 0 };
const ZERO_USAGE = {
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
const EMPTY_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
const STALL_MS = 60_000;

const root = mkdtempSync(join(tmpdir(), "ana-claude-backend-"));
const executable = join(root, "claude");
writeFileSync(executable, `#!/bin/sh\nexec '${runtimeProcess.execPath}' '${FAKE}' "$@"\n`, { mode: 0o755 });
afterAll(() => rmSync(root, { recursive: true, force: true }));

const catalog = claudeProvider({ executable, compaction: "off", home: root }).getModels();
const modelOf = (id: string): Model<Api> => {
  const found = catalog.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`missing model ${id}`);
  return found;
};
const haiku = modelOf("claude-haiku-4-5");
const opus = modelOf("claude-opus-5-5");
let seq = 0;

const ctx = (messages: Message[]) =>
  normalizeContext({ systemPrompt: "You are a solver.", messages, tools: [READ_TOOL] });

const flag = (launch: Launch, name: string): string | undefined => {
  const at = launch.argv.indexOf(name);
  return at === -1
    ? launch.argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1)
    : launch.argv[at + 1];
};

function patchLast(raw: string, patch: JsonObject, prefix = ""): string {
  const lines = raw.trim().split("\n");
  const last = asRecord(capturedJsonParse(lines.pop() ?? ""));
  if (last?.type !== "result") throw new Error("recording does not end on result");
  const added = prefix === "" ? [] : [prefix];
  return `${[...lines, ...added, JSON.stringify({ ...last, ...patch })].join("\n")}\n`;
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

function readLaunch(home: string): Launch {
  const launch: Launch = { argv: [], env: {}, stdin: [], cwd: "" };
  const rows = readFileSync(join(home, "launch.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => asRecord(capturedJsonParse(line)) ?? {});
  const last = rows.findLast((row) => Array.isArray(row.argv))?.pid;
  for (const row of rows.filter(({ pid }) => pid === last)) {
    if (isString(row.cwd)) launch.cwd = row.cwd;
    if (Array.isArray(row.argv)) launch.argv = row.argv.filter(isString);
    launch.env = asRecord(row.env) ?? launch.env;
    const sent = asRecord(row.stdin);
    if (sent !== null) launch.stdin.push(sent);
  }
  return launch;
}

function modelsWith(provider: ReturnType<typeof claudeProvider>) {
  const models = createModels({
    authContext: {
      env: async (name) => (name === "CLAUDE_CODE_OAUTH_TOKEN" ? "token" : undefined),
      fileExists: async () => false,
    },
  });
  models.setProvider(provider);
  return models;
}

function sandbox(
  options: Partial<Omit<ClaudeOptions, "home">> = {},
  account = "claude",
  replayName = TEXT,
  edit: (text: string) => string = (text) => text,
) {
  const id = `s-${String((seq += 1))}`;
  const home = mkdtempSync(join(root, `${id}-`));
  const [shutdown, signal] = [new AbortController(), new AbortController()];
  writeFileSync(join(home, "launch.jsonl"), "");
  writeFileSync(join(home, "usage.jsonl"), "");
  const replay = (name = TEXT, mutate: (text: string) => string = (text) => text) =>
    writeFileSync(join(home, "replay.jsonl"), mutate(readFileSync(join(FIXTURES, name), "utf8")));
  replay(replayName, edit);
  const provider = claudeProvider(
    { executable, compaction: { window: SWEEP_COMPACT_WINDOW }, home, shutdown: shutdown.signal, ...options },
    account,
  );
  return {
    id,
    home,
    shutdown,
    signal,
    provider,
    replay,
    usage: (row: JsonObject) => writeFileSync(join(home, "usage.jsonl"), `${JSON.stringify(row)}\n`),
    launched: () => readLaunch(home),
    launches: () =>
      readFileSync(join(home, "launch.jsonl"), "utf8")
        .split("\n")
        .filter((line) => line.includes('"argv"')).length,
    turn: (
      messages: Message[],
      extra: {
        model?: Model<Api>;
        reasoning?: ThinkingLevel;
        sessionId?: string | undefined;
        apiKey?: string | undefined;
        signal?: AbortSignal;
      } = {},
    ) => {
      const target = extra.model ?? provider.getModels().find((entry) => entry.id === haiku.id) ?? haiku;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stalled = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`the turn stalled past ${String(STALL_MS)} ms`)), STALL_MS);
      });
      const result = provider
        .streamSimple(target, ctx(messages), {
          ...keyIfDefined("sessionId", "sessionId" in extra ? extra.sessionId : id),
          ...keyIfDefined("apiKey", "apiKey" in extra ? extra.apiKey : "token"),
          signal: extra.signal ?? signal.signal,
          ...keyIfDefined("reasoning", extra.reasoning),
        })
        .result();
      return Promise.race([result, stalled]).finally(() => clearTimeout(timer));
    },
  };
}

describe.concurrent("Claude provider validation and SDK 0.3.332 launch surface", () => {
  it("validates account ids, compaction window bounds, and long-context clamping", () => {
    expect([servedByClaude("claude"), servedByClaude("claude-api"), servedByClaude("openai-codex")]).toEqual([
      true,
      true,
      false,
    ]);
    expect(claudeCompactionMode("off", haiku.id)).toBe("off");
    expect(claudeCompactionMode({ window: 200_000 }, haiku.id)).toBe("autoCompactWindow=200000");
    expect(claudeCompactionMode({ window: 1_000_000 }, opus.id)).toBe("autoCompactWindow=1000000");
    expect(() => claudeCompactionMode({ window: 200_001 }, haiku.id)).toThrow("clamped");
    expect(() => claudeProvider({ executable, compaction: "off", home: root }, "claude-max")).toThrow(
      "claude-max",
    );
    for (const bad of [99_999, 1_000_001]) {
      expect(() => claudeProvider({ executable, compaction: { window: bad }, home: root })).toThrow(
        "100000 to 1000000",
      );
    }
    for (const ok of [100_000, 1_000_000]) {
      expect(() => claudeProvider({ executable, compaction: { window: ok }, home: root })).not.toThrow();
    }
  });
});

describe.concurrent("Claude SDK 0.3.332 launch surface", () => {
  it("launches Claude Code with account credentials, cwd, effort, tools, compaction, and cacheTtl", async () => {
    const workspace = mkdtempSync(join(root, "cwd-"));
    const cases: readonly [
      Partial<Omit<ClaudeOptions, "home">>,
      string,
      Model<Api>,
      ThinkingLevel | undefined,
      readonly [
        string,
        string | undefined,
        string,
        string | null,
        string,
        string | undefined,
        string | undefined,
        string | undefined,
      ],
    ][] = [
      [
        { cacheTtl: "1h" },
        "claude",
        opus,
        "xhigh",
        [`${opus.id}[1m]`, "xhigh", "WebSearch", null, "CLAUDE_CODE_OAUTH_TOKEN", "300000", undefined, "1h"],
      ],
      [
        { compaction: "off", webSearch: false, cwd: workspace, cacheTtl: "5m" },
        "claude-api",
        haiku,
        "xhigh",
        [haiku.id, "max", "", workspace, "ANTHROPIC_API_KEY", undefined, "1", "5m"],
      ],
      [
        {},
        "claude",
        haiku,
        undefined,
        [haiku.id, undefined, "WebSearch", null, "CLAUDE_CODE_OAUTH_TOKEN", "300000", undefined, undefined],
      ],
    ];
    for (const [
      opts,
      account,
      chosen,
      reasoning,
      [expModel, expEffort, expTools, expCwd, expKey, expWin, expOff, expTtl],
    ] of cases) {
      const box = sandbox(opts, account);
      try {
        const model = box.provider.getModels().find((entry) => entry.id === chosen.id) ?? chosen;
        expect(
          (await box.turn([OPENING], { model, ...keyIfDefined("reasoning", reasoning) })).errorMessage,
        ).toBeUndefined();
        const launch = box.launched();
        expect([
          flag(launch, "--model"),
          flag(launch, "--effort"),
          flag(launch, "--tools"),
          flag(launch, "--permission-mode"),
        ]).toEqual([expModel, expEffort, expTools, "bypassPermissions"]);
        expect(flag(launch, "--thinking-display")).toBe(reasoning === undefined ? undefined : "summarized");
        for (const arg of [
          "--allow-dangerously-skip-permissions",
          "--strict-mcp-config",
          "--setting-sources=",
          "--no-session-persistence",
        ]) {
          expect(launch.argv).toContain(arg);
        }
        expect(launch.env.CLAUDE_CODE_PROJECT_DIR_NAME).toBeUndefined();
        expect(realpathSync.native(launch.cwd)).toBe(realpathSync.native(expCwd ?? box.home));
        const init = asRecord(
          launch.stdin.find((line) => asRecord(line.request)?.subtype === "initialize")?.request,
        );
        expect(init).toMatchObject({
          systemPrompt: ["You are a solver."],
          skills: [],
          sdkMcpServers: ["custom-tools"],
        });
        expect(init?.appendSystemPrompt).toBeUndefined();
        expect(launch.env).toMatchObject({
          HOME: box.home,
          CLAUDE_CONFIG_DIR: join(box.home, "claude-config"),
          [expKey]: "token",
          ENABLE_CLAUDEAI_MCP_SERVERS: "0",
          CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
        });
        expect([
          launch.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW,
          launch.env.DISABLE_AUTO_COMPACT,
          launch.env.CLAUDE_CODE_PROMPT_CACHE_TTL,
        ]).toEqual([expWin, expOff, expTtl]);
      } finally {
        box.shutdown.abort();
      }
    }
  });
});

describe.concurrent("Claude turn protocol and provider error mapping", () => {
  it("handles parallel tool calls, continuation, compaction diagnostics, and ignores synthetic turns", async () => {
    const box = sandbox({}, "claude", PARALLEL);
    try {
      const first = await box.turn([OPENING], { reasoning: "high" });
      expect([first.stopReason, first.responseModel]).toEqual(["toolUse", "claude-haiku-4-5-20251001"]);
      expect(first.usage.output).toBeGreaterThan(0);
      expect(first.content.filter((b) => b.type === "toolCall").map((b) => b.name)).toEqual([
        "read",
        "read",
        "read",
      ]);
      const second = await box.turn([OPENING, first, ...answered(first)]);
      expect(second.stopReason).toBe("stop");
      box.replay(TEXT);
      const done: Message = { role: "user", content: "Done", timestamp: 0 };
      expect((await box.turn([OPENING, first, ...answered(first), second, done])).stopReason).toBe("stop");
      expect(box.launches()).toBe(1);
      expect(
        box
          .launched()
          .stdin.filter((line) => line.type === "user")
          .map((line) => [line.priority ?? null, asRecord(line.message)?.content]),
      ).toEqual([
        [null, "Read the three files."],
        [null, "Done"],
      ]);
    } finally {
      box.shutdown.abort();
    }

    const steered = sandbox({}, "claude", PARALLEL);
    try {
      const first = await steered.turn([OPENING]);
      steered.replay(TEXT);
      const second = await steered.turn([
        OPENING,
        first,
        ...answered(first),
        { role: "user", content: "Steer one", timestamp: 0 },
        { role: "user", content: [{ type: "text", text: "Steer two" }], timestamp: 0 },
      ]);
      expect(second.stopReason).toBe("stop");
      const third = await steered.turn([
        OPENING,
        first,
        ...answered(first),
        second,
        { role: "user", content: "Final one", timestamp: 0 },
        { role: "user", content: [{ type: "text", text: "Final two" }], timestamp: 0 },
      ]);
      expect(third.stopReason).toBe("stop");
      expect(
        steered
          .launched()
          .stdin.filter((line) => line.type === "user")
          .map((line) => [line.priority ?? null, asRecord(line.message)?.content]),
      ).toEqual([
        [null, "Read the three files."],
        ["next", "Steer one\n\nSteer two"],
        [null, "Final one\n\nFinal two"],
      ]);
    } finally {
      steered.shutdown.abort();
    }

    const oneTool = (text: string) =>
      text
        .split("\n")
        .filter(
          (line) =>
            !/"index":[23]\b|toolu_01NGPi3nrvstMqcxUMzqUBzc|toolu_01JCvqboLqcpnctFBRKBBszp/u.test(line),
        )
        .join("\n");
    const single = sandbox({}, "claude", PARALLEL, oneTool);
    try {
      const first = await single.turn([OPENING]);
      expect(answered(first)).toHaveLength(1);
      single.replay(TEXT);
      const steer: Message = { role: "user", content: "Steer alone", timestamp: 0 };
      const second = await single.turn([OPENING, first, ...answered(first), steer]);
      expect(second.stopReason).toBe("stop");
      const done: Message = { role: "user", content: "Done", timestamp: 0 };
      expect((await single.turn([OPENING, first, ...answered(first), steer, second, done])).stopReason).toBe(
        "stop",
      );
      expect(
        single
          .launched()
          .stdin.filter((line) => line.type === "user")
          .map((line) => [line.priority ?? null, asRecord(line.message)?.content]),
      ).toEqual([
        [null, "Read the three files."],
        ["next", "Steer alone"],
        [null, "Done"],
      ]);
    } finally {
      single.shutdown.abort();
    }

    const compact = JSON.stringify({
      type: "system",
      subtype: "compact_boundary",
      compact_metadata: { pre_tokens: 180_000, duration_ms: 2500 },
    });
    const synth = JSON.stringify({
      type: "assistant",
      parent_tool_use_id: null,
      message: { model: "<synthetic>", content: [{ type: "text", text: "ignore" }], usage: {} },
    });
    const compacted = sandbox({}, "claude", TEXT, (raw) => `${compact}\n${synth}\n${raw}`);
    try {
      const out = await compacted.turn([OPENING]);
      expect(out.stopReason).toBe("stop");
      expect(out.diagnostics).toEqual([
        expect.objectContaining({ type: CLAUDE_COMPACTED, details: { tokensBefore: 180_000, seconds: 2.5 } }),
      ]);
      expect(out.content.some((part) => part.type === "text" && part.text.includes("ignore"))).toBe(false);
    } finally {
      compacted.shutdown.abort();
    }
  });

  it("maps refusal, rate-limit error, and non-success subtypes to provider errors", async () => {
    const limit = JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", resetsAt: 1_700_000_000 },
    });
    const cases: readonly (readonly [(raw: string) => string, string])[] = [
      [(raw) => raw.replaceAll('"stop_reason":"end_turn"', '"stop_reason":"refusal"'), "refusal"],
      [(raw) => patchLast(raw, { is_error: true, result: "limited" }, limit), "limit reached|1700000000"],
      [
        (raw) => patchLast(raw, { subtype: "error_max_turns", errors: ["cap hit"] }),
        "error_max_turns: cap hit",
      ],
    ];
    for (const [mutate, expected] of cases) {
      const box = sandbox({}, "claude", TEXT, mutate);
      try {
        const failed = await box.turn([OPENING]);
        expect(failed.stopReason).toBe("error");
        expect(failed.errorMessage).toContain(expected);
      } finally {
        box.shutdown.abort();
      }
    }
  });
});

describe.concurrent("Claude pre-turn guards, interrupts, and quiet timeouts", () => {
  it("enforces pre-turn guards, concurrent-turn refusal, and quiet timeouts", async () => {
    const box = sandbox();
    try {
      expect((await box.turn([OPENING], { sessionId: undefined })).errorMessage).toContain("sessionId");
      expect((await box.turn([OPENING], { apiKey: undefined })).errorMessage).toContain("OAuth token");
      const aborted = new AbortController();
      aborted.abort();
      expect((await box.turn([OPENING], { signal: aborted.signal })).stopReason).toBe("aborted");
      const prior: AssistantMessage = {
        role: "assistant",
        content: [{ type: "text", text: "prior" }],
        api: haiku.api,
        provider: haiku.provider,
        model: haiku.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: EMPTY_COST },
        stopReason: "stop",
        timestamp: 0,
      };
      expect((await box.turn([OPENING, prior])).errorMessage).toContain("no live Claude Code query");
      expect((await box.turn([])).errorMessage).toContain("no user message to open the query with");
      const image = { type: "image", data: "", mimeType: "image/png" } as const;
      expect((await box.turn([{ role: "user", content: [image], timestamp: 0 }])).errorMessage).toContain(
        "opens a query on text alone",
      );
      expect(
        (
          await box.turn([
            OPENING,
            { ...prior, content: [{ type: "toolCall", id: "tc1", name: "read", arguments: { path: "a" } }] },
            {
              role: "toolResult",
              toolCallId: "tc1",
              toolName: "read",
              content: [{ type: "text", text: "ok" }],
              isError: false,
              timestamp: 0,
            },
          ])
        ).errorMessage,
      ).toContain("takes these tool results");
      box.shutdown.abort();
      expect((await box.turn([OPENING])).stopReason).toBe("aborted");
      expect(box.launches()).toBe(0);
    } finally {
      box.shutdown.abort();
    }

    const silent = sandbox(
      { compaction: "off", quiet: 3000 },
      "claude",
      TEXT,
      (raw) => `${raw.trim().split("\n").slice(0, -1).join("\n")}\n`,
    );
    try {
      const first = silent.turn([OPENING]);
      expect((await silent.turn([OPENING])).errorMessage).toContain("already has a turn in flight");
      const timedOut = await first;
      expect(timedOut.stopReason).toBe("error");
      expect(Number(timedOut.errorMessage?.match(/[\d.]+/)?.[0])).toBeCloseTo(3000 / 60_000, 6);
      silent.replay(TEXT);
      expect(
        (await silent.turn([OPENING, timedOut, { role: "user", content: "Again.", timestamp: 0 }]))
          .stopReason,
      ).toBe("error");
      expect(silent.launches()).toBe(1);
    } finally {
      silent.shutdown.abort();
    }
  });
});

describe.concurrent("Claude post-toolUse aborts and active request interrupts", () => {
  it("keeps the query open across post-toolUse aborts and interrupts active requests cleanly", async () => {
    const keep = sandbox({}, "claude", PARALLEL);
    try {
      const first = await keep.turn([OPENING]);
      keep.signal.abort();
      expect(
        (await keep.turn([OPENING, first, ...answered(first)], { signal: new AbortController().signal }))
          .stopReason,
      ).toBe("stop");
      expect(keep.launches()).toBe(1);
      expect(keep.launched().stdin.some((sent) => asRecord(sent.request)?.subtype === "interrupt")).toBe(
        false,
      );
    } finally {
      keep.shutdown.abort();
    }

    const script = join(root, "interrupt-cli.ts");
    writeFileSync(
      script,
      readFileSync(FAKE, "utf8").replace(
        'if (message.type === "control_request") {',
        'if (message.type === "control_request" && JSON.parse(line).request.subtype === "interrupt") { process.stdout.write(readFileSync(join(home, "interrupted.jsonl"), "utf8")); }\nif (message.type === "control_request") {',
      ),
    );
    const interruptCli = join(root, "claude-interrupt");
    writeFileSync(interruptCli, `#!/bin/sh\nexec '${runtimeProcess.execPath}' '${script}' "$@"\n`, {
      mode: 0o755,
    });
    const rawLines = readFileSync(join(FIXTURES, TEXT), "utf8").trim().split("\n");
    const resultLine = rawLines.pop() ?? "";
    const box = sandbox(
      { executable: interruptCli, compaction: "off" },
      "claude",
      TEXT,
      () => `${rawLines.join("\n")}\n`,
    );
    writeFileSync(join(box.home, "interrupted.jsonl"), `${resultLine}\n`);
    try {
      const pending = box.turn([OPENING]);
      const deadline = Date.now() + 2000;
      while (
        !readFileSync(join(box.home, "launch.jsonl"), "utf8").includes('"type":"user"') &&
        Date.now() < deadline
      ) {
        await Bun.sleep(10);
      }
      box.signal.abort();
      const first = await pending;
      expect(first.stopReason).toBe("aborted");
      box.replay(TEXT);
      expect(
        (
          await box.turn([OPENING, first, { role: "user", content: "Again.", timestamp: 0 }], {
            signal: new AbortController().signal,
          })
        ).stopReason,
      ).toBe("stop");
      expect(box.launches()).toBe(1);
    } finally {
      box.shutdown.abort();
    }
  });
});

describe.concurrent("Claude spend ledger and live spend", () => {
  it("reads served-model ledgers, drops stale results, and drains resultAtClose on shutdown", async () => {
    const box = sandbox({}, "claude", TEXT, (raw) =>
      patchLast(raw, {
        total_cost_usd: 0.75,
        modelUsage: {
          "claude-haiku-4-5-20251001": {
            ...ZERO_USAGE,
            inputTokens: 10,
            outputTokens: 47,
            cacheCreationInputTokens: 10_088,
            cacheCreationEphemeral1hInputTokens: 10_000,
            canonicalModel: "claude-haiku-4-5",
            costUSD: 0.7,
          },
          "claude-side-model": { ...ZERO_USAGE, inputTokens: 900, outputTokens: 30, costUSD: 0.05 },
        },
      }),
    );
    expect((await box.turn([OPENING])).stopReason).toBe("stop");
    box.shutdown.abort();
    expect(await claudeLedger(box.id)).toMatchObject({
      byServed: true,
      reported: 0.75,
      ledger: {
        "claude/claude-haiku-4-5": {
          input: 10,
          output: 47,
          cacheWrite: 10_088,
          cacheWrite1h: 10_000,
          dollars: 0.7,
        },
        "claude/claude-side-model": { input: 900, output: 30, dollars: 0.05 },
      },
    });
    expect(await claudeLedger(box.id)).toBeNull();
    expect(await claudeLedger("unknown")).toBeNull();

    const multi = sandbox({}, "claude", TEXT, (raw) =>
      patchLast(raw, {
        total_cost_usd: 0.1,
        modelUsage: { "claude-haiku-4-5": { ...ZERO_USAGE, inputTokens: 1, costUSD: 0.1 } },
      }),
    );
    const t1 = await multi.turn([OPENING]);
    multi.replay(TEXT, (raw) =>
      patchLast(raw, {
        total_cost_usd: 0.3,
        modelUsage: { "claude-haiku-4-5": { ...ZERO_USAGE, inputTokens: 3, costUSD: 0.3 } },
      }),
    );
    await multi.turn([OPENING, t1, { role: "user", content: "Again.", timestamp: 0 }]);
    multi.shutdown.abort();
    expect((await claudeLedger(multi.id))?.reported).toBe(0.3);

    const midTool = sandbox({}, "claude", PARALLEL);
    expect((await midTool.turn([OPENING])).stopReason).toBe("toolUse");
    midTool.shutdown.abort();
    expect((await claudeLedger(midTool.id))?.reported).toBeCloseTo(0.0056776, 10);
  });
});

describe.concurrent("Claude live spend via claudeSpendNow", () => {
  it("reads live spend via claudeSpendNow and ignores malformed or unanswered usage replies", async () => {
    const valid = sandbox();
    try {
      valid.usage({
        session: {
          total_cost_usd: 0.75,
          model_usage: {
            "claude-haiku-4-5-20251001": {
              ...ZERO_USAGE,
              inputTokens: 41_000,
              costUSD: 0.75,
              canonicalModel: "claude-haiku-4-5",
            },
          },
        },
      });
      let readNow: (() => Promise<Spent>) | undefined;
      let spent: Spent | undefined;
      const sat = await runAgent({
        models: () => modelsWith(valid.provider),
        id: valid.id,
        model: haiku,
        effort: "medium",
        system: "An examiner.",
        opening: "Begin.",
        tools: [],
        turns: [],
        stops: [],
        spending: (reader) => {
          readNow = reader;
        },
        next: async () => {
          spent = await readNow?.();
          return null;
        },
      });
      expect(sat.crash).toBeNull();
      expect(spent?.billed).toBeCloseTo((haiku.cost.input * 41_000) / 1_000_000, 10);
      expect(await claudeSpendNow("no-such-session")).toBeNull();
    } finally {
      valid.shutdown.abort();
    }

    for (const bad of [
      { error: "unsupported" },
      {},
      { silent: true },
      { session: { total_cost_usd: 1, model_usage: { m: { input_tokens: 1 } } } },
    ] as const) {
      const box = sandbox({ compaction: "off", quiet: 120 });
      try {
        box.usage(bad);
        await box.turn([OPENING]);
        expect(await claudeSpendNow(box.id)).toBeNull();
      } finally {
        box.shutdown.abort();
      }
    }
  });
});

describe.concurrent("Claude seat home claim lifecycle", () => {
  it("claims and releases a generated seat home even when Claude Code outlives close on darwin", async () => {
    const there = (path: string) => lstatSync(path, { throwIfNoEntry: false }) !== undefined;
    const runSeated = async (outlive: "yes" | "no") => {
      let [made, held] = ["", false];
      const sat = await runAgent({
        models: (own, closing) => {
          made = own;
          writeFileSync(join(own, "replay.jsonl"), readFileSync(join(FIXTURES, TEXT), "utf8"));
          if (outlive === "yes") writeFileSync(join(own, "outlive"), "");
          return modelsWith(
            claudeProvider({
              executable,
              compaction: { window: SWEEP_COMPACT_WINDOW },
              home: own,
              shutdown: closing,
            }),
          );
        },
        id: `seat-${String((seq += 1))}`,
        model: haiku,
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
    };
    const clean = await runSeated("no");
    expect(clean.held).toBe(true);
    expect([clean.made, `${clean.made}.owner`].map(there)).toEqual([false, false]);
    if (runtimeProcess.platform === "darwin") {
      const lingering = await runSeated("yes");
      await Bun.sleep(1200);
      expect(there(lingering.made)).toBe(false);
    }
  });
});

describe.concurrent("Claude SDK 0.3.332 transcript persistence and turn-k forking", () => {
  const sid = "11111111-2222-3333-4444-555555555555";
  const row = (type: string, uuid: string, extra: JsonObject = {}) =>
    JSON.stringify({ type, uuid, sessionId: sid, ...extra });
  const assistant = (uuid: string, id: string, content: JsonObject[], extra: JsonObject = {}) =>
    row("assistant", uuid, { message: { id, model: "claude-opus-5-5", content }, ...extra });
  const transcript = `${[
    row("user", "u0", { message: { role: "user", content: "Open." } }),
    assistant("a1-think", "msg_1", [{ type: "thinking", thinking: "hmm" }]),
    assistant("a1-tool", "msg_1", [{ type: "tool_use", id: "tu_1", name: "bash" }]),
    row("user", "u1-res", {
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: "ok" }] },
    }),
    row("attachment", "att-1"),
    assistant("a2-text", "msg_2", [{ type: "text", text: "Done." }]),
  ].join("\n")}\n`;

  it("persists under CLAUDE_CODE_PROJECT_DIR_NAME, forks cleanly, and never masks turns on save failure", async () => {
    const withSid = (raw: string) => raw.replaceAll(/"session_id":"[^"]+"/g, `"session_id":"${sid}"`);
    const persistDir = mkdtempSync(join(root, "persist-"));
    const writer = sandbox(
      { compaction: "off", persist: { dir: persistDir, seat: "x-1" } },
      "claude",
      TEXT,
      withSid,
    );
    const projectDir = join(writer.home, "claude-config", "projects", CLAUDE_PROJECT_DIR);
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, `${sid}.jsonl`), transcript);
    try {
      await writer.turn([OPENING]);
      const launch = writer.launched();
      expect(launch.argv).not.toContain("--no-session-persistence");
      expect(launch.env.CLAUDE_CODE_PROJECT_DIR_NAME).toBe(CLAUDE_PROJECT_DIR);
      expect(readFileSync(join(persistDir, "x-1.jsonl"), "utf8")).toBe(transcript);
      expect(capturedJsonParse(readFileSync(join(persistDir, "x-1.json"), "utf8"))).toEqual({
        seat: "x-1",
        sdkSessionId: sid,
      });
    } finally {
      writer.shutdown.abort();
    }

    const blocked = join(persistDir, "not-a-dir");
    writeFileSync(blocked, "file");
    const safeFail = sandbox(
      { compaction: "off", persist: { dir: blocked, seat: "x-bad" } },
      "claude",
      TEXT,
      withSid,
    );
    const badProject = join(safeFail.home, "claude-config", "projects", CLAUDE_PROJECT_DIR);
    mkdirSync(badProject, { recursive: true });
    writeFileSync(join(badProject, `${sid}.jsonl`), transcript);
    const turn = await safeFail.turn([OPENING]);
    expect(turn.stopReason).toBe("stop");
    safeFail.shutdown.abort();
    expect(await claudeLedger(safeFail.id)).not.toBeNull();

    const childSid = "22222222-2222-3333-4444-555555555555";
    const withChildSid = (raw: string) =>
      raw.replaceAll(/"session_id":"[^"]+"/g, `"session_id":"${childSid}"`);
    const forked = sandbox(
      {
        compaction: "off",
        fork: { transcript: join(persistDir, "x-1.jsonl"), upToTurn: 1 },
        persist: { dir: persistDir, seat: "x-fork" },
      },
      "claude",
      TEXT,
      withChildSid,
    );
    const forkedProject = join(forked.home, "claude-config", "projects", CLAUDE_PROJECT_DIR);
    mkdirSync(forkedProject, { recursive: true });
    writeFileSync(join(forkedProject, `${childSid}.jsonl`), "child-transcript\n");
    try {
      await forked.turn([{ role: "user", content: "Try non-uniform constraints.", timestamp: 0 }]);
      const launch = forked.launched();
      expect(launch.argv).toContain("--fork-session");
      expect([flag(launch, "--resume"), flag(launch, "--resume-session-at")]).toEqual([sid, "att-1"]);
      expect(launch.argv).not.toContain("--no-session-persistence");
      expect(launch.env.CLAUDE_CODE_PROJECT_DIR_NAME).toBe(CLAUDE_PROJECT_DIR);
      expect(existsSync(join(forkedProject, `${sid}.jsonl`))).toBe(true);
      expect(readFileSync(join(persistDir, "x-fork.jsonl"), "utf8")).toBe("child-transcript\n");
      expect(capturedJsonParse(readFileSync(join(persistDir, "x-fork.json"), "utf8"))).toEqual({
        seat: "x-fork",
        sdkSessionId: childSid,
      });
      expect(asRecord(launch.stdin.find((line) => line.type === "user")?.message)?.content).toBe(
        "Try non-uniform constraints.",
      );
    } finally {
      forked.shutdown.abort();
    }

    const noSidFork = sandbox(
      {
        compaction: "off",
        fork: { transcript: join(persistDir, "x-1.jsonl"), upToTurn: 1 },
        persist: { dir: persistDir, seat: "x-fork-nosid" },
      },
      "claude",
      TEXT,
      (raw) =>
        raw
          .split("\n")
          .map((entry) => {
            if (entry.trim() === "") return entry;
            const parsed = asRecord(capturedJsonParse(entry));
            if (parsed === null || !("session_id" in parsed)) return entry;
            const { session_id: _omitted, ...rest } = parsed;
            return JSON.stringify(rest);
          })
          .join("\n"),
    );
    const noSidProject = join(noSidFork.home, "claude-config", "projects", CLAUDE_PROJECT_DIR);
    mkdirSync(noSidProject, { recursive: true });
    writeFileSync(join(noSidProject, `${childSid}.jsonl`), "should-not-save\n");
    try {
      expect((await noSidFork.turn([OPENING])).stopReason).toBe("stop");
      expect(existsSync(join(persistDir, "x-fork-nosid.jsonl"))).toBe(false);
    } finally {
      noSidFork.shutdown.abort();
    }
  });
});
