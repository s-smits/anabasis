/**
 * A task's history as the log holds it: the proposal that named it, the gates it was put to and the
 * states it was moved through, each as it was written and in the log's order.
 *
 * `task.ts` folds these three kinds of event into a version's state, and refuses a history that
 * could not have happened. Its readers ask more of them than a state: which tasks a session wrote,
 * the solve a task's gate 2 rests on, what each gate refused, which tasks a round moved. Until
 * 2026-10-08 each reader filtered the log for itself: the proposals in four files, the gates in
 * six, the moves in three. Here each kind is read once, and a reader asks for the list and keeps
 * its own question.
 *
 * Nothing here judges a history. An event the fold would refuse is handed over like any other; a
 * caller that needs the log to be sound asks the fold first (`taskSets`).
 */
import { asRecord, isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import type { LogEvent } from "./log.ts";
import type { Task } from "./verify.ts";

/** A `task.proposed` event. A pack's task is proposed by its id alone. A task an Examiner session
 *  wrote, or one carried from another checker's campaign, is logged whole, since no pack holds it. */
export interface Proposal {
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

/** A `task.gate` event. */
export interface Gate {
  readonly version: string;
  readonly gate: number;
  /** `passed` or `refused`, and at gate 2 `too-hard` for a stronger solve that did not pass. */
  readonly outcome: string;
  /** The event's own fields: the solve gate 2 rests on and how it ended, a refusal's reason and
   *  kinds, gate 4's control set and its digest. */
  readonly data: JsonObject;
}

/** A `task.state` event, with where it stands in the log. */
export interface Move {
  readonly index: number;
  readonly version: string;
  readonly state: string;
  /** The session that moved the task; null for a command's own move, such as a release. */
  readonly session: string | null;
  readonly data: JsonObject;
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

/** The tasks a log holds whole in a proposal: an Examiner's instances, which no pack holds, and
 *  every task an adoption carried into a later checker. Each is given once, as the last proposal
 *  of its id holds it: a carried task is proposed again under the id it had. */
export function writtenTasks(events: readonly LogEvent[]): Task[] {
  return [
    ...new Map(
      proposalsOf(events).flatMap(({ task }) => (task === null ? [] : [[task.taskId, task] as const])),
    ).values(),
  ];
}

/** Every gate a log put a task to, in the order they were logged. A task's last gate 2 is the
 *  stronger solve it stands on: a reach task is put to that gate again (`task.ts`). */
export function gatesOf(events: readonly LogEvent[]): Gate[] {
  return events.flatMap(({ kind, data }) =>
    kind === "task.gate" && isString(data.version) && isNumber(data.gate)
      ? [
          {
            version: data.version,
            gate: data.gate,
            outcome: isString(data.outcome) ? data.outcome : "",
            data,
          },
        ]
      : [],
  );
}

/** Each version's last gate `number` among `gates`. Gate 2 is the one a task may be put to more
 *  than once. */
export function lastGate(gates: readonly Gate[], number: number): Map<string, Gate> {
  return new Map(gates.flatMap((gate) => (gate.gate === number ? [[gate.version, gate] as const] : [])));
}

/** Every move of a task from one state to another, in the order they were logged. */
export function movesOf(events: readonly LogEvent[]): Move[] {
  return events.flatMap(({ kind, data }, index) =>
    kind === "task.state" && isString(data.version) && isString(data.state)
      ? [
          {
            index,
            version: data.version,
            state: data.state,
            session: isString(data.session) ? data.session : null,
            data,
          },
        ]
      : [],
  );
}
