/**
 * Fault attribution between the Builder and Built Harness. The producer with evidence of a failure
 * assigns the owner; readers consume that assignment rather than infer it from error text.
 */
export const OWNER_LAYERS = [
  /** Provider/transport/sandbox — never a product fact. */
  "environment",
  /** Artifact schema, draft shape, representation contracts. */
  "bh-representation",
  /** Tool contract, submission path, toolset behaviour. */
  "bh-tool-submit",
  /** Generated verifier, controls, discrimination. */
  "bh-correctness-model",
  /** Task battery, difficulty, curriculum. */
  "task-curriculum",
  /** A shared package primitive (correctness-model-prims, agent-bundle, correctness-model-bundle). */
  "shared-ana-primitive",
  /** The build driver, phase contracts, prompts, validators. */
  "builder-workflow",
  /** Claim/readiness/campaign governance and evidence handling. */
  "controller-evidence",
] as const;

export type OwnerLayer = (typeof OWNER_LAYERS)[number];
