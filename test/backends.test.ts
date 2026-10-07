import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { claudeExecutable, SWEEP_COMPACT_WINDOW } from "../src/backends/claude.ts";
import { type BackendOptions, backends, compactionMode } from "../src/backends/models.ts";
import { mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";

const HOUR_S = 60 * 60;
const home = mkdtempSync(join(tmpdir(), "ana-backends-"));
const previous = Bun.env.CODEX_HOME;
const options: BackendOptions = { claude: { executable: claudeExecutable(), compaction: "off" } };

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
    expect(models.getModel("openai-codex", "gpt-5.5")?.api).toBe("openai-codex-responses");
    expect(models.getModel("openrouter", "anthropic/claude-opus-5")).toBeDefined();
    expect(models.getModel("claude", "claude-opus-5")?.api).toBe("claude-agent-sdk");
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

  it("name the compaction each runs under: Claude Code's own as the host set it, and none in pi's loop", () => {
    const sweep: BackendOptions = {
      claude: { ...options.claude, compaction: { window: SWEEP_COMPACT_WINDOW } },
    };
    const claude = (id: string) => ({ provider: "claude", id });
    expect(compactionMode(claude("claude-opus-5"), sweep)).toBe("autoCompactWindow=300000");
    expect(compactionMode(claude("claude-opus-5-5"), options)).toBe("off");
    expect(compactionMode({ provider: "openai-codex", id: "gpt-5.5" }, sweep)).toBe("off");
    expect(compactionMode({ provider: "openrouter", id: "z-ai/glm-5" }, sweep)).toBe("off");
  });

  // The CLI clamps the window to the context it serves the id, without a word: a bare id gets 200K.
  it("refuse a compaction window the model's served context cannot hold", () => {
    const at = (window: number): BackendOptions => ({
      claude: { ...options.claude, compaction: { window } },
    });
    const claude = (id: string) => ({ provider: "claude", id });
    expect(() => compactionMode(claude("claude-opus-5-5"), at(SWEEP_COMPACT_WINDOW))).toThrow(
      "claude-opus-5-5 a 200000-token context",
    );
    expect(() => compactionMode(claude("claude-sonnet-5-5"), at(SWEEP_COMPACT_WINDOW))).toThrow("clamped");
    expect(compactionMode(claude("claude-opus-5-5"), at(200_000))).toBe("autoCompactWindow=200000");
    expect(compactionMode(claude("claude-fable-5-1"), at(1_000_000))).toBe("autoCompactWindow=1000000");
  });
});
