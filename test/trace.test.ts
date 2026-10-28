import { afterAll, describe, expect, it } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { append, read } from "../src/kernel/log.ts";
import { callList, callText, closingOf, traceOf, tracesIn, unfinished } from "../src/kernel/trace.ts";
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
      const invocation = {
        type: "toolCall" as const,
        id: call,
        name: "bash",
        arguments: { command: `ls ${id}` },
      };
      sink.beforeTool(invocation);
      sink.afterTool(invocation, { output: [{ type: "text", text: result }], isError });
    }
    sink.turn(fauxAssistantMessage(`done ${id}`));
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

  it("lists each call with its size and command, opens one whole, and refuses a number past the last", () => {
    const { calls } = traceOf(read(written("pages")), "solve", "s-1");
    // The duration is the host's clock, so only its shape is fixed.
    expect(callList(calls)).toMatch(
      /^1 bash \(7 characters, \d+\.\d s\): ls s-1\n2 bash failed \(0 characters, \d+\.\d s\): ls s-1$/,
    );
    expect(callText(calls, 1)).toContain("result: listing");
    expect(callText(calls, 2)).toContain("(no result recorded)");
    expect(() => callText(calls, 3)).toThrow("the solve recorded 2 tool calls");
  });
  it("reads and bills Referee traces until their finding ends the same reading", () => {
    const log = join(home, "referee.jsonl");
    const sink = traceSink(log, "referee", "r-1", () => 1);
    sink.turn(fauxAssistantMessage("A ruling."));
    append(log, "referee.compacted", { reader: "r-1", usages: [{ cost: { total: 0.5 } }] });
    expect(traceOf(read(log), "referee", "r-1").turns).toHaveLength(1);
    expect(unfinished(read(log))).toMatchObject([{ of: "referee", id: "r-1", turns: 1, dollars: 0.5 }]);
    append(log, "referee.finding", { reader: "r-1", session: "b-1", solve: "s-1", ruling: "earned" });
    expect(unfinished(read(log))).toEqual([]);
  });
});
