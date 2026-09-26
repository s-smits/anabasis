/**
 * Finding codes from control execution, coverage checks and verification-runner checks that
 * tool results determine verdicts. These executed checks decide whether the evidence supports a claim.
 */
import type { FindingDisclosure } from "../truth/brief.ts";

type DiscriminationClaimabilityCode =
  // NOT_PROVEN means evaluation could not finish; ACCEPT_REJECTED selects the needed repair.
  | "DISCRIMINATION_NOT_PROVEN"
  | "DISCRIMINATION_ACCEPT_REJECTED"
  // Gate audit 2026-09-25 (docs/gate-audit.md, reject-discrimination): commented out (unsure): a reject control that passes its named check no longer refuses the candidate or the claim
  // | "DISCRIMINATION_REJECT_PASSED"
  // From runControls and the solve path: an external engine's consumed verdict disagrees with the
  // verifier's verdict for the same checkId, or the verifier reports an environment non-result
  // without the exact host result for this subject and with no pending invocation when evaluation
  // returns. Generated code may relay host results; it cannot alter or ignore verdicts, or declare
  // an environment failure without host evidence.
  | "EXTERNAL_RESULT_UNBOUND"
  // From runControls: a control the host could not run to a verdict (timeout, crash, sandbox,
  // unavailable tool).
  | "DISCRIMINATION_PROBE_NO_VERDICT"
  // From runControls: a verdict an external check decided with no completed run of its tool (R1).
  | "EXTERNAL_VERDICT_UNGROUNDED"
  | "DISCRIMINATION_CONTROL_RECEIPT_INVALID";

export type DiscriminationClaimabilityFinding = {
  code: DiscriminationClaimabilityCode;
  message: string;
  /** The control id the message quotes, carried to `ContractFinding.subject`. */
  subject?: string;
  /** What the author may read of `message` (truth/discrimination-author-detail.ts); absent rows stay withheld. */
  disclosure?: FindingDisclosure;
};
