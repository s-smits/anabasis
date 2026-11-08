/**
 * A log's proposals and accepted answers, in the log's order.
 *
 * `task.ts` folds a task's proposal, its task admissions and its moves into a version's state, and refuses a
 * history that could not have happened. Its readers ask one thing more of a proposal than a state:
 * which tasks the log holds whole, since no pack holds an Examiner's. Here it is
 * read once, for every reader.
 * The review of 20 October found an author's answer absent from Referee packets. Its answer and
 * passing solves have one reader here, by proposed version; the known valid answer remains `poolOf`'s fact.
 * The audit of 29 October 2026 found settled wrong passes still offered as valid answers. Their
 * labels are read here for answer history, reported pairs and settlement alike (rule 12).
 *
 * Nothing here judges a history. An event the fold would refuse is handed over like any other; a
 * caller that needs the log to be sound asks the fold first (`taskSets`).
 */
import { asRecord, isString, type JsonValue } from "../meta/json-shape.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import type { LogEvent } from "./log.ts";
import type { Task } from "./verify.ts";

/** A `task.proposed` event. A pack's task is proposed by its id and its family. A task an Examiner
 *  session wrote is logged whole, since no pack holds it. */
interface Proposal {
  readonly version: string;
  readonly taskId: string | null;
  /** The task's family, which a comparison tallies by (`compared`, `comparison.ts`); null where the
   *  proposal names none, as a pack's did until 12 October. */
  readonly family: string | null;
  /** The Examiner session that wrote it; null for a pack's task. */
  readonly session: string | null;
  /** The task whole, where the proposal holds it. A proposal written between 4 and 5 November also
   *  holds its author's `claim` beside the task, which nothing reads any more (`write.ts`). */
  readonly task: Task | null;
}

/** An instance by what a solver and the checks read of it, whatever id it carries: what a writing
 *  session takes no second time and names a checked instance by (`write.ts`). */
export function contentOf({ family, publicInput, hidden }: Omit<Task, "taskId">): string {
  return hashJsonValue({ family, publicInput, hidden: hidden ?? null });
}

/** Every proposal of a log, in the order the tasks were proposed. */
export function proposalsOf(events: readonly LogEvent[]): Proposal[] {
  return events.flatMap(({ kind, data }) => {
    if (kind !== "task.proposed" || !isString(data.version)) return [];
    const task = asRecord(data.task);
    const family = task?.family ?? data.family;
    return [
      {
        version: data.version,
        taskId: isString(data.taskId) ? data.taskId : null,
        family: isString(family) ? family : null,
        session: isString(data.session) ? data.session : null,
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

/** Accepted answers for one proposed version. They remain on the exam side. */
export function acceptedAnswers(events: readonly LogEvent[], version: string | undefined): JsonValue[] {
  if (version === undefined) return [];
  const taskId = proposalsOf(events).findLast((proposal) => proposal.version === version)?.taskId ?? null;
  const wrong = wrongPassesIn(events);
  return events.flatMap(({ kind, data }) =>
    data.answer !== undefined &&
    ((kind === "task.feasible" && data.version === version) ||
      (kind === "verdict" &&
        taskId !== null &&
        data.task === taskId &&
        data.kind === "pass" &&
        !(isString(data.solve) && wrong.has(data.solve))))
      ? [data.answer]
      : [],
  );
}

/** The solves a person labelled wrong among the passes drawn for review. */
export function wrongPasses(passes: Readonly<Record<string, JsonValue>>): Set<string> {
  return new Set(Object.keys(passes).filter((solve) => passes[solve] === "wrong"));
}

/** `events` with each solve in `wrong` read as a rejection: its ending a fail and its verdict no
 *  pass. The log is unchanged; settlement, reported pairs and answer history read this one view. */
export function failWrongPasses(
  events: readonly LogEvent[],
  wrong: ReadonlySet<string>,
): readonly LogEvent[] {
  if (wrong.size === 0) return events;
  const ending = { outcome: "fail", kind: "rejected", reason: "a person labelled the pass wrong" };
  return events.map((event) => {
    if (!isString(event.data.solve) || !wrong.has(event.data.solve)) return event;
    if (event.kind === "solve.finished") return { ...event, data: { ...event.data, ending } };
    return event.kind === "verdict" ? { ...event, data: { ...event.data, kind: "fail" } } : event;
  });
}

/** Settled wrong passes across the log. A comparison can be settled only once (`settleReading`). */
export function wrongPassesIn(events: readonly LogEvent[]): Set<string> {
  return new Set(
    events.flatMap(({ kind, data }) =>
      kind === "comparison.reported" ? [...wrongPasses(asRecord(asRecord(data.settled)?.passes) ?? {})] : [],
    ),
  );
}

/** The tasks a log holds whole in a proposal: an Examiner's instances, which no pack holds. Each is
 *  given once, as the last proposal of its id holds it. */
export function writtenTasks(events: readonly LogEvent[]): Task[] {
  return [
    ...new Map(
      proposalsOf(events).flatMap(({ task }) => (task === null ? [] : [[task.taskId, task] as const])),
    ).values(),
  ];
}
