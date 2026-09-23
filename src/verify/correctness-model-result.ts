/**
 * The truth verdict the host constructs from a domain's declared check functions: each check
 * returns one Boolean, and every check that returned false is one blocking issue.
 */

export type CorrectnessModelIssue = {
  /** The declared check that returned false. */
  checkId: string;
  message: string;
};

/** Every kind here means no truth verdict exists, so a case carrying one has `truthOk` and `pass`
 *  as null rather than a fail. Two of them the verifier host creates itself: `crash`, an engine that
 *  died non-zero, and `protocol`, a response that broke the one-JSON wire contract.
 *
 *  This array is the single spelling of the set, and the type below derives from it, so the
 *  compile-time members cannot drift from the ones a reader accepts at runtime —
 *  `src/claim/record-events.ts` spreads this array into `NON_RESULT_KINDS` and validates saved JSON
 *  against it through `isNonResultKind`, which is the one place a stored kind is checked at all. */
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
