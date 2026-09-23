/**
 * The comparisons and result types a generated bundle may use on either side of the wall. Unlike
 * `@ana/correctness-model-bundle`, this package is on `DEFAULT_ALLOW` in
 * `src/claim/bundle-validation.ts`, so an agent may import it as well as a check: what it holds is
 * how two values are compared, never what the right answer is, and a tolerance rule is no more of
 * a hint to the solver than the brief that already publishes it. A name is exported from here once
 * a generated consumer imports it and not before. The implementations sit beside this entrypoint
 * rather than under `src/`, for the reason `correctness-model-bundle/index.ts` records.
 */
export type {
  CorrectnessModelIssue,
  CorrectnessModelResult,
} from "../../src/verify/correctness-model-result.ts";
export { relationalJoin } from "./relational-join.ts";
export { multisetMatches, numbersWithin } from "./comparison.ts";
export type { VerifierRuntime } from "../../src/verify/verifier-port.ts";
