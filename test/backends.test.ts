import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { backends } from "../src/backends/models.ts";
import { mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";

const HOUR_S = 60 * 60;
const home = mkdtempSync(join(tmpdir(), "ana-backends-"));
const previous = Bun.env.CODEX_HOME;

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
    const models = backends();
    expect(models.getModel("openai-codex", "gpt-5.5")?.api).toBe("openai-codex-responses");
    expect(models.getModel("openrouter", "anthropic/claude-opus-5")).toBeDefined();
    expect(models.getModel("claude", "claude-opus-5")?.api).toBe("claude-agent-sdk");
  });

  it("read the Codex CLI's login as it stands", async () => {
    const access = login(HOUR_S);
    const auth = await backends().getAuth("openai-codex");
    expect(auth?.auth.apiKey).toBe(access);
  });

  it("refuse to refresh a Codex login that is about to lapse, leaving that to the CLI", async () => {
    login(60);
    await expect(backends().getAuth("openai-codex")).rejects.toThrow("Codex CLI");
  });
});
