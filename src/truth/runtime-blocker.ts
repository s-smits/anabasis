/**
 * Environment-vs-product classification for solver failures.
 *
 * Two opposite misclassifications distort the rate. Counting runs blocked by exhausted credits
 * as task failures reduces it; treating every solver error as a runtime non-result shrinks the
 * denominator and increases it. Both need the same distinction: recognised provider,
 * transport, sandbox or credential messages establish a runtime failure here. Other errors remain
 * failed attempts unless the narrow no-work conditions below establish that the solver never
 * reached a usable turn.
 *
 * The matcher excludes bare "aborted" and "timeout". A
 * stall after real tool calls is a slow but real attempt, and a timeout without a recognised
 * runtime message is a genuine (failed) attempt. The narrow exceptions require zero tool calls,
 * zero tool starts, and no accepted submit: the agent never reached the loop, so whatever it
 * "failed" at was never a task attempt (runtime-probe-14 004-L0 zero-tool aborts). live-run-08
 * added the second shape: a spend-limit outage made the SDK settle every turn without the declared
 * model billing anything, the provider-degraded markers matched neither the canonical matcher nor
 * the aborted/failed shape, and 50 provider-dead cases were booked as product fails — so a solve
 * whose every outer turn completed no provider result, with zero work, is classified on the
 * controller's own completed-turn count instead of on marker prose.
 *
 * Three later gaps, each closed with one clause: the claude run's spend-limit wording ("out of
 * extra usage") filed three provider-limit cases as unaccepted; esp32-base-sol i02's close-coded
 * "WebSocket closed 1006" missed the `$` anchor (a numeric suffix is now admitted); the esp32
 * -4/-5 codex thread-creation fatal ("Session data … looks corrupt or unreadable") recorded two
 * bare aborts with no owner — anchored to the thread-open wording, so a solver's own prose about
 * corrupt session data stays a genuine failed attempt.
 *
 * A fourth gap, 2026-09-03: during the OpenAI incident "Elevated errors across ChatGPT and Codex"
 * every Codex responses call returned 404 with an empty body. pi-ai words an empty-body error as
 * the bare HTTP status text, so the Built slot's errors read `["Not Found", "turn 1 failed"]`;
 * 404 was not in the status list and the bare text matched nothing, so esp32-run57-sol-0903's
 * battery i02 recorded 25 solver-kind non-results one by one instead of stopping after five
 * provider-kind ones and re-measuring once. The status list now carries 404, and the bare status
 * text is admitted only as a whole message (`^not found$`), so a solver's own "file not found"
 * prose stays a genuine failed attempt.
 */

import { type JsonValue, isNumber, isString } from "../meta/json-shape.ts";

/** The Codex app-server's thread-open fatal. No transport produces it since the slots moved onto
 *  pi, but recorded runs carry it, and a replay must still read those cases as non-results. The
 *  thread-open wording binds it: a bare "session data ... corrupt" clause also matches a solver's
 *  own output in a session-store domain, and that genuine failed attempt would leave the
 *  denominator. */
export const CODEX_THREAD_OPEN_FATAL = /error creating thread[^\n]*session data[^\n]*(?:corrupt|unreadable)/i;

/** Explicit provider allowance exhaustion also ends authoring retries. The SDK wrapper binds
 * its otherwise ambiguous "hit your limit" text to the provider (Opus alt1 i02, three cases). */
export const PROVIDER_ALLOWANCE =
  /you'?ve hit your (?:(?:monthly|weekly) )?(?:spend|usage|session) limit|you'?ve hit your (?:monthly|weekly) limit|claude code returned an error result: you'?ve hit your limit\b|claude\.ai\/settings\/usage|upgrade to increase your usage limit/i;

/** The clauses with one reader: verifier-truth non-results arrive as typed
 * correctnessModel evidence, so prose about a missing verdict stays in the denominator. */
