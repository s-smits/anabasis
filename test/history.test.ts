// A person's wrong label must remove a passing answer from the exam side's valid examples.
// acceptedAnswers would otherwise read only the checker's verdict.
import { expect, it } from "bun:test";
import { acceptedAnswers, writtenTasks } from "../src/kernel/history.ts";
import { type TaskPackage, taskVersion } from "../src/kernel/task.ts";
import type { Task } from "../src/kernel/verify.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";

const event = (kind: EventKind, data: JsonObject): LogEvent => ({
  at: "2026-10-29T00:00:00.000Z",
  kind,
  data,
});

it("removes a pass labelled wrong from accepted answers and keeps a sound pass", () => {
  const log = [
    event("task.proposed", { version: "v1", taskId: "t1" }),
    event("task.feasible", { version: "v1", answer: { author: true } }),
    event("verdict", { solve: "s1", task: "t1", kind: "pass", answer: { solver: true } }),
    event("verdict", { solve: "s2", task: "t2", kind: "pass", answer: { other: true } }),
    event("comparison.reported", { session: "g1", settled: "unsettled" }),
  ];
  const accepted = [
    { answer: { author: true }, files: [] },
    { answer: { solver: true }, files: [] },
  ];
  expect(acceptedAnswers(log, "v1")).toEqual(accepted);
  for (const label of ["wrong", "sound"]) {
    const settled = [
      ...log,
      event("comparison.reported", { session: "g1", settled: { passes: { s1: label } } }),
    ];
    expect(acceptedAnswers(settled, "v1")).toEqual(label === "wrong" ? accepted.slice(0, 1) : accepted);
  }
  expect(acceptedAnswers(log, undefined)).toEqual([]);
});

it("carries the files an author's valid answer delivered, so the Referee reads it whole", () => {
  const files = [{ path: "report.md", bytes: 3, sha256: "a".repeat(64) }];
  const log = [
    event("task.proposed", { version: "v1", taskId: "t1" }),
    event("task.feasible", { version: "v1", answer: { author: true }, files }),
  ];
  expect(acceptedAnswers(log, "v1")).toEqual([{ answer: { author: true }, files }]);
});

it("packages a task written with a per-task rubric under the version its proposal logged", () => {
  const pack = (task: Task): TaskPackage => ({ ...task, ruleIds: [], checks: "/no-checks" });
  const written = { taskId: "t1", family: "f", publicInput: { q: 1 }, hidden: { a: 2 } };
  for (const task of [written, { ...written, rubric: [{ id: "cites", criterion: "cites the figures" }] }]) {
    const version = taskVersion(pack(task));
    const log = [event("task.proposed", { version, taskId: "t1", task })];
    expect(writtenTasks(log).map((one) => taskVersion(pack(one)))).toEqual([version]);
  }
});
