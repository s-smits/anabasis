/**
 * What an Examiner is told of the tasks its campaign holds: one outcome each.
 *
 * An Examiner session starts with no memory, and since 2026-10-09 it is put to no solver either: a
 * task is held out on the shape of its package (`src/kernel/task.ts`), so nothing a session does
 * tells its author whether a task was any good. What tells it is the comparisons. The plan has the
 * author see every task of the campaign, the pack's and the ones earlier sessions wrote, the older
 * and easier ones included, each with its outcome so far: one harness won, a tie between valid
 * answers, no valid answer yet, or disputed (`docs/plan.md`, Phase 2). That is every word here
 * beside the ones about a task's own standing in the campaign. It is a view of the log, and no
 * store is kept for it. Until that day a session was shown the pack's tasks by id and family alone,
 * and no outcome.
 *
 * What v1 measured about this channel is kept. An author told a zone, a share or a target count
 * wrote towards it, and one told each answer's distance from its limit moved limits (v1
 * `AGENTS.md`, "Tried and taken out"); the plan lists the difficulty band among what it will not
 * tell. So a line names no harness, no count of solves, no check and no budget.
 */
import { proposalsOf } from "../kernel/history.ts";
import type { LogEvent } from "../kernel/log.ts";
import { type Outcome, outcomesOf } from "../kernel/reports.ts";
import { taskStates } from "../kernel/task.ts";
import type { Task } from "../kernel/verify.ts";

/** How each outcome is said. */
const SAID: Readonly<Record<Outcome, string>> = {
  won: "one harness won",
  tie: "a tie between valid answers",
  "no-valid-answer": "no valid answer yet",
  disputed: "disputed: a rejection of an answer to it is not settled",
  exhausted: "answered validly by both harnesses in every solve of two comparisons: no longer scored",
};
/** What a state that is not held out says of a task. */
const SETTLED = new Map([
  ["released", "in use as practice, and so never scored"],
  ["disputed", "disputed: a check was at fault on an answer to it"],
]);

/** One line a task among `tasks`, in their order: the task by id and family, and its outcome. A
 *  task the log refused is left out, since it is no task of the exam. One the log does not hold,
 *  and one no comparison has scored, is not yet compared. */
export function heard(
  events: readonly LogEvent[],
  tasks: readonly Pick<Task, "taskId" | "family">[],
): string[] {
  const states = taskStates(events);
  const outcomes = outcomesOf(events);
  const versions = new Map(
    proposalsOf(events).flatMap(({ version, taskId, task }) => {
      const id = task?.taskId ?? taskId;
      return id === null ? [] : [[id, version] as const];
    }),
  );
  return tasks.flatMap(({ taskId, family }) => {
    const version = versions.get(taskId) ?? "";
    const state = states.get(version) ?? "";
    if (state === "refused") return [];
    const outcome = outcomes.get(version);
    const said = SETTLED.get(state) ?? (outcome === undefined ? "not yet compared" : SAID[outcome]);
    return [`${taskId} (family ${family}): ${said}`];
  });
}
