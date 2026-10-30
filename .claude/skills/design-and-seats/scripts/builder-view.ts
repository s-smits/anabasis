#!/usr/bin/env bun
/**
 * Print the campaign-history messages a Builder opening would receive.
 *
 *   bun .claude/skills/design-and-seats/scripts/builder-view.ts <log.jsonl | campaign name>
 *     [--parent <digest>]
 *
 * The opening includes three history readers from src/builder/past.ts: startTold gives harness
 * provenance and the previous session's ending; comparisonsTold gives tallies and readings;
 * failsTold gives failed practice solves on released tasks. Call them over campaignOf so a changed
 * message can be inspected using the same readers as firstMessage. Held-out tasks, checks or rulings
 * in the output would breach rule 3 and require a fix in past.ts or handover.ts.
 *
 * --parent selects the starting harness. Otherwise use latestBuilt, falling back to the starter
 * named A by namesOf. nextId selects the next Builder session id. Released tasks use their recorded
 * task ids, or a short version digest for stored-pack tasks absent from proposals. Practice task
 * content, limits and notes require the pack and home, so this script omits them.
 *
 * Written on 30 October alongside examiner-view.ts, which summarises the exam-side view in counts.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { comparisonsTold, failsTold, startTold } from "#src/builder/past.ts";
import { campaignOf } from "#src/campaign/handover.ts";
import { short } from "#src/campaign/move.ts";
import { namesOf } from "#src/campaign/names.ts";
import { proposalsOf } from "#src/kernel/history.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { latestBuilt } from "#src/kernel/reports.ts";
import { taskStates } from "#src/kernel/task.ts";
import { nextId } from "#tools/d2/campaign-terms.ts";
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

/** The lines a session opening now would read of the past, under the headings its message gives. */
export function builderTold(events: readonly LogEvent[], parent: string | null = parentOf(events)): string[] {
  const campaign = campaignOf(events);
  const id = nextId(events, "b");
  const released = releasedIds(events);
  const fails = failsTold(campaign.fails, released);
  const comparisons = comparisonsTold(campaign.steps);
  return [
    `session ${id}, ${String(released.size)} released tasks`,
    parent === null ? "start: the log names no harness yet" : `start: ${startTold(campaign, parent, id)}`,
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
      console.log(builderTold(events, args.value("parent") ?? parentOf(events)).join("\n"));
    },
  );
}
