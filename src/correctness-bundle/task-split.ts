/**
 * The public-input / hidden-expectation split, so the solve side cannot read an answer key.
 * Tasks live in the correctness-model package and the solver receives
 * only selected public fields. Selecting those fields explicitly prevents a newly added hidden
 * field from entering the public projection by default.
 */
import { capturedJsonStringify, parseJsonAs } from "../meta/json-runtime.ts";
import { sha256 } from "../meta/digest.ts";
export { evaluationPublicTask } from "../../vendor/correctness-model-bundle/evaluation-public-task.ts";

export interface GeneratedTask<PublicInput, Hidden> {
  taskId: string;
  /** Required task family, used for difficulty comparisons and Judge context. */
  family: string;
  /** Everything the solve side is allowed to see. */
  publicInput: PublicInput;
  /** The answer key / expectations. Never crosses the isolation; the correctnessModel consumes it at truth time. */
  hidden: Hidden;
}

export interface PublicTask<PublicInput> {
  taskId: string;
  family: string;
  publicInput: PublicInput;
}

/**
 * Capture the public task before solving. Its canonical bytes and
 * digest come from the authoritative task before generated code runs. A toolset factory or
 * solver can then mutate only its own clone. Computing the digest after solving would identify
 * the mutated view instead of the original question, losing the comparison this record preserves.
 */
export interface CommittedPublicTask<P> {
  /** Canonical bytes of the public projection — the evidence form and the digest input. */
  publicTaskJson: string;
  /** sha256 of publicTaskJson — the commitment every downstream evidence names. */
  publicTaskDigest: string;
  /** A fresh independent clone parsed from the canonical bytes. Call once per stage (one solve
   *  view, one evaluate view): views share no structure with each other or with the authoritative
   *  task, so nested mutation in one stage cannot reach another. */
  view(): PublicTask<P>;
}

/** Select the fields allowed across the isolation boundary. publicInput still references the
 *  original task here. Before passing the projection to generated code, callers must use
 *  commitPublicTask, which captures the bytes and returns independent views parsed from them.
 *  This selection alone does not isolate mutable objects. */
export function projectPublic<P>(task: GeneratedTask<P, unknown>): PublicTask<P> {
  return { taskId: task.taskId, family: task.family, publicInput: task.publicInput };
}

export function commitPublicTask<P>(task: GeneratedTask<P, unknown>): CommittedPublicTask<P> {
  const publicTaskJson = capturedJsonStringify(projectPublic(task));
  return {
    publicTaskJson,
    publicTaskDigest: sha256(publicTaskJson),
    view: () => parseJsonAs<PublicTask<P>>(publicTaskJson),
  };
}
