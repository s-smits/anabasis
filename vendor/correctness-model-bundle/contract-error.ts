/** Only instances created in the controller carry authority. Child exception frames cannot acquire it. */
export const VERIFIER_CONTRACT_HINTS = {
  "verifier-tool-input":
    "External operands must be declared artifact/public string leaves or JSON. Use authored evidence for check-local private or constructed test inputs. Changing the launcher does not change this contract.",
  "verifier-tool-binding":
    "The tool request is not bound to this check's declared tools. Declare required tools on the check, use their resolved inventory ids, and run cell outputs only within the check that produced them.",
  "verifier-tool-request":
    "The tool request violates the host API. Check argument and input types, cell-relative file paths, and awaited execution against the verifier reference.",
} as const;

export type VerifierContractCode = keyof typeof VERIFIER_CONTRACT_HINTS;

export class VerifierContractError extends Error {
  constructor(
    readonly code: VerifierContractCode,
    detail: string,
  ) {
    super(`tool run refused: ${detail}`);
    this.name = "VerifierContractError";
  }
}
