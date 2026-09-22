/** Shared limit for retained diagnostic text, including Codex stderr and Judge errors.
 *  Both use this value instead of defining separate 500-character limits (Sol review,
 *  run-16 review). Other outputs have different needs: scrub-env.ts allows 800 characters,
 *  while the Codex console line allows 300. Those limits remain with their callers because
 *  they govern different records and displays. */
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
      // Start only at the field's left edge. Without this boundary, a long alphanumeric diagnostic
      // retries the greedy key prefix at every byte before deciding it is not a secret field.
      /(?<![A-Za-z0-9_-])(["']?)([A-Za-z0-9_-]*(?:api[_-]?key|token|secret|password|authorization|credential|private[_-]?key|database[_-]?url|session[_-]?cookie)[A-Za-z0-9_-]*)\1\s*[:=]\s*(?:"[^"]*"|'[^']*'|\S+)/gi,
      (_match, quote: string, key: string) => `${quote}${key}${quote}=[redacted]`,
    );
}

/**
 * Provider SDK diagnostics can include useful outage signatures plus account, header, or local-path
 * details. Keep the diagnostic usable for runtime-blocker matching, but remove private/account-shaped
 * details and cap the string before it is persisted in turn-summary evidence.
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
