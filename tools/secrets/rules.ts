// Credential patterns forbidden from entering Git history (ported from v1's
// `tools/secrets/rules.ts`). Because v2 constructs child process environments from an explicit
// allowlist rather than scrubbing inherited environments, this is the sole credential rule set.
//
// Rules match value shapes rather than variable names alone: name-only rules trigger false
// positives on documentation and tests discussing credentials, eroding signal-to-noise ratio.

import { boundText } from "../../src/meta/bounded-text.ts";

interface SecretRule {
  id: string;
  /** Short noun phrase describing the matched credential class for operator output. */
  what: string;
  /** Global regular expression so multiple hits on a single line are all reported. */
  pattern: RegExp;
  /** Capture group containing the secret value; defaults to the full match when omitted. */
  valueGroup?: number;
}

const RULES: readonly SecretRule[] = [
  {
    id: "url-credentials",
    what: "credentials embedded in a URL",
    // Capture only the password segment, ignoring 1-3 character placeholders such as `postgres://u:p@host`.
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

// Heuristic filter for common fixture placeholders (including the repository's example password
// `hunter2`). Real credentials may occasionally match these tokens, so fixtures should still use
// obvious synthetic markers.
const PLACEHOLDER =
  /fake|dummy|example|sample|placeholder|redacted|scrubbed|changeme|change-me|secret|password|passwd|hunter2|deadbeef|foo|bar|baz|todo|xxx|1234|test|\bnone\b|\bnull\b|\byour\b|your[-_]|\.\.\.|\$\{|\{\{|<[A-Za-z]/i;

/** Matches runs of six or more identical characters (such as `aaaaaaaa` or `00000000`), treated as placeholders. */
const REPEATED = /(.)\1{5,}/;

/** Inline waiver token that suppresses secret scanning on the containing line. Kept verbose so
 *  waivers stand out in diffs and are easy to audit with `git grep`. */
export const WAIVER = "secret-scan-allow";

export interface SecretHit {
  path: string;
  line: number;
  rule: string;
  what: string;
  /** Redacted excerpt of the source line; the matched credential itself is never echoed. */
  masked: string;
}

/** Heuristic filter treating single-case alphabetic strings (with optional separators and no
 *  digits) as identifiers or prose rather than secrets. The 16-character length floor ensures
 *  separator-free passphrases such as `correcthorsebatterystaple` are still reported. */
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
      // Redact before truncating so truncation cannot split the matched value and leave part of it visible.
      const redacted = value ? text.split(value).join(`[redacted ${value.length} chars]`) : text;
      hits.push({ path, line, rule: rule.id, what: rule.what, masked: boundText(redacted, 200).shown });
    }
  }
  return hits;
}

export function scanText(path: string, text: string): SecretHit[] {
  return text
    .split("\n")
    .flatMap((line, index) => scanLine(path, index + 1, line.length > 4000 ? line.slice(0, 4000) : line));
}
