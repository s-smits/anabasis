/**
 * `bun run runs replay [<name> ...] [--holds <commit>]... [--has <text>]...`
 *
 * Every campaign log in the repository's worktrees, or those whose names hold one of `name` and
 * whose every launch ran with what `--holds` and `--has` name (`ranWith`, `receipt.ts`), through
 * this tree's readers of a log: its events and their kinds (`read`), the task states and the sets a
 * comparison takes (`taskSets`), what its sessions wrote (`writtenTasks`), each recorded condition,
 * and the plan's stop rule over its reports (`stopRule`). It writes nothing. The whole-run
 * investigation reads a log through its own command (`tools/wri/wri.ts read`), which a production
 * verb does not import.
 *
 * It is the check to run when an event's shape, a fold or a reader has changed. A log a real run
 * wrote that this tree refuses is named in the reader's own words, with exit code 1. A log being
 * appended to at that instant can read torn: run it again.
 */
import { conditionsOf } from "#src/kernel/condition.ts";
import { writtenTasks } from "#src/kernel/history.ts";
import { read } from "#src/kernel/log.ts";
import { stopRule } from "#src/kernel/reports.ts";
import { taskSets } from "#src/kernel/task.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { askedIn, ranWith } from "./receipt.ts";
import { isCampaign } from "./registry.ts";
import { readableAcross } from "./snapshots.ts";

/** What this tree's readers make of the log at `path`, in a line. */
export function replayed(path: string): string {
  const events = read(path);
  const sets = taskSets(events);
  return [
    `${String(events.length)} events`,
    `${String(conditionsOf(events).size)} conditions`,
    `${String(sets.held.length)} held out, ${String(sets.released.length)} released`,
    `${String(writtenTasks(events).length)} written by a session`,
    `${String(stopRule(events).checkpoints)} compared`,
  ].join(" · ");
}

/** `bun run runs replay`. */
export async function replay(args: readonly string[]): Promise<void> {
  const { asked, names } = askedIn(args);
  const asks = asked.holds.length + asked.has.length > 0;
  const logs = (await readableAcross(names)).filter(
    (run) =>
      isCampaign(run) &&
      (names.length === 0 || names.some((name) => run.name.includes(name))) &&
      (!asks || ranWith(run.path, run.tree, asked)),
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
