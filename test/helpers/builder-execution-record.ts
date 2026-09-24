import type {
  BuilderCustomToolCall,
  BuilderExecutionEvidence,
  BuilderSubmitAttempt,
} from "../../src/author/builder-execution.ts";
import type { ExperimentSubmission } from "../../src/author/experiment-plan.ts";
import { hashJsonValue } from "../../src/meta/stable-json.ts";

/** A complete `builder-execution/v6` record, since the readers open it through the strict reader.
 *  The submit rows take the writer's defaults, and the record stores the rows alone, as the writer
 *  does; `extra` overrides any top-level field, such as `customCalls` or `turnRetries`. */
export function executionRecord(
  rows: Array<Partial<BuilderSubmitAttempt>>,
  calls = 0,
  extra: Partial<Pick<BuilderExecutionEvidence, "customCalls" | "customCallsOmitted" | "turnRetries">> = {},
): string {
  const submits = rows.map(
    (row, index): BuilderSubmitAttempt => ({
      ordinal: index + 1,
      turn: index + 1,
      atMs: (index + 1) * 1000,
      kind: "candidate",
      outcome: "accepted",
      stage: row.outcome === undefined || row.outcome === "accepted" ? null : "validation",
      commit: "c".repeat(40),
      findingsDigest: row.outcome === undefined || row.outcome === "accepted" ? null : `digest-${index + 1}`,
      findingCodes: [],
      repeatedFindings: index === 0 ? null : false,
      findingsDelta: index === 0 ? null : { carried: 0, resolved: 0, introduced: 0 },
      workspaceChanged: index === 0 ? null : true,
      treeFirstSubmittedAsAttempt: null,
      terminal: false,
      ...row,
    }),
  );
  return JSON.stringify({
    schema: "builder-execution/v6",
    backend: "claude",
    runtimeIdentity: null,
    turns: 0,
    durationMs: 0,
    toolCalls: {
      total: calls,
      failed: 0,
      byName: calls === 0 ? {} : { bash: calls },
      custom: calls,
      native: 0,
    },
    usage: { inputTokens: null, outputTokens: null, costUsd: null, reportedTurns: 0, estimatedTurns: 0 },
    firstToolMs: null,
    submits,
    turnRetries: [],
    authoringReviews: [],
    failedByName: {},
    partialTurn: null,
    failedCalls: [],
    failedCallsOmitted: 0,
    customCalls: [],
    customCallsOmitted: 0,
    outcome: "recorded",
    writtenAt: "2026-08-25T00:00:00.000Z",
    ...extra,
  });
}

/** A recorded `harness_trial` call: the rehearsal of `taskId` on `candidateId` with its verdict. */
export function trialCall(
  sequence: number,
  taskId: string,
  candidateId: string,
  truthVerdict: string,
): BuilderCustomToolCall {
  return {
    sequence,
    turn: sequence,
    tool: "harness_trial",
    action: "run",
    target: { taskId },
    startedAtMs: sequence * 60_000,
    durationMs: 1_000,
    dispatchOutcome: "returned",
    semantic: { outcome: "completed", candidateId, truthVerdict },
  };
}

/** A recorded accepted `submit` call, carrying the candidate the gate froze. */
export function submitCall(sequence: number, candidateId: string): BuilderCustomToolCall {
  return {
    sequence,
    turn: sequence,
    tool: "submit",
    action: "submit",
    target: {},
    startedAtMs: sequence * 60_000,
    durationMs: 1_000,
    dispatchOutcome: "returned",
    semantic: { outcome: "accepted", candidateId },
  };
}

/** A captured experiment plan declaring `target`, digested the way the capture digests one. */
export function experimentProposal(target: ExperimentSubmission["target"]): ExperimentSubmission {
  const plan = {
    schema: "experiment-plan/v2",
    scope: "tasks",
    gap: "the last battery found no limit",
    change: "harder spans",
    expectedResult: "fewer verified passes",
    target,
    families: [{ family: "fam", level: "hard", move: "longer spans" }],
    predictions: [],
  } as const;
  return { ...plan, families: [...plan.families], predictions: [], digest: hashJsonValue(plan) };
}
