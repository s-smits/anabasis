/**
 * The `@ana/correctness-model-bundle` API for generated correctness models (`evaluator.ts`).
 * Solve-side validation refuses this protected package (`bundle-validation.ts`,
 * `CORRECTNESS_MODEL_PACKAGE`). Correctness-model loading makes it available to checks.
 * Add exports when generated code needs them.
 *
 * The runtime half of this contract lives beside the barrel rather than under `src/`. The Builder
 * runs its own `bun test` under a wall that opens this directory whole and closes `src/truth`,
 * and Bun lists a module's directory before it opens the file: measured 2026-09-02 (run50-opus),
 * a barrel re-exporting `../../src/truth/truth-checks.ts` failed there with "Cannot find module"
 * while the file itself was granted, and the Builder wrote a stand-in for the whole package.
 * Shared JSON shape primitives remain under the already-public `src/meta` authoring interface.
 */
export type {
  ReferenceSolveFn,
  EvaluationRequest,
  CheckFn,
  CheckRunner,
  CheckRuntime,
} from "../../src/truth/correctness-model-contract.ts";
export type { PublicTask } from "../../src/truth/task-split.ts";
// The editable evaluator seed uses the same declared input view as measured evaluation.
export { evaluationPublicTask } from "./evaluation-public-task.ts";
export { observedBlockingCheckIds } from "./control-results.ts";
export type { TruthCheck } from "./truth-checks.ts";
export { evaluateCheckProgram, checkEvaluationRequest } from "./evaluate.ts";
