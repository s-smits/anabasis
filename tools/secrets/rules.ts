// What may not enter git history. This is a third credential vocabulary beside
// src/backends/scrub-env.ts (what may not reach a child process env) and
// src/backends/diagnostic-redaction.ts (what may not reach a log line): the three refuse at
// different boundaries and this one is the widest, since a repository keeps what it is given
// in its history. test/secret-scan.test.ts checks the connection between these rules:
// the credential formats covered by its runtime-redaction cases must be caught here too.
//
// The rules read VALUE SHAPES, not names. A name-only rule ("a line mentioning PASSWORD") fires on
// the prose and the tests that discuss credentials. Repeated false alarms make it harder to
// distinguish a real credential from a harmless reference to one.

interface SecretRule {
  id: string;
  /** What the operator is told the match is, in one noun phrase. */
  what: string;
  /** Global, so one line can carry several hits. */
  pattern: RegExp;
  /** Which capture carries the credential; the whole match when absent. */
  valueGroup?: number;
}

const RULES: readonly SecretRule[] = [
  {
    id: "url-credentials",
    what: "credentials embedded in a URL",
    // The password segment only; a 1-2 char stand-in like postgres://u:p@host is not a credential.
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@"']+:([^/\s@"']{4,})@/gi,
    valueGroup: 1,
  },
  {
    id: "json-web-token",
    what: "a JSON Web Token",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  },
  {
    id: "provider-key",
    what: "a provider API key or access token",
    pattern: /\b(?:sk|pk|rk|ghp|gho|ghs|ghu|github_pat|glpat|xox[baprs]|shpat|dop_v1)[-_][A-Za-z0-9_-]{12,}/g,
  },
  {
    id: "aws-access-key-id",
    what: "an AWS access key id",
    pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g,
  },
  {
    id: "google-api-key",
    what: "a Google API key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    id: "private-key-block",
    what: "a private key block",
    pattern: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g,
  },
  {
    id: "secret-assignment",
    what: "a credential-named field assigned a literal",
    pattern:
      /["'`]?\b([A-Za-z0-9_-]*(?:api[_-]?key|apikey|secret|token|passwd|password|credential|private[_-]?key)[A-Za-z0-9_-]*)["'`]?\s*[:=]\s*["'`]([^"'`\n]{8,})["'`]/gi,
    valueGroup: 2,
  },
] as const;

// Recognise the placeholder words used by fixtures. This is a heuristic: a real credential can
// contain one of these strings too. Fixtures deliberately include a marker so their purpose is
// visible. `hunter2` is this repository's fixture password; it stays in this list so the scanner
// does not repeatedly report that known example.
const PLACEHOLDER =
  /fake|dummy|example|sample|placeholder|redacted|scrubbed|changeme|change-me|secret|password|passwd|hunter2|deadbeef|foo|bar|baz|todo|xxx|1234|test|\bnone\b|\bnull\b|\byour\b|your[-_]|\.\.\.|\$\{|\{\{|<[A-Za-z]/i;

/** A run of one repeated character (`aaaaaaaa`, `00000000`) is a stand-in, whatever it spells. */
const REPEATED = /(.)\1{5,}/;

/** Any line may waive the scan for itself. Kept deliberately verbose so it reads as a decision in
 *  a diff rather than as noise, and so `git grep` finds every waiver in one query. */
export const WAIVER = "secret-scan-allow";

export interface SecretHit {
  path: string;
  line: number;
  rule: string;
  what: string;
  /** The source line with the credential itself replaced — the report never echoes the secret. */
  masked: string;
}

/** Treat single-case words with letters and separators but no digits as likely names, such as
 *  env vars, markers or English phrases. This is a heuristic. The length floor keeps a
 *  separator-free passphrase (`correcthorsebatterystaple`) on the reporting side of the line. */
function isWordy(value: string): boolean {
  if (!/^[A-Za-z][A-Za-z_\-. ]*$/.test(value)) return false;
  if (value !== value.toLowerCase() && value !== value.toUpperCase()) return false;
  return value.length < 16 || /[-_. ]/.test(value);
}

function scanLine(path: string, line: number, text: string): SecretHit[] {
  if (text.includes(WAIVER)) return [];
  const hits: SecretHit[] = [];
  for (const rule of RULES) {
    for (const match of text.matchAll(rule.pattern)) {
      const value = match[rule.valueGroup ?? 0] ?? "";
      if (PLACEHOLDER.test(value) || REPEATED.test(value) || isWordy(value)) continue;
      hits.push({ path, line, rule: rule.id, what: rule.what, masked: mask(text, value) });
    }
  }
  return hits;
}

export function scanText(path: string, text: string): SecretHit[] {
  return text
    .split("\n")
    .flatMap((line, index) => scanLine(path, index + 1, line.length > 4000 ? line.slice(0, 4000) : line));
}

function mask(text: string, value: string): string {
  const trimmed = text.trim().slice(0, 200);
  if (!value) return trimmed;
  return trimmed.split(value).join(`[redacted ${value.length} chars]`);
}
