/**
 * Every task a campaign's comparisons scored, with its public input and nothing of how it was
 * answered, so the blind grading lane grades reach before it reads an outcome. It prints no hidden
 * value, check or answer, though the file stays on the exam side with the log it reads.
 *
 *   bun tools/wri/tasks.ts <log.jsonl | campaign folder | name> [--shape | --rows]
 *   bun tools/wri/tasks.ts <log.jsonl | campaign folder | name> --task <id | version prefix>
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { campaignName } from "#skills/main/logs.ts";
import { starterIn } from "#src/campaign/climb.ts";
import { draftOf } from "#src/examiner/draft.ts";
import { proposalsOf } from "#src/kernel/history.ts";
import { type LogEvent, read } from "#src/kernel/log.ts";
import { taskSets } from "#src/kernel/task.ts";
import { asRecord, isNumber, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { exampleId } from "#tools/campaign/exam.ts";
import { logAcross } from "#tools/runs/snapshots.ts";

interface Place {
  readonly kinds: Set<string>;
  lengths: number[];
}

const USAGE = `usage:
  bun tools/wri/tasks.ts <log.jsonl | campaign folder | name> [--shape | --rows]
  bun tools/wri/tasks.ts <log.jsonl | campaign folder | name> --task <id | version prefix>`;
const OPTIONS = { log: "text", task: "text", shape: "flag", rows: "flag" } as const;
/** A public text shown whole up to this many characters: a requirement fits, a long table does not. */
export const VALUE_BYTES = 1500;

export function proposedTasks(events: readonly LogEvent[]) {
  const drafted = new Map(
    (draftOf(events)?.tasks ?? []).map((example, index) => [exampleId(index), example]),
  );
  return proposalsOf(events).map(({ version, taskId, family, session, task }) => ({
    version,
    taskId,
    family,
    session,
    input: task ?? drafted.get(taskId ?? ""),
  }));
}

export function scoredTasks(events: readonly LogEvent[]) {
  const scoredIn = new Map<string, string[]>();
  for (const { kind, data } of events) {
    if (kind !== "comparison.started" || !isString(data.session) || !Array.isArray(data.tasks)) continue;
    for (const version of data.tasks.filter(isString)) {
      scoredIn.set(version, [...(scoredIn.get(version) ?? []), data.session]);
    }
  }
  return proposedTasks(events).flatMap((task) => {
    const sessions = scoredIn.get(task.version);
    return sessions === undefined ? [] : [{ ...task, sessions }];
  });
}

const taskLines = (
  { version, taskId, family, session, input }: ReturnType<typeof proposedTasks>[number],
  where: string,
) => [
  `${version.slice(0, 8)}  ${taskId ?? "no id"}  written by ${session ?? (input === undefined ? "the pack" : "the draft")}  ${where}`,
  `  family: ${family ?? "none"}`,
  `  public: ${input === undefined ? "none in the log (a pack's task: its public input is in the pack)" : JSON.stringify(input.publicInput)}`,
];

function placesOf(value: JsonValue | undefined, path: string, into: Map<string, Place>): void {
  const place = into.get(path) ?? { kinds: new Set<string>(), lengths: [] };
  into.set(path, place);
  if (Array.isArray(value)) {
    place.kinds.add("list");
    place.lengths.push(value.length);
    for (const item of value) placesOf(item, `${path}[]`, into);
    return;
  }
  const record = asRecord(value);
  if (record !== null) {
    place.kinds.add("object");
    for (const [key, each] of Object.entries(record)) {
      placesOf(each, path === "" ? key : `${path}.${key}`, into);
    }
    return;
  }
  if (isString(value)) {
    place.kinds.add("text");
    place.lengths.push(value.length);
  } else {
    place.kinds.add(value === null || value === undefined ? "null" : isNumber(value) ? "number" : "boolean");
  }
}

const span = (lengths: readonly number[]) => {
  const low = Math.min(...lengths);
  const high = Math.max(...lengths);
  return low === high ? String(high) : `${String(low)}-${String(high)}`;
};

