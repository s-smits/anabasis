import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { isString, type JsonValue } from "../src/meta/json-shape.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";

import { afterEach, describe, expect, it } from "bun:test";
import {
  codexAccessTokenExpiresAt,
  codexAuthFile,
  codexLoginState,
  claudeLoginState,
  openrouterLoginState,
} from "../src/backends/login-state.ts";
import { loadRepoEnv } from "../src/backends/env.ts";
import { decodeJwtPayload, getAccountId } from "../src/backends/oauth/openai-codex.ts";
import { parseAuthorizationInput } from "../src/backends/oauth/paste-input.ts";
import { generatePKCE } from "../src/backends/oauth/pkce.ts";
import {
  refreshCodexAuthJson,
  writeClaudeCredential,
  writeCodexAuthJson,
} from "../src/backends/oauth/storage.ts";
import { preflightCampaignModels } from "../src/run/model-preflight.ts";
import { resolvePiSlot } from "../src/backends/pi-providers.ts";
import type { PiBuiltRuntime } from "../src/backends/pi-built.ts";

const scratch: string[] = [];
afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});

function makeScratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

function base64urlJson(value: Record<string, JsonValue>): string {
  return new TextEncoder()
    .encode(JSON.stringify(value))
    .toBase64({ alphabet: "base64url", omitPadding: true });
}

/** One unsigned JWT whose payload carries the given claims. */
function fakeJwt(payloadValue: Record<string, JsonValue>): string {
  return `${base64urlJson({ alg: "none" })}.${base64urlJson(payloadValue)}.signature`;
}

describe("pasted OAuth response parsing", () => {
  it("reads a raw code, a full redirect URL, a code#state pair and an empty value", () => {
    expect(parseAuthorizationInput("abc123")).toEqual({ code: "abc123" });
    expect(parseAuthorizationInput("http://localhost:1455/auth/callback?code=c9&state=s1")).toEqual({
      code: "c9",
      state: "s1",
    });
    expect(parseAuthorizationInput("c9#s1")).toEqual({ code: "c9", state: "s1" });
    expect(parseAuthorizationInput("code=c9&state=s1")).toEqual({ code: "c9", state: "s1" });
    expect(parseAuthorizationInput("   ")).toEqual({});
  });
});

describe("JWT payload reading for the Codex flow", () => {
  it("decodes a payload and extracts the ChatGPT account claim", () => {
    const token = fakeJwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acc-7" }, exp: 123 });
    expect(decodeJwtPayload(token)).toEqual({
      "https://api.openai.com/auth": { chatgpt_account_id: "acc-7" },
      exp: 123,
    });
    expect(getAccountId(token)).toBe("acc-7");
  });

  it("returns null for damaged tokens and absent accounts", () => {
    expect(decodeJwtPayload("not-a-jwt")).toBeNull();
    for (const payload of ["null", "[]", "1", '"text"']) {
      const encoded = Buffer.from(payload).toString("base64url");
      expect(decodeJwtPayload(`header.${encoded}.signature`)).toBeNull();
    }
    expect(getAccountId(fakeJwt({ other: true }))).toBeNull();
    expect(getAccountId(fakeJwt({ "https://api.openai.com/auth": {} }))).toBeNull();
    expect(getAccountId(fakeJwt({ "https://api.openai.com/auth": { chatgpt_account_id: "" } }))).toBeNull();
  });
});

describe("PKCE", () => {
  it("returns a 43-character verifier and URL-safe challenge", async () => {
    const { verifier, challenge } = await generatePKCE();
    expect(verifier).not.toMatch(/[+/=]/);
    expect(challenge).not.toMatch(/[+/=]/);
    expect(verifier.length).toBe(43);
  });
});

