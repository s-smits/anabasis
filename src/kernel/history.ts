/**
 * A log's proposals: each task as the event that named it holds it, in the log's order.
 *
 * `task.ts` folds a task's proposal, its gates and its moves into a version's state, and refuses a
 * history that could not have happened. Its readers ask one thing more of a proposal than a state:
 * which tasks the log holds whole, since no pack holds an Examiner's or a carried one. Until
 * 2026-10-08 each reader filtered the log for that itself, in four files. Here it is read once.
 *
 * Nothing here judges a history. An event the fold would refuse is handed over like any other; a
 * caller that needs the log to be sound asks the fold first (`taskSets`).
 */
import { asRecord, isString } from "../meta/json-shape.ts";
import type { LogEvent } from "./log.ts";
import type { Task } from "./verify.ts";

/** A `task.proposed` event. A pack's task is proposed by its id alone. A task an Examiner session
 *  wrote, or one carried from another checker's campaign, is logged whole, since no pack holds it. */
interface Proposal {
  readonly version: string;
  readonly taskId: string | null;
  /** The Examiner session that wrote it; null for a pack's task and for a carried one. */
  readonly session: string | null;
  /** The stronger solve a carried task was accepted on in the campaign it came from
   *  (`tools/c/carry.ts`); null for any other. */
  readonly carried: string | null;
  /** The task whole, where the proposal holds it. */
  readonly task: Task | null;
}

/** Every proposal of a log, in the order the tasks were proposed. */
export function proposalsOf(events: readonly LogEvent[]): Proposal[] {
  return events.flatMap(({ kind, data }) => {
    if (kind !== "task.proposed" || !isString(data.version)) return [];
    const task = asRecord(data.task);
    return [
      {
        version: data.version,
        taskId: isString(data.taskId) ? data.taskId : null,
        session: isString(data.session) ? data.session : null,
        carried: isString(data.carried) ? data.carried : null,
        task:
          task !== null && isString(task.taskId) && isString(task.family)
            ? {
                taskId: task.taskId,
                family: task.family,
                publicInput: task.publicInput ?? null,
                hidden: task.hidden ?? null,
              }
            : null,
      },
    ];
  });
}

/** The tasks a log holds whole in a proposal: an Examiner's instances and the ones carried from
 *  another campaign, which no pack holds. Each is given once, as the last proposal of its id holds
 *  it. */
export function writtenTasks(events: readonly LogEvent[]): Task[] {
  return [
    ...new Map(
      proposalsOf(events).flatMap(({ task }) => (task === null ? [] : [[task.taskId, task] as const])),
    ).values(),
  ];
}
