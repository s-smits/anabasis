import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { claudeExecutable } from "../src/agent/backends/claude.ts";
import { codexAuthStatus } from "../src/agent/backends/codex-auth.ts";
import { type BackendOptions, backends, compactionMode, retryPolicy } from "../src/agent/backends/models.ts";
import { runAgent } from "../src/agent/session.ts";
import { read } from "../src/kernel/log.ts";
import { traceOf } from "../src/kernel/trace.ts";
import { asRecord, type JsonValue } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
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
    expect(catalog.getModel("openai-codex", "gpt-6.1-terra")).toMatchObject({
      contextWindow: 500_000,
      maxTokens: 128_000,
      cost: { input: 1, output: 5, cacheRead: 0.05, cacheWrite: 1.25 },
    });
    expect(catalog.getModel("openrouter", "anthropic/claude-opus-5")).toBeDefined();
    expect(catalog.getModel("claude", "claude-opus-5")?.api).toBe("claude-agent-sdk");
    // On an API key the same backend is a provider of its own, with the same prices, and compacts as
    // the login does.
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
      maxTokens: 65_536,
    });
    expect(
      Math.max(...catalog.getModels("openrouter").map(({ maxTokens }) => maxTokens)),
    ).toBeLessThanOrEqual(65_536);
    const under = openrouterProvider()
      .getModels()
      .find(({ maxTokens }) => maxTokens < 65_536);
    if (under === undefined) throw new Error("the OpenRouter catalog has no model below 65,536 maxTokens");
    expect(catalog.getModel("openrouter", under.id)?.maxTokens).toBe(under.maxTokens);
    // A model nobody pinned keeps pi's own entry, routed as OpenRouter chooses; the chat listing holds
    // the pinned one too.
    const chat = catalog.getModelsOfType("chat", "openrouter");
    expect(chat.map(({ id }) => id)).toContain("deepseek/deepseek-v4.1-flash-1017");
    expect(Math.max(...chat.map(({ maxTokens }) => maxTokens))).toBeLessThanOrEqual(65_536);
    const base = catalog.getModel("openrouter", "deepseek/deepseek-v4.1-flash");
    expect(base?.compat ?? {}).not.toHaveProperty("openRouterRouting");
    expect(catalog.getModel("openrouter", "deepseek/deepseek-v4.1-flash-0101")).toBeUndefined();
  });

  it("serve an OpenAI-compatible endpoint at its own /v1 base, on its own key, at its own price", () => {
    const served = catalog.getModel("deepinfra", "deepseek-ai/DeepSeek-V4.1-Flash-1017");
    expect(served).toMatchObject({
      provider: "deepinfra",
      api: "openai-completions",
      baseUrl: "https://api.deepinfra.com/v1/openai",
      reasoning: true,
      cost: { input: 0.098, output: 0.294, cacheRead: 0.00294 },
    });
    // The endpoint's model carries no OpenRouter routing, whatever the release OpenRouter pins.
    expect(served?.compat ?? {}).not.toHaveProperty("openRouterRouting");
    expect(catalog.getModel("deepinfra", "deepseek/deepseek-v4.1-flash-1017")).toBeUndefined();
  });

  it.each([-60, 60])(
    "refuses a Codex login with %s seconds left without refreshing or writing it",
    async (seconds) => {
      const claims = {
        exp: Math.floor(Date.now() / 1000) + seconds,
        "https://api.openai.com/auth": { chatgpt_account_id: "test-account" },
      };
      const access = ["e30", Buffer.from(JSON.stringify(claims)).toString("base64url"), "sig"].join(".");
      const auth = JSON.stringify({ tokens: { access_token: access, refresh_token: "r" } });
      writeFileSync(join(home, "auth.json"), auth);
      const models = backends(options);
      const provider = models.getProvider("openai-codex");
      const oauth = provider?.auth.oauth;
      if (provider === undefined || oauth === undefined) {
        throw new Error("the Codex OAuth provider is missing");
      }
      let refreshes = 0;
      models.setProvider({
        ...provider,
        auth: {
          ...provider.auth,
          oauth: {
            ...oauth,
            refresh: async (credential) => {
              refreshes += 1;
              return { ...credential, expires: Date.now() + 3_600_000 };
            },
          },
        },
      });
      await expect(models.getAuth("openai-codex")).rejects.toThrow();
      expect(refreshes).toBe(0);
      expect(readFileSync(join(home, "auth.json"), "utf8")).toBe(auth);
    },
  );

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
      const sat = await runAgent({
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
      served = undefined;
    }
  });
});

it("lets durable retry Codex, OpenRouter and the endpoints at the previous attempts and backoff, and leaves Claude alone", () => {
  for (const provider of ["openai-codex", "openrouter", "deepinfra"]) {
    expect(retryPolicy(provider)).toEqual({ enabled: true, maxRetries: 3, baseDelayMs: 2000 });
  }
  for (const provider of ["claude", "claude-api", "faux"]) expect(retryPolicy(provider).enabled).toBe(false);
});

it("classifies Codex auth state without exposing tokens", () => {
  const fresh = join(tmpdir(), `ana-codex-status-${String(Date.now())}`);
  const prev = Bun.env.CODEX_HOME;
  try {
    Bun.env.CODEX_HOME = fresh;
    expect(codexAuthStatus(1000)).toBe("missing");
    const secret = "fake-refresh-secret-value";
    const jwt = (exp: number) => `h.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.s`;
    writeFileSync(
      join(home, "auth.json"),
      JSON.stringify({ tokens: { access_token: jwt(1000), refresh_token: secret } }),
    );
    Bun.env.CODEX_HOME = home;
    for (const [now, expected] of [
      [100_000, "ready"],
      [699_999, "ready"],
      [700_000, "expired"],
      [1_100_000, "expired"],
    ] as const) {
      const state = codexAuthStatus(now);
      expect(state).toBe(expected);
      expect(state).not.toContain(secret);
    }
    writeFileSync(join(home, "auth.json"), "{not-json");
    expect(codexAuthStatus(100_000)).toBe("invalid");
  } finally {
    if (prev === undefined) delete Bun.env.CODEX_HOME;
    else Bun.env.CODEX_HOME = prev;
  }
});
