/** The sentence each contract code carries to whoever authored the check. These are the one part
 *  of a refusal that crosses to the author, so each is written as an instruction about the request
 *  they wrote rather than as a diagnosis of the artifact, and none of them quotes what the verifier
 *  saw. `src/correctness-bundle/brief.ts` folds them into the classification hints, and
 * `src/correctness-bundle/run-controls.ts`
 *  appends the reproduce-repair-rerun sentence after whichever one applies. */
export const VERIFIER_CONTRACT_HINTS = {
  "verifier-tool-input":
    "External operands must be declared artifact/public string leaves or JSON. Use authored evidence for check-local private or constructed test inputs. Changing the launcher does not change this contract.",
  "verifier-tool-binding":
    "The tool request is not bound to this check's declared tools. Declare required tools on the check, use their resolved inventory ids, and run cell outputs only within the check that produced them.",
  "verifier-tool-request":
    "The tool request violates the host API. Check argument and input types, cell-relative file paths, and awaited execution against the verifier reference.",
} as const;

export type VerifierContractCode = keyof typeof VERIFIER_CONTRACT_HINTS;

/** A refusal that belongs to whoever authored the check, rather than to the host or to the machine
 *  it ran on. That attribution is what the class is for: `isAuthoredEvaluatorFailure` in
 *  `src/correctness-bundle/evaluator-process.ts` tests `instanceof` against it, and both of its callers use
 * the  answer to let an authored refusal stand where a recorded verifier outage would otherwise have
 *  claimed the failure. Since `instanceof` holds only for an object this process constructed, an
 *  exception that came out of a child and was rebuilt here cannot acquire that authority by
 *  carrying the same name or the same message. */
export class VerifierContractError extends Error {
  constructor(
    readonly code: VerifierContractCode,
    detail: string,
  ) {
    super(`tool run refused: ${detail}`);
    this.name = "VerifierContractError";
  }
}
