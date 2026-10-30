#!/usr/bin/env bun
/**
 * What an Examiner session opening now would be told of its campaign, in counts.
 *
 *   bun .claude/skills/design-and-seats/scripts/examiner-view.ts <log.jsonl | campaign name>
 *
 * `AGENTS.md` section 3 lists what the Examiner reads, and `src/examiner/record.ts` composes it from
 * the log (`heard`). Before a change to that view, and when an Examiner session wrote towards
 * something nobody expected, the question is what the view holds for a real campaign: how many task
 * lines, how the reference stood in its last comparison, what the gate held out under the current
 * reference and on which kind of room, whether a promotion is announced, and how many refused and
 * interrupted drafts it lists. This script calls `heard` itself and prints its summary sentence
 * (`measuredLine`, which holds only counts) and the promotion line whole, and the rest as counts, so
 * no task line, refusal reason or hidden value reaches its output. The outcomes are counted from
 * `poolOf`, the fold `heard` reads them from.
 *
 * A name is found on any host `ANA_HOSTS` lists, its records refreshed first (`logAcross`,
 * `tools/runs/snapshots.ts`), and the log is read to its last whole line, so a live campaign reads
 * too (`logEvents`, `tools/runs/registry.ts`).
 *
 * The tasks are those the log proposed (`proposalsOf`). A campaign over a stored pack also holds the
 * pack's tasks, which its opening lists and this script does not, so its task lines are fewer than a
 * session's there; the summary, the promotion and the drafts do not depend on the list. Written on
 * 30 October, beside `seat-view.ts`.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { heard } from "#src/examiner/record.ts";
import { proposalsOf } from "#src/kernel/history.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { poolOf } from "#src/kernel/reports.ts";
import { countBy } from "#src/meta/tally.ts";
import { plural } from "#src/meta/text.ts";
import { logEvents } from "#tools/runs/registry.ts";
import { logAcross } from "#tools/runs/snapshots.ts";

/** The view `heard` gives over `events`, as counts and its two lines of counts. */
export function examinerCounts(events: readonly LogEvent[]): string[] {
  const tasks = [
    ...new Map(
      proposalsOf(events).flatMap(({ task }) => (task === null ? [] : [[task.taskId, task] as const])),
    ).values(),
  ];
  const view = heard(events, tasks);
  const outcomes = countBy([...poolOf(events).outcomes.values()], (outcome) => outcome);
  return [
    `lines: ${String(view.lines.length)} (a task each, grouped tasks and practice), over ${String(tasks.length)} proposed tasks`,
    `outcomes in the last comparison that scored each task: ${
      Object.entries(outcomes)
        .map(([outcome, count]) => `${outcome} ${String(count)}`)
        .join(", ") || "none"
    }`,
    `summary: ${view.measured ?? "none"}`,
    `promotion: ${view.promoted ?? "none"}`,
    `refused drafts in ${plural(view.refused.length, "group")} by reason, ${plural(view.interrupted.length, "interrupted draft")}`,
  ];
}

if (import.meta.main) {
  await runCommand(
    { name: "examiner-view", usage: "examiner-view.ts <log.jsonl | campaign name>", positionals: 1 },
    async (args: CommandArgs) => {
      const [named = ""] = args.positionals;
      console.log(examinerCounts(logEvents(await logAcross(named))).join("\n"));
    },
  );
}
