/**
 * What a generated `evaluator.ts` imports when it imports `@ana/correctness-model-bundle`. The two
 * sides of the bundle see this package differently on purpose: solve-side validation refuses it by
 * name (`CORRECTNESS_MODEL_PACKAGE` in `bundle-validation.ts`), so an agent cannot import the
 * vocabulary its own answers are judged in, while correctness-model loading makes it available to
 * the checks. A name is exported from here once a generated consumer imports it and not before.
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
