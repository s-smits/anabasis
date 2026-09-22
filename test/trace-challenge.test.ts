import { describe, expect, it } from "bun:test";
import {
  DEFAULT_MAX_CHARS,
  renderTraceRecord,
  selectLatestRecords,
} from "../.claude/skills/whole-run-investigation/scripts/trace-challenge.mjs";
import { buildTraceTelemetry } from "../.claude/skills/whole-run-investigation/scripts/trace-telemetry.mjs";

describe("whole-run trace challenge packet", () => {
  it("keeps the newest records inside the byte bound", () => {
    const records = [
      { seq: 1, text: "old-".repeat(30) },
      { seq: 2, text: "middle-".repeat(30) },
      { seq: 3, text: "new-".repeat(30) },
    ];
    const selected = selectLatestRecords(records, 100);
    expect(selected.selectedBytes).toBeLessThanOrEqual(100);
    expect(selected.context).toContain("new-");
    expect(selected.context).not.toContain("old-");
    expect(selected.truncated).toBe(true);
    expect(DEFAULT_MAX_CHARS).toBe(400_000);
  });

  it("clips an oversized newest record while retaining its identity header", () => {
    const selected = selectLatestRecords([{ seq: 9, text: `identity\n${"preview ".repeat(100)}` }], 80);
    expect(selected.records).toHaveLength(1);
    expect(selected.records[0]?.text).toContain("identity");
    expect(selected.records[0]?.clipped).toBe(true);
    expect(selected.selectedBytes).toBeLessThanOrEqual(80);
  });

  it("uses the remaining window for the tail of the next older record", () => {
    const selected = selectLatestRecords(
      [
        { seq: 1, text: `old identity\n${"old preview ".repeat(20)}` },
        { seq: 2, text: `new identity\n${"new preview ".repeat(5)}` },
      ],
      180,
    );
    expect(selected.selectedBytes).toBeLessThanOrEqual(180);
    expect(selected.context).toContain("new identity");
    expect(selected.context).toContain("old");
    expect(selected.records.some((record) => record.clipped)).toBe(true);
  });

  it("counts the UTF-8 byte cap rather than letting a split code point exceed it", () => {
    const selected = selectLatestRecords([{ seq: 1, text: "å".repeat(100) }], 7);
    expect(selected.selectedBytes).toBeLessThanOrEqual(7);
    expect(new TextEncoder().encode(selected.context).byteLength).toBeLessThanOrEqual(7);
  });

  it("renders previews but excludes raw arguments, results and error messages", () => {
    const rendered = renderTraceRecord(
      { seq: 1 },
      {
        runId: "run-1",
        taskId: "task-1",
        family: "family-1",
        acceptedSubmit: true,
        pass: false,
        runtimeNonResult: null,
        traces: [{ path: "trace.json", sha256: "digest" }],
      },
      {
        state: "recorded",
        path: "trace.json",
        trace: {
          schema: "case-trace/v4",
          turns: [
            {
              turn: 1,
              status: "failed",
              stopReason: null,
              assistantPreview: "try the public tool",
              errorMessage: "protected error should not cross",
            },
          ],
          toolCalls: [
            {
              seq: 1,
              turn: 1,
              toolName: "inspect",
              argsChars: 42,
              argsDigest: "secret-digest",
              resultPreview: "protected result",
              resultExcerpt: "protected excerpt bytes",
              argsExcerpt: "protected args bytes",
              isError: true,
              timingMs: 7,
            },
          ],
          truncated: false,
          droppedRawEvents: 2,
        },
      },
      "fail",
    );
    expect(rendered.text).toContain("try the public tool");
    expect(rendered.text).toContain("tool=inspect");
    expect(rendered.text).not.toContain("protected error");
    expect(rendered.text).not.toContain("secret-digest");
    expect(rendered.text).not.toContain("protected result");
    // Error and argument excerpts remain excluded from this WRI packet.
    expect(rendered.text).not.toContain("protected excerpt bytes");
    expect(rendered.text).not.toContain("protected args bytes");
  });

  it("counts tools, sequences, families and paired changes over every recorded trace", () => {
    const trace = (tools: Array<[string, string, boolean]>) => ({
      schema: "case-trace/v4",
      backend: "codex",
      turns: [{ turn: 1, inputTokens: 10, outputTokens: 2, costUsd: 0.01 }],
      toolCalls: tools.map(([toolName, argsDigest, isError], index) => ({
        seq: index + 1,
        toolName,
        argsDigest,
        isError,
        timingMs: 3,
      })),
      truncated: false,
      droppedRawEvents: 0,
    });
    const telemetry = buildTraceTelemetry([
      { runId: "7-off", taskId: "a", family: "deck", outcome: "pass", trace: trace([["read", "x", false]]) },
      {
        runId: "7-on",
        taskId: "a",
        family: "deck",
        outcome: "pass",
        // `check` varies its arguments across the solve, so its repeated `y` counts as a repeat.
        // A tool called one way throughout has no argument to vary and reports none, which is
        // what keeps a parameterless tool out of the repeat column — see test/outcome-scan.
        trace: trace([
          ["read", "x", false],
          ["check", "y", false],
          ["check", "y", true],
          ["check", "z", false],
        ]),
      },
    ]);
    expect(telemetry.batteries["7-on"]?.toolCallSpread).toMatchObject({ min: 4, median: 4, max: 4, n: 1 });
    expect(telemetry.batteries["7-on"]?.tools).toEqual([
      { name: "check", calls: 3, errors: 1, repeats: 1, share: 3 / 4 },
      { name: "read", calls: 1, errors: 0, repeats: 0, share: 1 / 4 },
    ]);
    expect(telemetry.batteries["7-on"]?.families.deck?.sequences).toMatchObject({ distinct: 1 });
    expect(telemetry.paired).toEqual([
      expect.objectContaining({
        left: "7-off",
        right: "7-on",
        sharedRecordedTasks: 1,
        toolCallsChanged: 1,
        sequencesChanged: 1,
        rightMinusLeftToolCalls: 3,
        taskDiffs: [
          expect.objectContaining({
            taskId: "a",
            family: "deck",
            left: expect.objectContaining({ toolCalls: 1, sequence: ["read"] }),
            right: expect.objectContaining({ toolCalls: 4, sequence: ["read", "check", "check", "check"] }),
          }),
        ],
      }),
    ]);
  });

  it("keeps missing traces absent and excludes prompt, argument and result content", () => {
    const telemetry = buildTraceTelemetry([
      {
        runId: "7-on",
        taskId: "missing",
        family: "tower",
        outcome: "non-result",
        trace: null,
        prompt: "do not retain this prompt",
        argsDigest: "do not retain this digest",
        resultPreview: "do not retain this result",
      },
    ]);
    expect(telemetry.batteries["7-on"]?.cases).toEqual({ seen: 1, recorded: 0 });
    expect(telemetry.batteries["7-on"]?.toolCallSpread).toBeNull();
    expect(JSON.stringify(telemetry)).not.toContain("do not retain");
  });
});
