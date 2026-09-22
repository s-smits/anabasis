import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { sha256OfFile } from "../src/meta/digest.ts";
import { readVerifiedTrace } from "../src/claim/trace-read.ts";
import { recordCaseTracePointer } from "../src/truth/case-trace-pointer.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

const GOOD = JSON.stringify({
  schema: "case-trace/v4",
  backend: "pi",
  turns: [{ turn: 1, assistantChars: 4 }],
  toolCalls: [{ turn: 1, toolName: "read_board_brief", seq: 0 }],
});

/**
 * A case's trace pointer, and the one verified read that reaches the trace through it. The pointer
 * carries the digest of the bytes it saw, so a trace rewritten afterwards reads as drifted rather
 * than as evidence, and a case that produced no usable trace states which way it was unusable
 * instead of carrying a digest of nothing.
 */

afterAll(cleanupScratch);

function runDirWithTrace(taskId: string, body: string | null): string {
  const runDir = scratchDir("case-trace-pointer-");
  mkdirSync(join(runDir, "cases", taskId), { recursive: true });
  if (body !== null) writeFileSync(join(runDir, "cases", taskId, "trace.json"), body);
  return runDir;
}

describe("the per-case trace pointer", () => {
  it("records a trace pointer with its digest and schema, and no warning", () => {
    const runDir = runDirWithTrace("t1", GOOD);
    const pointer = recordCaseTracePointer(runDir, "t1");
    expect(pointer.schema).toBe("case-trace-pointer/v1");
    expect(pointer.taskId).toBe("t1");
    expect(pointer.path).toBe("cases/t1/trace.json");
    expect(pointer.traceSchema).toBe("case-trace/v4");
    expect(pointer.warnings).toEqual([]);
    expect(pointer.sha256).toBe(sha256OfFile(join(runDir, "cases/t1/trace.json")));
  });

  it("reaches the trace through the one verified read, with no record row created", () => {
    const runDir = runDirWithTrace("t2", GOOD);
    const pointer = recordCaseTracePointer(runDir, "t2");
    const read = readVerifiedTrace(
      { traces: [{ path: pointer.path, sha256: pointer.sha256 ?? "" }] },
      runDir,
    );
    expect(read.state).toBe("recorded");
    expect(read.trace?.schema).toBe("case-trace/v4");
    expect(read.trace?.turns).toHaveLength(1);
    expect(read.trace?.toolCalls).toHaveLength(1);
    expect(read.path).toBe("cases/t2/trace.json");
  });

  it("states the absence when a case produced no trace instead of carrying a digest", () => {
    const runDir = runDirWithTrace("t3", null);
    const pointer = recordCaseTracePointer(runDir, "t3");
    expect(pointer.sha256).toBeNull();
    expect(pointer.traceSchema).toBeNull();
    expect(pointer.warnings).toHaveLength(1);
    expect(pointer.warnings[0]).toMatch(/^trace missing —/);
    expect(readVerifiedTrace({ traces: [] }, runDir).state).toBe("no-trace-pointer");
  });

  it.each([
    ["", /^trace empty —/],
    ["{not json", /^malformed trace JSON —/],
    [JSON.stringify({ schema: "case-trace/v99", turns: [], toolCalls: [] }), /^trace schema not readable —/],
  ])("refuses an unusable trace with its own warning (%#)", (body, pattern) => {
    const runDir = runDirWithTrace("t4", body);
    const pointer = recordCaseTracePointer(runDir, "t4");
    expect(pointer.sha256).toBeNull();
    expect(pointer.warnings[0]).toMatch(pattern);
  });

  it("self-invalidates when the trace is rewritten after recording", () => {
    const runDir = runDirWithTrace("t5", GOOD);
    const pointer = recordCaseTracePointer(runDir, "t5");
    writeFileSync(join(runDir, "cases/t5/trace.json"), JSON.stringify({ ...JSON.parse(GOOD), backend: "x" }));
    expect(
      readVerifiedTrace({ traces: [{ path: pointer.path, sha256: pointer.sha256 ?? "" }] }, runDir).state,
    ).toBe("trace-drifted");
  });
});
