/**
 * `bun run runs replay [<name> ...] [--holds <commit>]... [--has <text>]...`
 */
import { conditionsOf } from "#src/kernel/condition.ts";
import { writtenTasks } from "#src/kernel/history.ts";
import { eachEvent, eventsOf, type LogEvent, TRACE_KINDS } from "#src/kernel/log.ts";
import { stopRule } from "#src/campaign/admission.ts";
import { openingOf } from "#src/campaign/opening.ts";
import { lastReports } from "#src/kernel/reports.ts";
import { taskSets } from "#src/kernel/task.ts";
import { isString } from "#src/meta/json-shape.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { askedIn, ranWith } from "./receipt.ts";
import { isCampaign } from "./registry.ts";
import { readableAcross } from "./snapshots.ts";

function lineageTags(events: readonly LogEvent[]): string[] {
  const parent = openingOf(events)?.parent;
  const kind = eventsOf(events, "exam.revised").at(-1)?.event.data.kind;
  return [
    ...(parent == null ? [] : [`from ${parent.campaign} (${parent.kind})`]),
    ...(isString(kind) ? [`revised (${kind})`] : []),
  ];
}

/** What this tree's readers make of the log at `path`, in a line. */
function replayed(path: string): string {
  const events: LogEvent[] = [];
  let total = 0;
  eachEvent(path, (event) => {
    total += 1;
    if (!TRACE_KINDS.has(event.kind)) events.push(event);
  });
  const sets = taskSets(events);
  return [
    `${String(total)} events`,
    `${String(conditionsOf(events).size)} conditions`,
    `${String(sets.held.length)} held out, ${String(sets.released.length)} released`,
    `${String(writtenTasks(events).length)} written by a session`,
    `${String(lastReports(events).length)} compared`,
    `${String(stopRule(events).checkpoints)} counted by the stop rule`,
    ...lineageTags(events),
  ].join(" · ");
}

export async function replay(args: readonly string[]): Promise<void> {
  const { asked, names } = askedIn(args);
  const asks = asked.holds.length + asked.has.length > 0;
  const logs = (await readableAcross(names)).filter(
    (run) => isCampaign(run) && (!asks || ranWith(run.path, run.tree, asked)),
  );
  let refused = 0;
  for (const run of logs) {
    try {
      console.log(`${run.name}${run.seed === true ? " (a seed)" : ""}  ${replayed(run.path)}`);
    } catch (error) {
      refused += 1;
      console.error(`⚠ ${run.name} in ${run.tree}: ${errorMessage(error)}`);
    }
  }
  console.log(`${String(logs.length - refused)} of ${String(logs.length)} logs read`);
  if (refused > 0) runtimeProcess.exitCode = 1;
}
