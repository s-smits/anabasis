/**
 * OpenAI Codex (ChatGPT OAuth) flow.
 *
 * Ported from the PrimeIntellect-ai/prime-agent implementation of the same flow rather than written
 * fresh, because the authorisation endpoint accepts exactly one shape and a reimplementation would
 * have had to discover it: PKCE against `auth.openai.com`, one local callback server on the fixed
 * port 1455, and a manual paste fallback for a host with no browser to redirect. The state bytes
 * come from Web Crypto and every JSON response is checked before a field is read, since both the
 * redirect and the token response are external input. Capturing the `id_token` is what lets the
 * credential be stored in the exact shape the official Codex CLI writes, so a login taken here and
 * a login taken with that CLI are interchangeable afterwards. The callback server and the race
 * between it and the paste live in callback-flow.ts.
 */
import { capturedJsonParse } from "../../meta/json-runtime.ts";
import { isNumber, isRecord, isString, type JsonValue } from "../../meta/json-shape.ts";
import { errorMessage } from "../../meta/runtime-values.ts";
import { type OAuthLoginOptions, resolveAuthorizationCode, startCallbackServer } from "./callback-flow.ts";
import { generatePKCE } from "./pkce.ts";
import { hasText } from "../../meta/text.ts";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token"; // secret-scan-allow: public OAuth endpoint of auth.openai.com, not a credential.
const CALLBACK_PORT = 1455;
const CALLBACK_PATH = "/auth/callback";
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const SCOPE = "openid profile email offline_access";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";
/** One token exchange may take this long; the refresh lock's waiters rely on the bound. */
const EXCHANGE_TIMEOUT_MS = 30_000;

export type OpenAICodexLogin = {
  access: string;
  refresh: string;
  expires: number;
  idToken: string | null;
  accountId: string;
};

type OpenAICodexLoginOptions = OAuthLoginOptions;

/** One decoded JWT payload: JSON values only; login tokens are read here, never trusted. */
type DecodedJwtPayload = Record<string, JsonValue> | null;

/** Decode an unsigned JWT payload without verifying it. */
export function decodeJwtPayload(token: string): DecodedJwtPayload {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const bytes = Uint8Array.fromBase64(parts[1] ?? "", { alphabet: "base64url" });
    const payload = capturedJsonParse(new TextDecoder().decode(bytes));
    return isRecord(payload) ? payload : null;
  } catch {
    return null;
  }
}

/** Read the ChatGPT account id from a namespaced claim in the access token. */
export function getAccountId(accessToken: string): string | null {
  const claim = decodeJwtPayload(accessToken)?.[JWT_CLAIM_PATH];
  if (!isRecord(claim)) return null;
  const accountId = claim.chatgpt_account_id;
  return isString(accountId) && accountId.length > 0 ? accountId : null;
}

/**
 * One token exchange, for a login's authorization code or a stored login's refresh token; a failed
 * request, a non-2xx status or a short response all throw.
 */
async function exchangeCode(body: Record<string, string>): Promise<OpenAICodexLogin> {
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`OpenAI Codex token exchange error: ${errorMessage(error)}`, { cause: error });
  }
  const text = await response.text();
  if (!response.ok) throw new Error(`OpenAI Codex token exchange failed (${response.status}): ${text}`);
  const json = capturedJsonParse(text);
  if (
    !isRecord(json) ||
    !isString(json.access_token) ||
    !isString(json.refresh_token) ||
    !isNumber(json.expires_in)
  ) {
    throw new Error(`OpenAI Codex token exchange response missing fields`);
  }
  const accountId = getAccountId(json.access_token);
  if (!hasText(accountId)) throw new Error("Failed to extract accountId from token");
  return {
    access: json.access_token,
    refresh: json.refresh_token,
    expires: Date.now() + json.expires_in * 1000,
    idToken: isString(json.id_token) ? json.id_token : null,
    accountId,
  };
}

/** A stored login's refresh, through the same client and in the same shape as the login. The
 *  refresh token rotates: the one passed in is spent once this resolves. */
export function refreshOpenAICodex(refreshToken: string): Promise<OpenAICodexLogin> {
  return exchangeCode({
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
    scope: "openid profile email",
  });
}

/** Login with ChatGPT via the Codex OAuth client. Opens one local callback server. */
export async function loginOpenAICodex(options: OpenAICodexLoginOptions): Promise<OpenAICodexLogin> {
  const { verifier, challenge } = await generatePKCE();
  const stateBytes = new Uint8Array(16);
  crypto.getRandomValues(stateBytes);
  const state = stateBytes.toHex();

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", "anabasis");

  const server = startCallbackServer({
    port: CALLBACK_PORT,
    path: CALLBACK_PATH,
    state,
    provider: "ChatGPT",
  });
  options.onAuth({
    url: url.toString(),
    instructions: "A browser window should open. Complete login to finish.",
  });

  try {
    const { code } = await resolveAuthorizationCode(server, options, state, {
      message: "Paste the authorization code (or full redirect URL):",
    });
    options.onProgress?.("Exchanging authorization code for tokens...");
    return await exchangeCode({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    });
  } finally {
    await server.close();
  }
}
