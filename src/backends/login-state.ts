/**
 * What each provider's login looks like on this host, read without activating anything, which is
 * what lets `login status` report all three at once and lets the shared provider layer
 * (pi-providers.ts) decide before it opens a session: it reads the Codex access token from here and
 * refuses a missing login itself, naming the operator's fix rather than letting the transport fail
 * later with a provider error. Codex login state is a current access token, or the refresh token
 * that renews it, in `auth.json` under `$CODEX_HOME` (or `~/.codex`); claude login state is the
 * explicit credential in the merged repo env; OpenRouter's is its endpoint's key.
 */
import { existsSync } from "../meta/filesystem.ts";
import { homedir } from "../meta/os.ts";
import { isAbsolute, join } from "../meta/path.ts";
import { parseJsonAs } from "../meta/json-runtime.ts";
import { isNumber, isString, type JsonValue } from "../meta/json-shape.ts";
import { openRouterEndpointFrom } from "./openrouter-model.ts";
import type { OptionalEnvValues } from "./scrub-env.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { hasText, textOr } from "../meta/text.ts";
import { readJsonFile } from "../meta/completed-json.ts";

type LoginState = { ok: true } | { ok: false; reason: string };

type CodexAuthRead =
  | { ok: true; token: string; refreshToken: string | null; lastRefreshAt: number | null }
  | { ok: false; reason: string };
/** A stored Codex login: the access token with the expiry its own claims state, the refresh token
 *  beside it, and when the Codex CLI's own rule makes the login due for a refresh. */
type CodexLogin =
  | { ok: true; token: string; expiresAt: number; refreshToken: string | null; refreshDueAt: number }
  | { ok: false; reason: string };

/** The Codex CLI refreshes a login whose last refresh is eight days old, or whose access token is
 *  about to expire. This process keeps the same two-part rule, so it never refreshes earlier than
 *  the CLI would and the two can share one `auth.json` without fighting over it. */
const CODEX_REFRESH_INTERVAL_MS = 8 * 24 * 60 * 60 * 1000;
const CODEX_EXPIRY_MARGIN_MS = 5 * 60 * 1000;

/** The Codex CLI credential file's name under `$CODEX_HOME`. */
export const CODEX_AUTH_FILE = "auth.json";

/** Absolute path of the Codex CLI credential file this host resolves. */
export function codexAuthFile(env: OptionalEnvValues): string {
  const configured = env.CODEX_HOME?.trim();
  if (hasText(configured) && !isAbsolute(configured)) throw new Error("CODEX_HOME must be absolute");
  return join(textOr(configured, join(homedir(), ".codex")), CODEX_AUTH_FILE);
}

function accessTokenExpiryMs(token: string): number | null {
  try {
    const payload = parseJsonAs<Record<string, JsonValue>>(
      new TextDecoder().decode(Uint8Array.fromBase64(token.split(".")[1] ?? "", { alphabet: "base64url" })),
    );
    return isNumber(payload.exp) ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function readCodexAuthJson(env: OptionalEnvValues): CodexAuthRead {
  const file = codexAuthFile(env);
  if (!existsSync(file)) return { ok: false, reason: "no auth.json" };
  let value: unknown;
  try {
    value = readJsonFile(file);
  } catch {
    return { ok: false, reason: "auth.json is malformed" };
  }
  const stored = /* SAFETY: the Codex auth file is read at its boundary, so nothing about its shape
       is proved yet; every field is tested for a non-empty string below before any use. */ value as {
    tokens?: { access_token?: unknown; refresh_token?: unknown };
    last_refresh?: unknown;
  } | null;
  const token = stored?.tokens?.access_token;
  if (!isString(token) || !token) return { ok: false, reason: "auth.json has no access token" };
  const refreshToken = stored?.tokens?.refresh_token;
  const lastRefreshAt = isString(stored?.last_refresh) ? Date.parse(stored.last_refresh) : Number.NaN;
  return {
    ok: true,
    token,
    refreshToken: isString(refreshToken) && refreshToken ? refreshToken : null,
    lastRefreshAt: Number.isFinite(lastRefreshAt) ? lastRefreshAt : null,
  };
}

/**
 * The stored Codex login, read again on every call. A token past its expiry still reads here: the
 * refresh token beside it renews it (`refreshCodexAuthJson`), as the Codex CLI renews its own.
 */
export function codexLogin(env: OptionalEnvValues): CodexLogin {
  const read = readCodexAuthJson(env);
  if (!read.ok) return read;
  const expiresAt = accessTokenExpiryMs(read.token);
  if (expiresAt === null) return { ok: false, reason: "auth.json access token is malformed" };
  const intervalDueAt =
    read.lastRefreshAt === null ? Number.POSITIVE_INFINITY : read.lastRefreshAt + CODEX_REFRESH_INTERVAL_MS;
  return {
    ok: true,
    token: read.token,
    expiresAt,
    refreshToken: read.refreshToken,
    refreshDueAt: Math.min(expiresAt - CODEX_EXPIRY_MARGIN_MS, intervalDueAt),
  };
}

/** Login state of the Codex CLI: a current access token, or the refresh token that renews it. */
export function codexLoginState(env: OptionalEnvValues): LoginState {
  const login = codexLogin(env);
  if (!login.ok) return login;
  if (login.expiresAt > Date.now() + 60_000 || login.refreshToken !== null) return { ok: true };
  return { ok: false, reason: "auth.json access token is expired" };
}

/** Expiry wall time of the stored Codex access token, or null when absent or unreadable. */
export function codexAccessTokenExpiresAt(env: OptionalEnvValues): Date | null {
  const read = readCodexAuthJson(env);
  if (!read.ok) return null;
  const expiry = accessTokenExpiryMs(read.token);
  return expiry === null ? null : new Date(expiry);
}

/** Login state of Claude: an explicit OAuth subscription token or API key in the repo env. The
    CLI's own keychain fallback is deliberately not accepted here, for two separate reasons: it
    cannot serve the Built transport at all, and it silently books sessions against whatever account
    last ran `/login`, so a run's recorded identity would not name the account that paid for it. */
export function claudeLoginState(env: OptionalEnvValues): LoginState {
  if (hasText(env.CLAUDE_CODE_OAUTH_TOKEN)) return { ok: true };
  if (hasText(env.ANTHROPIC_API_KEY)) return { ok: true };
  return { ok: false, reason: "neither CLAUDE_CODE_OAUTH_TOKEN nor ANTHROPIC_API_KEY is set" };
}

/** Display-only OpenRouter key report for `login status`; never a readiness gate. */
export function openrouterLoginState(env: OptionalEnvValues): LoginState {
  let apiKeyEnv: string;
  try {
    ({ apiKeyEnv } = openRouterEndpointFrom(env));
  } catch (cause) {
    return { ok: false, reason: errorMessage(cause) };
  }
  if (hasText(env[apiKeyEnv])) return { ok: true };
  return { ok: false, reason: `${apiKeyEnv} is not set` };
}
