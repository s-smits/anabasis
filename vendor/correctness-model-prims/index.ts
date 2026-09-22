/**
 * The `@ana/correctness-model-prims` API for generated bundles: shared comparisons and result
 * types. It is on the solve-side allowlist (`bundle-validation.ts`, `DEFAULT_ALLOW`) and is
 * available during evaluation. Add exports when generated code needs them.
 * Implementations live beside this entrypoint, for the reason
 * `correctness-model-bundle/index.ts` gives.
 */
export type {
  CorrectnessModelIssue,
  CorrectnessModelResult,
} from "../../src/verify/correctness-model-result.ts";
export { relationalJoin } from "./relational-join.ts";
export { multisetMatches, numbersWithin } from "./comparison.ts";
export type { VerifierRuntime } from "../../src/verify/verifier-port.ts";
