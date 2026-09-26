import { expect, test } from "bun:test";
import { type BuildTask, validateTasks } from "../src/correctness-bundle/tasks.ts";
import { MATCHING_BRIEF } from "./helpers/matching-fixture.ts";

const brief = {
  ...MATCHING_BRIEF,
  joins: [],
  truthChecks: [
    {
      id: "condition",
      assertion: "the selected result satisfies the public conditions",
      execution: {
        families: "all" as const,
        artifactPaths: ["$.answer"],
        publicInputPaths: ["$.condition"],
        hidden: "none" as const,
        evidence: { kind: "authored" as const },
      },
    },
  ],
};

/** Two families of two, each varying the one path the single check declares. */
function battery(): BuildTask[] {
  return ["routing", "allocation"].flatMap((family) =>
    ["shared", "exclusive"].map((mode) => ({
      taskId: `${family}-${mode}`,
      family,
      publicInput: { condition: { mode, capacity: 2 } },
      hidden: [],
    })),
  );
}

function codes(tasks: BuildTask[]) {
  return validateTasks(brief, { tasks }, {}).findings.map((finding) => finding.code);
}

test("a declared path absent from some tasks is an optional input, not a misnamed one", () => {
  const tasks = battery();
  tasks[0] = { ...tasks[0]!, publicInput: { label: "different" } };
  // Some task of the family it applies to still provides $.condition, so the path is real.
  expect(codes(tasks)).not.toContain("tasks-public-rule-path-missing");
  const renamed = battery().map((task) => ({ ...task, publicInput: { setting: task.taskId } }));
  expect(codes(renamed)).toContain("tasks-public-rule-path-missing");
});

test("an empty battery and a malformed one are refused before any rule reads a task", () => {
  expect(codes([])).toEqual(["tasks-empty"]);
  // A wrong shape returns its field finding alone: the rules below it would read absent fields.
  const malformed = validateTasks(brief, { tasks: [{ taskId: "a", family: "routing" }] }, {});
  expect(malformed.ok).toBe(false);
  expect(malformed.findings).toHaveLength(1);
  expect(validateTasks(brief, { tasks: "not-an-array" }, {}).findings).toHaveLength(1);
});
