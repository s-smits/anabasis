/**
 * `bun run runs replay [<name> ...] [--holds <commit>]... [--has <text>]...`
 */
import { conditionsOf } from "#src/kernel/condition.ts";
import { writtenTasks } from "#src/kernel/history.ts";
import { eachEvent, eventsOf, LOG_FILE, type LogEvent, read, TRACE_KINDS } from "#src/kernel/log.ts";
import { stopRule } from "#src/campaign/admission.ts";
import { openingOf } from "#src/campaign/opening.ts";
import { lastReports } from "#src/kernel/reports.ts";
import { taskSets } from "#src/kernel/task.ts";
import { existsSync } from "#src/meta/filesystem.ts";
import { isString } from "#src/meta/json-shape.ts";
import { basename, dirname, join } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { askedIn, ranWith } from "./receipt.ts";
import { isCampaign } from "./registry.ts";
import { readableAcross } from "./snapshots.ts";

function lineageTags(path: string, events: readonly LogEvent[]): string[] {
  const tags: string[] = [];
  const parent = openingOf(events)?.parent ?? null;
  if (parent !== null) {
    const parentLog = join(dirname(dirname(path)), parent.campaign, LOG_FILE);
    if (existsSync(parentLog)) {
      const parentEvents = read(parentLog, TRACE_KINDS);
      const rev = eventsOf(parentEvents, "exam.revised").at(-1)?.event.data;
      if (rev?.draftHash !== parent.revised || rev.kind !== parent.kind) {
        const kind = isString(rev?.kind) ? rev.kind : "?";
        const hash = isString(rev?.draftHash) ? rev.draftHash : "?";
        throw new Error(
          `parent ${parent.campaign} exam.revised (${kind}/${hash}) disagrees with successor opening (${parent.kind}/${parent.revised})`,
        );
      }
      const successor = eventsOf(parentEvents, "campaign.ended").at(-1)?.event.data.successor;
      if (isString(successor) && successor !== basename(dirname(path))) {
        throw new Error(
          `parent ${parent.campaign} names successor ${successor}, not ${basename(dirname(path))}`,
        );
      }
    }
    tags.push(`from ${parent.campaign} (${parent.kind})`);
  }
  const revised = eventsOf(events, "exam.revised").at(-1)?.event.data;
  if (revised !== undefined && isString(revised.kind)) tags.push(`revised (${revised.kind})`);
  return tags;
}

/** What this tree's readers make of the log at `path`, in a line. */
export function replayed(path: string): string {
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
    ...lineageTags(path, events),
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
