/**
 * The truth verdict the host constructs from a domain's declared check functions: each check
 * returns one Boolean, and every check that returned false is one blocking issue.
 */

export type CorrectnessModelIssue = {
  /** The declared check that returned false. */
  checkId: string;
  message: string;
};

/** Every kind means no truth verdict exists. The verifier host creates `crash` (an engine that died
 *  non-zero) and `protocol` (a response that broke the one-JSON wire contract). The type derives
 *  from this array so it cannot drift from what `hostCreatedNonResult` reads at runtime. */

export const VERIFIER_EXECUTION_NON_RESULT_KINDS = [
  "provider",
  "transport",
  "verifierUnavailable",
  "sandbox",
  "timeout",
  "crash",
  "protocol",
] as const;

export type VerifierExecutionNonResultKind = (typeof VERIFIER_EXECUTION_NON_RESULT_KINDS)[number];

export type CorrectnessModelResult = {
  ok: boolean;
  issues: CorrectnessModelIssue[];
  /** Host-created completed check dispatches. */
  checkReceipts: Array<{
    checkId: string;
    passed: boolean;
    artifactInputDigest: string;
    publicTaskInputDigest: string;
  }>;
};
