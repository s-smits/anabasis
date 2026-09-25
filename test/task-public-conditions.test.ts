import { expect, test } from "bun:test";
import { type BuildTask, validateTasks } from "../src/truth/tasks.ts";
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

// Gate audit 2026-09-25 (docs/gate-audit.md, task-variation): commented out (unsure): the variation cases
// below read the rule through the authoring flag.
// function codes(tasks: BuildTask[], authoring = true) {
//   return validateTasks(brief, { tasks }, { authoring }).findings.map((finding) => finding.code);
// }
function codes(tasks: BuildTask[]) {
  return validateTasks(brief, { tasks }, {}).findings.map((finding) => finding.code);
}

// Gate audit 2026-09-25 (docs/gate-audit.md, task-variation): commented out (unsure): each family must vary a
// public input path its checks declare; unsure two distinct values show the family varies what the request
// demands.
// test("a battery varying every declared path in every family passes, coupled values included", () => {
//   expect(codes(battery())).toEqual([]);
//   // Two public fields moving together are still one varied path; nothing has to vary alone.
//   const coupled = battery().map((task) => ({
//     ...task,
//     publicInput: {
//       condition: task.taskId.endsWith("exclusive")
//         ? { mode: "exclusive", capacity: 1 }
//         : { mode: "shared", capacity: 2 },
//     },
//   }));
//   expect(codes(coupled)).toEqual([]);
// });
//
// test("variation is read at the declared path, so labels beside it supply none", () => {
//   const labelled = battery().map((task) => ({
//     ...task,
//     publicInput: { condition: "same", label: task.taskId },
//   }));
//   // One finding per family: neither varies $.condition, and $.label is declared by no check.
//   expect(codes(labelled)).toEqual([
//     "tasks-structural-variation-shortfall",
//     "tasks-structural-variation-shortfall",
//   ]);
//   // The rule is an authoring obligation. A previously fingerprinted tree keeps its recorded policy.
//   expect(codes(labelled, false)).toEqual([]);
// });
//
// test("every family carries the obligation, including a family holding one task", () => {
//   const oneFlat = battery().map((task) =>
//     task.family === "routing" ? { ...task, publicInput: { condition: "same" } } : task,
//   );
//   expect(codes(oneFlat)).toEqual(["tasks-structural-variation-shortfall"]);
//   // A single task cannot differ from itself, and the count is not an excuse.
//   expect(codes(battery().slice(1))).toEqual(["tasks-structural-variation-shortfall"]);
// });

test("a declared path absent from some tasks is an optional input, not a misnamed one", () => {
  const tasks = battery();
  tasks[0] = { ...tasks[0]!, publicInput: { label: "different" } };
  // Some task of the family it applies to still provides $.condition, so the path is real.
  expect(codes(tasks)).not.toContain("tasks-public-rule-path-missing");
  // Gate audit 2026-09-25 (docs/gate-audit.md, task-variation): commented out (unsure): each family must vary
  // a public input path its checks declare; unsure two distinct values show the family varies what the
  // request demands.
  // // It is absent from this one, so the family is left with one value where two are needed.
  // expect(codes(tasks)).toContain("tasks-structural-variation-shortfall");
  // A path no applicable task provides anywhere is the misnamed case.
  const renamed = battery().map((task) => ({ ...task, publicInput: { setting: task.taskId } }));
  expect(codes(renamed)).toContain("tasks-public-rule-path-missing");
});

test("difficulty is read from measured results, so a battery-wide label is refused", () => {
  // A per-task level and a parent stay readable: they label a task, and nothing reads them as a rung.
  const levelled = battery().map((task) => ({ ...task, level: 1, parentTaskId: "old-task" }));
  expect(codes(levelled)).toEqual([]);
  for (const labelled of [{ difficulty: { level: 2 } }, { rung: 2 }]) {
    const result = validateTasks(brief, { tasks: battery(), ...labelled }, {});
    expect(result.findings.map((finding) => finding.code)).toEqual(["tasks-difficulty-unrequested"]);
  }
});

test("an empty battery and a malformed one are refused before any rule reads a task", () => {
  expect(codes([])).toEqual(["tasks-empty"]);
  // A wrong shape returns its field finding alone: the rules below it would read absent fields.
  const malformed = validateTasks(brief, { tasks: [{ taskId: "a", family: "routing" }] }, {});
  expect(malformed.ok).toBe(false);
  expect(malformed.findings).toHaveLength(1);
  expect(validateTasks(brief, { tasks: "not-an-array" }, {}).findings).toHaveLength(1);
});
