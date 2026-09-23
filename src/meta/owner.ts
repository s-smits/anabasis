/**
 * Fault attribution between the Builder and Built Harness. These values name the component a
 * failure belongs to; they carry no repair verdict with them. The producer that holds the evidence
 * of the failure assigns the owner, and every reader consumes that recorded assignment instead of
 * inferring ownership from error text, which is the one thing that reads the same whoever caused
 * it.
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
