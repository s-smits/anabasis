/**
 * Hostile-input tests for the Builder's model-facing tools.
 *
 * These tools return text to the Builder, and their results share one ceiling at
 * TOOL_TEXT_LIMITS.evidence. Four tools reached it from four different directions — a context read
 * of an admitted file, a context listing, a context search, and a public task projection — and each
 * one threw. The exceptions gave the model no usable result or next step: the tool had failed to
 * answer a request it was meant to support.
 *
 * This file tests related cases beyond those four failures. Models can send invalid arguments,
 * hundreds of distinct values for a closed set of seven. The inputs here include errors
 * observed in model calls — offsets past the end, a negative offset, a fractional limit, an unknown
 * id, a traversal string where an identifier belongs — and the assertion is the same for all of
 * them, which is why the three tools share one file: either return a result that fits and says what
 * it covers, or throw an error naming what was wrong with the request. Never a bare crash, and
 * never more than one result can hold.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { Type } from "@earendil-works/pi-ai";
import { writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { join } from "../src/meta/path.ts";
import { createHarnessInspectTool } from "../src/builder/harness-inspect.ts";
import { prepareUserContext } from "../src/builder/user-context.ts";
import { createContextTool, RehearsalTraces } from "../src/builder/context-tool.ts";
import { TOOL_TEXT_LIMITS, defineTool } from "../src/solve/define-tool.ts";
import { DraftStore } from "../src/solve/draft-store.ts";
import { defineDraftTool } from "../src/solve/draft-tool.ts";
import { double } from "./helpers/doubles.ts";
import { MATCHING_TASKS, writeMatchingBuildFixture } from "./helpers/matching-fixture.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { errorMessage } from "../src/meta/runtime-values.ts";

const ASK = { question: "what does the corpus say", decides: "the hostile case" };

afterAll(cleanupScratch);

/** A context corpus that is hostile in three different ways at once: one file far above the tool
 *  result ceiling, one minified single line, and one file that matches everything. */
function hostileContext() {
  const dir = scratchDir("ana-hostile-ctx-");
  writeFileSync(join(dir, "huge.md"), Array.from({ length: 8_000 }, (_, i) => `row ${i} needle`).join("\n"));
  writeFileSync(join(dir, "minified.json"), `{"blob":"${"z".repeat(300_000)}"}`);
  writeFileSync(join(dir, "small.txt"), "needle\n");
  return createContextTool({
    round: "",
    workspace: dir,
    rehearsals: new RehearsalTraces(),
    user: prepareUserContext(dir, ["huge.md", "minified.json", "small.txt"]),
  });
}

function inspectTool() {
  const dir = scratchDir("ana-hostile-inspect-");
  writeMatchingBuildFixture(dir);
  const tasks = structuredClone(MATCHING_TASKS);
  tasks[0]!.hidden[0]!.expectation = { privateMarker: "hidden-answer-must-stay-private" };
  writeFileSync(join(dir, "correctness-model/tasks.json"), JSON.stringify(tasks));
  return createHarnessInspectTool({ workspace: dir, context: { slug: "matching" } });
}

/** Require either bounded text or a refusal that names the request problem. Assertions reject
 *  empty errors and failures caused by an oversized result; this helper never returns false. */
async function settles(
  tool: {
    execute: (id: string, params: never) => Promise<{ content: Array<{ type: string; text?: string }> }>;
  },
  params: JsonObject,
): Promise<{ ok: true; text: string } | { ok: "refused"; message: string }> {
  try {
    const result = await tool.execute("hostile", double(params));
    const block = result.content[0];
    if (block?.type !== "text" || block.text === undefined) throw new Error("tool returned no text block");
    const { text } = block;
    expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(TOOL_TEXT_LIMITS.evidence);
    return { ok: true, text };
  } catch (error) {
    const message = errorMessage(error);
    // A refusal has to name what was wrong with the request. An empty or generic throw leaves the
    // model with nothing to change, so it loops on the same call.
    expect(message.length).toBeGreaterThan(8);
    // And it must be about the request, not about the result being too big to return. That second
    // kind is the defect this file exists for: the model asked a legitimate question and the tool
    // stopped working. Accepting it here would let these tests pass against the behaviour they were
    // written to rule out.
    expect(message).not.toMatch(/public limit|evidence text|exceeds/i);
    return { ok: "refused", message };
  }
}

function returning(text: string) {
  return defineTool({
    name: "returns",
    label: "Returns",
    description: "Returns a fixed body.",
    parameters: Type.Object({}),
    run: () => ({ text }),
  });
}

