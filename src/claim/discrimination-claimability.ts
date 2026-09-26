/**
 * Finding codes from control execution, coverage checks and verification-runner checks that
 * tool results determine verdicts. These executed checks decide whether the evidence supports a claim.
 */
import type { FindingDisclosure } from "../correctness-bundle/brief.ts";

type DiscriminationClaimabilityCode =
  // NOT_PROVEN means evaluation could not finish; ACCEPT_REJECTED selects the needed repair.
  | "DISCRIMINATION_NOT_PROVEN"
  | "DISCRIMINATION_ACCEPT_REJECTED"
  // From the census and the claim's read-back of its receipts (R2): a reject whose named check did
  // not fail, and a declared check no reject names.
  | "DISCRIMINATION_REJECT_PASSED"
  | "DISCRIMINATION_CHECK_UNREJECTED"
  // From runControls and the solve path: an external engine's consumed verdict disagrees with the
  // verifier's verdict for the same checkId, or the verifier reports an environment non-result
  // without the exact host result for this subject and with no pending invocation when evaluation
  // returns. Generated code may relay host results; it cannot alter or ignore verdicts, or declare
  // an environment failure without host evidence.
  | "EXTERNAL_RESULT_UNBOUND"
  // From runControls: a control whose tool run crashed, which the check owns.
  | "DISCRIMINATION_PROBE_NO_VERDICT"
  // From runControls: a tool the host refused (sandbox, unavailable) after its retry, which the
  // census settles as the environment's non-result.
  | "verifier-tool-refused"
  // From runControls: a verdict an external check decided with no completed run of its tool (R1).
  | "EXTERNAL_VERDICT_UNGROUNDED"
  | "DISCRIMINATION_CONTROL_RECEIPT_INVALID";

export type DiscriminationClaimabilityFinding = {
  code: DiscriminationClaimabilityCode;
  message: string;
  /** The control id the message quotes, carried to `ContractFinding.subject`. */
  subject?: string;
  /** What the author may read of `message` (correctness-bundle/discrimination-author-detail.ts); absent rows
   * stay withheld. */
  disclosure?: FindingDisclosure;
};