/** One task's public input as its key paths, each with its kind, a list's length and a text's
 *  longest, and no value. */
export function inputPaths(publicInput: JsonValue | undefined): string {
  const places = new Map<string, Place>();
  placesOf(publicInput, "", places);
  return [...places]
    .filter(([, { kinds }]) => !(kinds.size === 1 && kinds.has("object")))
    .map(([path, { kinds, lengths }]) => {
      const kind = [...kinds].toSorted().join("|");
      const sized = kinds.has("list")
        ? `list(${span(lengths)})`
        : kinds.has("text")
          ? `text(${span(lengths)})`
          : kind;
      return `${path === "" ? "(whole)" : path} ${kinds.size > 1 && !kinds.has("list") && !kinds.has("text") ? kind : sized}`;
    })
    .join("; ");
}

function wholeOf(value: JsonValue | undefined): string {
  return JSON.stringify(
    value ?? null,
    (_key, each: unknown) =>
      isString(each) && each.length > VALUE_BYTES
        ? `${each.slice(0, VALUE_BYTES)} [cut after ${String(VALUE_BYTES)} of ${String(each.length)} characters]`
        : each,
    2,
  );
}

function listed(events: readonly LogEvent[]) {
  const scored = scoredTasks(events);
  const released = new Set(taskSets(events).released);
  for (const { version } of scored) released.delete(version);
  return [
    ...scored.map((task) => ({ task, where: `scored in ${task.sessions.join(", ")}` })),
    ...proposedTasks(events)
      .filter(({ version }) => released.has(version))
      .map((task) => ({ task, where: "practised, never scored" })),
  ];
}

/** The skeleton of the grade rows, as `gradesIn` and `wri.ts trajectory --grades` read them: a row
 *  a scored task and a row a version a comparison measured. */
function gradeRows(events: readonly LogEvent[], campaign: string): string[] {
  const starter = starterIn(events);
  const versions = [
    ...new Set(events.flatMap(({ kind, data }) => (kind === "comparison.started" ? [data.fresh] : []))),
  ].filter((digest): digest is string => isString(digest) && digest !== starter);
  return [
    ...scoredTasks(events).map(({ taskId, version }) => `task\t${campaign}\t${taskId ?? version}\t`),
    ...versions.map((digest) => `version\t${campaign}\t${digest}\t`),
  ];
}

export function tasksLines(events: readonly LogEvent[], form: "shape" | "blocks" = "blocks"): string[] {
  const tasks = listed(events);
  const lines =
    form === "shape"
      ? tasks.map(
          ({ task, where }) =>
            `${task.version.slice(0, 8)}  ${task.taskId ?? "no id"}  ${where}  ${task.input === undefined ? "none in the log" : inputPaths(task.input.publicInput)}`,
        )
      : tasks.flatMap(({ task, where }) => taskLines(task, where));
  return lines.length === 0 ? ["no comparison has scored a task"] : lines;
}

async function main(args: CommandArgs): Promise<number> {
  const [named = ""] = args.positionals;
  const log = await logAcross(args.value("log") ?? named);
  const events = read(log);
  const asked = args.value("task");
  if (args.flag("rows")) {
    console.log(gradeRows(events, campaignName(log)).join("\n"));
    return 0;
  }
  if (asked !== null) {
    const found = listed(events).find(({ task }) => task.taskId === asked || task.version.startsWith(asked));
    if (found === undefined) return args.die(`${asked} is no task this log scored or released`);
    const { task, where } = found;
    console.log(
      [...taskLines(task, where).slice(0, 2), `  public:`, wholeOf(task.input?.publicInput)].join("\n"),
    );
    return 0;
  }
  console.log(tasksLines(events, args.flag("shape") ? "shape" : "blocks").join("\n"));
  return 0;
}

if (import.meta.main) {
  await runCommand({ name: "tasks", usage: USAGE, options: OPTIONS, positionals: [0, 1] }, main);
}