describe("the tool result ceiling", () => {
  it("cuts an over-long host tool result and says so instead of throwing", async () => {
    const outcome = await settles(returning("x".repeat(TOOL_TEXT_LIMITS.evidence * 3)), {});
    if (outcome.ok !== true) throw new Error("an over-long result should be cut, not refused");
    expect(outcome.text).toContain("result was shortened");
    expect(outcome.text).toContain("narrower range");
  });

  it("leaves a result that already fits byte-identical", async () => {
    const text = "a normal tool result\nover two lines";
    const outcome = await settles(returning(text), {});
    if (outcome.ok !== true) throw new Error("a normal result should return");
    expect(outcome.text).toBe(text);
  });

  it("holds the ceiling for multi-byte text, where a cut can land mid-character", async () => {
    const outcome = await settles(returning("é".repeat(TOOL_TEXT_LIMITS.evidence)), {});
    expect(outcome.ok).toBe(true);
  });

  // The generated harness's own contract keeps the refusal on purpose. Its results are framed for
  // the worker protocol, and text past the ceiling there is an authoring defect that conformance
  // should reject, not a controller result to shorten quietly.
  it("still refuses an over-long draft tool result, which is a generated-harness defect", async () => {
    const tool = defineDraftTool({
      name: "read",
      label: "Read",
      description: "Read.",
      parameters: Type.Object({}),
      run: () => ({ text: "x".repeat(TOOL_TEXT_LIMITS.evidence + 1) }),
    });
    await expect(tool.execute("large", {}, new DraftStore())).rejects.toThrow(/evidence text exceeds/);
  });
});

const page = (args: JsonObject): JsonObject => ({ ...ASK, depth: "page", ...args });

describe("context under hostile arguments", () => {
  const CASES: Array<[string, JsonObject]> = [
    ["a read of a single 300 KB line", page({ id: "ctx-2" })],
    ["an offset past the end", page({ id: "ctx-1", offset: 999_999 })],
    ["a negative offset", page({ id: "ctx-1", offset: -40 })],
    ["a fractional limit", page({ id: "ctx-1", limit: 2.7 })],
    ["a zero limit", page({ id: "ctx-1", limit: 0 })],
    ["an enormous limit", page({ id: "ctx-1", limit: 10 ** 9 })],
    ["an unknown id", page({ id: "ctx-999" })],
    ["a listing with a silly limit", { ...ASK, depth: "overview", limit: 10 ** 9 }],
    ["a question matching nothing", { ...ASK, question: "no-such-string-anywhere" }],
    ["an empty question", { ...ASK, question: "   " }],
    ["citations paged past their end", { ...ASK, question: "needle", offset: 10 ** 6 }],
    ["a character page far past the end", page({ id: "ctx-2", characterOffset: 10 ** 9 })],
  ];

  for (const [name, params] of CASES) {
    it(`settles ${name}`, async () => {
      expect((await settles(hostileContext(), params)).ok).toBeDefined();
    });
  }

  // The central guard would keep any of these under the ceiling on its own, which is precisely why
  // "it fits" is too weak an assertion to prove the tool windowed anything. A tool that windows
  // states the range it covers and the offset for the rest; a tool that fell through to the guard
  // carries the guard's own note instead. Asserting both makes a removed window visible here.
  it("windows a large read itself rather than falling through to the central cut", async () => {
    const outcome = await settles(hostileContext(), page({ id: "ctx-1" }));
    if (outcome.ok !== true) throw new Error("a read of an admitted file should return a page");
    expect(outcome.text).toMatch(/lines 1-\d+ of 8000/);
    expect(outcome.text).toContain("call again with offset");
    expect(outcome.text).not.toContain("cut here");
  });

  it("never returns a file's bytes for an id it does not hold", async () => {
    const outcome = await settles(hostileContext(), page({ id: "../../etc/passwd" }));
    expect(outcome.ok).toBe("refused");
    if (outcome.ok === "refused") expect(outcome.message).toMatch(/unknown context id/);
  });

  it("states a total larger than the page it returned", async () => {
    const outcome = await settles(hostileContext(), { ...ASK, question: "needle" });
    if (outcome.ok !== true) throw new Error("a question should have returned citations");
    // 8,000 rows in one file plus one in another. The page is smaller; the count is not.
    expect(outcome.text).toStartWith("Citations 1-30 of 8001 over");
    expect(outcome.text).toContain("continue with offset 31");
  });
});

describe("harness_inspect under hostile arguments", () => {
  const CASES: Array<[string, JsonObject]> = [
    ["a readiness finding page", { action: "readiness", group: 1, field: "detail" }],
    ["a task with no id", { action: "task" }],
    ["an unknown task id", { action: "task", taskId: "no-such-task" }],
    ["a traversal where a task id belongs", { action: "task", taskId: "../../correctness-model/tasks.json" }],
    ["an empty task id", { action: "task", taskId: "" }],
    ["an unknown readiness family", { action: "readiness", family: "no-such-family" }],
  ];

  for (const [name, params] of CASES) {
    it(`settles ${name}`, async () => {
      expect((await settles(inspectTool(), params)).ok).toBeDefined();
    });
  }

  // The inspection reads tasks that carry their answer keys. Whatever the argument, the projection is
  // what leaves. This asserts it over every action at once rather than one fixture at a time.
  it("never lets a hidden expectation leave under any action", async () => {
    const tool = inspectTool();
    for (const params of [
      { action: "readiness" },
      { action: "readiness", group: 1 },
      { action: "task", taskId: "t1" },
      { action: "coverage" },
      { action: "feedback" },
    ]) {
      const outcome = await settles(tool, params);
      if (params.action === "task") expect(outcome.ok).toBe(true);
      if (outcome.ok !== true) continue;
      if (params.action === "task") expect(outcome.text).toContain('"publicTask"');
      expect(outcome.text).not.toContain("hidden-answer-must-stay-private");
      expect(outcome.text).not.toContain("privateMarker");
    }
  });
});
