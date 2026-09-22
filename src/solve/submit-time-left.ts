/**
 * The first submit of a Built solve that still has a quarter or more of its time answers with the
 * time left instead of sending, once. Cycle 7 of the veryhard truss sweep (claude-opus-5, 120-minute
 * wall, 2026-09-21) failed 14 of 25 cases, and all 14 submitted by their own call a median 35 minutes
 * in, the longest after 62. The system prompt states the wall once, at the start of a long turn; this
 * states it where the decision to stop is made. The reply names only the clock and the published requirements, so it
 * carries nothing the verifier knows (AGENTS.md rule 4). The second call sends, and so does the call
 * the wall makes, since by then less than the share remains.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";

const SUBMIT_TIME_LEFT_SHARE = 0.25;

export function submitTimeLeftNote(leftMs: number, solveMs: number): string {
  const left = Math.floor(leftMs / 60_000);
  return (
    `Not sent: ${String(left)} of the case's ${String(Math.round(solveMs / 60_000))} minutes remain, and this reply comes once. ` +
    "Check the prepared answer against every published requirement with the tools you have: a requirement it breaks fails the case, however small the breach. " +
    "If one fails, use the time on it and save the current candidate first; when time runs out, the last answer an artifact-writer prepared is submitted for you. " +
    "Call submit again to send the prepared answer now."
  );
}

/** `tools` with its submit replaced for one solve whose wall is `solveMs` from `now()` at this call.
 *  `AgentTool<never>` is the Built roster's common type. On the last permitted turn a held submit
 *  would end the solve unsent, so `lastTurn` sends it at once. */
export function withTimeLeftAtSubmit(
  tools: ReadonlyMap<string, AgentTool<never>>,
  solveMs: number,
  now: () => number = Date.now,
  lastTurn: () => boolean = () => false,
): Map<string, AgentTool<never>> {
  const submit = tools.get("submit");
  const wrapped = new Map(tools);
  if (submit === undefined) return wrapped;
  const deadline = now() + solveMs;
  let noted = false;
  wrapped.set("submit", {
    ...submit,
    execute: async (...call) => {
      const leftMs = deadline - now();
      if (noted || lastTurn() || leftMs < solveMs * SUBMIT_TIME_LEFT_SHARE) {
        return await submit.execute(...call);
      }
      noted = true;
      return {
        content: [{ type: "text", text: submitTimeLeftNote(leftMs, solveMs) }],
        details: { timeLeftMs: leftMs },
      };
    },
  });
  return wrapped;
}
