import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { claudeExecutable, SWEEP_COMPACT_WINDOW } from "../src/agent/backends/claude.ts";
import { type BackendOptions, backends, compactionMode, retryPolicy } from "../src/agent/backends/models.ts";
import { mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";

const HOUR_S = 60 * 60;
const home = mkdtempSync(join(tmpdir(), "ana-backends-"));
const previous = Bun.env.CODEX_HOME;
const options: BackendOptions = {
  claude: { executable: claudeExecutable(), compaction: "off", home: tmpdir() },
};

function login(expiresInSeconds: number): string {
  const claims = { exp: Math.floor(Date.now() / 1000) + expiresInSeconds, "https://api.openai.com/auth": {} };
  const access = ["e30", Buffer.from(JSON.stringify(claims)).toString("base64url"), "sig"].join(".");
  writeFileSync(
    join(home, "auth.json"),
    JSON.stringify({ tokens: { access_token: access, refresh_token: "r" } }),
  );
  return access;
}

beforeAll(() => {
  Bun.env.CODEX_HOME = home;
});

afterAll(() => {
  if (previous === undefined) delete Bun.env.CODEX_HOME;
  else Bun.env.CODEX_HOME = previous;
  rmSync(home, { recursive: true, force: true });
});

describe("the three backends", () => {
  it("serve Codex, OpenRouter and Claude Code from pi's catalogs", () => {
    const models = backends(options);
    expect(models.getModel("openai-codex", "gpt-6.1-sol")?.api).toBe("openai-codex-responses");
    expect(models.getModel("openrouter", "anthropic/claude-opus-5")).toBeDefined();
    expect(models.getModel("claude", "claude-opus-5")?.api).toBe("claude-agent-sdk");
    // The same backend on an API key is a provider of its own, with the same catalog and prices,
    // and it compacts as the login does.
    const [login_, key] = ["claude", "claude-api"].map((id) => models.getModel(id, "claude-sonnet-5-5"));
    expect(key).toMatchObject({ provider: "claude-api", api: "claude-agent-sdk", cost: login_?.cost });
    if (login_ === undefined || key === undefined) throw new Error("the catalog has no claude-sonnet-5-5");
    expect(compactionMode(key, options)).toBe(compactionMode(login_, options));
  });

  it("route a model pinned to one OpenRouter endpoint there alone, at that endpoint's price", () => {
    const models = backends(options);
    const dated = models.getModel("openrouter", "deepseek/deepseek-v4.1-flash-1017");
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
    const chat = models.getModelsOfType("chat", "openrouter").map(({ id }) => id);
    expect(chat).toContain("deepseek/deepseek-v4.1-flash-1017");
    const base = models.getModel("openrouter", "deepseek/deepseek-v4.1-flash");
    expect(base?.compat ?? {}).not.toHaveProperty("openRouterRouting");
    expect(models.getModel("openrouter", "deepseek/deepseek-v4.1-flash-0101")).toBeUndefined();
  });

  it("read the Codex CLI's login as it stands", async () => {
    const access = login(HOUR_S);
    const auth = await backends(options).getAuth("openai-codex");
    expect(auth?.auth.apiKey).toBe(access);
  });

  it("refuse to refresh a Codex login that is about to lapse, leaving that to the CLI", async () => {
    login(60);
    await expect(backends(options).getAuth("openai-codex")).rejects.toThrow("Codex CLI");
  });

  it("name the compaction each runs under: Claude Code's own as the host set it, and pi's in its own loop", () => {
    const sweep: BackendOptions = {
      claude: { ...options.claude, compaction: { window: SWEEP_COMPACT_WINDOW } },
    };
    const claude = (id: string) => ({ provider: "claude", id, contextWindow: 1_000_000 });
    expect(compactionMode(claude("claude-opus-5"), sweep)).toBe("autoCompactWindow=300000");
    expect(compactionMode(claude("claude-opus-5-5"), options)).toBe("off");
    const codex = { provider: "openai-codex", id: "gpt-6.1-sol", contextWindow: 400_000 };
    expect(compactionMode(codex, sweep)).toBe(
      "durable window=300000 reserve=16384 keep=20000 summaryReserve=116384 background=off",
    );
    const glm = { provider: "openrouter", id: "z-ai/glm-5", contextWindow: 200_000 };
    expect(compactionMode(glm, options)).toBe(
      "durable window=200000 reserve=16384 keep=20000 summaryReserve=16384 background=off",
    );
  });

  // The CLI clamps the window to the context it serves the id, without a word: a bare id gets 200K.
  it("refuse a compaction window the model's served context cannot hold", () => {
    const at = (window: number): BackendOptions => ({
      claude: { ...options.claude, compaction: { window } },
    });
    const claude = (id: string) => ({ provider: "claude", id, contextWindow: 200_000 });
    expect(() => compactionMode(claude("claude-haiku-4-5"), at(SWEEP_COMPACT_WINDOW))).toThrow(
      "claude-haiku-4-5 a 200000-token context",
    );
    expect(compactionMode(claude("claude-haiku-4-5"), at(200_000))).toBe("autoCompactWindow=200000");
    expect(compactionMode(claude("claude-opus-5-5"), at(SWEEP_COMPACT_WINDOW))).toBe(
      "autoCompactWindow=300000",
    );
    expect(compactionMode(claude("claude-fable-5-1"), at(1_000_000))).toBe("autoCompactWindow=1000000");
  });
});

it("lets durable retry Codex and OpenRouter at the previous attempts and backoff, and leaves Claude alone", () => {
  for (const provider of ["openai-codex", "openrouter"]) {
    expect(retryPolicy(provider)).toEqual({ enabled: true, maxRetries: 3, baseDelayMs: 2000 });
  }
  for (const provider of ["claude", "claude-api", "faux"]) expect(retryPolicy(provider).enabled).toBe(false);
});
