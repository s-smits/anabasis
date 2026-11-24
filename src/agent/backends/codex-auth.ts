import type { OAuthCredential } from "@earendil-works/pi-ai";
import { existsSync, readFileSync } from "../../meta/filesystem.ts";
import { capturedJsonParse } from "../../meta/json-runtime.ts";
import { asRecord, isNumber, isString } from "../../meta/json-shape.ts";
import { homedir } from "../../meta/os.ts";
import { join } from "../../meta/path.ts";

export type CodexAuthState = "ready" | "expired" | "missing" | "invalid";

export const CODEX_AUTH = "auth.json";

export function codexAuthFile(): string {
  return join(Bun.env.CODEX_HOME ?? join(homedir(), ".codex"), CODEX_AUTH);
}

export function codexCredential(): OAuthCredential {
  const tokens = asRecord(asRecord(capturedJsonParse(readFileSync(codexAuthFile(), "utf8")))?.tokens);
  const access = tokens?.access_token;
  const refresh = tokens?.refresh_token;
  if (!isString(access) || !isString(refresh)) throw new Error(`${codexAuthFile()} holds no ChatGPT login`);
  const claims = asRecord(
    capturedJsonParse(Buffer.from(access.split(".")[1] ?? "", "base64url").toString("utf8")),
  );
  const expires = claims?.exp;
  if (!isNumber(expires)) throw new Error(`${codexAuthFile()}: the access token carries no expiry`);
  return { type: "oauth", access, refresh, expires: expires * 1000 };
}

export function codexAuthStatus(now = Date.now()): CodexAuthState {
  if (!existsSync(codexAuthFile())) return "missing";
  try {
    return codexCredential().expires > now ? "ready" : "expired";
  } catch {
    return "invalid";
  }
}
