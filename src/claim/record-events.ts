/**
 * Allowed non-result kinds shared by case evidence and outcome views. The type and runtime
 * membership check both derive from this array, keeping their accepted values aligned.
 * `isNonResultKind` validates values read from saved JSON: a string type alone cannot establish
 * that a stored kind belongs to the supported set.
 */
import type { JsonValue } from "../meta/json-shape.ts";
import { VERIFIER_EXECUTION_NON_RESULT_KINDS } from "../verify/correctness-model-result.ts";

/** Every kind a case can be a non-result of: the four the case layer decides, then the verifier's
 *  own seven, taken from the array that already calls itself their single spelling. */
export const NON_RESULT_KINDS = [
  "solver",
  "runtime",
  "verifier-throw",
  "verifier",
  ...VERIFIER_EXECUTION_NON_RESULT_KINDS,
] as const;

export type NonResultKind = (typeof NON_RESULT_KINDS)[number];

/**
 * Kinds that may establish an environment failure. The kind alone is insufficient: the battery
 * also requires claimable discrimination and the corresponding producer evidence for the case.
 * The host records `verifierUnavailable` and `sandbox` when the tool never started, because
 * process creation was refused or isolation could not be established. A tool that starts and
 * then exits unsuccessfully, whether by signal or non-zero exit, is classified as `crash`.
 * `solver` is eligible because its producers are the shared blocker matcher for provider,
 * transport and credential failures, plus controller observations that no work completed:
 * every turn aborted or encountered provider degradation (live-run-08).
 * Excluded kinds need different handling. `verifier-throw` indicates an evaluator defect and
 * is handled by suspect-correctness-model; `verifier` has no attributed cause. A `crash` or
 * `protocol` error alone cannot establish environment ownership and may expose a checker
 * defect. Consumers use this set with the required evidence to classify a fully blocked
 * battery without treating unmeasured cases as a capability result.
 */
export const ENVIRONMENT_OWNED_NONRESULT_KINDS: ReadonlySet<NonResultKind> = new Set([
  "solver",
  "runtime",
  "provider",
  "transport",
  "verifierUnavailable",
  "sandbox",
  "timeout",
]);

/**
 * The opening of the terminal reason a `provider-stopped` battery records, written by
 * `batteryTerminalReason` and read back by the claim gate's denominator clauses. The disposition
 * itself belongs to `BATTERY_DISPOSITIONS` in src/truth/battery-record.ts. Keeping the prefix
 * here lets writer and reader share it without a reverse runtime dependency. The claim reads
 * the recorded stop reason rather than inferring an outage from the non-result ratio.
 */
export const PROVIDER_STOPPED_REASON_PREFIX = "provider-stopped:";
export function isNonResultKind(value: JsonValue | undefined): value is NonResultKind {
  return NON_RESULT_KINDS.some((known) => known === value);
}
