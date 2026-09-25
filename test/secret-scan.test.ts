import { describe, expect, it } from "bun:test";
import { redactProviderDiagnostic, redactTokens } from "../src/backends/diagnostic-redaction.ts";
import { scrubSecretEnv } from "../src/backends/scrub-env.ts";
import { WAIVER, scanText } from "../tools/secrets/rules.ts";
import { refusedPath, scanTree } from "../tools/secrets/scan.ts";

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
  `redactTokens("url ${SHORT_URL}")`,
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

  it("never echoes the credential it found", () => {
    const [hit] = scanText("fixture.ts", `const token = "${GITHUB_PAT}"`);
    expect(hit?.masked).not.toContain(GITHUB_PAT);
    expect(hit?.masked).toContain("[redacted");
  });

  it("honours a line that waives the scan for itself", () => {
    expect(scanText("fixture.ts", `DB: "${URL_CREDS}" // ${WAIVER}: documented`)).toEqual([]);
  });

  it("refuses a dotenv file by path, and admits its template", () => {
    expect(refusedPath(".env")).toBe(true);
    expect(refusedPath("tools/login/.env.local")).toBe(true);
    expect(refusedPath(".env.example")).toBe(false);
    expect(refusedPath("src/backends/env.ts")).toBe(false);
  });
});

describe("repository scanning covers the tested runtime credential patterns", () => {
  // The pre-commit vocabulary is the widest of the three: a repository keeps what it is given
  // forever, while an env scrub and a log redactor each drop one value at one boundary. This pins
  // this coverage relationship as a test. Either runtime redactor may recognise the fixture;
  // they do not have identical rules. In particular, redactTokens has no general JWT rule.
  // This comparison preserves that limitation while requiring the repository scanner to
  // detect all three fixture patterns.
  it("catches every value shape the runtime redactors already treat as a credential", () => {
    for (const value of [URL_CREDS, JWT, GITHUB_PAT]) {
      const droppedFromEnv = Object.keys(scrubSecretEnv({ BENIGN_NAME: value })).length === 0;
      const droppedFromLog = !redactTokens(value).includes(value);
      expect(droppedFromEnv || droppedFromLog, value).toBe(true);
      expect(scanText("fixture.ts", `x = "${value}"`), value).not.toEqual([]);
    }
  });
});

describe("the tracked tree", () => {
  // The repo-wide audit, run by `bun run test` so the gate covers it. `bun run secrets` is the same
  // scan by hand; the pre-commit hook runs it over staged additions only.
  it("carries no credential-shaped literal", () => {
    const { hits, refusedPaths } = scanTree();
    expect({ hits, refusedPaths }).toEqual({ hits: [], refusedPaths: [] });
  });
});

describe("redactTokens", () => {
  // Assembled: a continuous postgres://user:…@, api_key= or ghp- literal is what remote secret
  // scanners report.
  const urlCreds = join("post", "gres", "://", "user", ":", "pass", "@", "example.test/db");
  it.each([
    ["token gho-abcdefgh1234 leaked", "token [redacted-token] leaked"],
    ["token ghp-abcdefgh1234 leaked", "token [redacted-token] leaked"],
    ["token github_pat-abcdefgh1234 leaked", "token [redacted-token] leaked"],
    ["sk-abcdefgh1234 in the log", "[redacted-token] in the log"],
    ["xoxb-abcdefgh1234", "[redacted-token]"],
    ["xoxp-abcdefgh1234", "[redacted-token]"],
    // `or-` needs eight or more charset characters, so ordinary hyphenated words pass through.
    ["or-else this stays as-is", "or-else this stays as-is"],
    ["or-1234567", "or-1234567"],
    ["or-12345678", "[redacted-token]"],
    ["", ""],
    ["build finished in 1.2s", "build finished in 1.2s"],
    // The key=value pass re-matches the query string's own "token=" after the query pass redacts it,
    // greedily consuming the rest of the string.
    ["https://x.test/cb?token=abc123&next=/", "https://x.test/cb?token=[redacted]"],
    [`api_key=${join("abcdef", "123456")}`, "api_key=[redacted]"],
    [`GITHUB_TOKEN=${join("ghp-abcdefgh", "1234")}`, "GITHUB_TOKEN=[redacted]"],
    ["Authorization: ***", "Authorization=[redacted]"],
    [`DATABASE_URL=${urlCreds}`, "DATABASE_URL=[redacted]"],
    ["SESSION_COOKIE='sid=abc123'", "SESSION_COOKIE=[redacted]"],
    ['{"Authorization":"Bearer abc123"}', '{"Authorization"=[redacted]}'],
    [`url ${urlCreds}`, "url postgres://[redacted]@example.test/db"],
  ])("redacts %p to %p", (input, output) => {
    expect(redactTokens(input)).toBe(output);
  });

  it("redacts credential fields whose keys carry diagnostic suffixes", () => {
    for (const key of [
      "client_secret_value",
      "authorization_header",
      "password_hash",
      "credential_json",
      "private_key_pem",
      "session_cookie_value",
    ]) {
      expect(redactTokens(`${key}=example`)).toBe(`${key}=[redacted]`);
    }
  });

  it("scans one long benign field from its left edge", () => {
    const diagnostic = `${"x".repeat(20_000)}=present`;
    expect(redactTokens(diagnostic)).toBe(diagnostic);
  });
});

describe("redactProviderDiagnostic", () => {
  it("redacts account/path details while preserving useful runtime signatures", () => {
    expect(
      redactProviderDiagnostic(
        "API Error: Unable to connect to API (ConnectionRefused) for alice@example.com in /Users/alice/.claude/projects/x Authorization: BearerSecret123",
      ),
    ).toBe(
      "API Error: Unable to connect to API (ConnectionRefused) for [redacted-email] in /Users/[redacted-user]/[redacted-path] Authorization=[redacted]",
    );
  });

  it("caps diagnostics before persistence", () => {
    const result = redactProviderDiagnostic(`prefix ${"x".repeat(50)}`, 24);
    expect(result).toHaveLength(24);
    expect(result.endsWith("…")).toBe(true);
  });
});
