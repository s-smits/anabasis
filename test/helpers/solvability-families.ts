/**
 * A three-task fixture across two families: `ta` and `tb` share family "one" with different
 * answers, and `tc` is family "two". Each task carries a report beside its answer, so the artifact
 * has no root the truth relation ignores. Dropping tb's required hidden operand must refuse rather
 * than quietly make the check inapplicable.
 */
import type { ToolInventory } from "../../src/verify/verifier-port.ts";
import {
  ACCEPTING_TOOL,
  COMPARING_TOOL,
  type Fixture,
  type FixtureTask,
  check,
  installedTool,
  specimen,
} from "./solvability-specimen.ts";

interface FamilySpec {
  /** The two family-one answers. */
  answers: [string, string];
  /** Drop tb's required hidden operand, which must refuse rather than change applicability. */
  dropSiblingHidden?: boolean;
}

const ANSWER_ROOT = { name: "answer", "shape": "string" };
const REPORT_ROOT = { name: "report", "shape": "string" };

/** The evaluator owns domain meaning; the controller-side scope counts its invocations. */
function countingVerifier(): string {
  return `
export function solve(task) {
  return { answer: task.publicInput.expected, report: task.publicInput.report };
}
// CHECKS
export const checks = {
  answer: (request) => {
    const expected = request.hidden[0]?.expectation;
    return request.artifact?.answer === expected;
  },
  "report-present": (request) => request.artifact?.report === request.hidden[0]?.expectation,
};
`;
}

const REPORT_CHECK = check({ id: "report-present", roots: ["$.report"] });
function familyTasks(
  answers: readonly string[],
  hidden: (taskId: string, expected: string) => FixtureTask["hidden"],
): FixtureTask[] {
  return ["ta", "tb", "tc"].map((taskId, index) => {
    const expected = answers[index] ?? "C";
    const publicInput = { expected, report: `report for ${taskId}` };
    return { taskId, family: index === 2 ? "two" : "one", publicInput, hidden: hidden(taskId, expected) };
  });
}

const familyAccepts = (tasks: readonly FixtureTask[]) =>
  tasks.map((task, index) => {
    const { expected = null, report = null } = task.publicInput;
    return { id: `accept-${String(index)}`, taskId: task.taskId, artifact: { answer: expected, report } };
  });

export function familyFixture(spec: FamilySpec): Fixture {
  const answerRow = (expected: string) => [{ checkId: "answer", expectation: expected }];
  const tasks = familyTasks([...spec.answers, "C"], (taskId, expected) => [
    ...(spec.dropSiblingHidden === true && taskId === "tb" ? [] : answerRow(expected)),
    { checkId: "report-present", expectation: `report for ${taskId}` },
  ]);
  return specimen({
    verifier: countingVerifier(),
    schema: [ANSWER_ROOT, REPORT_ROOT],
    extraChecks: [REPORT_CHECK],
    tasks,
    accepts: familyAccepts(tasks),
    writerRoots: ["answer", "report"],
  });
}

/** The report program attempts to read an undeclared answer. The process must withhold it before
 *  that program can credit or reject an artifact using another check's inputs. */
export function externalFamilyFixture(): Fixture {
  const tasks = familyTasks(["A", "B", "C"], () => []);
  return specimen({
    verifier: `
export function solve(task) {
  return { answer: task.publicInput.expected, report: task.publicInput.report };
}
// CHECKS
export const checks = {
  answer: async (request, runtime) => (await runtime.tools.run({
    toolId: "answer-tool", files: { "answer.txt": request.artifact.answer }, args: ["answer.txt"],
  })).exitCode === 0,
  "report-present": async (request, runtime) => {
    if (request.artifact.answer === undefined) throw new Error("unrelated answer operand withheld");
    return (await runtime.tools.run({ toolId: "report-tool", files: {
      "answer.txt": request.artifact.answer, "expected.txt": request.publicTask.publicInput.expected,
    }, args: ["answer.txt", "expected.txt"] })).exitCode === 0;
  },
};
`,
    schema: [ANSWER_ROOT, REPORT_ROOT],
    tool: "answer-tool",
    extraChecks: [
      check({ id: "report-present", roots: ["$.report"], inputs: ["$.expected"], tool: "report-tool" }),
    ],
    tasks,
    accepts: familyAccepts(tasks),
    writerRoots: ["answer", "report"],
  });
}

/** answer-tool accepts every artifact; report-tool compares, but the evaluator would attribute its
 *  rejection to an unrelated check id if the answer operand reached it. */
export const misattributingToolInventory = (): ToolInventory => ({
  "answer-tool": installedTool("answer-tool", ACCEPTING_TOOL),
  "report-tool": installedTool("report-tool", COMPARING_TOOL),
});
