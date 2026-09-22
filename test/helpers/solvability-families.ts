/**
 * Two sibling tasks whose marked deliverable the family census exchanges, plus a lone family.
 *
 * `ta` and `tb` share family "one"; `tc` is a family of its own. Each task carries a report as well
 * as an answer, so the artifact has no root the truth relation ignores and a transplant that only
 * the report distinguishes still has something to fail on.
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

// ---------------------------------------------------------------------------------------------
// Family fixtures: two siblings whose marked deliverable the census exchanges, plus a lone family.

interface FamilySpec {
  /** The two family-one answers. Repeating one recreates W20: distinct tasks, one deliverable. */
  answers: [string, string];
  /** Mark the answer root task-conditioned. Unmarked, the census does not run at all. */
  material?: boolean;
  nonResultOnMismatch?: boolean;
  /** Drop tb's required hidden operand, which must refuse rather than change applicability. */
  dropSiblingHidden?: boolean;
}

const REPORT_ROOT = { name: "report", "shape": "string" };

/** The evaluator owns domain meaning; the controller-side scope counts its invocations. */
function countingVerifier(nonResultOnMismatch: boolean): string {
  return `
export function solve(task) {
  return { answer: task.publicInput.expected, report: task.publicInput.report };
}
// CHECKS
export const checks = {
  answer: (request) => {
    const expected = request.hidden[0]?.expectation;
    const wrong = request.artifact?.answer !== expected;
    if (wrong && ${String(nonResultOnMismatch)}) throw new Error("check did not settle");
    return !wrong;
  },
  "report-present": (request) => request.artifact?.report === request.hidden[0]?.expectation,
};
`;
}

const REPORT_CHECK = check({ id: "report-present", roots: ["$.report"] });
const MARKED_ANSWER = { name: "answer", "shape": "string", taskConditioned: true as const };
/** ta and tb share family "one"; tc is a family of its own. Each carries a report as well, so the
 *  artifact has no root the truth relation ignores. */
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
    verifier: countingVerifier(spec.nonResultOnMismatch === true),
    schema: [spec.material === false ? { name: "answer", "shape": "string" } : MARKED_ANSWER, REPORT_ROOT],
    extraChecks: [REPORT_CHECK],
    tasks,
    accepts: familyAccepts(tasks),
    writerRoots: ["answer", "report"],
  });
}

/** The report program attempts to read an undeclared answer. The process must withhold it before
 *  that program can credit or reject a family transplant using another check's inputs. */
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
    schema: [MARKED_ANSWER, REPORT_ROOT],
    tool: "answer-tool",
    extraChecks: [
      check({ id: "report-present", roots: ["$.report"], inputs: ["$.expected"], tool: "report-tool" }),
    ],
    tasks,
    accepts: familyAccepts(tasks),
    writerRoots: ["answer", "report"],
  });
}

/** answer-tool accepts every artifact; report-tool rejects the transplant, but the evaluator
 *  attributes that rejection to its own unrelated check id — the shape a census that trusts any
 *  settled rejection would credit. */
export const misattributingToolInventory = (): ToolInventory => ({
  "answer-tool": installedTool("answer-tool", ACCEPTING_TOOL),
  "report-tool": installedTool("report-tool", COMPARING_TOOL),
});