const PROVIDER_BLOCKER_MESSAGE =
  /\b(?:https?|status(?:\s+code)?|error(?:\s+code)?)\s*[:=]?\s*\(?(?:401|402|403|404|429|500|502|503)\b|^not found$|payment required|too many requests|internal server error|an error occurred while processing your request[^\n]*help\.openai\.com[^\n]*request id|bad gateway|unauthorized|authentication (?:expired|failed)|oauth[^\n]*(?:expired|invalid|login|required)|codex (?:run|turn) stopped|unsupported model|model (?:not found|unavailable)|insufficient credit|requires more credits|prompt tokens?\s*limit|max_tokens|low token budget|response truncated|context length|rate.?limit|no api key|missing.*api key|api[_ ]key[^\n]*\bmissing\b|api key for provider|econnreset|etimedout|enotfound|epipe|fetch failed|response stream (?:disconnected|connection failed)|stream (?:drop|dropped|disconnect(?:ed)?)|overloaded|service unavailable|usage limit|out of extra usage|spend(?:ing)? limit|quota|app-server exited|codex app-server "[a-z0-9_./-]+" timed out after \d+ms|operation not permitted, mkdir|operation not permitted.*\.codex|eperm.*\.codex|\.codex\/\.harness-app-server|spawn(?:\s+\S+)?\s+enoent|app-server cannot read|denies.*\.codex|host key verification failed|permission denied \(publickey\)|identity file[^\n]*not accessible|^websocket (?:error|closed|connection (?:closed|failed|lost|error))(?: \d{3,4}\b[^\n]*)?$|connection refused|connection closed by|no route to host|could not resolve hostname|host is unreachable|remote verifier staging failed/i;

/** Shared environment-blocker matcher used by every reader. */
export const RUNTIME_NON_RESULT_MESSAGE = new RegExp(
  [PROVIDER_BLOCKER_MESSAGE, CODEX_THREAD_OPEN_FATAL, PROVIDER_ALLOWANCE]
    .map((clause) => clause.source)
    .join("|"),
  "i",
);

interface SolverSignals {
  /** Completed tool calls across the solve, when the solver recorded them. `undefined` means
   *  unknown, so it cannot establish the no-work exception. That exception also requires
   *  a controller-known zero for started calls. */
  toolCalls: number | undefined;
  /** Controller-observed tool start events. `undefined` is unknown and fails closed. A call that
   *  started but never ended must not be mistaken for a solve that never reached the loop. */
  startedToolCalls?: number;
  acceptedSubmit: boolean;
  errors: string[];
  /** Outer turns driven and completed with a provider result — the solver's own counts on the
   *  case evidence. `undefined` is unknown and fails closed: the completed-nothing clause needs both. */
  turns?: number;
  completedTurns?: number;
}

/** The solver's non-completed turn marker (`turn N aborted` / `turn N failed`). */
const TURN_NOT_COMPLETED = /^turn \d+ (?:aborted|failed)$/;

/** First runtime/provider non-result message in a message list, or null — the evidence string
 *  every reader reports. One matcher, one reason, no reader-side copy. */
export function runtimeNonResultReason(messages: JsonValue): string | null {
  return Array.isArray(messages)
    ? (messages.find(
        (message): message is string => isString(message) && RUNTIME_NON_RESULT_MESSAGE.test(message),
      ) ?? null)
    : null;
}

/**
 * The one per-case solver classifier: the canonical matcher first, then the narrow
 * zero-tool-abort shape. Returns the evidence string to report as the runtime non-result, or
 * null when the controller already accepted verifiable bytes or the case is a genuine (possibly
 * failed) attempt that belongs in the denominator. An earlier transient error cannot erase a
 * later accepted artifact.
 */
export function solverNonResultReason(signals: SolverSignals): string | null {
  if (signals.acceptedSubmit) return null;
  const canonical = runtimeNonResultReason(signals.errors);
  if (canonical !== null) return canonical;
  if (signals.toolCalls === 0 && signals.startedToolCalls === 0) {
    const stopped = signals.errors.find((e) => TURN_NOT_COMPLETED.test(e));
    if (stopped !== undefined) {
      return `zero completed tool calls and zero tool starts with "${stopped}" and no accepted submit — the agent never reached the loop`;
    }
    // The no-completed-result condition (live-run-08): every outer turn ended without a
    // provider result, judged on the controller's completed-turn count instead of marker prose.
    // Zero starts and zero completions above restrict this exception to solves with no tool
    // work. Tool activity prevents this clause from removing a failed attempt from the count.
    if (isNumber(signals.turns) && signals.turns > 0 && signals.completedTurns === 0) {
      return `no outer turn completed a provider result (0 of ${String(signals.turns)}) with zero tool calls and no accepted submit — the provider never handed the agent a working turn`;
    }
  }
  return null;
}
