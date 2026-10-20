/**
 * `bun run runs replay [<name> ...]`
 *
 * Every campaign log in the repository's worktrees, or those whose names hold one of `name`, through
 * this tree's readers of a log: its events and their kinds (`read`), the task states and the sets a
 * comparison takes (`taskSets`), what its sessions wrote (`writtenTasks`), each recorded condition,
 * the plan's stop rule over its reports (`stopRule`), and the whole-run investigation's fold of it
 * into rows and triggers (`tools/wri/read.ts`). It writes nothing.
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
import { overview } from "../wri/read.ts";
import { readable } from "./registry.ts";

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
    `${String(new Set(overview(events).triggers.map(({ lane }) => lane)).size)} lanes with something to read`,
  ].join(" · ");
}

/** `bun run runs replay`. */
export function replay(names: readonly string[]): void {
  const logs = readable().filter(
    (run) =>
      run.end === "comparison.reported" &&
      (names.length === 0 || names.some((name) => run.name.includes(name))),
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