describe("Codex auth.json storage", () => {
  it("writes the exact Codex CLI file shape with private permissions", () => {
    const home = makeScratchDir("ana-login-codex-");
    const file = writeCodexAuthJson(
      { access: "a1", refresh: "r1", expires: 1000, idToken: "i1", accountId: "acc-7" },
      { CODEX_HOME: home },
    );
    expect(file).toBe(join(home, "auth.json"));
    const written = parseJsonAs<{
      auth_mode?: JsonValue;
      OPENAI_API_KEY?: JsonValue;
      tokens?: Record<string, JsonValue>;
      last_refresh?: JsonValue;
    }>(readFileSync(file, "utf8"));
    expect(written.auth_mode).toBe("chatgpt");
    expect(written.OPENAI_API_KEY).toBeNull();
    expect(written.tokens?.access_token).toBe("a1");
    expect(written.tokens?.refresh_token).toBe("r1");
    expect(written.tokens?.id_token).toBe("i1");
    expect(written.tokens?.account_id).toBe("acc-7");
    expect(isString(written.last_refresh)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("resolves the auth path through an absolute CODEX_HOME or ~/.codex", () => {
    const home = makeScratchDir("ana-login-codex2-");
    expect(codexAuthFile({ CODEX_HOME: home })).toBe(join(home, "auth.json"));
    expect(codexAuthFile({})).toContain(".codex");
    expect(() => codexAuthFile({ CODEX_HOME: "relative/path" })).toThrow("CODEX_HOME must be absolute");
  });

  it("resolves CODEX_HOME from the repo env files, the same env the login CLI writes through", () => {
    const repoRoot = makeScratchDir("ana-login-codexenv-");
    const home = makeScratchDir("ana-login-codexhome-");
    writeFileSync(join(repoRoot, ".env.local"), `CODEX_HOME=${home}\n`, "utf8");
    expect(codexAuthFile(loadRepoEnv(repoRoot).env)).toBe(join(home, "auth.json"));
  });
});

describe("Claude credential storage", () => {
  it("stores the login privately and the env loader reads it only when no env file sets the token", () => {
    const repoRoot = makeScratchDir("ana-login-claude-");
    const credentialFile = writeClaudeCredential(repoRoot, {
      access: "a2",
      refresh: "r2",
      expires: 5000,
      updatedAt: "2026-08-22T00:00:00.000Z",
    });
    expect(credentialFile).toBe(join(repoRoot, ".harness", "auth", "claude-oauth.json"));
    expect(statSync(credentialFile).mode & 0o777).toBe(0o600);

    const stored = loadRepoEnv(repoRoot, {});
    expect(stored.env.CLAUDE_CODE_OAUTH_TOKEN).toBe("a2");
    expect(stored.sources.CLAUDE_CODE_OAUTH_TOKEN).toBe(".harness/auth/claude-oauth.json");

    // An operator token in .env outranks the stored login: on 2026-09-15 a login written beside a
    // hand-set token silently switched the account, and the loader now cannot.
    writeFileSync(join(repoRoot, ".env"), "CLAUDE_CODE_OAUTH_TOKEN=hand-set\n", "utf8");
    const operator = loadRepoEnv(repoRoot, {});
    expect(operator.env.CLAUDE_CODE_OAUTH_TOKEN).toBe("hand-set");
    expect(operator.sources.CLAUDE_CODE_OAUTH_TOKEN).toBe(".env");
  });

  it("ignores a stored login without an access token and keeps 0600 on a rewrite", () => {
    const repoRoot = makeScratchDir("ana-login-claude2-");
    mkdirSync(join(repoRoot, ".harness", "auth"), { recursive: true });
    writeFileSync(join(repoRoot, ".harness", "auth", "claude-oauth.json"), "{}", "utf8");
    expect(loadRepoEnv(repoRoot, {}).env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();

    const file = writeClaudeCredential(repoRoot, {
      access: "first",
      refresh: "r",
      expires: 1,
      updatedAt: "t",
    });
    chmodSync(file, 0o644);
    writeClaudeCredential(repoRoot, { access: "second", refresh: "r", expires: 1, updatedAt: "t" });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(loadRepoEnv(repoRoot, {}).env.CLAUDE_CODE_OAUTH_TOKEN).toBe("second");
  });

  it("serves every Claude slot from the unnumbered token alone, from .env or the process", async () => {
    const repoRoot = makeScratchDir("ana-shared-credential-");
    const claude = { kind: "claude", model: "claude-opus-5", reasoningEffort: "medium" } as const;
    const defaults = { webSearch: false } as const;
    const slots = ["builder", "built", "review"] as const;

    writeFileSync(join(repoRoot, ".env"), "CLAUDE_CODE_OAUTH_TOKEN=only\n", "utf8");
    for (const slot of slots) {
      expect(await resolvePiSlot(slot, claude, defaults, repoRoot, {}).auth()).toEqual({
        type: "bearer",
        token: "only",
      });
    }
    writeFileSync(join(repoRoot, ".env"), "", "utf8");
    const env = { CLAUDE_CODE_OAUTH_TOKEN: "exported" };
    for (const slot of slots) {
      expect(await resolvePiSlot(slot, claude, defaults, repoRoot, env).auth()).toEqual({
        type: "bearer",
        token: "exported",
      });
    }
  });

  it("names who compacts every Claude slot, the CLI unless CLAUDE_COMPACTION chose pi", () => {
    const repoRoot = makeScratchDir("ana-slot-compaction-");
    writeFileSync(join(repoRoot, ".env"), "CLAUDE_COMPACTION=pi\n", "utf8");
    const claude = { kind: "claude", model: "claude-opus-5", reasoningEffort: "medium" } as const;
    const defaults = { webSearch: false } as const;

    for (const slot of ["builder", "built", "review"] as const) {
      expect(resolvePiSlot(slot, claude, defaults, repoRoot, {}).profile.compaction).toBe("pi");
    }
    // A codex slot compacts through pi whatever the env says; it carries no mode.
    const codex = { kind: "codex", model: "gpt-5.6-sol", reasoningEffort: "medium" } as const;
    expect(resolvePiSlot("builder", codex, defaults, repoRoot, {}).profile).not.toHaveProperty("compaction");

    const unset = makeScratchDir("ana-slot-compaction-unset-");
    expect(resolvePiSlot("review", claude, defaults, unset, {}).profile.compaction).toBe("claude-ss");

    writeFileSync(join(repoRoot, ".env"), "CLAUDE_COMPACTION=server\n", "utf8");
    expect(() => resolvePiSlot("built", claude, defaults, repoRoot, {})).toThrow(
      'CLAUDE_COMPACTION "server" is unsupported; choose one of pi, claude-ss',
    );
  });
});

describe("login-state owners", () => {
  function writeCodexAuth(home: string, token: string | null): void {
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(home, "auth.json"),
      JSON.stringify(
        token === null ? {} : { auth_mode: "chatgpt", OPENAI_API_KEY: null, tokens: { access_token: token } },
      ),
      "utf8",
    );
  }

  it("accepts a stored access token and refuses missing, malformed or empty credentials", () => {
    const home = makeScratchDir("ana-login-state-");
    const env = { CODEX_HOME: home };
    expect(codexLoginState(env)).toEqual({ ok: false, reason: "no auth.json" });

    // A token whose expiry cannot be read gives no refresh rule to follow, so it is a login fault.
    writeCodexAuth(home, "garbage");
    expect(codexLoginState(env)).toEqual({ ok: false, reason: "auth.json access token is malformed" });

    writeFileSync(join(home, "auth.json"), "{not json", "utf8");
    expect(codexLoginState(env)).toEqual({ ok: false, reason: "auth.json is malformed" });

    writeCodexAuth(home, null);
    expect(codexLoginState(env)).toEqual({ ok: false, reason: "auth.json has no access token" });

    writeCodexAuth(home, fakeJwt({ exp: Math.floor(Date.now() / 1000) - 3600 }));
    expect(codexLoginState(env)).toEqual({ ok: false, reason: "auth.json access token is expired" });
    expect(codexAccessTokenExpiresAt(env)!.getTime()).toBeLessThan(Date.now());
    // The refresh token beside an expired access token renews it on first use.
    writeStoredLogin(home, { exp: -3600, lastRefreshDaysAgo: 9 });
    expect(codexLoginState(env)).toEqual({ ok: true });

    writeCodexAuth(home, fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }));
    expect(codexLoginState(env)).toEqual({ ok: true });
    expect(codexAccessTokenExpiresAt(env)?.getTime()).toBeGreaterThan(Date.now());
  });

  /** A Codex CLI file whose access token expires `exp` seconds from now, refreshed some days ago. */
  function writeStoredLogin(home: string, login: { exp: number; lastRefreshDaysAgo: number }): void {
    mkdirSync(home, { recursive: true });
    writeFileSync(
      codexAuthFile({ CODEX_HOME: home }),
      JSON.stringify({
        auth_mode: "chatgpt",
        OPENAI_API_KEY: "kept-api-key",
        tokens: {
          id_token: "stored-id-token",
          access_token: fakeJwt({ exp: Math.floor(Date.now() / 1000) + login.exp }),
          refresh_token: "stored-refresh-token",
          account_id: "stored-account",
        },
        last_refresh: new Date(Date.now() - login.lastRefreshDaysAgo * 86_400_000).toISOString(),
      }),
      "utf8",
    );
  }

  /** A token exchange that counts its calls and answers with a login ten days long. */
  function countedRefresh(idToken: string | null) {
    const spent: string[] = [];
    const refresh = async (refreshToken: string) => {
      spent.push(refreshToken);
      await Bun.sleep(20);
      return {
        access: fakeJwt({ exp: Math.floor(Date.now() / 1000) + 10 * 86_400 }),
        refresh: `fake-rotated-${String(spent.length)}`,
        expires: Date.now() + 10 * 86_400_000,
        idToken,
        accountId: "refreshed-account",
      };
    };
    return { spent, refresh };
  }

  // The Codex CLI's own rule: a login refreshed eight days ago is due though its token has not
  // expired. The VM login of 2026-09-21 was refused at that age with two days of claims left.
  it("refreshes a due Codex login once across racing processes and keeps the file's other fields", async () => {
    const home = makeScratchDir("ana-codex-refresh-");
    const env = { CODEX_HOME: home };
    writeStoredLogin(home, { exp: 2 * 86_400, lastRefreshDaysAgo: 9 });
    const { spent, refresh } = countedRefresh(null);
    await Promise.all([refreshCodexAuthJson(env, refresh), refreshCodexAuthJson(env, refresh)]);
    expect(spent).toEqual(["stored-refresh-token"]);
    const stored = parseJsonAs<Record<string, JsonValue>>(
      readFileSync(codexAuthFile({ CODEX_HOME: home }), "utf8"),
    );
    expect(stored.OPENAI_API_KEY).toBe("kept-api-key");
    expect(stored.auth_mode).toBe("chatgpt");
    expect(stored.tokens).toMatchObject({
      id_token: "stored-id-token",
      refresh_token: "fake-rotated-1",
      account_id: "refreshed-account",
    });
    const lastRefresh = stored.last_refresh;
    expect(isString(lastRefresh) ? Date.now() - Date.parse(lastRefresh) : null).toBeLessThan(60_000);
    expect(statSync(codexAuthFile({ CODEX_HOME: home })).mode & 0o777).toBe(0o600);
    expect(() => statSync(`${codexAuthFile({ CODEX_HOME: home })}.refresh-lock`)).toThrow();

    // Now current, the login is left alone.
    await refreshCodexAuthJson(env, refresh);
    expect(spent).toHaveLength(1);
  });

  it("hands the codex transport the stored token, with no refresh, while its login is not due", async () => {
    const home = makeScratchDir("ana-codex-slot-home-");
    const repoRoot = makeScratchDir("ana-codex-slot-");
    writeFileSync(join(repoRoot, ".env"), `CODEX_HOME=${home}\n`, "utf8");
    writeStoredLogin(home, { exp: 2 * 86_400, lastRefreshDaysAgo: 1 });
    const before = readFileSync(codexAuthFile({ CODEX_HOME: home }), "utf8");
    const slot = resolvePiSlot(
      "review",
      { kind: "codex", model: "gpt-5.6-sol", reasoningEffort: "medium" },
      { webSearch: false },
      repoRoot,
      {},
    );
    expect(await slot.auth()).toMatchObject({ type: "oauth", refresh: "" });
    expect(readFileSync(codexAuthFile({ CODEX_HOME: home }), "utf8")).toBe(before);

    // An expired token with nothing to renew it is a login fault, named for the operator.
    writeCodexAuth(home, fakeJwt({ exp: Math.floor(Date.now() / 1000) - 3600 }));
    await expect(slot.auth()).rejects.toThrow(
      "Codex authentication is unavailable (auth.json access token is expired)",
    );
  });

  it("leaves a login that is not due, and a failed exchange, as stored", async () => {
    const home = makeScratchDir("ana-codex-refresh-hold-");
    const env = { CODEX_HOME: home };
    writeStoredLogin(home, { exp: 2 * 86_400, lastRefreshDaysAgo: 1 });
    const { spent, refresh } = countedRefresh("new-id-token");
    await refreshCodexAuthJson(env, refresh);
    expect(spent).toEqual([]);

    writeStoredLogin(home, { exp: 60, lastRefreshDaysAgo: 1 });
    const before = readFileSync(codexAuthFile({ CODEX_HOME: home }), "utf8");
    const failing = async () => {
      throw new Error("OpenAI Codex token exchange failed (401): invalid_grant");
    };
    await expect(refreshCodexAuthJson(env, failing)).rejects.toThrow("invalid_grant");
    expect(readFileSync(codexAuthFile({ CODEX_HOME: home }), "utf8")).toBe(before);
    expect(() => statSync(`${codexAuthFile({ CODEX_HOME: home })}.refresh-lock`)).toThrow();

    // Within five minutes of expiry the login is due, and a returned id token replaces the stored one.
    await refreshCodexAuthJson(env, refresh);
    expect(spent).toEqual(["stored-refresh-token"]);
    const stored = parseJsonAs<{ tokens: Record<string, JsonValue> }>(
      readFileSync(codexAuthFile({ CODEX_HOME: home }), "utf8"),
    );
    expect(stored.tokens.id_token).toBe("new-id-token");
  });

  it("requires an explicit Claude credential and never counts the CLI keychain", () => {
    expect(claudeLoginState({})).toEqual({
      ok: false,
      reason: "neither CLAUDE_CODE_OAUTH_TOKEN nor ANTHROPIC_API_KEY is set",
    });
    expect(claudeLoginState({ CLAUDE_CODE_OAUTH_TOKEN: "t" })).toEqual({ ok: true });
    expect(claudeLoginState({ ANTHROPIC_API_KEY: "k" })).toEqual({ ok: true });
  });

  it("requires the OpenRouter key", () => {
    expect(openrouterLoginState({}).ok).toBe(false);
    expect(openrouterLoginState({ OPENROUTER_API_KEY: "k" })).toEqual({ ok: true });
  });
});

describe("campaign model preflight login gate", () => {
  it("refuses missing review credentials before authoring starts", async () => {
    // The review slot opens no session until measurement, but a missing review login would
    // otherwise surface only after the whole authoring phase was paid for.
    const repoRoot = makeScratchDir("ana-login-gate-review-");
    const home = makeScratchDir("ana-login-gate-review-home-");
    writeFileSync(join(repoRoot, ".env"), `CODEX_HOME=${home}\nOPENROUTER_API_KEY=test-key\n`, "utf8");
    const runtime = /* SAFETY: the login gate reads only profile.transport before it refuses; nothing below
			   runs once the gate throws. */ {
      profile: { provider: "openrouter", transport: "openrouter", model: "x/y", thinkingLevel: "medium" },
    } as PiBuiltRuntime;
    // An unpinned OpenRouter Builder: an absent pin is "no pin", and the key is in the repo env.
    const builder = {
      kind: "openrouter" as const,
      model: "x/y",
      reasoningEffort: "off",
      source: "operator" as const,
    };
    const review = {
      enabled: true as const,
      kind: "codex" as const,
      model: "gpt-5.6-sol",
      reasoningEffort: "medium" as const,
      source: "operator" as const,
    };

    await expect(
      preflightCampaignModels({ builder, review, repoRoot, builtRuntime: runtime }),
    ).rejects.toThrow(/Codex authentication is unavailable.*run `codex login`/s);
  });

  it("refuses missing credentials for the selected backend before any provider session opens", async () => {
    const repoRoot = makeScratchDir("ana-login-gate-");
    const home = makeScratchDir("ana-login-gate-home-");
    writeFileSync(join(repoRoot, ".env"), `CODEX_HOME=${home}\n`, "utf8");
    const runtime = /* SAFETY: the login gate reads only profile.transport before it refuses; nothing below
			   runs once the gate throws. */ {
      profile: {
        provider: "openai-codex",
        transport: "codex",
        model: "gpt-5.6-sol",
        thinkingLevel: "medium",
      },
    } as PiBuiltRuntime;

    await expect(
      preflightCampaignModels({
        builder: { kind: "codex", model: "gpt-5.6-sol", reasoningEffort: "high" },
        review: { enabled: false, source: "operator" },
        repoRoot,
        builtRuntime: runtime,
      }),
    ).rejects.toThrow(/Codex authentication is unavailable.*run `codex login`/s);
  });
});
