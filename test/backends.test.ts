import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { claudeExecutable } from "../src/agent/backends/claude.ts";
import { type BackendOptions, backends, compactionMode, retryPolicy } from "../src/agent/backends/models.ts";
import { sit } from "../src/agent/session.ts";
import { read } from "../src/kernel/log.ts";
import { traceOf } from "../src/kernel/trace.ts";
import { asRecord, type JsonValue } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";

const home = mkdtempSync(join(tmpdir(), "ana-backends-"));
const previous = Bun.env.CODEX_HOME;
const options: BackendOptions = {
  claude: { executable: claudeExecutable(), compaction: "off", home: tmpdir() },
};

beforeAll(() => {
  Bun.env.CODEX_HOME = home;
});

afterAll(() => {
  if (previous === undefined) delete Bun.env.CODEX_HOME;
  else Bun.env.CODEX_HOME = previous;
  rmSync(home, { recursive: true, force: true });
});

describe("the three backends", () => {
  const catalog = backends(options);
  it("serve Codex, OpenRouter and Claude Code from pi's catalogs", () => {
    expect(catalog.getModel("openai-codex", "gpt-6.1-sol")?.api).toBe("openai-codex-responses");
    expect(catalog.getModel("openrouter", "anthropic/claude-opus-5")).toBeDefined();
    expect(catalog.getModel("claude", "claude-opus-5")?.api).toBe("claude-agent-sdk");
    // The same backend on an API key is a provider of its own, with the same catalog and prices,
    // and it compacts as the login does.
    const [login_, key] = ["claude", "claude-api"].map((id) => catalog.getModel(id, "claude-sonnet-5-5"));
    expect(key).toMatchObject({ provider: "claude-api", api: "claude-agent-sdk", cost: login_?.cost });
    if (login_ === undefined || key === undefined) throw new Error("the catalog has no claude-sonnet-5-5");
    expect(compactionMode(key, options)).toBe(compactionMode(login_, options));
  });

  it("route a model pinned to one OpenRouter endpoint there alone, at that endpoint's price", () => {
    const dated = catalog.getModel("openrouter", "deepseek/deepseek-v4.1-flash-1017");
    expect(dated?.compat).toMatchObject({
      openRouterRouting: { only: ["deepinfra/fp8"], allow_fallbacks: false },
    });
    expect(dated?.cost).toMatchObject({ input: 0.098, output: 0.294, cacheRead: 0.00294 });
    expect(dated).toMatchObject({
      name: "DeepSeek: DeepSeek V4.1 Flash 1017",
      api: "openai-completions",
      baseUrl: "https://openrouter.ai/api/v1",
      reasoning: true,
      contextWindow: 1_048_576,
      maxTokens: 131_072,
    });
    // A model nobody pinned keeps pi's own entry, routed as OpenRouter chooses.
    // Every listing pi's collection offers holds it, as `getModel` does.
    const chat = catalog.getModelsOfType("chat", "openrouter").map(({ id }) => id);
    expect(chat).toContain("deepseek/deepseek-v4.1-flash-1017");
    const base = catalog.getModel("openrouter", "deepseek/deepseek-v4.1-flash");
    expect(base?.compat ?? {}).not.toHaveProperty("openRouterRouting");
    expect(catalog.getModel("openrouter", "deepseek/deepseek-v4.1-flash-0101")).toBeUndefined();
  });

  it("records the model Codex serves from its terminal event, leaving an absent model and backend bill unknown", async () => {
    const claims = {
      exp: Math.floor(Date.now() / 1000) + 60 * 60,
      "https://api.openai.com/auth": { chatgpt_account_id: "test-account" },
    };
    const access = ["e30", Buffer.from(JSON.stringify(claims)).toString("base64url"), "sig"].join(".");
    writeFileSync(
      join(home, "auth.json"),
      JSON.stringify({ tokens: { access_token: access, refresh_token: "r" } }),
    );
    let served: string | undefined = "gpt-served-snapshot";
    const fetch = Object.assign(
      async () => {
        const event = {
          type: "response.completed",
          response: {
            id: "resp-test",
            status: "completed",
            ...keyIfDefined("model", served),
            output: [],
            usage: {
              input_tokens: 10,
              input_tokens_details: { cached_tokens: 3 },
              output_tokens: 4,
              output_tokens_details: { reasoning_tokens: 2 },
              total_tokens: 14,
            },
          },
        };
        return new Response(`data: ${JSON.stringify(event)}\n\n`, {
          headers: { "Content-Type": "text/event-stream" },
        });
      },
      { preconnect: globalThis.fetch.preconnect },
    );
    const models = backends(options);
    expect((await models.getAuth("openai-codex"))?.auth.apiKey).toBe(access);
    const provider = models.getProvider("openai-codex");
    const model = models.getModel("openai-codex", "gpt-6.1-sol");
    if (provider === undefined || model === undefined) throw new Error("the Codex provider is missing");
    const observed: JsonValue[] = [];
    const full = await models
      .stream(
        model,
        { messages: [] },
        {
          transport: "sse",
          fetch,
          onProviderStreamEvent: (event) => {
            observed.push(asRecord(asRecord(event)?.response)?.model ?? null);
          },
        },
      )
      .result();
    expect(full).toMatchObject({ model: model.id, responseModel: served });
    expect(observed).toEqual([served]);
    models.setProvider({
      ...provider,
      streamSimple: (asked, context, request) =>
        provider.streamSimple(asked, context, { ...request, transport: "sse", fetch }),
    });
    const log = join(home, "codex.jsonl");
    for (const id of ["served", "absent"]) {
      const sat = await sit({
        models: () => models,
        id,
        model,
        effort: "medium",
        system: "A seat.",
        opening: "Begin.",
        tools: [],
        turns: [],
        stops: [],
        trace: { log, of: "solve" },
      });
      expect(sat.crash).toBeNull();
      const [turn] = traceOf(read(log), "solve", id).turns;
      expect(turn?.model).toBe(served ?? null);
      expect(turn?.usage).toMatchObject({ input: 7, output: 4, cacheRead: 3, reasoning: 2 });
      expect(sat.spent.reportedCost).toBeNull();
      served = undefined;
    }
  });
});

it("lets durable retry Codex and OpenRouter at the previous attempts and backoff, and leaves Claude alone", () => {
  for (const provider of ["openai-codex", "openrouter"]) {
    expect(retryPolicy(provider)).toEqual({ enabled: true, maxRetries: 3, baseDelayMs: 2000 });
  }
  for (const provider of ["claude", "claude-api", "faux"]) expect(retryPolicy(provider).enabled).toBe(false);
});
