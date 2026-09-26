/**
 * The census gate's record of a tool run that reached no completed run, and its public code.
 *
 * The census gate settles a tool run that timed out, crashed or was refused at the sandbox as a
 * repairable `correctness-model` finding and writes the host's own record beside the iteration
 * (`settleNonResult` in census-gate.ts). The public code of that record, one per failure family,
 * is derived from the host's own measured fields; it is the family label a reader groups by.
 *
 * Only host-measured facts and public authoring identities cross to the author: tool id, check id,
 * counts. Tool stdout and stderr stay in the protected record.
 */
import type { VerifierExecutionEvidence } from "../verify/verifier-port.ts";

/** The census gate's own no-result record, written once per refused census. Its presence in a
 *  settled iteration directory *is* the refusal. */
export const TOOL_NON_RESULT_FILE = "verifier-non-result.json";

/** The public code for one no-result record: the host-measured outcome family. */
export function toolNonResultCode(evidence: Pick<VerifierExecutionEvidence, "outcome">): string {
  switch (evidence.outcome) {
    case "timeout":
      return "tool-timeout";
    case "crash":
      return "tool-crash";
    case "sandbox":
      return "tool-wall-refusal";
    case "verifierUnavailable":
      return "tool-unavailable";
    case "executed":
    case "protocol":
    case "provider":
    case "transport":
      return "tool-no-result";
  }
}
