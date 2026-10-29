// A person's wrong label must remove a passing answer from the exam side's valid examples.
// The audit of 29 October 2026 found that acceptedAnswers read only the checker's verdict.
import { expect, it } from "bun:test";
import { acceptedAnswers } from "../src/kernel/history.ts";
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
  const accepted = [{ author: true }, { solver: true }];
  expect(acceptedAnswers(log, "v1")).toEqual(accepted);
  for (const label of ["wrong", "sound"]) {
    const settled = [
      ...log,
      event("comparison.reported", { session: "g1", settled: { passes: { s1: label } } }),
    ];
    expect(acceptedAnswers(settled, "v1")).toEqual(label === "wrong" ? [{ author: true }] : accepted);
  }
  expect(acceptedAnswers(log, undefined)).toEqual([]);
});
