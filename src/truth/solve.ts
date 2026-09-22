/** One Built task, one controller-assembled toolset, one submission authority. */
import type { AgentTurnResult } from "../backends/backend-types.ts";
import type { ModelSelectionEvidence } from "../backends/model-selection.ts";
import type { CaseTrace } from "../backends/trace-capture.ts";
import type {
  BuiltAgentInterfaceTool,
  BuiltStarterCheckpoint,
  GeneratedToolWorkerEvidence,
} from "../solve/built-starter.ts";
import type { SubmissionPort } from "../solve/final-submission.ts";
import type { PublicArtifactSchema } from "../solve/public-artifact-schema.ts";
import type { Toolset } from "./contracts.ts";
import type { PublicTask } from "./task-split.ts";

export type SolverNonResult = {
  kind: "provider" | "runtime" | "protocol" | "sandbox" | "crash";
  message: string;
};

/** `solve-wall`: the whole-solve wall stopped a solver that had already called tools. The case
 *  stays unaccepted with this typed cause, not a runtime non-result. */
type BuiltWorkerTermination =
  | { status: "normal" }
  | { status: "solve-wall"; message: string }
  | { status: "non-result"; kind: SolverNonResult["kind"]; message: string };

/** The model-visible solve contract the runtime opened, disclosed as separate identities so two
 *  runs can be diffed field by field instead of digest-versus-digest. Every field is constant
 *  across a battery; the per-case identity stays `modelWorker.conditionDigest`, because the
 *  first-turn prompt embeds the task bytes. */
export type SolveInterfaceCondition = {
  systemPromptDigest: string;
  /** The composed bytes behind `systemPromptDigest`, recorded for the same reason as the tool rows:
   *  a reader must see the prompt this case's model actually read, not whatever the
   *  current source constants say. */
  systemPrompt: string;
  firstTurnTemplateDigest: string;
  nudgeDigest: string;
  /** Over the full model-facing tool rows: names, labels, descriptions, parameters. */
  toolSchemaDigest: string;
  /** The rows behind that digest. The digest says two runs opened the same contract; the rows say
   *  what the contract told the agent, which is what separates a wrong
   *  tool description (tools-spec) from a wrong implementation (fingerprint). Recorded per case rather
   *  than re-derived later, so the text is the text this case's model read. */
  tools: BuiltAgentInterfaceTool[];
  /** The operating guide this case's model read, already inside `systemPromptDigest`. Recorded as
   *  text for the same reason as the rows: a reader judging the guide has to see
   *  the policy this case ran under, and a digest cannot be read. Null stays for the outcome
   *  reader: a case recorded from a bundle without a guide holds null, and the loader now refuses
   *  such a bundle. */
  operatingGuide: string | null;
  backendProfileDigest: string;
  maxTurns: number;
};

export type BuiltRuntimeBoundaryEvidence = {
  schema: "built-runtime-boundary/v1";
  modelWorker: {
    workerInstanceId: string;
    conditionDigest: string;
    confinedPid: number | null;
    controllerPid: number;
    /** The confined worker's working directory (the executed bundle directory), recorded so a
     *  review can bind traced file access to the tree that ran without re-deriving it from
     *  the isolation policy. */
    workingDirectory: string;
    policyHash: string;
    bundleDigest: string;
    modelSelection: ModelSelectionEvidence | null;
    termination: BuiltWorkerTermination;
  };
  /** The model-visible solve contract this worker opened. */
  contractCondition: SolveInterfaceCondition;
  generatedTools: GeneratedToolWorkerEvidence;
};

export interface SolveOutcome {
  turns: number;
  /** Outer prompts that completed a provider result. */
  completedTurns: number;
  errors: string[];
  /** Missing means the runtime did not produce a complete tally. */
  toolCalls?: number;
  /** Tool starts observed by the controller event sink. */
  startedToolCalls?: number;
  trace?: CaseTrace;
  runtimeIdentities?: NonNullable<AgentTurnResult["runtimeIdentity"]>[];
  /** Controller checkpoints taken after each completed Pi prompt. */
  checkpoints?: BuiltStarterCheckpoint[];
  /** Typed infrastructure failure; product/tool errors remain ordinary failed attempts. */
  nonResult?: SolverNonResult;
  /** Both production process boundaries, joined after the Pi child has completed. */
  runtimeBoundary?: BuiltRuntimeBoundaryEvidence;
}

/** `submitted` reads only the controller's own submission authority. */
export type Solver = (
  task: PublicTask<unknown>,
  toolset: Toolset,
  submitted: () => boolean,
) => Promise<SolveOutcome>;

type SolverBuiltStarterFactory = (
  slugDir: string,
  task: PublicTask<unknown>,
  submission: SubmissionPort,
  publicArtifactSchema: PublicArtifactSchema,
) => Promise<Toolset>;

const solverStarterFactories = new WeakMap<Solver, SolverBuiltStarterFactory>();

export function nonResultOutcome(
  failure: SolverNonResult,
  rest: Partial<Pick<SolveOutcome, "checkpoints" | "runtimeBoundary" | "trace">> = {},
): SolveOutcome {
  return {
    turns: 0,
    completedTurns: 0,
    errors: [failure.message],
    toolCalls: 0,
    startedToolCalls: 0,
    nonResult: failure,
    ...rest,
  };
}

export function withSolverBuiltStarterFactory(solver: Solver, factory: SolverBuiltStarterFactory): Solver {
  solverStarterFactories.set(solver, factory);
  return solver;
}

export function builtStarterFactoryForSolver(solver: Solver): SolverBuiltStarterFactory | undefined {
  return solverStarterFactories.get(solver);
}
