import { asRecord, isString, type JsonValue } from "../meta/json-shape.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { type FileManifest, manifestOf } from "./answer-files.ts";
import { eventsOf, type LogEvent } from "./log.ts";
import type { Task } from "./verify.ts";

export const OPENING = "the opening exam";

interface Proposal {
  readonly version: string;
  readonly taskId: string | null;
  readonly family: string | null;
  readonly session: string | null;
  readonly task: Task | null;
}

export function contentOf({ family, publicInput, hidden }: Omit<Task, "taskId">): string {
  return hashJsonValue({ family, publicInput, hidden: hidden ?? null });
}

export function proposalsOf(events: readonly LogEvent[]): Proposal[] {
  return eventsOf(events, "task.proposed").flatMap(({ event: { data } }) => {
    if (!isString(data.version)) return [];
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

export const writersOf = (events: readonly LogEvent[]) =>
  new Map(proposalsOf(events).map(({ version, session }) => [version, session ?? OPENING]));

export const familiesOf = (events: readonly LogEvent[]) =>
  new Map(proposalsOf(events).map(({ version, family }) => [version, family]));

export function familySizes(events: readonly LogEvent[], tasks: readonly string[]) {
  const named = familiesOf(events);
  const kin = Map.groupBy(tasks, (task) => named.get(task) ?? null);
  const sizes = [...kin].flatMap(([family, some]) => (family === null ? [] : [some.length]));
  return { sizes: sizes.toSorted((one, other) => other - one), unnamed: kin.get(null)?.length ?? 0 };
}

export function acceptedAnswers(
  events: readonly LogEvent[],
  version: string | undefined,
): { readonly answer: JsonValue; readonly files: FileManifest[] }[] {
  if (version === undefined) return [];
  const taskId = proposalsOf(events).findLast((proposal) => proposal.version === version)?.taskId ?? null;
  const wrong = wrongPassesIn(events);
  return eventsOf(events, ["task.feasible", "verdict"]).flatMap(({ event: { kind, data } }) =>
    data.answer !== undefined &&
    ((kind === "task.feasible" && data.version === version) ||
      (kind === "verdict" &&
        taskId !== null &&
        data.task === taskId &&
        data.kind === "pass" &&
        !(isString(data.solve) && wrong.has(data.solve))))
      ? [{ answer: data.answer, files: manifestOf(data.files) }]
      : [],
  );
}

export function wrongPasses(passes: Readonly<Record<string, JsonValue>>): Set<string> {
  return new Set(Object.keys(passes).filter((solve) => passes[solve] === "wrong"));
}

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

export function wrongPassesIn(events: readonly LogEvent[]): Set<string> {
  return new Set(
    eventsOf(events, "comparison.reported").flatMap(({ event: { data } }) => [
      ...wrongPasses(asRecord(asRecord(data.settled)?.passes) ?? {}),
    ]),
  );
}

export function writtenTasks(events: readonly LogEvent[]): Task[] {
  return [
    ...new Map(
      proposalsOf(events).flatMap(({ task }) => (task === null ? [] : [[task.taskId, task] as const])),
    ).values(),
  ];
}
