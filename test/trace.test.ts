import { afterAll, describe, expect, it } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { append, read } from "../src/kernel/log.ts";
import { callList, callText, closingOf, traceOf, tracesIn } from "../src/kernel/trace.ts";
import { mkdtempSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { traceSink } from "../src/agent/session.ts";

const home = mkdtempSync(join(tmpdir(), "ana-trace-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

/** A log with one solve's turn and two calls, and a Builder session's turn, call and compaction. */
function written(name: string): string {
  const log = join(home, `${name}.jsonl`);
  for (const [seat, id] of [
    ["solve", "s-1"],
    ["build", "b-1"],
  ] as const) {
    const sink = traceSink(log, seat, id, () => 1);
    for (const [call, result, isError] of [
      ["c-1", "listing", false],
      ["c-2", "", true],
    ] as const) {
      sink({
        type: "tool_execution_start",
        toolCallId: call,
        toolName: "bash",
        args: { command: `ls ${id}` },
      });
      const content = result === "" ? [] : [{ type: "text" as const, text: result }];
      sink({ type: "tool_execution_end", toolCallId: call, toolName: "bash", result: { content }, isError });
    }
    sink({ type: "turn_end", message: fauxAssistantMessage(`done ${id}`), toolResults: [] });
  }
  append(log, "build.compacted", {
    session: "b-1",
    usages: [{ cost: { total: 0.5 } }, { cost: { total: 0.25 } }],
  });
  append(log, "solve.finished", { solve: "s-1", billed: 1 });
  return log;
}

describe("a trace", () => {
  it("reads back each seat's turns and calls as its writer logged them, and no other seat's", () => {
    const events = read(written("seats"));
    const solve = traceOf(events, "solve", "s-1");
    expect(solve.calls.map(({ tool, isError, args }) => [tool, isError, args])).toEqual([
      ["bash", false, { command: "ls s-1" }],
      ["bash", true, { command: "ls s-1" }],
    ]);
    expect(closingOf(solve.turns)).toBe("done s-1");
    expect(traceOf(events, "build", "s-1").calls).toEqual([]);
    expect(traceOf(events, "build", "b-1").turns.map(({ text }) => text)).toEqual(["done b-1"]);
  });

  it("bills a compaction by its summaries, and reads an end or a start as no part of a trace", () => {
    const parts = tracesIn(read(written("parts")));
    const compacted = parts.filter(({ part }) => part === "compacted");
    expect(compacted.map(({ seat, id }) => [seat, id])).toEqual([["build", "b-1"]]);
    expect(compacted[0]?.part === "compacted" && compacted[0].billed).toBe(0.75);
    expect(parts.map(({ part }) => part)).toEqual([
      "call",
      "call",
      "turn",
      "call",
      "call",
      "turn",
      "compacted",
    ]);
  });

  it("pages a call by number, and refuses a number past the last", () => {
    const { calls } = traceOf(read(written("pages")), "solve", "s-1");
    expect(callList(calls)).toBe("1 bash\n2 bash failed");
    expect(callText(calls, 1, 3)).toContain("result: ting");
    expect(callText(calls, 2, 0)).toContain("(no result recorded)");
    expect(() => callText(calls, 3, 0)).toThrow("the solve recorded 2 tool calls");
  });
});
