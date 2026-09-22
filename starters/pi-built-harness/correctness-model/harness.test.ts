/**
 * Seed test suite for the agent-side harness. It is tracked candidate content and it is yours:
 * extend it with domain cases as the harness grows, and make it pass before submitting. It
 * lives under correctness-model/ because candidate validation admits only the three authoring packages there,
 * so the test runner may not be imported from agent/.
 *
 * Run from the workspace root: .toolchain/bun test correctness-model/harness.test.ts correctness-model/evaluator.test.ts
 *
 * These tests are your own authoring evidence. The controller's conformance probe and the host
 * verifier remain the deciding checks; passing here needs no submission and catches the
 * tool-list mismatches those gates would otherwise refuse later.
 */
import { expect, test } from "bun:test";
import { DraftStore } from "@ana/agent-bundle";
import { createDomainHarness } from "../agent/tools.ts";

interface DeclaredTool {
  name: string;
  kind: string;
  description: string;
}
interface ToolsSpec {
  presets: string[];
  tools: DeclaredTool[];
}
interface TaskRow {
  taskId: string;
  family: string;
  publicInput: unknown;
}

async function readJson<T>(name: string): Promise<T> {
  // SAFETY: this local test trusts the candidate files to have the declared shape. The controller
  // independently validates them before measurement; this assertion does not perform that check.
  return (await Bun.file(new URL(name, import.meta.url)).json()) as T;
}

const spec = await readJson<ToolsSpec>("../agent/tools-spec.json");
const tasks = await readJson<TaskRow[]>("./tasks.json");

/** Until correctness-model/tasks.json is authored, exercise the factory with one synthetic task. */
const probeTasks: TaskRow[] =
  tasks.length > 0 ? tasks : [{ taskId: "starter-probe", family: "starter", publicInput: {} }];

test("createDomainHarness returns a tool array for every task", () => {
  for (const task of probeTasks) {
    const harness = createDomainHarness(task);
    expect(Array.isArray(harness.tools), `${task.taskId}: harness.tools must be an array`).toBe(true);
  }
});

/**
 * The worked example of calling one of your own tools. A tool is authored as `run: () => ({ text })`
 * but answers `{ content: [{ type: "text", text }] }`, and its third argument is the DraftStore, so
 * `tool.run(params, {})` and `(await tool.execute(id, params, store)).text` both fail. Copy this
 * shape when you add domain cases below.
 */
test("every parameterless tool answers with model-visible text", async () => {
  for (const task of probeTasks) {
    for (const tool of createDomainHarness(task).tools) {
      const required =
        "required" in tool.parameters && Array.isArray(tool.parameters.required)
          ? tool.parameters.required
          : [];
      if (required.length > 0) continue;
      const result = await tool.execute(`suite-${tool.name}`, {}, new DraftStore());
      const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
      expect(text.length, `${task.taskId}: ${tool.name} returned no text`).toBeGreaterThan(0);
    }
  }
});

test("implemented tool names equal agent/tools-spec.json on every task", () => {
  const declared = spec.tools.map((tool) => tool.name).sort();
  for (const task of probeTasks) {
    const implemented = createDomainHarness(task)
      .tools.map((tool) => tool.name)
      .sort();
    expect(
      implemented,
      `${task.taskId}: agent/tools.ts implements [${implemented.join(", ")}] but agent/tools-spec.json declares [${declared.join(", ")}] — the submit probe refuses any difference`,
    ).toEqual(declared);
  }
});

/** The description is the tool's contract as the agent reads it, so the served text and the
 *  declared text are one surface. A tools.ts description that understates what its tool writes
 *  reaches the agent while the declared one reaches only the validator. */
test("served tool descriptions equal agent/tools-spec.json on every task", () => {
  const declared = new Map(spec.tools.map((tool) => [tool.name, tool.description]));
  for (const task of probeTasks) {
    for (const tool of createDomainHarness(task).tools) {
      const contract = declared.get(tool.name);
      if (contract === undefined) continue;
      expect(
        tool.description,
        `${task.taskId}: agent/tools.ts serves "${tool.name}" with a description agent/tools-spec.json does not declare — the submit probe refuses the difference`,
      ).toBe(contract);
    }
  }
});
