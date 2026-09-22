import { afterEach, describe, expect, it } from "bun:test";
import { loginAnthropic, refreshAnthropicToken } from "../src/backends/oauth/anthropic.ts";
import { loginOpenAICodex } from "../src/backends/oauth/openai-codex.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";

const CALLBACK_PORT = 53692;

/** The token exchange is the only network call a completed manual login makes. */
function mockTokenExchange(
  payload: JsonValue = { access_token: "fake-access-1", refresh_token: "fake-refresh-1", expires_in: 3600 },
): void {
  globalThis.fetch = Object.assign(
    async (): Promise<Response> =>
      new Response(JSON.stringify(payload), {
        headers: { "content-type": "application/json" },
      }),
    { preconnect: () => {} },
  );
}

/**
 * Complete a ChatGPT login through the paste route. The Codex credential is stored as the CLI's
 * own `auth.json` and the CLI refreshes it, so this login holds the whole of the product's
 * ChatGPT token exchange; there is nothing else to drive its response check through.
 */
function codexLogin() {
  return loginOpenAICodex({
    onAuth: () => {},
    onManualCodeInput: async () => "http://localhost:1455/auth/callback?code=paste-code",
    onPrompt: async () => "",
  });
}

describe("interactive OAuth login race", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("validates both providers' token responses before reading fields", async () => {
    const account = Buffer.from(
      JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "account-1" } }),
    ).toString("base64url");
    const access = `header.${account}.signature`;
    mockTokenExchange({ access_token: access, refresh_token: "fake-refresh-1", expires_in: 3600 });
    expect(await refreshAnthropicToken("old")).toMatchObject({ access, refresh: "fake-refresh-1" });
    expect(await codexLogin()).toMatchObject({ access, accountId: "account-1" });
    for (const payload of [null, [], 1, "text", {}, { access_token: 1, refresh_token: "refresh" }]) {
      mockTokenExchange(payload);
      await expect(refreshAnthropicToken("old")).rejects.toThrow("response missing fields");
      await expect(codexLogin()).rejects.toThrow("response missing fields");
    }
  });

  it("an occupied callback port falls back to the manual paste and still completes the login", async () => {
    // Another session holds the fixed callback port. The login must stay usable: the paste
    // route carries it, exactly as the Codex flow already behaved.
    const occupier = Bun.serve({
      port: CALLBACK_PORT,
      hostname: "127.0.0.1",
      fetch: () => new Response("occupied"),
    });
    try {
      mockTokenExchange();
      let cancelled = false;
      const login = await loginAnthropic({
        onAuth: () => {},
        onManualCodeInput: async () => "http://localhost:53692/callback?code=paste-code",
        onManualCodeCancel: () => {
          cancelled = true;
        },
        onPrompt: async () => "",
      });
      expect(login.access).toBe("fake-access-1");
      // The browser route never ran, so nothing had to release the manual reader.
      expect(cancelled).toBe(false);
    } finally {
      await occupier.stop(true);
    }
  });
});
