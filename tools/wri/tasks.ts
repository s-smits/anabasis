/**
 * Every task a campaign's comparisons scored, with its public input and nothing of how it was
 * answered, so lane 34 grades reach before it reads an outcome. On 30 October the first lane-34
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
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { draftOf } from "#src/examiner/draft.ts";
import { proposalsOf } from "#src/kernel/history.ts";
import { read } from "#src/kernel/log.ts";
import { isString } from "#src/meta/json-shape.ts";
import { exampleId } from "#tools/d2/exam.ts";
import { logAcross } from "#tools/runs/snapshots.ts";

const USAGE = "usage: bun tools/wri/tasks.ts <log.jsonl | campaign folder | name>";

async function main(args: CommandArgs): Promise<number> {
  const [named = ""] = args.positionals;
  const events = read(await logAcross(named));
  const scoredIn = new Map<string, string[]>();
  for (const { kind, data } of events) {
    if (kind !== "comparison.started" || !isString(data.session) || !Array.isArray(data.tasks)) continue;
    for (const version of data.tasks.filter(isString)) {
      scoredIn.set(version, [...(scoredIn.get(version) ?? []), data.session]);
    }
  }
  const drafted = new Map(
    (draftOf(events)?.tasks ?? []).map((example, index) => [exampleId(index), example]),
  );
  const lines = proposalsOf(events).flatMap(({ version, taskId, family, session, task }) => {
    const sessions = scoredIn.get(version);
    if (sessions === undefined) return [];
    const input = task ?? drafted.get(taskId ?? "");
    return [
      `${version.slice(0, 8)}  ${taskId ?? "no id"}  written by ${session ?? (input === undefined ? "the pack" : "the draft")}  scored in ${sessions.join(", ")}`,
      `  family: ${family ?? "none"}`,
      `  public: ${input === undefined ? "none in the log (a pack's task: its public input is in the pack)" : JSON.stringify(input.publicInput)}`,
    ];
  });
  console.log(lines.length === 0 ? "no comparison has scored a task" : lines.join("\n"));
  return 0;
}

if (import.meta.main) await runCommand({ name: "tasks", usage: USAGE, positionals: 1 }, main);
