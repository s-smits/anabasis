/**
 * `GET /api/tasks?key=` and `GET /api/task?key=&id=`: every task version against every comparison
 * (`taskSets`, `pairsReported`, `poolOf`), and one task's solves across them. A task's public part
 * is served in the default tier for a practice task alone, its hidden values in the exam tier
 * alone; the log holds either only for a task it holds whole (`proposalsOf`), since a pack's task
 * is proposed by id.
 */
import { fixedIn, reported } from "../../../../src/campaign/comparison.ts";
import { passed } from "../../../../src/kernel/solves.ts";
import { isString } from "../../../../src/meta/json-shape.ts";
import { keyIfDefined } from "../../../../src/meta/optional-key.ts";
import type {
  Issue,
  LeftOut,
  Query,
  TaskCell,
  TaskDetail,
  TaskGrid,
  TaskLeftOut,
  TaskRow,
} from "../models.ts";
import { type Reading, Unanswerable } from "./context.ts";
import { drawsIn, once, proposalsIn, ranIn, setsIn } from "./folds.ts";
import { campaignAt } from "./logs.ts";
import { barsIn, outcomeOf, ownSolves, pairsIn, shareOf } from "./moves.ts";
import { examTier, solveRow } from "./trace.ts";

const proposedIn = once(
  ({ events }) =>
    new Map(
      events.flatMap(({ kind, data, at }) =>
        kind === "task.proposed" && isString(data.version) ? [[data.version, at] as const] : [],
      ),
    ),
);

const rowsIn = once((log): TaskRow[] => {
  const { states } = setsIn(log);
  const proposed = proposedIn(log);
  const draws = drawsIn(log);
  return proposalsIn(log).map(({ version, taskId }) => ({
    version,
    id: taskId,
    state: states.get(version) ?? "held",
    draw: draws.get(version) ?? null,
    proposedAt: proposed.get(version) ?? null,
  }));
});

const rowByVersionIn = once((log) => new Map(rowsIn(log).map((row) => [row.version, row])));
const taskByVersionIn = once((log) => new Map(proposalsIn(log).map(({ version, task }) => [version, task])));
const ranByTaskIn = once((log) => Map.groupBy(ranIn(log), ({ under }) => under.task));

/** The report's lists naming a task it fixed and left out, in the chart's order (`splitOf`,
 *  `moves.ts`), so a task named in two counts where the chart counts it. */
const LEFT_OUT = ["disputed", "short", "withdrawn"] as const satisfies readonly (keyof LeftOut)[];

const gridIn = once((log) => {
  const [bars, pairs] = [barsIn(log), pairsIn(log)];
  const indexed = bars.map((bar) => {
    const report = reported(log.events, bar.id);
    const leftOut = new Map(
      LEFT_OUT.toReversed().flatMap((list) => (report?.[list] ?? []).map((task) => [task, list] as const)),
    );
    return {
      bar,
      pairByTask: new Map((pairs.get(bar.id) ?? []).map((pair) => [pair.task, pair])),
      aside: new Set(report?.aside),
      leftOut,
      solves: fixedIn(log.events, bar.id)?.solves ?? 0,
    };
  });
  const cell = (column: (typeof indexed)[number], version: string): TaskCell | TaskLeftOut | null => {
    const pair = column.pairByTask.get(version);
    if (pair !== undefined) {
      return { outcome: outcomeOf(pair), old: shareOf(pair.old), fresh: shareOf(pair.fresh) };
    }
    if (!column.aside.has(version)) {
      const left = column.leftOut.get(version);
      return left === undefined ? null : { leftOut: left };
    }
    const under = (harness: string) =>
      shareOf(
        ownSolves(log, column.bar.id, version, harness, column.solves).map((solve) => passed(solve) === true),
      );
    return { outcome: "aside", old: under(column.bar.old), fresh: under(column.bar.fresh) };
  };
  return {
    columns: bars.map(({ id, move, kind, reading: read, cut, old, fresh }) => ({
      id,
      move,
      kind,
      reading: read,
      cut,
      old,
      fresh,
    })),
    rows: rowsIn(log).map((row) => ({ ...row, cells: indexed.map((col) => cell(col, row.version)) })),
  };
});

export function tasksAnswer(reading: Reading, query: Query<"tasks">): TaskGrid {
  const { log, issues } = campaignAt(reading, query.key);
  return { tier: reading.tier, issues, ...gridIn(log) };
}

export function taskAnswer(reading: Reading, query: Query<"task">): TaskDetail {
  const { found, log, issues: read } = campaignAt(reading, query.key);
  const row = rowByVersionIn(log).get(query.id);
  if (row === undefined) throw new Unanswerable(404, `no task version ${query.id} in this campaign`);
  const { tier } = reading;
  const exam = examTier(tier);
  const task = taskByVersionIn(log).get(query.id) ?? null;
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
  const solves = (ranByTaskIn(log).get(query.id) ?? []).map((solve) => solveRow(log, solve, tier));
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
