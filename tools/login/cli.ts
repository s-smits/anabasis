/**
 * `bun run login` — operator logins for the provider backends.
 *
 *   bun run login -- codex    ChatGPT OAuth into the Codex CLI's own ~/.codex/auth.json. Runs read
 *                             that file at every turn and never refresh it; the Codex CLI does.
 *   bun run login -- claude   Claude subscription OAuth into .harness/auth/claude-oauth.json, or a
 *                             silent refresh when that file already holds refresh material. The env
 *                             loader reads its token last, so CLAUDE_CODE_OAUTH_TOKEN set in the
 *                             process env or any env file names the account instead.
 *   bun run login -- status   which kinds are logged in and which source supplies the Claude token
 *
 * Each interactive flow opens one local callback server and races a manual paste prompt against
 * it, so headless hosts work by pasting the redirect URL from another machine's browser.
 */

import { readFileSync } from "../../src/meta/filesystem.ts";
import { runtimeProcess } from "../../src/meta/process.ts";
import { parseJsonAs } from "../../src/meta/json-runtime.ts";
import { isNumber, isString } from "../../src/meta/json-shape.ts";
import { CLAUDE_CREDENTIAL_FILE, claudeCredentialFile, loadRepoEnv } from "../../src/backends/env.ts";
import { readOptionalConfigFile } from "../../src/backends/config-file.ts";
import {
  claudeLoginState,
  codexAccessTokenExpiresAt,
  codexLoginState,
  openrouterLoginState,
} from "../../src/backends/login-state.ts";
import { loginAnthropic, refreshAnthropicToken } from "../../src/backends/oauth/anthropic.ts";
import { loginOpenAICodex } from "../../src/backends/oauth/openai-codex.ts";
import { writeClaudeCredential, writeCodexAuthJson } from "../../src/backends/oauth/storage.ts";
import type { OAuthLoginOptions } from "../../src/backends/oauth/callback-flow.ts";
import { errorMessage } from "../../src/meta/runtime-values.ts";
import { hasText } from "../../src/meta/text.ts";

const repoRoot = runtimeProcess.cwd();

/** The one stdin reader every prompt shares. `Bun.stdin.stream()` is a single stream and a
 *  cancelled reader keeps its lock, so a second reader per prompt failed with "ReadableStream is
 *  locked" as soon as an empty paste sent the flow on to its fallback prompt. */
let stdinReader:
  | { read(): Promise<{ done: boolean; value?: Uint8Array | undefined }>; cancel(): Promise<void> }
  | undefined;
let stdinBuffer = "";
let stdinClosed = false;
const stdinDecoder = new TextDecoder();

/** One line of stdin; at end of input, what is left, and after that an empty answer. */
async function promptLine(message: string): Promise<string> {
  await Bun.write(Bun.stdout, `${message} `);
  const reader = (stdinReader ??= Bun.stdin.stream().getReader());
  for (;;) {
    const newline = stdinBuffer.indexOf("\n");
    if (newline !== -1) {
      const line = stdinBuffer.slice(0, newline);
      stdinBuffer = stdinBuffer.slice(newline + 1);
      return line.trim();
    }
    if (stdinClosed) {
      const rest = stdinBuffer;
      stdinBuffer = "";
      return rest.trim();
    }
    const { done, value } = await reader.read();
    if (done) stdinClosed = true;
    else stdinBuffer += stdinDecoder.decode(value, { stream: true });
  }
}

/** Ends stdin for this process, settling a pending read, so nothing holds the process open. */
function releaseStdin(): void {
  stdinClosed = true;
  void stdinReader?.cancel().catch(() => {});
}

/** Both OAuth flows share these prompts; the losing stdin reader is released when the browser
 *  callback wins, so no second stdin consumer lingers until exit. */
const prompts: OAuthLoginOptions = {
  onAuth: (info) => {
    console.log(`\nOpen this URL to log in:\n\n  ${info.url}\n`);
    if (hasText(info.instructions)) console.log(info.instructions);
  },
  onPrompt: async (prompt) => promptLine(prompt.message),
  onProgress: (message) => console.log(message),
  onManualCodeInput: () => {
    console.log("Or paste the authorization code / redirect URL here (Ctrl-C to abort):");
    return promptLine(">");
  },
  onManualCodeCancel: releaseStdin,
};

function expiry(expiresAt: Date | null): string {
  if (expiresAt === null) return "";
  return ` (token ${expiresAt.getTime() <= Date.now() ? "expired" : "expires"} ${expiresAt.toISOString()})`;
}

async function loginClaude(): Promise<void> {
  const stored = readOptionalConfigFile(claudeCredentialFile(repoRoot), CLAUDE_CREDENTIAL_FILE);
  const refresh = stored === null ? undefined : parseJsonAs<{ refresh?: unknown }>(stored).refresh;
  const login =
    isString(refresh) && refresh ? await refreshAnthropicToken(refresh) : await loginAnthropic(prompts);
  console.log(
    `Claude login stored in ${writeClaudeCredential(repoRoot, { ...login, updatedAt: new Date().toISOString() })}`,
  );
}

function status(): void {
  const { env, sources } = loadRepoEnv(repoRoot);
  const codex = codexLoginState(env);
  console.log(
    `codex:      ${codex.ok ? `logged in${expiry(codexAccessTokenExpiresAt(env))}` : `not logged in (${codex.reason})`}`,
  );

  const claude = claudeLoginState(env);
  let detail = claude.ok
    ? ` via ${sources.CLAUDE_CODE_OAUTH_TOKEN ?? "ANTHROPIC_API_KEY"}`
    : ` (${claude.reason})`;
  // Only the stored login records an expiry; an operator token from an env file is a setup token.
  if (detail.endsWith(CLAUDE_CREDENTIAL_FILE)) {
    const stored = parseJsonAs<{ expires?: unknown }>(readFileSync(claudeCredentialFile(repoRoot), "utf8"));
    detail = `${isNumber(stored.expires) ? expiry(new Date(stored.expires)) : ""}${detail}`;
  }
  console.log(`claude:     ${claude.ok ? "logged in" : "not logged in"}${detail}`);

  const openrouter = openrouterLoginState(env);
  console.log(`openrouter: ${openrouter.ok ? "logged in" : `not logged in (${openrouter.reason})`}`);
}

try {
  const command = Bun.argv[2];
  if (command === "codex") {
    // The merged repo env the runtime resolves, so a CODEX_HOME set in an env file lands where the
    // launched backend will read it.
    console.log(
      `ChatGPT login stored in ${writeCodexAuthJson(await loginOpenAICodex(prompts), loadRepoEnv(repoRoot).env)}`,
    );
  } else if (command === "claude") await loginClaude();
  else if (command === "status") status();
  else throw new Error("usage: bun run login -- <codex|claude|status>");
} catch (error) {
  console.error(errorMessage(error));
  runtimeProcess.exitCode = 1;
} finally {
  releaseStdin();
}
