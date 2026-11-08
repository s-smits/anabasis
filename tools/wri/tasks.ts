/**
 * Every task a campaign's comparisons scored, with its public input and nothing of how it was
 * answered, so lane 27 grades reach before it reads an outcome. On 30 October the first lane-34
 * session spent fifteen calls finding the tasks' text in the log and joining it to the scored sets
 * by hand. It prints no hidden value, no check and no answer, though the file stays on the exam
 * side with the log it reads.
 *
 *   bun tools/wri/tasks.ts <log.jsonl | campaign folder | name>
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
import { isString } from "#src/meta/json-shape.ts";
import { exampleId } from "#tools/d2/exam.ts";
import { logAcross } from "#tools/runs/snapshots.ts";

const USAGE = "usage: bun tools/wri/tasks.ts <log.jsonl | campaign folder | name>";

/** Every task a log proposed, with what its author wrote. */
function proposedTasks(events: readonly LogEvent[]) {
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

async function main(args: CommandArgs): Promise<number> {
  const [named = ""] = args.positionals;
  const events = read(await logAcross(named));
  const scored = scoredTasks(events);
  const released = new Set(taskSets(events).released);
  for (const { version } of scored) released.delete(version);
  const lines = [
    ...scored.flatMap((task) => taskLines(task, `scored in ${task.sessions.join(", ")}`)),
    ...proposedTasks(events)
      .filter(({ version }) => released.has(version))
      .flatMap((task) => taskLines(task, "practised, never scored")),
  ];
  console.log(lines.length === 0 ? "no comparison has scored a task" : lines.join("\n"));
  return 0;
}

if (import.meta.main) await runCommand({ name: "tasks", usage: USAGE, positionals: 1 }, main);
