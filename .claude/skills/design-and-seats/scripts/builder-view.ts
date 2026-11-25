#!/usr/bin/env bun
/**
 * Prints the campaign-history sections a Builder session opening now would receive:
 * `builder-view.ts <log.jsonl | campaign name> [--parent <digest>]`.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { formatComparisonHistory, formatPracticeFailures, formatSessionStart } from "#src/builder/past.ts";
import { campaignOf } from "#src/campaign/summary.ts";
import { short } from "#src/campaign/move.ts";
import { namesOf } from "#src/campaign/names.ts";
import { proposalsOf } from "#src/kernel/history.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { latestBuilt } from "#src/kernel/reports.ts";
import { taskStates } from "#src/kernel/task.ts";
import { nextId } from "#tools/campaign/campaign-terms.ts";
import { logEvents } from "#tools/runs/registry.ts";
import { logAcross } from "#tools/runs/snapshots.ts";

const USAGE = `usage: builder-view.ts <log.jsonl | campaign name> [--parent <digest>]

What a Builder session opening now is told of the campaign's past, as past.ts words it.`;

/** The harness a session starts from where `--parent` names none: the last one a session left, else
 *  the starter, or null where the log names no harness yet. */
function parentOf(events: readonly LogEvent[]): string | null {
  return latestBuilt(events) ?? [...namesOf(events)].find(([, letter]) => letter === "A")?.[0] ?? null;
}

/** Each released task's version, with the id a Builder knows it by. */
function releasedIds(events: readonly LogEvent[]): Map<string, string> {
  const ids = new Map(
    proposalsOf(events).flatMap(({ version, taskId, task }) => {
      const id = task?.taskId ?? taskId;
      return id === null ? [] : [[version, id] as const];
    }),
  );
  return new Map(
    [...taskStates(events)].flatMap(([version, state]) =>
      state === "released" ? [[version, ids.get(version) ?? short(version)] as const] : [],
    ),
  );
}

export function formatBuilderView(
  events: readonly LogEvent[],
  parent: string | null = parentOf(events),
): string[] {
  const campaign = campaignOf(events);
  const id = nextId(events, "b");
  const released = releasedIds(events);
  const fails = formatPracticeFailures(campaign.fails, released);
  const comparisons = formatComparisonHistory(campaign.steps);
  return [
    `session ${id}, ${String(released.size)} released tasks`,
    parent === null
      ? "start: the log names no harness yet"
      : `start: ${formatSessionStart(campaign, parent, id)}`,
    `comparisons (${String(comparisons.length)}):`,
    ...comparisons,
    `failed practice solves on released tasks (${String(fails.length)}):`,
    ...fails,
  ];
}

if (import.meta.main) {
  await runCommand(
    { name: "builder-view", usage: USAGE, options: { parent: "text" }, positionals: 1 },
    async (args: CommandArgs) => {
      const [named = ""] = args.positionals;
      const events = logEvents(await logAcross(named));
      console.log(formatBuilderView(events, args.value("parent") ?? parentOf(events)).join("\n"));
    },
  );
}
