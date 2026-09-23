/**
 * Shared repository environment loader. Every caller goes through util.parseEnv via
 * meta/env-parser.ts and receives a merged object without changing the process environment, which
 * is what keeps the backend a `login status` displays and the backend a run launches reading the
 * same values instead of two processes disagreeing about which file won.
 *
 * Precedence:
 *   process env  >  .env.cloud  >  .env.local  >  .env  >  stored Claude login (token only)
 */
import { join } from "../meta/path.ts";
import { parseEnv } from "../meta/env-parser.ts";
import { parseJsonAs } from "../meta/json-runtime.ts";
import { isString } from "../meta/json-shape.ts";
import { readOptionalConfigFile } from "./config-file.ts";
import type { OptionalEnvValues } from "./scrub-env.ts";

const REPO_ENV_FILES = [".env.cloud", ".env.local", ".env"] as const;

export interface RepoEnv {
  /** The merged view every resolution reads. */
  env: Record<string, string>;
  /** Provenance per key: "process", an env file name or the stored login. Names only, never values. */
  sources: Record<string, string>;
}

/** The stored login's file name, which doubles as the provenance label `loadRepoEnv` reports.
 *  `tools/login/cli.ts` tests the reported label against this constant, because only the stored
 *  login records an expiry — a token supplied through an env file is a setup token with no expiry
 *  to print. */
export const CLAUDE_CREDENTIAL_FILE = "claude-oauth.json";

/** The `bun run login -- claude` credential; the loader's last fallback for CLAUDE_CODE_OAUTH_TOKEN. */
export function claudeCredentialFile(repoRoot: string): string {
  return join(repoRoot, ".harness", "auth", CLAUDE_CREDENTIAL_FILE);
}

export function loadRepoEnv(repoRoot: string, processEnv: OptionalEnvValues = Bun.env): RepoEnv {
  const env: Record<string, string> = {};
  const sources: Record<string, string> = {};
  // First writer wins: process env, then each file in order, then the stored login.
  const fill = (key: string, value: string | undefined, source: string) => {
    if (value !== undefined && !(key in env)) {
      env[key] = value;
      sources[key] = source;
    }
  };
  for (const [key, value] of Object.entries(processEnv)) fill(key, value, "process");
  for (const file of REPO_ENV_FILES) {
    const raw = readOptionalConfigFile(join(repoRoot, file), file);
    if (raw === null) continue;
    for (const [key, value] of Object.entries(parseEnv(raw))) fill(key, value, file);
  }
  const stored = readOptionalConfigFile(claudeCredentialFile(repoRoot), CLAUDE_CREDENTIAL_FILE) ?? "{}";
  const { access } = parseJsonAs<{ access?: unknown }>(stored);
  fill(
    "CLAUDE_CODE_OAUTH_TOKEN",
    isString(access) ? access : undefined,
    `.harness/auth/${CLAUDE_CREDENTIAL_FILE}`,
  );
  return { env, sources };
}
