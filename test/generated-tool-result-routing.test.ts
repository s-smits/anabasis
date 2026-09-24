// What the controller does with a result frame one confined worker sent back.
//
// By the time a frame reaches this decision the transport has already proved it: the bytes were
// canonical, the signature matched and the counter was the next one. What is left is whether the
// frame answers the request it claims to, and whether the checkpoint it carries may replace the
// one the controller is holding — a draft sequence that walks backwards, or an artifact-writer
// roster that changes mid-session, means the worker is no longer the one the controller started.
//
// The routing decides three outcomes, and the difference between the last two is the whole point:
// a tool's own failure is that call's business and the session continues, while a protocol fault
// ends it. Getting that wrong either loses a paid case to a recoverable error or keeps running
// against a worker that has stopped making sense.

import { describe, expect, it } from "bun:test";
import { type AcceptedResult, admitResult } from "../src/solve/generated-tool-result-routing.ts";
import type { BuiltStarterCheckpoint } from "../src/solve/built-starter.ts";
import type { GeneratedTaskAccess } from "../src/solve/task-access-trace.ts";
const TOOL_RESULT = "tool_result";

type ToolResult = Extract<AcceptedResult, { type: "tool_result" }>;

function checkpoint(overrides: Partial<BuiltStarterCheckpoint> = {}): BuiltStarterCheckpoint {
  return {
    schema: "built-starter-checkpoint/v2",
    turn: 1,
    draftSeq: 1,
    draftDigest: "a".repeat(64),
    fileMapDigest: "b".repeat(64),
    artifactWriterNames: ["record_truss_design"],
    materialization: { state: "absent" },
    ...overrides,
  };
}

const HELD = checkpoint();

function toolResult(over: Partial<ToolResult> = {}): ToolResult {
  return {
    type: TOOL_RESULT,
    requestId: "r1",
    result: { content: [{ type: "text" as const, text: "ok" }], details: null },
    checkpoint: HELD,
    ...over,
  };
}

const filesResult = { type: "files_result" as const, requestId: "r1", files: {}, checkpoint: HELD };
const materialized = { type: "materialization_result" as const, requestId: "r1", checkpoint: HELD };
const failed = {
  type: "request_error" as const,
  requestId: "r1",
  error: "the draft has no artifact yet",
  checkpoint: HELD,
};

describe("a result the controller can take", () => {
  it("accepts the reply the request asked for", () => {
    const verdict = admitResult(toolResult(), TOOL_RESULT, HELD);
    expect(verdict.act).toBe("accept");
  });

  it("hands back the reply, and with it the checkpoint to hold from here", () => {
    const advanced = checkpoint({ draftSeq: 4, turn: 2 });
    const verdict = admitResult(toolResult({ checkpoint: advanced }), TOOL_RESULT, HELD);
    if (verdict.act !== "accept") throw new Error(`expected accept, got ${verdict.act}`);
    expect(verdict.result.checkpoint.draftSeq).toBe(4);
  });

  it("accepts a draft sequence that stands still, since a reader advances nothing", () => {
    expect(admitResult(filesResult, "files_result", HELD).act).toBe("accept");
  });
});

