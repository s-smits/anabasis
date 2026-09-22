/**
 * Finding codes from control execution, coverage checks and verification-runner checks that
 * tool results determine verdicts. These executed checks decide whether the evidence supports a claim.
 */
import type { FindingDisclosure } from "../truth/brief.ts";

type DiscriminationClaimabilityCode =
  // NOT_PROVEN means evaluation could not finish; the two verdict codes select the needed repair.
  | "DISCRIMINATION_NOT_PROVEN"
  | "DISCRIMINATION_ACCEPT_REJECTED"
  | "DISCRIMINATION_REJECT_PASSED"
  // From runControls and the solve path: an external engine's consumed verdict disagrees with the
  // verifier's verdict for the same checkId, or the verifier reports an environment non-result
  // without the exact host result for this subject and with no pending invocation when evaluation
  // returns. Generated code may relay host results; it cannot alter or ignore verdicts, or declare
  // an environment failure without host evidence.
  | "EXTERNAL_RESULT_UNBOUND"
  // From runControls: a control the host could not run to a verdict (timeout, crash, sandbox,
  // unavailable tool).
  | "DISCRIMINATION_PROBE_NO_VERDICT"
  | "DISCRIMINATION_CONTROL_RECEIPT_INVALID"
  // From runControls: every reject naming a check also fails another declared check, so the corpus
  // never shows that check refusing an artifact the others accept. Weakening or dropping the
  // comparison would leave the census passing on the strength of its neighbours.
  | "DISCRIMINATION_CHECK_NOT_ISOLATED";

/** Codes that report a gap without refusing the candidate. A reject is built from its accept by
 *  changing one fact and may fail further checks by design (operator decision 2026-09-14), and a
 *  check whose condition another subsumes cannot be isolated at all, so this reads as a control
 *  gap to close rather than a contract the candidate broke. `runControls` keeps such a row out of
 *  `claimable` and the census gate reads the same set for its row severity: one list, two readers. */
export const ADVISORY_DISCRIMINATION_CODES: ReadonlySet<string> = new Set<DiscriminationClaimabilityCode>([
  "DISCRIMINATION_CHECK_NOT_ISOLATED",
]);

export type DiscriminationClaimabilityFinding = {
  code: DiscriminationClaimabilityCode;
  message: string;
  /** The control id the message quotes, carried to `ContractFinding.subject`. */
  subject?: string;
  /** What the author may read of `message` (truth/discrimination-author-detail.ts); absent rows stay withheld. */
  disclosure?: FindingDisclosure;
};
