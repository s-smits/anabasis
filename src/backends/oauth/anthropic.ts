/**
 * Anthropic OAuth flow (Claude Pro/Max subscription), ported from PrimeIntellect-ai/prime-agent:
 * authorization code plus PKCE against `claude.ai`, a local callback server on port 53692 and a
 * manual paste fallback (both in callback-flow.ts).
 */
import { capturedJsonParse, capturedJsonStringify } from "../../meta/json-runtime.ts";
import { isNumber, isRecord, isString, type JsonValue } from "../../meta/json-shape.ts";
import { errorMessage } from "../../meta/runtime-values.ts";
import { type OAuthLoginOptions, resolveAuthorizationCode, startCallbackServer } from "./callback-flow.ts";
import { generatePKCE } from "./pkce.ts";

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token"; // secret-scan-allow: public OAuth endpoint of platform.claude.com, not a credential.
const CALLBACK_PORT = 53692;
const CALLBACK_PATH = "/callback";
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const SCOPES =
  "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

type AnthropicLogin = {
  access: string;
  refresh: string;
  expires: number;
};

type AnthropicLoginOptions = OAuthLoginOptions;

async function postJson(url: string, body: Record<string, string>): Promise<JsonValue> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: capturedJsonStringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP request failed. status=${response.status}; url=${url}; body=${responseBody}`);
  }
  return capturedJsonParse(responseBody);
}

function readTokenResponse(json: JsonValue, action: string): AnthropicLogin {
  if (!isRecord(json) || !isString(json.access_token) || !isString(json.refresh_token)) {
    throw new Error(`Anthropic token ${action} response missing fields`);
  }
  const expiresIn = isNumber(json.expires_in) ? json.expires_in : 0;
  return {
    refresh: json.refresh_token,
    access: json.access_token,
    expires: Date.now() + expiresIn * 1000 - 5 * 60 * 1000,
  };
}

/** Login with Claude via the Anthropic OAuth client. Opens one local callback server. */
export async function loginAnthropic(options: AnthropicLoginOptions): Promise<AnthropicLogin> {
  const { verifier, challenge } = await generatePKCE();
  // The original flow uses the PKCE verifier itself as the state value.
  const server = startCallbackServer({
    port: CALLBACK_PORT,
    path: CALLBACK_PATH,
    state: verifier,
    provider: "Claude",
  });

  const authParams = new URLSearchParams({
    code: "true",
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: verifier,
  });
  options.onAuth({
    url: `${AUTHORIZE_URL}?${authParams.toString()}`,
    instructions:
      "Complete login in your browser. If the browser is on another machine, paste the final redirect URL here.",
  });

  try {
    const { code, state } = await resolveAuthorizationCode(server, options, verifier, {
      message: "Paste the authorization code or full redirect URL:",
      placeholder: REDIRECT_URI,
    });
    options.onProgress?.("Exchanging authorization code for tokens...");
    const json = await postJson(TOKEN_URL, {
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      state,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    });
    return readTokenResponse(json, "exchange");
  } finally {
    await server.close();
  }
}

/** Exchange the stored refresh token for fresh credentials. */
export async function refreshAnthropicToken(refreshToken: string): Promise<AnthropicLogin> {
  try {
    const json = await postJson(TOKEN_URL, {
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    });
    return readTokenResponse(json, "refresh");
  } catch (error) {
    throw new Error(
      `Anthropic token refresh request failed. url=${TOKEN_URL}; details=${errorMessage(error)}`,
      {
        cause: error,
      },
    );
  }
}
