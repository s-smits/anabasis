#!/usr/bin/env bun
/**
 * Summarise the campaign information an Examiner opening would receive.
 *
 *   bun .claude/skills/design-and-seats/scripts/examiner-view.ts <log.jsonl | campaign name>
 *
 * Call heard, the production composer in src/examiner/record.ts, and report task-line counts,
 * reference outcomes from poolOf, the measuredLine summary, promotion notice, and refused and
 * interrupted draft counts. Print the two aggregate messages in full; omit task text, refusal
 * reasons and hidden values. This helps inspect a view before changing its delivery.
 *
 * logAcross resolves names across configured hosts and refreshes their records. logEvents reads
 * through the last complete line, allowing live logs. The task list comes from proposalsOf;
 * stored-pack tasks are omitted, so such campaigns have fewer task lines here than in a real
 * opening. Their summary, promotion notice and draft counts are unaffected by that omission.
 *
 * Written on 30 October alongside seat-view.ts.
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
