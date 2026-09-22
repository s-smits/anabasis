/**
 * Stores credentials for provider logins. Codex credentials are written in the
 * exact `auth.json` shape the official Codex CLI reads (verified against a live CLI file);
 * A Claude login is one file under `.harness/auth/`: refresh material plus the access token, which
 * `loadRepoEnv` reads as its last fallback for CLAUDE_CODE_OAUTH_TOKEN. Nothing here reads secrets
 * back for display; `login status` reports source and expiry only.
 */

import { capturedJsonStringify } from "../../meta/json-runtime.ts";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "../../meta/filesystem.ts";
import { readJsonFile } from "../../meta/completed-json.ts";
import { isRecord, type JsonValue } from "../../meta/json-shape.ts";
import { errorCode } from "../../meta/runtime-values.ts";
import { keyIfDefined } from "../../meta/optional-key.ts";
import { dirname } from "../../meta/path.ts";
import type { OpenAICodexLogin } from "./openai-codex.ts";
import { codexAuthFile, codexLogin } from "../login-state.ts";
import { claudeCredentialFile } from "../env.ts";
import type { OptionalEnvValues } from "../scrub-env.ts";

/** How long a process waits for another's Codex refresh before it takes the lock over: the holder
 *  died mid-refresh, since one token exchange is bounded well inside this. */
const CODEX_REFRESH_LOCK_WAIT_MS = 60_000;

/** The credential payload of a Claude login: refreshable OAuth state plus its access token. */
type ClaudeCredential = {
  access: string;
  refresh: string;
  expires: number;
  updatedAt: string;
};

function writePrivateFile(file: string, contents: string): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, contents);
  // `writeFileSync` mode only applies at creation; a rewrite of an existing file keeps its old
  // permissions, so the private mode is enforced on every write.
  chmodSync(file, 0o600);
}

/**
 * Persist a ChatGPT login as the Codex CLI's own `auth.json`. Field names and nesting match the
 * structure of the live CLI file; `OPENAI_API_KEY` stays null because this login
 * never holds an API key.
 */
export function writeCodexAuthJson(login: OpenAICodexLogin, env: Record<string, string | undefined>): string {
  const file = codexAuthFile(env);
  writePrivateFile(
    file,
    `${capturedJsonStringify(
      {
        auth_mode: "chatgpt",
        OPENAI_API_KEY: null,
        tokens: {
          id_token: login.idToken ?? "",
          access_token: login.access,
          refresh_token: login.refresh,
          account_id: login.accountId,
        },
        last_refresh: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  return file;
}

/** Take the refresh lock beside `auth.json`: a directory, which only one process can create. */
async function lockCodexRefresh(lock: string): Promise<void> {
  let deadline = Date.now() + CODEX_REFRESH_LOCK_WAIT_MS;
  for (;;) {
    try {
      mkdirSync(lock);
      return;
    } catch (cause) {
      if (errorCode(cause) !== "EEXIST") throw cause;
    }
    if (Date.now() >= deadline) {
      rmSync(lock, { recursive: true, force: true });
      deadline = Date.now() + CODEX_REFRESH_LOCK_WAIT_MS;
    }
    await Bun.sleep(200);
  }
}

/** The stored file with the refreshed tokens in place and every other field kept, as the Codex CLI
 *  rewrites its own after a refresh. An id token the exchange did not return stays as stored. */
function refreshedAuthJson(stored: JsonValue, next: OpenAICodexLogin): Record<string, JsonValue> {
  const file = isRecord(stored) ? stored : {};
  const tokens = isRecord(file.tokens) ? file.tokens : {};
  return {
    ...file,
    tokens: {
      ...tokens,
      ...keyIfDefined("id_token", next.idToken ?? undefined),
      access_token: next.access,
      refresh_token: next.refresh,
      account_id: next.accountId,
    },
    last_refresh: new Date().toISOString(),
  };
}

/**
 * Refresh the stored Codex login when it is due, once across processes. The first process to take
 * the lock reads the file again (another may have refreshed it meanwhile), exchanges the refresh
 * token through `refresh` and writes the result back; the rest wait and then find the login no
 * longer due. The refresh token rotates, so two processes exchanging the same one would leave the
 * second, and the file, holding a spent token.
 */
export async function refreshCodexAuthJson(
  env: OptionalEnvValues,
  refresh: (refreshToken: string) => Promise<OpenAICodexLogin>,
): Promise<void> {
  const file = codexAuthFile(env);
  const lock = `${file}.refresh-lock`;
  await lockCodexRefresh(lock);
  try {
    const login = codexLogin(env);
    if (!login.ok || login.refreshToken === null || login.refreshDueAt > Date.now()) return;
    const next = await refresh(login.refreshToken);
    writePrivateFile(
      file,
      `${capturedJsonStringify(refreshedAuthJson(readJsonFile(file), next), null, 2)}\n`,
    );
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/** Store the refreshable Claude credential under `.harness/auth/` (gitignored, mode 0600). */
export function writeClaudeCredential(repoRoot: string, credential: ClaudeCredential): string {
  const file = claudeCredentialFile(repoRoot);
  writePrivateFile(file, `${capturedJsonStringify(credential, null, 2)}\n`);
  return file;
}
