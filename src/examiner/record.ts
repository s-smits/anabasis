/**
 * What an Examiner is told of the tasks earlier sessions of its campaign wrote: how each stands now.
 *
 * An Examiner session used to start with no memory. It was told one word of each task it wrote, and
 * the next session's Examiner, a new process, was told nothing of them, so nothing an earlier
 * session measured could move what a later one wrote. v1's author did hear what was measured:
 * every battery's counts, how long its slowest solve took, and after a full pass that the next
 * battery had to ask more (`renderReadout`, v1 `src/run/climb-readout.ts`). What v1 measured about
 * that channel is kept. An author told a zone, a share or a target count wrote towards it, and one
 * told each answer's distance from its limit moved limits (v1 `AGENTS.md`, "Tried and taken out").
 * An author told what was measured, and nothing to aim at, is what stayed.
 *
 * So each line here is a measurement and no instruction: the word the task has now, read against
 * the harness the campaign stands on and not the one it began with (`src/kernel/ladder.ts`), how
 * many of the solves read failed, and which checks refused them. The checks are the Examiner's to
 * know, since it names them in its controls. Nothing of a solver's answer or trace is here, and
 * nothing of the harness.
 *
 * A wall-bound task is said to be so at the time limit it was measured under, and no more: the
 * verdict holds under those limits alone (`src/kernel/limits.ts`), and once the campaign runs
 * under a longer wall the task is back in the pool and reads `not yet measured` until it is solved
 * again. The limit is never given as a number, nor how near a solve came to it, for the reason
 * above.
 */
import { type Rule, type Stand, solvesOf, standing } from "../kernel/ladder.ts";
import type { LogEvent } from "../kernel/log.ts";
import type { Counted } from "../kernel/solve.ts";
import { taskSets } from "../kernel/task.ts";
import { asRecord, isString } from "../meta/json-shape.ts";
import { countBy } from "../meta/tally.ts";

/** What a state that is not a standing says of a task. */
const SETTLED = new Map([
  ["too-hard", "too hard for now: no stronger solve of it has passed"],
  ["too-easy", "too easy: the solver passes it"],
  [
    "wall-bound",
    "wall-bound: the solver only ran out of time on it, at the time limit it was measured under",
  ],
  ["released", "in use as practice, and so never scored"],
  ["disputed", "set aside: a check was at fault on a solver's answer"],
]);
/** How a fail that reached no check is said. */
const UNJUDGED = new Map([
  ["wall-ended", "ran to the wall"],
  ["context-ended", "ran out of context"],
  ["no-answer", "gave no answer"],
]);

/** What stopped the failed ones among `solves`, as an author is told it: the checks that refused an
 *  answer, or how a solve ended short of one. Empty when none failed. */
export function stoppedBy(
  events: readonly LogEvent[],
  solves: readonly { readonly solve: string; readonly ending: Counted }[],
): string {
  const blocking = new Map(
    events.flatMap(({ kind, data }): [string, string[]][] =>
      kind === "verdict" && isString(data.solve) && Array.isArray(data.blocking)
        ? [[data.solve, data.blocking.filter(isString)]]
        : [],
    ),
  );
  const stopped = countBy(
    solves.flatMap(({ solve, ending }) => {
      if (ending.outcome !== "fail") return [];
      const checks = blocking.get(solve) ?? [];
      return checks.length > 0
        ? checks.map((check) => `refused by ${check}`)
        : [UNJUDGED.get(ending.kind) ?? "failed"];
    }),
    (how) => how,
  );
  return Object.entries(stopped)
    .map(([what, times]) => `${what}${times > 1 ? ` (${String(times)})` : ""}`)
    .join(", ");
}

/** What was measured of a task on `solves`, after its word: the fails among them and what stopped
 *  them. */
export function tally(
  events: readonly LogEvent[],
  solves: readonly { readonly solve: string; readonly ending: Counted }[],
): string {
  const failed = solves.filter(({ ending }) => ending.outcome === "fail").length;
  const how = stoppedBy(events, solves);
  return `${String(failed)} of ${String(solves.length)} solves failed${how === "" ? "" : `, ${how}`}`;
}

/** One line a task an Examiner session wrote, in the order they were written. A refused task is
 *  left out, since its author was told why when it was refused, and so is one still short of its
 *  controls, which the opening message hands over whole. */
export function measured(events: readonly LogEvent[], stand: Stand, rule: Rule): string[] {
  const { states, feasible } = taskSets(events);
  return events.flatMap(({ kind, data }) => {
    const task = asRecord(kind === "task.proposed" && isString(data.session) ? data.task : null);
    const { version } = data;
    if (task === null || !isString(version) || !isString(task.taskId)) return [];
    const state = states.get(version) ?? "";
    if (state === "refused" || state === "stale") return [];
    const name = `${task.taskId} (family ${isString(task.family) ? task.family : ""})`;
    const settled = SETTLED.get(state);
    if (settled !== undefined) return [`${name}: ${settled}`];
    if (!feasible.has(version)) return [];
    const read = solvesOf(events, version, stand).slice(-rule.solves);
    const stood = standing(
      read.map(({ ending }) => ending),
      rule,
    );
    if (stood === "unknown") return [`${name}: not yet measured`];
    const word = { stops: "scored", clears: "too easy", walled: "wall-bound" }[stood];
    return [`${name}: ${word}: ${tally(events, read)}`];
  });
}
