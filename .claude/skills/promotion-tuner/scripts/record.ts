/**
 * Comparison archive for decision-rule replays: every reported comparison from campaigns opened
 * since a release tag or date, reduced to per-solve validity, objective, billed dollars, turns and
 * seconds. Forked campaigns inherit parent comparisons, so `once` keeps each in the earliest
 * campaign that recorded it.
 */
import { epochsOf } from "#src/campaign/climb.ts";
import { startOf } from "#src/campaign/comparison.ts";
import { judgeIn, objectiveRuleIn, type Paired } from "#src/kernel/compare.ts";
import { familiesOf } from "#src/kernel/history.ts";
import { type LogEvent, read, TRACE_KINDS } from "#src/kernel/log.ts";
import { lastReports, pairsReported, type Reported } from "#src/kernel/reports.ts";
import { solvesIn } from "#src/kernel/solves.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { gitText } from "#src/meta/git.ts";
import { isNumber, isString, type JsonObject } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { dirname } from "#src/meta/path.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { packOf } from "#tools/runs/registry.ts";
import { campaignLogs, rehearsed } from "#skills/main/logs.ts";

export interface Solve {
  readonly valid: boolean;
  readonly measure: number | null;
  readonly billed: number | null;
  readonly turns: number | null;
  readonly seconds: number | null;
}

export interface Task {
  readonly task: string;
  readonly family: string | null;
  readonly direction: "lower" | "higher" | null;
  readonly scale?: "unit";
  readonly judged?: Paired["judged"];
  readonly retained: boolean;
  readonly old: readonly Solve[];
  readonly fresh: readonly Solve[];
}

export interface Comparison {
  readonly campaign: string;
  readonly pack: string;
  readonly opened: number;
  readonly session: string;
  /** A candidate against the reference, the reference against the starter, or a dedicated A/A noise run. */
  readonly kind: "candidate" | "starter" | "noise";
  readonly old: string;
  readonly fresh: string;
  readonly level: number;
  readonly reading: string;
  readonly tasks: readonly Task[];
  /** The reference against itself on halves of its solves, empty under two solves a side. */
  readonly aa: readonly Task[];
  readonly after: { readonly promoted: readonly string[]; readonly readings: number };
  /** Whether the promotion this comparison's step made was confirmed by its starter read
   *  (`epochsOf`); null where the next promotion is of another harness, there is none, or no
   *  starter read reported. */
  readonly confirmed: boolean | null;
}

const AT = '{"at":"';

const numberOr = (value: unknown) => (isNumber(value) ? value : null);

export function paired(task: Task): Paired {
  const { direction, scale, old, fresh } = task;
  return {
    task: task.task,
    old: old.map(({ valid }) => valid),
    fresh: fresh.map(({ valid }) => valid),
    used: {
      old: old.map(({ billed }) => ({ billed })),
      fresh: fresh.map(({ billed }) => ({ billed })),
    },
    ...keyIfDefined(
      "objective",
      direction === null
        ? undefined
        : {
            direction,
            ...keyIfDefined("scale", scale),
            old: old.map(({ measure }) => measure),
            fresh: fresh.map(({ measure }) => measure),
          },
    ),
    ...keyIfDefined("judged", task.judged),
  };
}

function taskOf(
  pair: Paired,
  retained: ReadonlySet<string>,
  ends: Map<string, JsonObject | null>,
  families: ReadonlyMap<string, string | null>,
): Task {
  const side = (which: "old" | "fresh"): Solve[] =>
    pair[which].map((valid, at) => {
      const end = ends.get(pair.solves?.[which][at] ?? "");
      return {
        valid,
        measure: numberOr(pair.objective?.[which][at]),
        billed: numberOr(pair.used?.[which][at]?.billed),
        turns: numberOr(end?.turns),
        seconds: numberOr(end?.seconds),
      };
    });
  return {
    task: pair.task,
    family: families.get(pair.task) ?? null,
    direction: pair.objective?.direction ?? null,
    ...keyIfDefined("scale", pair.objective?.scale),
    ...keyIfDefined("judged", pair.judged),
    retained: retained.has(pair.task),
    old: side("old"),
    fresh: side("fresh"),
  };
}

/** The reference's halves mirrored as `comparison.ts` reads them (`halves: "mirrored"`, with the
 *  report's objective and judge); null at an odd count of solves. */
export function selfTerms(events: readonly LogEvent[], { session, data }: Reported) {
  const { old, setting, solves } = data;
  const start = startOf(events, session);
  const noise = start?.noise === true;
  if (!isString(old) || !isString(setting) || !isNumber(solves) || (!noise && solves % 2 !== 0)) return null;
  const sides = {
    old,
    fresh: old,
    setting,
    comparison: session,
    objective: objectiveRuleIn(data),
    judge: start === undefined ? undefined : judgeIn(start),
    halves: "mirrored" as const,
  };
  return { sides, solves: noise ? solves : solves / 2 };
}

