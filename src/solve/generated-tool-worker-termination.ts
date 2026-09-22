/** How a generated-tool worker's run ends, and who owns the ending.
 *
 *  Every case a battery schedules is paid for, so the difference between the candidate's code
 *  crashing and the host running out of patience decides whether the run reports a capability
 *  result or a typed non-result. These three judgements are the ones the close path makes, and
 *  they are pure: the client around them keeps the child, the pipes and the timers. */

import type { BuiltStarterNonResult, GeneratedToolWorkerEvidence } from "./built-starter.ts";

/** Whatever ended the run, said in the worker's own name so a log line stands alone. */
type Cause = BuiltStarterNonResult;

/** Whether the worker's `ready` frame was admitted, which is the phase these three judgements turn on. */
type Handshake = "done" | "pending";

/** Whether the child reported its isolation installed, which decides who owns a startup wait. */
type Walls = "installed" | "pending";

export const PENDING_REQUESTS_AT_CLOSE = "closed with pending requests";

/** `deadline` is set only when the host's own wait limit ended the operation, so its absence is
 *  the ordinary case rather than an unknown. */
function cause(kind: Cause["kind"], message: string, deadline = false): Cause {
  const named: Cause = { kind, message: `generated-tool worker ${message}` };
  if (deadline) named.deadline = true;
  return named;
}

/** Why this worker may not simply be closed, or `null` when it may. The unready case is named
 *  first: a worker that never reached its handshake also explains any request still in flight. */
export function closeRefusal(handshake: Handshake, activeRequests: number): Cause | null {
  if (handshake === "pending") return cause("runtime", "closed before its ready handshake");
  if (activeRequests > 0) return cause("protocol", PENDING_REQUESTS_AT_CLOSE);
  return null;
}

/** Who owns a child's ending. `exit` carries a code or a signal and never both — the caller has
 *  already unwrapped a Bubblewrap signal out of the code — so a signalled worker keeps the
 *  broader "runtime" kind rather than being recorded as a crash it did not commit. "crash" is
 *  reserved for generated code dying after its handshake and may never be assigned to the
 *  environment. Two paths ask: a close that found the child gone, and a child that exited
 *  while the controller still expected it. */
export function exitOwner(handshake: Handshake, exit: { code: number | null }): Cause["kind"] {
  return handshake === "done" && exit.code !== null && exit.code !== 0 ? "crash" : "runtime";
}

/** The ending itself, for a close that has a child's exit to report. */
export function exitTermination(
  prefix: string,
  exit: { code: number | null; signal: string | null },
  handshake: Handshake,
): GeneratedToolWorkerEvidence["termination"] {
  if (exit.code === 0) return { status: "normal" };
  return {
    status: "non-result",
    ...cause(exitOwner(handshake, exit), `${prefix} with ${String(exit.code ?? exit.signal)}`),
  };
}

/** A startup the host stopped waiting for, classified by the last phase the worker reported.
 *  Before its walls are installed the wait is the host's, and `deadline` says so. Afterwards
 *  the wait is on candidate code loading, which no environment reader may claim. */
export function readyTimeoutCause(walls: Walls, readyTimeoutMs: number): Cause {
  return walls === "installed"
    ? cause(
        "runtime",
        `did not finish loading the candidate harness within ${readyTimeoutMs}ms of its walls being installed`,
      )
    : cause("runtime", "timed out before its ready handshake", true);
}
