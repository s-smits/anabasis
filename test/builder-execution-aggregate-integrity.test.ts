import { describe, expect, it } from "bun:test";
import { BuilderExecutionRecorder, type BuilderExecutionEvidence } from "../src/author/builder-execution.ts";
import { isCurrentExecutionRecord } from "../tools/outcome/builder-execution-current.ts";

function executionRecord(): BuilderExecutionEvidence {
  return {
    schema: "builder-execution/v6",
    backend: "codex",
    runtimeIdentity: null,
    turns: 1,
    durationMs: 10,
    toolCalls: {
      total: 3,
      failed: 1,
      byName: { Read: 2, Bash: 1 },
      custom: 0,
      native: 3,
    },
    usage: { inputTokens: null, outputTokens: null, costUsd: null, reportedTurns: 0, estimatedTurns: 0 },
    firstToolMs: 0,
    submits: [],
    partialTurn: null,
    turnRetries: [],
    authoringReviews: [],
    failedCalls: [],
    failedCallsOmitted: 0,
    failedByName: { Bash: 1 },
    customCalls: [],
    customCallsOmitted: 0,
    outcome: "recorded",
    writtenAt: "2026-09-01T00:00:00.000Z",
  };
}

describe("Builder execution aggregate integrity", () => {
  it("accepts one writer-consistent current record", () => {
    expect(isCurrentExecutionRecord(executionRecord())).toBe(true);
  });

  it("rejects totals that disagree with their per-name rows", () => {
    const wrongTotal = executionRecord();
    wrongTotal.toolCalls.total += 1;
    expect(isCurrentExecutionRecord(wrongTotal)).toBe(false);

    const wrongFailed = executionRecord();
    wrongFailed.toolCalls.failed = 0;
    expect(isCurrentExecutionRecord(wrongFailed)).toBe(false);
  });

  it("rejects a failed call that the all-call map never recorded", () => {
    const record = executionRecord();
    record.toolCalls.failed = 2;
    record.failedByName = { Bash: 2 };
    expect(isCurrentExecutionRecord(record)).toBe(false);
  });

  it("rejects a custom/native split that contradicts the tool names", () => {
    const record = executionRecord();
    record.toolCalls.byName = { harness_inspect: 2, Bash: 1 };
    expect(isCurrentExecutionRecord(record)).toBe(false);
  });

  it("requires custom receipts to keep the writer's 1..n dispatch order", () => {
    const customCall = (sequence: number) => ({
      sequence,
      turn: 1,
      tool: "harness_inspect",
      action: "readiness",
      target: {},
      startedAtMs: 0,
      durationMs: 1,
      dispatchOutcome: "returned" as const,
    });
    const record = executionRecord();
    record.toolCalls = {
      total: 5,
      failed: 1,
      byName: { Read: 2, Bash: 1, harness_inspect: 2 },
      custom: 2,
      native: 3,
    };
    record.customCalls = [customCall(1), customCall(2)];
    expect(isCurrentExecutionRecord(record)).toBe(true);

    record.customCalls = [customCall(2), customCall(1)];
    expect(isCurrentExecutionRecord(record)).toBe(false);

    record.customCalls = [customCall(1), customCall(3)];
    expect(isCurrentExecutionRecord(record)).toBe(false);
  });

  // The real writer against the real reader: an accepted submit records the task-quality
  // advisories beside the acceptance (src/author/builder-session.ts), so the reader must admit a
  // non-empty finding list on an accepted row. Hand-rolled records on both sides hid this: the
  // reader dropped the whole session as "incomplete or invalid shape" for every externally
  // grounded battery, whose 25 unobservable tasks always produce an advisory.
  it("admits the advisories the accepted submit row records", () => {
    const advisory = {
      code: "tasks-multiplicity-unobservable",
      path: "tasks",
      detail: "the bounded search cannot enumerate an externally decided task",
      owner: "task-curriculum",
    } as const;
    const recorder = new BuilderExecutionRecorder(Date.now() - 1_000);
    recorder.recordSubmit({
      turn: 1,
      outcome: "refused",
      stage: "validation",
      commit: "a1b2c3d",
      findings: [
        {
          code: "tasks-self-reported-expectation",
          path: "tasks",
          detail: "d",
          owner: "task-curriculum" as const,
        },
      ],
      terminal: false,
    });
    const accepted = recorder.recordSubmit({
      turn: 2,
      outcome: "accepted",
      stage: null,
      commit: "e4f5a6b",
      findings: [advisory],
      terminal: false,
    });
    expect(accepted.findingCodes).toEqual(["tasks-multiplicity-unobservable"]);
    expect(accepted.findingsDigest).toBeNull();
    const record = recorder.finish("recorded");
    expect(isCurrentExecutionRecord(structuredClone(record))).toBe(true);

    // The null digest is what marks the acceptance; a digest on an accepted row is not a shape
    // the writer can produce, and the reader still refuses it.
    const forged = structuredClone(record);
    const row = forged.submits[1];
    if (row === undefined) throw new Error("missing accepted submit row");
    row.findingsDigest = "0".repeat(64);
    expect(isCurrentExecutionRecord(forged)).toBe(false);
  });

  it("applies the same exact tally contract to a running partial turn", () => {
    const record = executionRecord();
    record.partialTurn = {
      turn: 2,
      toolCalls: { total: 2, failed: 0, byName: { Read: 1 }, failedByName: {} },
    };
    expect(isCurrentExecutionRecord(record)).toBe(false);
  });
});