describe("a tool's own failure, which the session survives", () => {
  it("fails the call and keeps the session, so the solver can ask for something else", () => {
    const verdict = admitResult(failed, TOOL_RESULT, HELD);
    expect(verdict.act).toBe("fail-call");
    if (verdict.act !== "fail-call") return;
    expect(verdict.error).toBe("the draft has no artifact yet");
  });

  it("keeps the checkpoint the failing frame carried, since the worker recorded it either way", () => {
    // A request_error is the tool saying no, not the worker stopping: the draft the call left
    // behind is what the next call continues from. The failing branch used to return before the
    // controller stored the checkpoint, so a turn whose tool call failed threw away the liveness
    // evidence that turn is read through, and the next frame was measured against a stale one.
    const advanced = checkpoint({ draftSeq: 9, turn: 3 });
    const verdict = admitResult({ ...failed, checkpoint: advanced }, TOOL_RESULT, HELD);
    if (verdict.act !== "fail-call") throw new Error(`expected fail-call, got ${verdict.act}`);
    expect(verdict.retained.checkpoint.draftSeq).toBe(9);
  });

  it("keeps the task access a failing frame reported, which is how the call was read", () => {
    const access: GeneratedTaskAccess = { events: ["span"], opaqueCopies: 0, truncated: false };
    const verdict = admitResult({ ...failed, taskAccess: access }, TOOL_RESULT, HELD);
    if (verdict.act !== "fail-call") throw new Error(`expected fail-call, got ${verdict.act}`);
    expect(verdict.retained.taskAccess).toEqual(access);
  });

  it("reports no task access for a frame kind that carries none, so the held one stands", () => {
    const verdict = admitResult(filesResult, "files_result", HELD);
    if (verdict.act !== "accept") throw new Error(`expected accept, got ${verdict.act}`);
    expect(verdict.retained.taskAccess).toBeUndefined();
  });

  it("still refuses a failure where the controller was preparing the trusted answer", () => {
    // `materialization` is the controller's own request, not the solver's. A worker that
    // answers it with a request error has broken the contract rather than failed a call.
    expect(admitResult(failed, "materialization_result", HELD)).toMatchObject({
      act: "refuse",
      error: "trusted answer preparation returned a request error",
    });
  });
});

describe("a frame that ends the session", () => {
  it("refuses a request id nothing is waiting for", () => {
    expect(admitResult(toolResult(), null, HELD)).toMatchObject({
      act: "refuse",
      error: "returned an unknown request id",
    });
  });

  it("refuses a result that arrives before any ready handshake, and says so", () => {
    // The controller holds no checkpoint until the worker is ready. Naming this as a drifting
    // artifact-writer roster would send the reader after the wrong owner.
    const verdict = admitResult(toolResult(), TOOL_RESULT, null);
    if (verdict.act !== "refuse") throw new Error("expected a refusal");
    expect(verdict.error).toContain("before");
    expect(verdict.error).not.toContain("drifted");
  });

  it("refuses a draft sequence that walks backwards", () => {
    const held = checkpoint({ draftSeq: 7 });
    const verdict = admitResult(toolResult({ checkpoint: checkpoint({ draftSeq: 6 }) }), TOOL_RESULT, held);
    expect(verdict).toMatchObject({ act: "refuse", error: "checkpoint regressed" });
  });

  it("refuses an artifact-writer roster the session did not start with", () => {
    const renamed = checkpoint({ artifactWriterNames: ["record_truss_design", "write_more"] });
    const verdict = admitResult(toolResult({ checkpoint: renamed }), TOOL_RESULT, HELD);
    expect(verdict).toMatchObject({ act: "refuse", error: "checkpoint artifact-writer identity drifted" });
  });

  it("refuses the same roster spelled in another order, since the order is the identity", () => {
    const held = checkpoint({ artifactWriterNames: ["write_a", "write_b"] });
    const swapped = checkpoint({ artifactWriterNames: ["write_b", "write_a"] });
    expect(admitResult(toolResult({ checkpoint: swapped }), TOOL_RESULT, held)).toMatchObject({
      act: "refuse",
      error: "checkpoint artifact-writer identity drifted",
    });
  });

  it("refuses a reply of the wrong kind, even with a checkpoint it would have taken", () => {
    expect(admitResult(materialized, "files_result", HELD)).toMatchObject({
      act: "refuse",
      error: "crossed result types",
    });
  });

  it("checks the checkpoint before the reply kind, so a drifted worker is named as one", () => {
    const renamed = checkpoint({ artifactWriterNames: [] });
    const verdict = admitResult({ ...materialized, checkpoint: renamed }, "files_result", HELD);
    if (verdict.act !== "refuse") throw new Error("expected a refusal");
    expect(verdict.error).toContain("drifted");
  });
});
