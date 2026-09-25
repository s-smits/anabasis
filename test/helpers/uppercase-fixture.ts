/**
 * The smallest complete candidate the production gates admit: one public input, one authored
 * check, task-bound accept and reject controls at the calibration floor, a reference solve and an
 * artifact writer. Extracted from the experiment-freeze warranty so the whole-loop warranty and the
 * simulation runner author the same bytes through a scripted session.
 */
import type { Brief } from "../../src/truth/brief.ts";
import type { JsonValue } from "../../src/meta/json-shape.ts";
import type { Toolset } from "../../src/truth/contracts.ts";
import type { Solver } from "../../src/truth/solve.ts";
import { chmodSync, mkdirSync, writeFileSync } from "../../src/meta/filesystem.ts";
import { join } from "../../src/meta/path.ts";
import { double } from "./doubles.ts";

/** Public inputs in task order; the first four are the historical fixture, the controller's
 *  battery floor of six takes the rest. */
export const UPPERCASE_TASK_INPUTS = ["a", "ab", "c", "cd", "e", "ef"] as const;

/** The computational contract from reference-solve-package, completed for campaign admission. */
export function uppercaseFixture(dir: string, redesign = false, tool = false, taskCount = 4): void {
  mkdirSync(join(dir, "correctness-model/reference"), { recursive: true });
  mkdirSync(join(dir, "agent"), { recursive: true });
  const put = (path: string, value: JsonValue) => writeFileSync(join(dir, path), JSON.stringify(value));
  const brief: Brief = {
    correctnessContract: "check-program/v1",
    slug: "matching",
    domain: "uppercase letters",
    decisions: ["uppercase the public input"],
    gates: ["correct uppercase answer"],
    ruleDecisions: [
      {
        id: "uppercase",
        visibility: "public",
        families: ["first", "second", "coordination"],
        statement:
          "The answer equals the uppercase public input, as a string or a singleton array containing it.",
        publicInputPaths: ["$.input"],
      },
    ],
    truthChecks: [
      {
        id: "answer",
        citedDecisionIds: ["uppercase"],
        assertion: "The answer is the uppercase public input.",
        execution: {
          families: "all",
          artifactPaths: ["$.answer"],
          publicInputPaths: ["$.input"],
          hidden: "none",
          evidence: { kind: "authored" },
        },
      },
    ],
    joins: [],
    artifactSchema: [{ name: "answer", "shape": "string or singleton array" }],
    designRuleConstants: [],
  };
  if (tool) brief.truthChecks[0]!.execution.requiredToolIds = ["uppercase-fixture"];
  writeFileSync(join(dir, "correctness-model/brief.json"), JSON.stringify(brief));
  const inputs = (redesign ? ["z", "xy", "jk", "w", "v", "uv"] : [...UPPERCASE_TASK_INPUTS]).slice(
    0,
    taskCount,
  );
  put(
    "correctness-model/tasks.json",
    inputs.map((input, index) => ({
      taskId: `t${index}`,
      family: index < 2 ? "first" : redesign ? "coordination" : "second",
      intendedFeatures: { hiddenChecks: { min: 0, max: 0 } },
      publicInput: { input, length: input.length },
      difficultyAxisPath: "$.length",
      hidden: [],
    })),
  );
  put("correctness-model/controls.json", {
    accept: Array.from({ length: 25 }, (_, i) => ({
      id: `accept-${i}`,
      taskId: `t${i % taskCount}`,
      artifact: { answer: inputs[i % taskCount]!.toUpperCase() },
    })),
    reject: Array.from({ length: 25 }, (_, i) => ({
      id: `reject-${i}`,
      taskId: `t${i % taskCount}`,
      artifact: { answer: "" },
      mutationClass: "hollow",
      expectedCheckId: "answer",
    })),
  });
  writeFileSync(
    join(dir, "correctness-model/evaluator.ts"),
    "export const checks = { answer: ({artifact, publicTask}) => (Array.isArray(artifact.answer) && artifact.answer.length === 1 ? artifact.answer[0] : artifact.answer) === publicTask.publicInput.input.toUpperCase() };",
  );
  if (tool) {
    writeFileSync(
      join(dir, "correctness-model/evaluator.ts"),
      'export const checks = { answer: async ({artifact, publicTask}, runtime) => { const result = await runtime.tools.run({ toolId: "uppercase-fixture", args: [] }); return result.exitCode === 0 && artifact.answer === publicTask.publicInput.input.toUpperCase(); } };',
    );
    mkdirSync(join(dir, ".toolchain/bin"), { recursive: true });
    writeFileSync(join(dir, ".toolchain/bin/uppercase-fixture"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(dir, ".toolchain/bin/uppercase-fixture"), 0o755);
  }
  writeFileSync(
    join(dir, "correctness-model/reference/index.ts"),
    "export function solve(task) { return { answer: task.publicInput.input.toUpperCase() }; }",
  );
  put("agent/tools-spec.json", {
    presets: ["shell"],
    tools: [{ name: "write_answer", kind: "artifact-writer", description: "Write the answer." }],
  });
  writeFileSync(
    join(dir, "agent/BUILT_AGENTS.md"),
    "<!-- rule:uppercase --> Write the requested uppercase answer with write_answer, then submit.",
  );
  writeFileSync(
    join(dir, "agent/tools.ts"),
    `import { defineDraftTool } from "@ana/agent-bundle"; import { Type } from "typebox";
export function createDomainHarness() { return { tools: [defineDraftTool({ name: "write_answer", label: "Write answer", description: "Write the answer.", executionMode: "sequential", parameters: Type.Object({ answer: Type.String() }), run(params, draft) { draft.setArtifact(params); return { text: "written" }; } })] }; }`,
  );
}

/** Scripted in-process Built solver over the uppercase bundle: write the answer, then submit.
 *  `flubTaskIds` answer with the input unchanged, so pass and fail are deterministic. */
export function scriptedUppercaseSolver(flubTaskIds: ReadonlySet<string> = new Set()): Solver {
  let callSeq = 0;
  return async (task, toolset: Toolset) => {
    /* SAFETY: this solver runs only against the uppercase bundle, whose every task carries this public input. */
    const input = task.publicInput as { input: string };
    const byName = new Map(toolset.tools.map((tool) => [tool.name, tool]));
    const call = async (name: string, params: Record<string, JsonValue>) => {
      const tool = byName.get(name);
      if (!tool) throw new Error(`generated toolset is missing tool "${name}"`);
      await tool.execute(`u${++callSeq}`, double(params));
    };
    await call("write_answer", {
      answer: flubTaskIds.has(task.taskId) ? input.input : input.input.toUpperCase(),
    });
    await call("submit", {});
    return {
      turns: 1,
      completedTurns: 1,
      errors: [],
      runtimeIdentities: [
        {
          schema: "runtime-model-identity/v2",
          agentRuntime: {
            id: "pi-agent-core",
            version: "test",
            sessionId: `scripted-session-${task.taskId}`,
          },
          provider: {
            id: "openai-codex",
            model: "gpt-5.5",
            resultId: `scripted-result-${task.taskId}`,
            nativeSessionId: null,
          },
        },
      ],
    };
  };
}
