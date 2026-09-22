/**
 * What one failed case tells the reader.
 *
 * The excerpt is the only part of a trace that crosses into the packet, so it must quote the
 * failing call's own words, state an absence as an absence, and disclose its own clipping.
 * Inventing an outcome for a call still open is the failure this guards.
 */
import { describe, expect, test } from "bun:test";
import type { ReadCaseTrace } from "../src/claim/trace-read.ts";
import { traceExcerpt } from "../src/review/diagnosis-reader.ts";

describe("what one failed case tells the reader", () => {
  const trace = (
    over: Partial<ReadCaseTrace> = {},
  ) => /* SAFETY: ReadCaseTrace's turns and toolCalls are free JSON records by declaration, so this
       fixture is the shape the reader already accepts from a recorded file. */ ({
    schema: "case-trace/v4",
    backend: "codex",
    turns: [{ assistantPreview: "", stopReason: null, errorMessage: "Pi turn 1 failed" }],
    toolCalls: [
      {
        toolName: "bash",
        isError: true,
        argsExcerpt: '{"command":"curl https://downloads.arduino.cc/tool"}',
        resultExcerpt: "Download failed: lookup downloads.arduino.cc: no such host",
      },
      {
        toolName: "submit",
        isError: false,
        argsExcerpt: "SUCCESS_ARGS_MUST_STAY_OMITTED",
        resultExcerpt: null,
      },
    ],
    truncated: false,
    droppedRawEvents: 0,
    ...over,
  });

  test("a failed tool call's own words reach the excerpt", () => {
    // The shape of a real codex trace: 98% of 6,838 recorded ones have no final assistant text,
    // and the cause sits in resultExcerpt, which the excerpt did not read.
    const text = traceExcerpt(trace());
    expect(text).toContain("no such host");
    expect(text).toContain("turn error: Pi turn 1 failed");
    expect(text).toContain("failed bash:");
    expect(text).toContain('arguments: {"command":"curl https://downloads.arduino.cc/tool"}');
    expect(text).not.toContain("SUCCESS_ARGS_MUST_STAY_OMITTED");
  });

  test("a failed call keeps bounded arguments even when its result is missing", () => {
    const text = traceExcerpt(
      trace({
        toolCalls: [
          {
            toolName: "write",
            isError: true,
            argsExcerpt: "x".repeat(1_200) + "ARG_TAIL",
            resultExcerpt: null,
          },
        ],
      }),
    );
    expect(text).toContain("failed write: (no result recorded)");
    expect(text).toContain("arguments: " + "x".repeat(1_200));
    expect(text).not.toContain("ARG_TAIL");
  });

  test("an empty final text is stated as absent rather than left dangling", () => {
    expect(traceExcerpt(trace())).toContain("final assistant text: (none recorded)");
  });

  test("a passing trace quotes no failure lines", () => {
    const text = traceExcerpt(
      trace({
        turns: [{ assistantPreview: "done", stopReason: "completed", errorMessage: null }],
        toolCalls: [{ toolName: "submit", isError: false }],
      }),
    );
    expect(text).not.toContain("turn error:");
    expect(text).not.toContain("failed ");
    expect(text).toContain("final assistant text: done");
  });

  test("a trace with no tool errors still offers bounded recorded results, without inventing outcomes for open calls", () => {
    const text = traceExcerpt(
      trace({
        toolCalls: [
          ...Array.from({ length: 10 }, () => ({
            toolName: "read",
            isError: false,
            resultPreview: "EARLIER_PREVIEW",
            argsExcerpt: "SUCCESS_ARGS_MUST_STAY_OMITTED",
          })),
          { toolName: "preview_artifact", isError: false, resultPreview: '{"resolutionBits":17}' },
          { toolName: "submit", isError: false, resultPreview: "Submitted." },
          { toolName: "pending", isError: null, resultPreview: "UNFINISHED_RESULT" },
        ],
      }),
    );
    expect(text).toContain('completed preview_artifact: {"resolutionBits":17}');
    expect(text).toContain("recorded preview");
    expect(text).toContain("tool result excerpts: 3/13; 10 omitted");
    expect(text).not.toContain("UNFINISHED_RESULT");
    expect(text).not.toContain("SUCCESS_ARGS_MUST_STAY_OMITTED");
    expect(text).not.toContain("failed ");
  });

  test("limits excerpts from a trace with twenty failed tool calls", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      toolName: "bash",
      isError: true,
      resultExcerpt: `error ${i}`,
    }));
    const text = traceExcerpt(trace({ toolCalls: many }));
    expect(text).toContain("error 0");
    expect(text).not.toContain("error 9");
    expect(text).toContain("tool result excerpts: 3/20; 17 omitted");
  });

  test("later permitted outcomes qualify early errors, with ordering and clipping disclosed", () => {
    const text = traceExcerpt(
      trace({
        toolCalls: [
          { toolName: "bash", isError: true, resultExcerpt: "compiler unavailable" },
          ...Array.from({ length: 12 }, () => ({
            toolName: "read",
            isError: false,
            resultPreview: "public data",
          })),
          { toolName: "bash", isError: false, resultPreview: "compiled successfully" },
          { toolName: "check", isError: false, resultPreview: "x".repeat(1_300) },
        ],
        truncated: true,
        droppedRawEvents: 7,
      }),
    );
    expect(text).toContain("call 1 failed bash: compiler unavailable");
    expect(text).toContain("call 14 completed bash: compiled successfully");
    expect(text.indexOf("compiler unavailable")).toBeLessThan(text.indexOf("compiled successfully"));
    expect(text).toContain("tool result excerpts: 4/15; 11 omitted");
    expect(text).toContain("[result clipped]");
    expect(text).toContain("recorded trace incomplete: truncated=true, dropped raw events=7");
    expect(text.length).toBeLessThan(3_000);
  });

  test("an absent trace still says so", () => {
    expect(traceExcerpt(null)).toBe("(no readable trace)");
  });
});
