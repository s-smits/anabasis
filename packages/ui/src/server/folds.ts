/**
 * The repository's folds of one log, each computed once and kept with the log as read, so every
 * endpoint and the list's poll share one reading. A log read again after it changed is another
 * `Log`, and the old one's folds go with it.
 */
import { epochsOf } from "../../../../src/campaign/climb.ts";
import { campaignOf } from "../../../../src/campaign/summary.ts";
import { openingOf } from "../../../../src/campaign/opening.ts";
import { conditionsOf } from "../../../../src/kernel/condition.ts";
import { proposalsOf } from "../../../../src/kernel/history.ts";
import type { LogEvent } from "../../../../src/kernel/log.ts";
import { stopRule } from "../../../../src/campaign/admission.ts";
import { lastReports, poolOf } from "../../../../src/kernel/reports.ts";
import { practiceRan, ranUnder, solvesIn, verdictsOf } from "../../../../src/kernel/solves.ts";
import { taskSets } from "../../../../src/kernel/task.ts";
import type { TaskDraw } from "../models.ts";

export interface Log {
  readonly events: readonly LogEvent[];
}

export function once<T>(make: (log: Log) => T): (log: Log) => T {
  const kept = new WeakMap<Log, { readonly value: T }>();
  return (log) => {
    const found = kept.get(log);
    if (found !== undefined) return found.value;
    const value = make(log);
    kept.set(log, { value });
    return value;
  };
}

export const campaignIn = once(({ events }) => campaignOf(events));
export const reportsIn = once(({ events }) => lastReports(events));
export const epochsIn = once(({ events }) => epochsOf(events));
export const setsIn = once(({ events }) => taskSets(events));
export const solvedIn = once(({ events }) => new Map(solvesIn(events).map((solve) => [solve.id, solve])));
export const ranIn = once(({ events }) => ranUnder(events));
export const practiceIn = once(({ events }) => new Set(practiceRan(events).map(({ id }) => id)));
export const verdictsIn = once(({ events }) => verdictsOf(events));
export const conditionsIn = once(({ events }) => conditionsOf(events));
/** The one place each held-out task has (`poolOf`), from which the tasks awaiting a label and the
 *  exhausted ones are read, as the supply counts them (`supplyOf`). */
const poolIn = once(({ events }) => poolOf(events));
export const awaitingIn = once((log) => new Set(poolIn(log).awaiting));
export const doubtedIn = once((log) => new Set(poolIn(log).doubted));
export const drawsIn = once((log): ReadonlyMap<string, TaskDraw> => {
  const { frontier, retained, exhausted } = poolIn(log);
  const [awaiting, doubted, spent] = [awaitingIn(log), doubtedIn(log), new Set(exhausted)];
  return new Map<string, TaskDraw>([
    ...frontier.map((task) => [task, { place: "frontier" }] as const),
    ...retained.map((task) => [task, { place: "retained", exhausted: spent.has(task) }] as const),
    ...[...awaiting, ...doubted].map(
      (task) =>
        [task, { place: "out", awaitingLabel: awaiting.has(task), doubted: doubted.has(task) }] as const,
    ),
  ]);
});
export const stopIn = once(({ events }) => stopRule(events));
export const openingIn = once(({ events }) => openingOf(events));
export const proposalsIn = once(({ events }) => proposalsOf(events));
