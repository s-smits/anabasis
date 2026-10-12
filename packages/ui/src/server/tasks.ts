/**
 * `GET /api/tasks?key=` and `GET /api/task?key=&id=`: every task version against every comparison
 * (`taskSets`, `pairsReported`, `poolOf`), and one task's solves across them.
 * A task's public part is served in the default tier for a practice task alone; its hidden values
 * in the exam tier alone. Both are in the log only for a task it holds whole, an Examiner's or a
 * carried one (`proposalsOf`): a pack's task is proposed by its id, and its text is in the pack,
 * which this server does not read.
 */
import { fixedIn, reported } from "../../../../src/builder/comparison.ts";
import { passed } from "../../../../src/kernel/solves.ts";
import { isString } from "../../../../src/meta/json-shape.ts";
import { keyIfDefined } from "../../../../src/meta/optional-key.ts";
import type { ComparisonBar, Issue, Query, TaskCell, TaskDetail, TaskGrid, TaskRow } from "../models.ts";
import { type Reading, Unanswerable } from "./context.ts";
import { awaitingIn, exhaustedIn, type Log, once, proposalsIn, ranIn, setsIn } from "./folds.ts";
import { campaignAt } from "./logs.ts";
import { barsIn, outcomeOf, pairsIn, shareOf } from "./moves.ts";
import { examTier, solveRow } from "./trace.ts";

/** When each task version was proposed. Derived: the place of its `task.proposed`, by version. */
const proposedIn = once(
  ({ events }) =>
    new Map(
      events.flatMap(({ kind, data, at }) =>
        kind === "task.proposed" && isString(data.version) ? [[data.version, at] as const] : [],
      ),
    ),
);

/** Every task version as a row, in the order proposed. */
const rowsIn = once((log): TaskRow[] => {
  const { states } = setsIn(log);
  const proposed = proposedIn(log);
  return proposalsIn(log).map(({ version, taskId }) => ({
    version,
    id: taskId,
    state: states.get(version) ?? "held",
    awaitingLabel: awaitingIn(log).has(version),
    exhausted: exhaustedIn(log).has(version),
    proposedAt: proposed.get(version) ?? null,
  }));
});

/** What comparison `bar` came to on task `version`: its pair's outcome, or set aside, with each
 *  side's valid answers over its solves; null where it did not score the task. A set-aside task's
 *  sides are cut to the comparison's solves a side, as a pair's are (`pairsOf`,
 *  `src/kernel/compare.ts`): under an A/A reading the reference solved it twice as often, and the
 *  further arm is no part of its side. */
function cellOf(
  log: Log,
  bar: Pick<ComparisonBar, "id" | "old" | "fresh">,
  version: string,
): TaskCell | null {
  const { id } = bar;
  const pair = pairsIn(log)
    .get(id)
    ?.find(({ task }) => task === version);
  if (pair !== undefined) {
    return { outcome: outcomeOf(pair), old: shareOf(pair.old), fresh: shareOf(pair.fresh) };
  }
  if (!(reported(log.events, id)?.aside ?? []).includes(version)) return null;
  // A task set aside is in no pair: each side's share is of the comparison's own counted solves of
  // it, in the order they started, as many as a side has.
  const solves = fixedIn(log.events, id)?.solves ?? 0;
  const under = (harness: string) =>
    shareOf(
      ranIn(log)
        .flatMap((solve) => {
          const valid = passed(solve);
          return solve.start.comparison === id &&
            solve.under.task === version &&
            solve.under.harness === harness &&
            valid !== null
            ? [{ valid, started: solve.started }]
            : [];
        })
        .toSorted((one, other) => one.started - other.started)
        .slice(0, solves)
        .map(({ valid }) => valid),
    );
  return { outcome: "aside", old: under(bar.old), fresh: under(bar.fresh) };
}

export function tasksAnswer(reading: Reading, query: Query<"tasks">): TaskGrid {
  const { log, issues } = campaignAt(reading, query.key);
  const bars = barsIn(log);
  return {
    tier: reading.tier,
    issues,
    columns: bars.map(({ id, move, kind, reading: read, cut, old, fresh }) => ({
      id,
      move,
      kind,
      reading: read,
      cut,
      old,
      fresh,
    })),
    rows: rowsIn(log).map((row) => ({
      ...row,
      cells: bars.map((bar) => cellOf(log, bar, row.version)),
    })),
  };
}

export function taskAnswer(reading: Reading, query: Query<"task">): TaskDetail {
  const { found, log, issues: read } = campaignAt(reading, query.key);
  const row = rowsIn(log).find(({ version }) => version === query.id);
  if (row === undefined) throw new Unanswerable(404, `no task version ${query.id} in this campaign`);
  const { tier } = reading;
  const exam = examTier(tier);
  const task = proposalsIn(log).find(({ version }) => version === query.id)?.task ?? null;
  const shown = exam || row.state === "released";
  const issues: Issue[] = [...read];
  if (shown && task === null) {
    issues.push({
      level: "warning",
      source: `${found.label}/.ana/d2/${found.name}`,
      message:
        "the log names this task by its id alone: its text is in the stored pack, which this server does not read",
    });
  }
  const solves = ranIn(log)
    .filter((solve) => solve.under.task === query.id)
    .map((solve) => solveRow(log, solve, tier));
  return {
    tier,
    issues,
    row,
    solves,
    ...keyIfDefined("input", shown && task !== null ? task.publicInput : undefined),
    ...keyIfDefined("family", exam ? (task?.family ?? null) : undefined),
    ...keyIfDefined("hidden", exam && task !== null ? task.hidden : undefined),
  };
}
