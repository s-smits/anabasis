/**
 * The repository's folds of one log, each computed once for the log as it was read and then kept
 * with it, so that every endpoint and the poll of the campaign list share one reading.
 *
 * Every fact the page shows is one of these folds' output, or computed from one, as the brief of
 * 11 October holds it (decision 7: one reader a fact, `AGENTS.md` section 5, habit 2). A log read
 * again after it changed is another `Log`, and the folds kept for the old one go with it.
 */
import { epochsOf } from "../../../../src/campaign/climb.ts";
import { campaignOf } from "../../../../src/campaign/handover.ts";
import { openingOf } from "../../../../src/campaign/opening.ts";
import { conditionsOf } from "../../../../src/kernel/condition.ts";
import { proposalsOf } from "../../../../src/kernel/history.ts";
import type { LogEvent } from "../../../../src/kernel/log.ts";
import { lastReports, poolOf, stopRule } from "../../../../src/kernel/reports.ts";
import { practiceRan, ranUnder, solvesIn, verdictsOf } from "../../../../src/kernel/solves.ts";
import { taskSets } from "../../../../src/kernel/task.ts";
import { tracesIn } from "../../../../src/kernel/trace.ts";
import { countBy } from "../../../../src/meta/tally.ts";

/** One log as it was read: the unit every fold below is kept for. */
export interface Log {
  readonly events: readonly LogEvent[];
}

/** `make` of a log, made once for that log and kept while the log is. */
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
/** Every solve as its own two events tell it (`solvesIn`), by id. */
export const solvedIn = once(({ events }) => new Map(solvesIn(events).map((solve) => [solve.id, solve])));
export const ranIn = once(({ events }) => ranUnder(events));
/** The practice solves (`practiceRan`), by id. */
export const practiceIn = once(({ events }) => new Set(practiceRan(events).map(({ id }) => id)));
export const verdictsIn = once(({ events }) => verdictsOf(events));
export const conditionsIn = once(({ events }) => conditionsOf(events));
/** How many calls each solve made (`tracesIn`), by id. */
export const callsIn = once(({ events }) =>
  countBy(
    tracesIn(events).filter(({ seat, part }) => seat === "solve" && part === "call"),
    ({ id }) => id,
  ),
);
/** The one place each held-out task has (`poolOf`): the tasks waiting for a person's label and
 *  the exhausted ones are read off it, as the supply counts them (`supplyOf`,
 *  `src/campaign/admission.ts`). */
const poolIn = once(({ events }) => poolOf(events));
export const awaitingIn = once((log) => new Set(poolIn(log).awaiting));
export const exhaustedIn = once((log) => new Set(poolIn(log).exhausted));
export const retainedIn = once((log) => new Set(poolIn(log).retained));
export const stopIn = once(({ events }) => stopRule(events));
export const openingIn = once(({ events }) => openingOf(events));
export const proposalsIn = once(({ events }) => proposalsOf(events));
