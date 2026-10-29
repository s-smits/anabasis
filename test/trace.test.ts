import { afterAll, describe, expect, it } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { append, read } from "../src/kernel/log.ts";
import {
  callList,
  callText,
  closingOf,
  cutSessions,
  traceOf,
  tracesIn,
  unfinished,
} from "../src/kernel/trace.ts";
import { mkdtempSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { traceSink } from "../src/agent/session.ts";

const home = mkdtempSync(join(tmpdir(), "ana-trace-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

describe("a trace", () => {
  it("recovers completed draft submissions without charging unread or failed calls as attempts", () => {
    const log = join(home, "draft-cut.jsonl");
    append(log, "draft.started", { session: "d-1" });
    const sink = traceSink(log, "draft", "d-1", () => 1);
    for (const [id, name, isError] of [
      ["c-0", "read_opening", false],
      ["c-1", "draft_exam", false],
      ["c-2", "draft_exam", false],
      ["c-3", "draft_exam", false],
      ["c-4", "draft_exam", true],
    ] as const) {
      sink.afterTool({ type: "toolCall", id, name, arguments: {} }, { output: [], isError });
    }
    append(log, "draft.started", { session: "d-2" });
    expect(cutSessions(read(log))).toMatchObject([
      { of: "draft", session: "d-1", tries: 3 },
      { of: "draft", session: "d-2", tries: 0 },
    ]);
    append(log, "draft.finished", { session: "d-1", ended: "killed", tries: 3 });
    expect(cutSessions(read(log))).toMatchObject([{ session: "d-2", tries: 0 }]);
  });
  it("isolates seats, bills summaries and lists complete calls with bounded indices", () => {
    const log = join(home, "seats.jsonl");
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
    const events = read(log);
    const solve = traceOf(events, "solve", "s-1");
    expect(solve.calls.map(({ tool, isError, args }) => [tool, isError, args])).toEqual([
      ["bash", false, { command: "ls s-1" }],
      ["bash", true, { command: "ls s-1" }],
    ]);
    expect(closingOf(solve.turns)).toBe("done s-1");
    expect(traceOf(events, "build", "s-1").calls).toEqual([]);
    expect(traceOf(events, "build", "b-1").turns.map(({ text }) => text)).toEqual(["done b-1"]);

    const parts = tracesIn(events);
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

    const { calls } = solve;
    // The duration is the host's clock, so only its shape is fixed.
    const listed = callList(calls).split("\n");
    expect(listed).toHaveLength(2);
    for (const [index, line] of listed.entries()) {
      expect(line).toStartWith(`${String(index + 1)} bash`);
      expect(line.includes("failed")).toBe(index === 1);
      expect(line).toContain(index === 0 ? "7 characters" : "failed (0 characters");
      expect(line).toMatch(/\d+\.\d s/u);
      expect(line).toContain("ls s-1");
    }
    expect(callText(calls, 1)).toContain("result: listing");
    expect(callText(calls, 2)).toContain("(no result recorded)");
    expect(() => callText(calls, 3)).toThrow(/2 tool calls/u);
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
