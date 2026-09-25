/**
 * A complete `builder-execution/v6` record for the tests that read, write or census one without
 * running a Builder session: the execution-record validator, the writer and reader, and the
 * Builder tool census.
 *
 * The reader validates every field before projecting a record, so the fixture fills the writer's
 * stable defaults and leaves each case's variation visible in its override. The aggregate tool
 * counts are derived from the per-name maps the same way the writer derives them, because the
 * reader refuses a record whose aggregate disagrees with its rows; a case that wants a specific
 * tuple still passes one.
 */
import { CUSTOM_TOOL_NAMES, bareCustomToolName } from "../../src/author/builder-custom-tool-call.ts";
import type {
  BuilderCustomToolCall,
  BuilderExecutionEvidence,
  BuilderSubmitAttempt,
} from "../../src/author/builder-execution.ts";

export type ExecutionRecordOverrides = Omit<
  Partial<BuilderExecutionEvidence>,
  "toolCalls" | "usage" | "submits" | "customCalls"
> & {
  toolCalls?: Partial<BuilderExecutionEvidence["toolCalls"]>;
  usage?: Partial<BuilderExecutionEvidence["usage"]>;
  submits?: Array<Partial<BuilderSubmitAttempt>>;
  customCalls?: Array<Partial<BuilderCustomToolCall>>;
};

function derivedToolCalls(
  override: Partial<BuilderExecutionEvidence["toolCalls"]> | undefined,
  failedByName: Record<string, number> | undefined,
): BuilderExecutionEvidence["toolCalls"] {
  const named = Object.entries(override?.byName ?? {});
  const total = named.reduce((sum, [, count]) => sum + count, 0);
  const custom = named.reduce(
    (sum, [name, count]) => sum + (CUSTOM_TOOL_NAMES.has(bareCustomToolName(name)) ? count : 0),
    0,
  );
  const failed = Object.values(failedByName ?? {}).reduce((sum, count) => sum + count, 0);
  return { total, failed, byName: {}, custom, native: total - custom, ...override };
}

/** One submission row at `ordinal`. Only the first candidate has no predecessor to compare itself
 *  with; the reader refuses a later row that leaves those three comparisons unstated. */
export function submitRow(ordinal: number, over: Partial<BuilderSubmitAttempt> = {}): BuilderSubmitAttempt {
  return {
    ordinal,
    turn: ordinal,
    atMs: ordinal * 1000,
    kind: "candidate",
    outcome: "accepted",
    stage: null,
    commit: "c".repeat(40),
    findingsDigest: null,
    findingCodes: [],
    repeatedFindings: ordinal === 1 ? null : false,
    findingsDelta: ordinal === 1 ? null : { carried: 0, resolved: 0, introduced: 0 },
    workspaceChanged: ordinal === 1 ? null : true,
    treeFirstSubmittedAsAttempt: null,
    terminal: false,
    ...over,
  };
}

export function executionRecord(overrides: ExecutionRecordOverrides = {}): BuilderExecutionEvidence {
  const { toolCalls, usage, submits, customCalls, ...rest } = overrides;
  return {
    schema: "builder-execution/v6",
    backend: "claude",
    runtimeIdentity: null,
    turns: 0,
    durationMs: 0,
    toolCalls: derivedToolCalls(toolCalls, rest.failedByName),
    usage: {
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      reportedTurns: 0,
      estimatedTurns: 0,
      ...usage,
    },
    firstToolMs: null,
    submits: (submits ?? []).map((row, index) => submitRow(index + 1, row)),
    turnRetries: [],
    authoringReviews: [],
    failedByName: {},
    partialTurn: null,
    failedCalls: [],
    failedCallsOmitted: 0,
    customCalls: (customCalls ?? []).map(
      (row, index): BuilderCustomToolCall => ({
        sequence: index + 1,
        turn: index + 1,
        tool: "unknown",
        action: "unknown",
        target: {},
        startedAtMs: null,
        durationMs: null,
        dispatchOutcome: "returned",
        ...row,
      }),
    ),
    customCallsOmitted: 0,
    outcome: "recorded",
    writtenAt: "2026-08-25T00:00:00.000Z",
    ...rest,
  };
}
