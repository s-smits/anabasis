/**
 * Every task a campaign's comparisons scored, with its public input and nothing of how it was
 * answered, so lane 27 grades reach before it reads an outcome. On 30 October the first lane-34
 * session spent fifteen calls finding the tasks' text in the log and joining it to the scored sets
 * by hand. It prints no hidden value, no check and no answer, though the file stays on the exam
 * side with the log it reads.
 *
 *   bun tools/wri/tasks.ts <log.jsonl | campaign folder | name> [--shape | --rows]
 *   bun tools/wri/tasks.ts <log.jsonl | campaign folder | name> --task <id | version prefix>
 *
 * `--shape` prints one line a task: its key paths, a list's items folded into one `[]` path, each with
 * its kind, a list's length and a text's longest, and no value. `--task` prints one task's public
 * input indented, every text whole up to `VALUE_BYTES`. `--rows` prints the skeleton of lane 27's
 * grade rows (`gradesIn`, `tools/wri/trajectory.ts`) under the campaign's folder name, grades blank.
 * Between 3 and 10 November 13 of 17 lane 27 sessions and 11 of 14 lane 17 sessions parsed the
 * one-line `public:` JSON below by hand, 31 times in lane 17 alone, and lane 27 sessions assembled
 * the grade rows with full digests by hand. None of the three prints an outcome, a tally or a reading.
 *
 * The tasks come from `proposalsOf` (`src/kernel/history.ts`) and the scored sets from each
 * `comparison.started`, whose `tasks` hold its retained ones too (`scoredSet`, `src/campaign/round.ts`). A task of the
 * drafted exam is proposed by its id alone, so its input is read from the draft by that id
 * (`exampleId`, `tools/d2/exam.ts`): on 1 November the grading packets of two fresh campaigns
 * went out with 2 of each campaign's 8 scored tasks bare. A stored pack's task carries no public
 * input in the log, and says so.
 *
 * A task released and never scored follows, marked, since what a harness practised on is part of what
 * it was built against: on 6 November v5 held 11 such tasks that no reader listed. Lane 27's packets
 * read `scoredTasks` alone, as a blind grader's set stays the tasks that were scored.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { draftOf } from "#src/examiner/draft.ts";
import { proposalsOf } from "#src/kernel/history.ts";
import { type LogEvent, read } from "#src/kernel/log.ts";
import { taskSets } from "#src/kernel/task.ts";
import { asRecord, isNumber, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { basename, dirname } from "#src/meta/path.ts";
import { exampleId } from "#tools/d2/exam.ts";
import { logAcross } from "#tools/runs/snapshots.ts";

/** What one place in a public input holds across every value found there: its kinds, a list's
 *  lengths and a string's longest. */
interface Place {
  readonly kinds: Set<string>;
  lengths: number[];
}

const USAGE = `usage:
  bun tools/wri/tasks.ts <log.jsonl | campaign folder | name> [--shape | --rows]
  bun tools/wri/tasks.ts <log.jsonl | campaign folder | name> --task <id | version prefix>`;
const OPTIONS = { log: "text", task: "text", shape: "flag", rows: "flag" } as const;
/** A public text shown whole up to this many characters: every requirement of the sixteen buffer
 *  logs of 6 November fits, a long table does not. The lane 27 packets cut at the same place. */
export const VALUE_BYTES = 1500;

/** Every task a log proposed, with what its author wrote. */
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

/** Each task a comparison scored, with what its author wrote and the comparisons that scored it. */
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

/** Every key path of a value, a list's items folded into one `[]` path, values dropped. */
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
 *  longest, and no value: what lanes 17 and 27 read a task's structure from. */
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

/** One task's public input, indented, with any text past `VALUE_BYTES` cut and the cut said. */
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

/** The scored tasks, then those practised and never scored, each with where it stood. */
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

/** The skeleton of lane 27's grade rows, as `gradesIn` and `wri.ts trajectory --grades` read them: a
 *  row a scored task and a row a version a comparison measured, grades blank, in the log's order. */
function gradeRows(events: readonly LogEvent[], campaign: string): string[] {
  const started = events.filter(({ kind }) => kind === "comparison.started");
  const starter = started[0]?.data.starter;
  const versions = [...new Set(started.map(({ data }) => data.fresh))].filter(
    (digest): digest is string => isString(digest) && digest !== starter,
  );
  return [
    ...scoredTasks(events).map(({ taskId, version }) => `task\t${campaign}\t${taskId ?? version}\t`),
    ...versions.map((digest) => `version\t${campaign}\t${digest}\t`),
  ];
}

async function main(args: CommandArgs): Promise<number> {
  const [named = ""] = args.positionals;
  const log = await logAcross(args.value("log") ?? named);
  const events = read(log);
  const tasks = listed(events);
  const asked = args.value("task");
  if (args.flag("rows")) {
    console.log(gradeRows(events, basename(dirname(log))).join("\n"));
    return 0;
  }
  if (asked !== null) {
    const found = tasks.find(({ task }) => task.taskId === asked || task.version.startsWith(asked));
    if (found === undefined) return args.die(`${asked} is no task this log scored or released`);
    const { task, where } = found;
    console.log(
      [...taskLines(task, where).slice(0, 2), `  public:`, wholeOf(task.input?.publicInput)].join("\n"),
    );
    return 0;
  }
  const lines = args.flag("shape")
    ? tasks.map(
        ({ task, where }) =>
          `${task.version.slice(0, 8)}  ${task.taskId ?? "no id"}  ${where}  ${task.input === undefined ? "none in the log" : inputPaths(task.input.publicInput)}`,
      )
    : tasks.flatMap(({ task, where }) => taskLines(task, where));
  console.log(lines.length === 0 ? "no comparison has scored a task" : lines.join("\n"));
  return 0;
}

if (import.meta.main) {
  await runCommand({ name: "tasks", usage: USAGE, options: OPTIONS, positionals: [0, 1] }, main);
}
