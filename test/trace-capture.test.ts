/**
 * The case trace: what a solve leaves behind for a reader, and what it must never leave behind.
 *
 * The recorder sees the backend's whole stream — reasoning, messages, raw native payloads and
 * every tool argument. The persisted trace is a projection of that: turn and tool-call structure,
 * timings from a monotonic clock, redacted previews, and arguments reduced to a run-keyed digest.
 * A value that reaches `trace()` reaches every reader of the run directory, so each case below
 * asserts on the serialised snapshot rather than on the field it expects to be clean.
 */

import { describe, expect, it } from "bun:test";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { createTraceRecorder } from "../src/backends/trace-capture.ts";
const TOOL_ENDED = "tool_ended";
const TOOL_STARTED = "tool_started";

describe("what the trace withholds", () => {
  it("drops raw native payloads entirely and stores args as digest and length only", () => {
    const recorder = createTraceRecorder({ backend: "claude" });
    recorder.beginTurn(1);
    recorder.onEvent({
      type: "raw",
      backend: "claude",
      native: { secret: "RAW-NATIVE-MARKER", nested: { k: "v" } },
    });
    const args = { password: "ARG-VALUE-MARKER", n: 7 };
    recorder.onEvent({ type: "reasoning_text", text: "BUILDER-REASONING-MARKER" });
    recorder.onEvent({ type: "message_text", text: "BUILDER-MESSAGE-MARKER" });
    recorder.onEvent({ type: TOOL_STARTED, toolName: "query", toolCallId: "c1", args });
    recorder.onEvent({
      type: TOOL_ENDED,
      toolName: "query",
      toolCallId: "c1",
      isError: false,
      resultPreview: "3 rows",
    });
    recorder.onEvent({ type: "turn_ended", stopReason: "end_turn" });

    const trace = recorder.trace();
    const serialized = JSON.stringify(trace);
    for (const marker of [
      "RAW-NATIVE-MARKER",
      "ARG-VALUE-MARKER",
      "BUILDER-REASONING-MARKER",
      "BUILDER-MESSAGE-MARKER",
    ]) {
      expect(serialized).not.toContain(marker);
    }
    expect(trace.droppedRawEvents).toBe(1);

    const call = trace.toolCalls[0];
    // Run-keyed digest (steering 2026-07-12 §2): a well-formed hash, but NOT the plain sha256 of
    // the args — that would be a commitment anyone holding the trace could dictionary-attack.
    expect(call?.argsDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(call?.argsDigest).not.toBe(
      new Bun.CryptoHasher("sha256").update(JSON.stringify(args)).digest("hex"),
    );
    expect(call?.argsChars).toBe(JSON.stringify(args).length);
    expect(call?.isError).toBe(false);
    expect(call?.resultPreview).toBe("3 rows");
  });

  it("makes the args digest an equality classifier inside one solve and unlinkable across solves", () => {
    const args = { q: "select 1" };
    const one = createTraceRecorder();
    one.beginTurn(1);
    one.onEvent({ type: TOOL_STARTED, toolName: "a", toolCallId: "x", args });
    one.onEvent({ type: TOOL_STARTED, toolName: "b", toolCallId: "y", args });
    const [first, second] = one.trace().toolCalls;
    expect(first?.argsDigest).toBe(second?.argsDigest);

    const other = createTraceRecorder();
    other.beginTurn(1);
    other.onEvent({ type: TOOL_STARTED, toolName: "a", toolCallId: "x", args });
    // A different recorder holds a different random key: equal args are not linkable across runs.
    expect(other.trace().toolCalls[0]?.argsDigest).not.toBe(first?.argsDigest);
  });

  it("scrubs tokens, addresses and host paths from every preview it keeps", () => {
    const recorder = createTraceRecorder();
    recorder.beginTurn(1);
    recorder.onEvent({
      type: "assistant_text",
      delta: "wrote key sk-abc12345678901234 for someone@example.com ",
    });
    recorder.onEvent({ type: "assistant_text", delta: "under /Users/someone/secret/place", final: true });
    recorder.onEvent({
      type: TOOL_ENDED,
      toolName: "sh",
      isError: true,
      resultPreview: `boom token ghp_${"a".repeat(20)} at /Users/someone/x`,
    });
    recorder.onEvent({ type: "turn_failed", errorMessage: "provider said sk-zzz99999999999999 died" });

    const trace = recorder.trace();
    const serialized = JSON.stringify(trace);
    for (const secret of [
      "sk-abc12345678901234",
      "someone@example.com",
      "ghp_",
      "sk-zzz99999999999999",
      "/Users/someone",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    // The preview still carries usable signal after redaction.
    expect(trace.turns[0]?.assistantPreview).toContain("wrote key");
    expect(trace.turns[0]?.status).toBe("failed");
    expect(trace.toolCalls[0]?.resultPreview).toContain("boom token");
  });

  it("keeps redacted args and result excerpts for a failed call and neither for a successful one", () => {
    const recorder = createTraceRecorder();
    recorder.beginTurn(1);
    recorder.onEvent({
      type: TOOL_STARTED,
      toolName: "record_design",
      toolCallId: "ok",
      args: { password: "ARG-VALUE-MARKER" },
    });
    recorder.onEvent({
      type: TOOL_ENDED,
      toolName: "record_design",
      toolCallId: "ok",
      isError: false,
      resultPreview: "saved",
    });
    recorder.onEvent({
      type: TOOL_STARTED,
      toolName: "record_design",
      toolCallId: "bad",
      args: { members: "deficient", token: `ghp_${"b".repeat(20)}` },
    });
    recorder.onEvent({
      type: TOOL_ENDED,
      toolName: "record_design",
      toolCallId: "bad",
      isError: true,
      resultPreview: `Validation failed: missing deficientBaselineMembers ${"x".repeat(400)}`,
    });

    const trace = recorder.trace();
    const [ok, bad] = trace.toolCalls;
    // Success: digest and preview only — the args value must not survive anywhere.
    expect(ok?.argsExcerpt).toBeNull();
    expect(ok?.resultExcerpt).toBeNull();
    expect(JSON.stringify(trace)).not.toContain("ARG-VALUE-MARKER");
    // Failure: the bytes a diagnosis needs survive, redacted, past the 240-char preview cap.
    expect(bad?.argsExcerpt).toContain("deficient");
    expect(bad?.argsExcerpt).not.toContain("ghp_");
    expect(bad?.resultExcerpt).toContain("Validation failed");
    expect((bad?.resultExcerpt ?? "").length).toBeGreaterThan(300);
    expect(bad?.resultPreview?.length).toBeLessThanOrEqual(240);
  });

  it("degrades unserialisable args to a null digest instead of throwing", () => {
    const recorder = createTraceRecorder();
    recorder.beginTurn(1);
    const loop: Record<string, JsonValue> = {};
    loop.self = loop;
    recorder.onEvent({ type: TOOL_STARTED, toolName: "t", args: loop });
    const call = recorder.trace().toolCalls[0];
    expect(call?.argsDigest).toBeNull();
    expect(call?.argsChars).toBeNull();
  });
});

describe("the structure the trace records", () => {
  it("projects a whole turn, its compactions and its tool call into the redacted snapshot", () => {
    const recorder = createTraceRecorder({ backend: "claude" });
    recorder.beginTurn(1);
    recorder.onEvent({ type: "assistant_text", delta: "working on it" });
    recorder.onEvent({
      type: TOOL_STARTED,
      toolName: "bind_slot",
      toolCallId: "c1",
      args: { part: "alpha" },
    });
    recorder.onEvent({
      type: TOOL_ENDED,
      toolName: "bind_slot",
      toolCallId: "c1",
      isError: false,
      resultPreview: "bound",
    });
    recorder.onEvent({
      type: "turn_ended",
      stopReason: "end_turn",
      compactions: [{ tokensBefore: 301_000, compacted: true }],
    });
    const trace = recorder.trace();
    expect(trace.schema).toBe("case-trace/v4");
    expect(trace.turns[0]?.status).toBe("ended");
    expect(trace.turns[0]?.compactions).toEqual([{ tokensBefore: 301_000, compacted: true }]);
    expect(JSON.stringify(trace)).not.toContain("alpha");
    expect(trace.toolCalls[0]?.argsDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("orders calls solve-wide, attributes them to the caller-owned turn and matches ended-only backends", () => {
    const recorder = createTraceRecorder();
    recorder.beginTurn(1);
    recorder.onEvent({ type: "turn_started" }); // stream turn events do NOT fork turn numbering
    recorder.onEvent({ type: TOOL_STARTED, toolName: "a", toolCallId: "x" });
    recorder.onEvent({ type: TOOL_ENDED, toolName: "a", toolCallId: "x", isError: false });
    recorder.onEvent({ type: "turn_ended", stopReason: "tool_use" });
    recorder.beginTurn(2);
    // A backend that never emits tool_started still yields a completed call record.
    recorder.onEvent({ type: TOOL_ENDED, toolName: "b", isError: true, resultPreview: "err" });
    // Started but never ended: visible as unknown outcome, not as success.
    recorder.onEvent({ type: TOOL_STARTED, toolName: "c", toolCallId: "y" });

    const trace = recorder.trace();
    expect(trace.turns.map((turn) => turn.turn)).toEqual([1, 2]);
    expect(trace.turns.map((turn) => turn.status)).toEqual(["ended", "open"]);
    expect(trace.toolCalls.map((call) => [call.seq, call.turn, call.toolName])).toEqual([
      [1, 1, "a"],
      [2, 2, "b"],
      [3, 2, "c"],
    ]);
    expect(trace.toolCalls[2]?.isError).toBeNull();
    expect(trace.truncated).toBe(false);
  });

  it("lets an id-less tool_ended close only an open same-name call from the current turn", () => {
    const recorder = createTraceRecorder();
    recorder.beginTurn(1);
    recorder.onEvent({ type: TOOL_STARTED, toolName: "sh", toolCallId: "dangling" });
    recorder.onEvent({ type: "turn_ended", stopReason: "tool_use" });
    recorder.beginTurn(2);
    // Same tool name, no id: a fresh turn-2 record, not turn 1's dangling call.
    recorder.onEvent({ type: TOOL_ENDED, toolName: "sh", isError: false, resultPreview: "ok" });

    const recorded = recorder.trace();
    expect(recorded.toolCalls.map((call) => [call.turn, call.isError])).toEqual([
      [1, null], // the interrupted turn-1 call stays visibly open
      [2, false],
    ]);
    // An id match still closes across turns: the id is the stronger identity.
    recorder.onEvent({ type: TOOL_ENDED, toolName: "sh", toolCallId: "dangling", isError: true });
    expect(recorder.trace().toolCalls[0]?.isError).toBe(true);
  });

  it("measures turn and tool-call duration off a monotonic clock", () => {
    let clock = 1_000;
    const recorder = createTraceRecorder({ now: () => clock });
    recorder.beginTurn(1); // the turn clock starts here — what the solver waited, setup included
    clock = 1_050;
    recorder.onEvent({ type: TOOL_STARTED, toolName: "query", toolCallId: "c1" });
    clock = 1_320;
    recorder.onEvent({ type: TOOL_ENDED, toolName: "query", toolCallId: "c1", isError: false });
    clock = 1_400;
    recorder.onEvent({ type: "turn_ended", stopReason: "end_turn" });

    const trace = recorder.trace();
    expect(trace.turns[0]?.timingMs).toBe(400);
    expect(trace.toolCalls[0]?.timingMs).toBe(270);
  });

  it("leaves a span that never closed unmeasured instead of timing it to the reader", () => {
    let clock = 0;
    const recorder = createTraceRecorder({ now: () => clock });
    recorder.beginTurn(1);
    recorder.onEvent({ type: TOOL_STARTED, toolName: "hangs", toolCallId: "c1" });
    // A backend that reports only completions has no start to measure from.
    recorder.onEvent({ type: TOOL_ENDED, toolName: "ended-only", isError: false });
    clock = 9_999;

    const trace = recorder.trace();
    expect(trace.turns[0]?.status).toBe("open");
    expect(trace.turns[0]?.timingMs).toBeNull();
    expect(trace.toolCalls.map((call) => [call.toolName, call.timingMs])).toEqual([
      ["hangs", null],
      ["ended-only", null],
    ]);
    // The different fact, stated separately: how long each open span had been running when the
    // trace was taken. The call the backend created at its end has no start to measure from.
    expect(trace.turns[0]?.observedMs).toBe(9_999);
    expect(trace.toolCalls.map((call) => [call.toolName, call.observedMs])).toEqual([
      ["hangs", 9_999],
      ["ended-only", null],
    ]);
  });

  /** A whole-solve wall stops the turn in flight, and `timingMs` stays null because the turn
   *  reached no terminal event. One recorded truss turn ran 6 h 27 m and its case carried no
   *  elapsed time at all, which is the fact this separates out. A span that did end keeps its
   *  duration and states no observed time, so no reader can add the two together. */
  it("times a closed span once and an open one as elapsed, never both", () => {
    let clock = 0;
    const recorder = createTraceRecorder({ now: () => clock });
    recorder.beginTurn(1);
    clock = 500;
    recorder.onEvent({ type: "turn_ended", stopReason: "end_turn" });
    recorder.beginTurn(2);
    clock = 700;
    recorder.onEvent({ type: TOOL_STARTED, toolName: "bash", toolCallId: "c1" });
    clock = 23_220_000; // the wall arrives mid-call

    const trace = recorder.trace();
    expect(trace.turns.map((turn) => [turn.timingMs, turn.observedMs])).toEqual([
      [500, null],
      // Turn 2's clock starts at its own beginTurn, not at the trace, so the elapsed time is
      // measured from 500; the call inside it started 200 ms later still.
      [null, 23_219_500],
    ]);
    expect(trace.toolCalls[0]?.observedMs).toBe(23_219_300);
  });

  it("keeps unknown telemetry null and carries reported usage on the turn", () => {
    const recorder = createTraceRecorder();
    recorder.beginTurn(1);
    recorder.onEvent({ type: "turn_ended" });
    recorder.beginTurn(2);
    recorder.onEvent({
      type: "turn_ended",
      usage: { inputTokens: 160, outputTokens: 40, totalTokens: 200, costUsd: 0.42 },
    });
    const [unreported, reported] = recorder.trace().turns;
    expect(unreported).toMatchObject({
      inputTokens: null,
      outputTokens: null,
      tokensUsed: null,
      costUsd: null,
      stopReason: null, // an absent stop reason is unknown, not ""
    });
    expect(reported).toMatchObject({ inputTokens: 160, outputTokens: 40, tokensUsed: 200, costUsd: 0.42 });
  });

  it("marks itself a truncated prefix past the call cap", () => {
    const recorder = createTraceRecorder();
    recorder.beginTurn(1);
    for (let index = 0; index < 500; index++) {
      recorder.onEvent({ type: TOOL_ENDED, toolName: `t${index}`, isError: false });
    }
    const trace = recorder.trace();
    expect(trace.toolCalls.length).toBe(400);
    expect(trace.truncated).toBe(true);
  });
});