export function readsStarter(events: readonly LogEvent[], { session, data }: Reported): boolean {
  return data.fresh === (startOf(events, session)?.starter ?? data.starter);
}

export const swapped = (task: Task): Task => ({
  ...task,
  old: task.fresh,
  fresh: task.old,
  ...keyIfDefined(
    "judged",
    task.judged && {
      weights: task.judged.weights,
      votes: task.judged.votes.map(({ fresh, old, judge, holistic }) => ({
        fresh: old,
        old: fresh,
        judge: -judge,
        holistic: -holistic,
      })),
    },
  ),
});

function comparisonsIn(name: string, events: readonly LogEvent[]): Comparison[] {
  const finished = new Map(solvesIn(events).map(({ id, end }) => [id, end]));
  const opened = Date.parse(events[0]?.at ?? "");
  const reports = lastReports(events);
  const families = familiesOf(events);
  const epochs = epochsOf(events);
  const promotions = events.flatMap(({ kind, data }, index) =>
    kind === "harness.promoted" && isString(data.harness) ? [{ index, harness: data.harness }] : [],
  );
  return reports.flatMap((report, at): Comparison[] => {
    const { old, fresh, reading, level } = report.data;
    const pairs = pairsReported(events, report);
    if (pairs.length === 0 || !isString(old) || !isString(fresh)) return [];
    const start = startOf(events, report.session) ?? {};
    const retained = new Set(Array.isArray(start.retained) ? start.retained.filter(isString) : []);
    const of = (pair: Paired) => taskOf(pair, retained, finished, families);
    const next = epochs.find(({ from }) => from > report.index);
    return [
      {
        campaign: name,
        pack: packOf(name),
        opened,
        session: report.session,
        kind: readsStarter(events, report) ? "starter" : old === fresh ? "noise" : "candidate",
        old,
        fresh,
        level: numberOr(level) ?? 0,
        reading: isString(reading) ? reading : "",
        tasks: pairs.map(of),
        aa: pairsReported(events, report, "old").map(of),
        after: {
          promoted: promotions.filter(({ index }) => index > report.index).map(({ harness }) => harness),
          readings: reports.length - at - 1,
        },
        confirmed:
          next?.reverted !== true && next?.reference === fresh && next.starter_read !== null
            ? next.confirmed
            : null,
      },
    ];
  });
}

export function once(comparisons: readonly Comparison[]): Comparison[] {
  const copies = Map.groupBy(
    comparisons.toSorted((one, other) => one.opened - other.opened),
    ({ old, fresh, tasks }) =>
      `${old}|${fresh}|${tasks
        .map(({ task }) => task)
        .toSorted()
        .join(",")}`,
  );
  return [...copies.values()].flatMap(([first]) => first ?? []);
}

/** The time `from` names: a release tag's commit, or a date. */
export function timeOf(from: string): number {
  const asDate = Date.parse(from);
  return Number.isNaN(asDate) ? Date.parse(gitText(".", "log", "-1", "--format=%cI", from)) : asDate;
}

async function readRecord(home: string | null, names: readonly string[], from: number) {
  const comparisons: Comparison[] = [];
  const unread: string[] = [];
  for (const { name, path } of await campaignLogs(home, names, "")) {
    const head = await Bun.file(path)
      .slice(0, AT.length + 24)
      .text();
    if (!(Date.parse(head.slice(AT.length)) >= from)) continue;
    try {
      const events = read(path, TRACE_KINDS);
      if (!rehearsed(events)) comparisons.push(...comparisonsIn(name, events));
    } catch (error) {
      unread.push(`${name}: ${errorMessage(error)}`);
    }
    Bun.gc(true);
  }
  return { comparisons, unread };
}

/** The record, from `file` where it is given and exists, else read from the logs and kept in
 *  `file`. */
export async function recordOf({
  file,
  home,
  names,
  from,
  refresh,
}: {
  readonly file: string | null;
  readonly home: string | null;
  readonly names: readonly string[];
  readonly from: number;
  readonly refresh: boolean;
}): Promise<{ comparisons: Comparison[]; unread: string[] }> {
  if (file !== null && !refresh && existsSync(file)) {
    // SAFETY: only this function writes the file, from these types.
    const kept = JSON.parse(readFileSync(file, "utf8")) as Comparison[];
    return { comparisons: kept.filter(({ opened }) => opened >= from), unread: [] };
  }
  const { comparisons, unread } = await readRecord(home, names, from);
  if (file !== null) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(comparisons));
  }
  return { comparisons, unread };
}
