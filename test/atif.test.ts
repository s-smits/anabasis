import { afterAll, describe, expect, it } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { tracedRuns, trajectoryOf } from "../src/kernel/atif.ts";
import { append, read } from "../src/kernel/log.ts";
import { mkdtempSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { traceSink } from "../src/agent/session.ts";

const AGENT = { name: "anabasis", version: "abc123", model: "faux-model" };
const USAGE = {
  input: 10,
  output: 5,
  cacheRead: 100,
  cacheWrite: 20,
  cacheWrite1h: 0,
  totalTokens: 135,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.25 },
};

const home = mkdtempSync(join(tmpdir(), "ana-atif-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

/** A solve of two turns with a compaction between them, a call no turn ended, and a Builder's turn. */
function written(): string {
  const log = join(home, "log.jsonl");
  const solve = traceSink(log, "solve", "s-1", () => 1);
  const call = (id: string, args: string | { command: string }, isError: boolean) => {
    solve({ type: "tool_execution_start", toolCallId: id, toolName: "bash", args });
    const content = [{ type: "text" as const, text: `ran ${id}` }];
    solve({ type: "tool_execution_end", toolCallId: id, toolName: "bash", result: { content }, isError });
  };
  call("c-1", { command: "ls" }, false);
  call("c-2", "not an object", true);
  solve({ type: "turn_end", message: { ...fauxAssistantMessage("first"), usage: USAGE }, toolResults: [] });
  append(log, "solve.compacted", { solve: "s-1", usages: [{ cost: { total: 0.5 } }] });
  solve({ type: "turn_end", message: { ...fauxAssistantMessage("second"), usage: USAGE }, toolResults: [] });
  call("c-3", { command: "pwd" }, false);
  traceSink(
    log,
    "build",
    "b-1",
    () => 1,
  )({ type: "turn_end", message: fauxAssistantMessage("built"), toolResults: [] });
  return log;
}

describe("a trace as an ATIF trajectory", () => {
  const events = read(written());
  const trajectory = trajectoryOf(events, "solve", "s-1", AGENT);
  // SAFETY: the shape `trajectoryOf` builds, read back as the test checks it.
  const steps = trajectory.steps as {
    step_id: number;
    source: string;
    message: string;
    tool_calls?: { tool_call_id: string; arguments: object; extra?: object }[];
    observation?: { results: { source_call_id: string; extra: object }[] };
    metrics?: object;
    extra?: object;
  }[];

  it("numbers its steps from one and gives each turn the calls logged before it", () => {
    expect(trajectory.schema_version).toBe("ATIF-v1.8");
    expect(steps.map(({ step_id, source, message }) => [step_id, source, message])).toEqual([
      [1, "agent", "first"],
      [2, "system", "The conversation was compacted."],
      [3, "agent", "second"],
      [4, "agent", ""],
    ]);
    expect(steps[0]?.tool_calls?.map(({ tool_call_id }) => tool_call_id)).toEqual(["c-1", "c-2"]);
    expect(steps[0]?.observation?.results.map(({ source_call_id }) => source_call_id)).toEqual([
      "c-1",
      "c-2",
    ]);
    expect(steps[2]?.tool_calls).toBeUndefined();
  });

  it("keeps an argument that is no object, a failed call and a cut turn in extra", () => {
    expect(steps[0]?.tool_calls?.[1]?.arguments).toEqual({});
    expect(steps[0]?.tool_calls?.[1]?.extra).toMatchObject({ arguments: "not an object" });
    expect(steps[0]?.observation?.results[1]?.extra).toEqual({ is_error: true });
    expect(steps[3]?.extra).toEqual({ unfinished: true });
    expect(steps[3]?.metrics).toBeUndefined();
  });

  it("counts every input token as prompt and the cache reads as cached, as Harbor's pi agent does", () => {
    expect(steps[0]?.metrics).toEqual({
      prompt_tokens: 130,
      completion_tokens: 5,
      cached_tokens: 100,
      cost_usd: 0.25,
      extra: { cache_write_tokens: 20 },
    });
    expect(trajectory.final_metrics).toEqual({
      total_prompt_tokens: 260,
      total_completion_tokens: 10,
      total_cached_tokens: 200,
      total_cost_usd: 1,
      total_steps: 4,
    });
  });

  it("finds each seat's trace once, and reads no other seat's into a trajectory", () => {
    expect(tracedRuns(events)).toEqual([
      { seat: "solve", id: "s-1" },
      { seat: "build", id: "b-1" },
    ]);
    expect(trajectoryOf(events, "build", "b-1", AGENT).steps).toHaveLength(1);
  });
});
