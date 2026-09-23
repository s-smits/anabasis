/** Shared limit for retained diagnostic text. The Judge's own error capture
 *  (`src/truth/judge-drivers.ts`) uses this value rather than defining a second 500-character limit
 *  beside it, so the two records agree on how much of a failure they keep. A caller with a
 *  different record to govern passes its own bound instead: the trace's `PREVIEW_CHARS` does. */
export const DEFAULT_DIAGNOSTIC_MAX_CHARS = 500;

/**
 * Scrub provider tokens and secret-shaped key/value pairs out of text before it reaches a log line,
 * persisted turn evidence, stderr tail, or SSE frame.
 */
export function redactTokens(text: string): string {
  return text
    .replace(/(:\/\/)[^/\s:@]+:[^/\s@]+@/g, "$1[redacted]@")
    .replace(/\b(?:github_pat|gho|ghp|ghs|sk|or|xox[baprs]?)[-_][A-Za-z0-9_=-]{8,}\b/g, "[redacted-token]")
    .replace(/([?&](?:token|key|signature|sig|access_token)=)[^\s&]+/gi, "$1[redacted]")
    .replace(
      // Start only at the field's left edge. Without that boundary a long alphanumeric diagnostic
      // retries the greedy key prefix at every byte before deciding it is not a secret field.
      /(?<![A-Za-z0-9_-])(["']?)([A-Za-z0-9_-]*(?:api[_-]?key|token|secret|password|authorization|credential|private[_-]?key|database[_-]?url|session[_-]?cookie)[A-Za-z0-9_-]*)\1\s*[:=]\s*(?:"[^"]*"|'[^']*'|\S+)/gi,
      (_match, quote: string, key: string) => `${quote}${key}${quote}=[redacted]`,
    );
}

/**
 * Provider SDK diagnostics carry useful outage signatures and, beside them, account, header and
 * local-path details. Both matter: the diagnostic has to stay usable for runtime-blocker matching,
 * which reads those signatures, while the private and account-shaped details are removed and the
 * string is capped before it is persisted in turn-summary evidence.
 */
export function redactProviderDiagnostic(text: string, maxChars = DEFAULT_DIAGNOSTIC_MAX_CHARS): string {
  const redacted = redactTokens(text)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/(?<![\w.-])~\/[^\s;,)]+/g, "~/[redacted-path]")
    .replace(/(\/Users|\/home)\/[^/\s;,)]+(?:\/[^\s;,)]+)*/g, "$1/[redacted-user]/[redacted-path]")
    .replace(/\s+/g, " ")
    .trim();
  return maxChars <= 0 || redacted.length <= maxChars
    ? redacted
    : `${redacted.slice(0, Math.max(0, maxChars - 1))}…`;
}
