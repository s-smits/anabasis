/**
 * `bun run runs replay [<name> ...]`
 *
 * Every campaign log in the repository's worktrees, or those whose names hold one of `name`, through
 * this tree's readers of a log: its events and their kinds (`read`), the task states and the sets a
 * round takes (`setsOf`), what its sessions wrote (`carriable`), each recorded condition, and the
 * plan's three-session rule over its reports (`stopRule`). It writes nothing.
 *
 * It is the check to run when an event's shape, a fold or a reader has changed. A log a real run
 * wrote that this tree refuses is named in the reader's own words, with exit code 1. A log being
 * appended to at that instant can read torn: run it again.
 */
import { stopRule } from "#src/builder/round.ts";
import { conditionsOf } from "#src/kernel/condition.ts";
import { read } from "#src/kernel/log.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { carriable, setsOf } from "../d2/campaign.ts";
import { runs } from "./pulse.ts";

/** What this tree's readers make of the log at `path`, in a line. */
export function replayed(path: string): string {
  const events = read(path);
  const sets = setsOf(events);
  const { feasible, waiting } = carriable(events);
  return [
    `${String(events.length)} events`,
    `${String(conditionsOf(events).size)} conditions`,
    `${String(sets.anchor.length)} anchor, ${String(sets.released.length)} released, ${String(sets.candidates.length)} held, ${String(sets.admitted.length)} admitted`,
    `${String(feasible.length)} written and feasible, ${String(waiting.length)} waiting for controls`,
    `${String(stopRule(events).sessions)} reported`,
  ].join(" · ");
}

/** `bun run runs replay`. */
export function replay(names: readonly string[]): void {
  const logs = runs().filter(
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
