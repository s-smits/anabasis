/** Named check and separate public reference contracts, confined by the host. */
import type { PublicTask } from "./task-split.ts";
import type { ToolRunRequest, ToolRunResult, VerifierRuntime } from "../verify/verifier-port.ts";

/** Candidate code names a tool; the host binds it to the dispatched check. */
export interface CheckRuntime {
  tools: { run(request: Omit<ToolRunRequest, "checkId">): Promise<ToolRunResult> };
}

/** One authored deciding implementation. Aggregate verdicts and non-results are host-owned. */
export type CheckFn = (
  request: EvaluationRequest & { runtime?: CheckRuntime },
  runtime?: CheckRuntime,
) => boolean | Promise<boolean>;

/** Host-side dispatch into a fresh confined check process. */
export type CheckRunner = (
  checkId: string,
  request: EvaluationRequest,
  runtime?: VerifierRuntime,
) => boolean | Promise<boolean>;

/** Cases and controls share one task-bound request; generated code cannot distinguish their role. */
export interface EvaluationRequest<Artifact = unknown, Hidden = unknown> {
  publicTask: PublicTask<unknown>;
  artifact: Artifact;
  hidden: Hidden;
}

/** The reference solve receives only committed public task data. A successful execution shows
 * that this path can produce an accepted artifact without reading the hidden answer directly.
 * The controller attaches hidden expectations when checking the returned artifact. */
export type ReferenceSolveFn<Artifact = unknown, PublicInput = unknown> = (
  task: PublicTask<PublicInput>,
) => Artifact | Promise<Artifact>;
