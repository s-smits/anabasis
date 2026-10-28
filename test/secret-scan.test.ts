import { describe, expect, it } from "bun:test";
import { scanText } from "../tools/secrets/rules.ts";
import { refusedPath } from "../tools/secrets/scan.ts";

// Credential-shaped fixtures below are assembled at run time. A test for a secret scanner that
// spelled its fixtures out would be the first thing the scanner reports, and the repository's own
// three false-positive incidents came from exactly that: fixtures written for a reader instead of
// for a scanner. Parts stay below the continuous-string threshold GitGuardian (and our own gate)
// classify as a secret; the assembled bytes are what the rules see, so the coverage is unchanged.
const join = (...parts: string[]): string => parts.join("");
const b64url = (value: string): string =>
  new TextEncoder().encode(value).toBase64({ alphabet: "base64url", omitPadding: true });
// Scheme, user, password, and host never sit on one continuous source token.
const URL_CREDS = join("post", "gres", "://", "user", ":", "p4", "ss", "@", "db.host:5432/app");
// No classic JWT header/payload/signature literals: each segment is base64url of plain JSON.
const JWT = [b64url('{"alg":"HS256","typ":"JWT"}'), b64url('{"sub":"1234"}'), b64url("sig-fixture")].join(
  ".",
);
const GITHUB_PAT = ["ghp", "16C7e42F292c6912E7710c838347Ae178B4a"].join("_");
const HEX_KEY = join("9f8c2b1e4d7a", "6f3c0b5e8d1a", "2c4f6b9e");
// Short stand-in (u:p) — our rules and remote scanners treat it as non-credential.
const SHORT_URL = join("post", "gres", "://", "u", ":", "p", "@", "example.test/db");

const MUST_FIRE: ReadonlyArray<readonly [string, string]> = [
  // The three shapes that opened real incidents on this repository's first push.
  ["url-credentials", `DB: "${URL_CREDS}"`],
  ["json-web-token", `APP_JWT: "${JWT}"`],
  ["provider-key", `Authorization: Bearer ${join("sk-ant-api03-", "Xy7Qm2Lp9RtVw4Zc8Nb1Hj6Kd3Gs0Ge5")}`],
  ["provider-key", `const token = "${GITHUB_PAT}"`],
  ["aws-access-key-id", `aws: "${join("AKIA", "5J3KLMNOPQRSTUVW")}"`],
  ["private-key-block", join("-----BEGIN RSA PRIVATE ", "KEY-----")],
  ["secret-assignment", `const apiKey = ${JSON.stringify(HEX_KEY)}`],
];

// Every one of these was a live false positive on the tracked tree before the rules were tuned.
// A scanner that fires on names, markers, and declared fixtures is a scanner people learn to skip.
const MUST_NOT_FIRE: readonly string[] = [
  'apiKeyEnv: "OPENROUTER_API_KEY",',
  'ANTHROPIC_API_KEY: "ambient-key",',
  'native: { secret: "RAW-NATIVE-MARKER" }',
  `fixture("url ${SHORT_URL}")`,
  'OPENROUTER_API_KEY: "sk-or-fake000000000000",',
  "const token = process.env.ANTHROPIC_API_KEY;",
  'url: "https://api.example.com/v1"',
];

describe("secret scan rules", () => {
  it("reports every credential shape, naming the rule that fired", () => {
    for (const [rule, line] of MUST_FIRE) {
      const hits = scanText("fixture.ts", line);
      expect(
        hits.map((h) => h.rule),
        line,
      ).toContain(rule);
    }
  });

  it("stays quiet on env var names, markers, and declared fakes", () => {
    for (const line of MUST_NOT_FIRE) {
      expect(scanText("fixture.ts", line), line).toEqual([]);
    }
  });

  it("redacts before it bounds, so a credential across the display bound leaves no part behind", () => {
    // The credential starts five bytes before the 200-byte bound, so a cut first keeps its prefix.
    const [hit] = scanText("fixture.ts", `const token = "${"a ".repeat(90)}${GITHUB_PAT}"`);
    expect(hit?.masked).not.toContain(GITHUB_PAT.slice(0, 4));
    expect(hit?.masked).toContain("bytes omitted]");
  });

  it("refuses a dotenv file by path, and admits its template", () => {
    expect(refusedPath(".env")).toBe(true);
    expect(refusedPath("tools/login/.env.local")).toBe(true);
    expect(refusedPath(".env.example")).toBe(false);
    expect(refusedPath(".env.runs.example")).toBe(false);
    expect(refusedPath(".env.runs")).toBe(true);
    expect(refusedPath("src/backends/env.ts")).toBe(false);
  });
});
