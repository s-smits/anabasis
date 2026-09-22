import { describe, expect, it } from "bun:test";
import { caseTraceFacts, foldTraceFacts, spread } from "../tools/outcome/trace-facts.ts";

/**
 * What a verified trace says beyond its row counts.
 *
 * Each fact states how many records carried the field it summed, so a partial total never passes
 * as a full one, and a field no record carried stays null rather than collapsing to a zero. The
 * counting rules here are what the anomaly scan then reads; `outcome-scan.test.ts` owns what the
 * scan does with them.
 */

describe("trace facts beyond the row counts", () => {
  it("counts repeated calls with the same tool name and argument digest", () => {
    const facts = caseTraceFacts({
      schema: "case-trace/v4",
      backend: "claude",
      turns: [{ turn: 1, timingMs: 500, inputTokens: 10, outputTokens: 4, costUsd: 0.5 }],
      toolCalls: [
        { toolName: "read", argsDigest: "a", isError: false, timingMs: 10 },
        { toolName: "read", argsDigest: "a", isError: false, timingMs: 12 },
        { toolName: "read", argsDigest: "b", isError: true, timingMs: 8 },
      ],
      truncated: false,
      droppedRawEvents: 0,
    });
    expect(facts.repeatedCalls).toEqual({ value: 1, of: 3, from: 3 });
    expect(facts.erroredCalls).toEqual({ value: 1, of: 3, from: 3 });
    expect(facts.byTool.read).toEqual({ calls: 3, errors: 1, repeats: 1 });
    expect(facts.distinctTools).toBe(1);
    expect(facts.toolMs).toEqual({ value: 30, of: 3, from: 3 });
    expect(facts.costUsd).toEqual({ value: 0.5, of: 1, from: 1 });
  });

  it("a parameterless tool's identical digests are its signature, not repeated work", () => {
    const facts = caseTraceFacts({
      schema: "case-trace/v4",
      backend: "claude",
      turns: [{ turn: 1 }],
      toolCalls: [
        // `materialize_files` takes no parameters, so every call digests `{}` the same way.
        { toolName: "materialize_files", argsDigest: "empty", isError: false },
        { toolName: "materialize_files", argsDigest: "empty", isError: false },
        { toolName: "materialize_files", argsDigest: "empty", isError: false },
        // `bash` varied its arguments once and then repeated one of them: that repeat still counts.
        { toolName: "bash", argsDigest: "a", isError: false },
        { toolName: "bash", argsDigest: "b", isError: false },
        { toolName: "bash", argsDigest: "a", isError: false },
      ],
      truncated: false,
      droppedRawEvents: 0,
    });
    expect(facts.byTool.materialize_files).toEqual({ calls: 3, errors: 0, repeats: 0 });
    expect(facts.byTool.bash).toEqual({ calls: 3, errors: 0, repeats: 1 });
    expect(facts.repeatedCalls).toEqual({ value: 1, of: 6, from: 6 });
  });

  it("a call with no args digest is not an equality, and an open call is not a success", () => {
    const facts = caseTraceFacts({
      schema: "case-trace/v4",
      backend: null,
      turns: [{ turn: 1 }],
      toolCalls: [
        { toolName: "grep", argsDigest: null },
        { toolName: "grep", argsDigest: null },
      ],
      truncated: false,
      droppedRawEvents: 0,
    });
    // Two identical-looking calls, no digest on either: the trace cannot say they were the same.
    expect(facts.repeatedCalls).toBeNull();
    // isError absent on both — started and never ended, visible as unknown instead of as success.
    expect(facts.openCalls).toBe(2);
    expect(facts.erroredCalls).toBeNull();
    // A turn with no timing or usage reads each of those as a stated absence.
    expect(facts.turnMs).toBeNull();
    expect(facts.inputTokens).toBeNull();
  });

  /** The wall-stopped case: the turn never ended, so it has no duration, and a reader asking how
   *  long the solve ran got null from every field. A v4 trace states the elapsed time separately,
   *  and the fact keeps its own denominator: one turn of two carried it. */
  it("reads an interrupted turn's elapsed time where its duration does not exist", () => {
    const facts = caseTraceFacts({
      schema: "case-trace/v4",
      backend: "pi",
      turns: [
        { turn: 1, timingMs: 500, observedMs: null },
        { turn: 2, timingMs: null, observedMs: 23_220_000 },
      ],
      toolCalls: [{ toolName: "bash", argsDigest: "a", observedMs: 23_219_300 }],
      truncated: false,
      droppedRawEvents: 0,
    });
    expect(facts.turnMs).toEqual({ value: 500, of: 1, from: 2 });
    expect(facts.openMs).toEqual({ value: 23_220_000, of: 1, from: 2 });
    expect(facts.openCalls).toBe(1);
  });

  /** A v1/v2/v3 trace carries no such field, and absence stays absence. */
  it("leaves the elapsed time of a trace written before v4 unstated", () => {
    const facts = caseTraceFacts({
      schema: "case-trace/v4",
      backend: "claude",
      turns: [{ turn: 1, timingMs: null }],
      toolCalls: [],
      truncated: false,
      droppedRawEvents: 0,
    });
    expect(facts.openMs).toBeNull();
  });

  it("a sum states how many records carried the field, so a partial total cannot pass as a full one", () => {
    const facts = caseTraceFacts({
      schema: "case-trace/v4",
      backend: "claude",
      turns: [{ turn: 1, costUsd: 2 }, { turn: 2 }, { turn: 3 }],
      toolCalls: [],
      truncated: false,
      droppedRawEvents: 0,
    });
    expect(facts.costUsd).toEqual({ value: 2, of: 1, from: 3 });
  });

  it("spread separates a uniform battery from a bimodal one the mean cannot", () => {
    expect(spread([8, 8, 8, 8])).toEqual({ min: 8, median: 8, max: 8, mean: 8, n: 4 });
    expect(spread([3, 3, 3, 3, 28, 28])).toMatchObject({ min: 3, max: 28, median: 3, n: 6 });
    expect(spread([null, null])).toBeNull();
  });

  /**
   * The outcome reader and the whole-run telemetry script both fold a battery this way, and each
   * used to spell the six sums and the two spreads itself. The empty fold is the half a
   * hand-written copy gets wrong: nothing recorded has to stay null, because a zero cost over
   * nothing reads as a battery that was free.
   */
  it("folds a battery once, and an empty battery stays null rather than zero", () => {
    const one = { turns: 4, toolCalls: 9, costUsd: { value: 2, of: 1, from: 1 } };
    const two = { turns: 12, toolCalls: 3, costUsd: { value: 5, of: 1, from: 1 } };
    const none = {
      repeatedCalls: null,
      erroredCalls: null,
      toolMs: null,
      inputTokens: null,
      outputTokens: null,
    };
    const folded = foldTraceFacts([
      { ...one, ...none },
      { ...two, ...none },
    ]);
    expect(folded.costUsd).toEqual({ value: 7, of: 2, from: 2 });
    expect(folded.turnSpread).toMatchObject({ min: 4, max: 12, mean: 8, n: 2 });
    expect(folded.toolCallSpread).toMatchObject({ min: 3, max: 9, n: 2 });
    expect(folded.inputTokens).toBeNull();

    const empty = foldTraceFacts([]);
    expect(empty).toEqual({
      turnSpread: null,
      toolCallSpread: null,
      repeatedCalls: null,
      erroredCalls: null,
      toolMs: null,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
    });
  });
});
