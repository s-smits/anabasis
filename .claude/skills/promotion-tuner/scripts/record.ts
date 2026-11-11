/**
 * The record a mechanism is tried on: every reported comparison of the campaigns opened since a
 * release, reduced to what a score or a test can read of a solve (validity, the objective's measure,
 * dollars, turns, seconds), through this checkout's readers of the log. A fork carries its parent's
 * comparisons, so each counts once, in the campaign that opened first: counted once for each copy,
 * jobstat's solves read 1,800 where they were 1,400.
 *
 * It holds objective measures, which are exam-side, so a file written by `--record` goes under the
 * ignored `data/derived/` and out of every prompt, pull request and paste.
 */
import { startOf } from "#src/campaign/comparison.ts";
import { objectiveRuleIn, pairsOf, type Paired } from "#src/kernel/compare.ts";
import { failWrongPasses, wrongPasses } from "#src/kernel/history.ts";
import { type EventKind, type LogEvent, read } from "#src/kernel/log.ts";
import { lastReports, pairsReported, type Reported } from "#src/kernel/reports.ts";
import { solvesIn } from "#src/kernel/solves.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { gitText } from "#src/meta/git.ts";
import { asRecord, isNumber, isString, type JsonObject } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { dirname } from "#src/meta/path.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { packOf } from "#tools/runs/registry.ts";
import { campaignLogs, rehearsed } from "#skills/main/logs.ts";

/** One counted solve of one side. */
export interface Solve {
  readonly valid: boolean;
  readonly measure: number | null;
  readonly billed: number | null;
  readonly turns: number | null;
  readonly seconds: number | null;
}

/** One task of a comparison, each side's counted solves in the order they started. */
export interface Task {
  readonly task: string;
  readonly direction: "lower" | "higher" | null;
  readonly retained: boolean;
  readonly old: readonly Solve[];
  readonly fresh: readonly Solve[];
}

export interface Comparison {
  readonly campaign: string;
  /** The campaign's pack, read from its name by `packOf`. */
  readonly pack: string;
  /** When the campaign opened, in milliseconds. */
  readonly opened: number;
  readonly session: string;
  /** A candidate against the reference, or the reference against the starter, read the other way. */
  readonly kind: "candidate" | "starter";
  readonly old: string;
  readonly fresh: string;
  readonly level: number;
  readonly reading: string;
  readonly tasks: readonly Task[];
  /** The reference against itself on halves of its solves, empty under two solves a side. */
  readonly aa: readonly Task[];
  /** What the campaign did after this report, for what became of a step a replay adds. */
  readonly after: { readonly promoted: readonly string[]; readonly readings: number };
}

/** How a log's first line opens, before its event's time. */
const AT = '{"at":"';
/** Kinds no score reads and the largest logs are mostly made of. */
const UNREAD: ReadonlySet<EventKind> = new Set<EventKind>([
  "solve.call",
  "build.call",
  "build.turn",
  "draft.call",
  "draft.turn",
  "exam.turn",
  "referee.turn",
  "referee.call",
]);

const numberOr = (value: unknown) => (isNumber(value) ? value : null);

/** The new side's pair as production reads it (`pointsOf`). */
export function paired(task: Task): Paired {
  const { direction, old, fresh } = task;
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
        : { direction, old: old.map(({ measure }) => measure), fresh: fresh.map(({ measure }) => measure) },
    ),
  };
}

/** A pair as a task of the record, with each solve's turns and seconds from its ending (`solvesIn`). */
function taskOf(pair: Paired, retained: ReadonlySet<string>, ends: Map<string, JsonObject | null>): Task {
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
    direction: pair.objective?.direction ?? null,
    retained: retained.has(pair.task),
    old: side("old"),
    fresh: side("fresh"),
  };
}

/** What a report's A/A read, the reference against itself (`itself`, `comparison.ts`): null at an odd
 *  count of solves. */
export function selfTerms({ session, data }: Reported) {
  const { old, setting, solves } = data;
  if (!isString(old) || !isString(setting) || !isNumber(solves) || solves % 2 !== 0) return null;
  const sides = {
    old,
    fresh: old,
    setting,
    comparison: session,
    objective: objectiveRuleIn(data),
    halves: "mirrored" as const,
  };
  return { sides, solves: solves / 2 };
}

function selfPairs(events: readonly LogEvent[], report: Reported, versions: readonly string[]): Paired[] {
  const terms = selfTerms(report);
  if (terms === null) return [];
  const wrong = wrongPasses(asRecord(asRecord(report.data.settled)?.passes) ?? {});
  const before = failWrongPasses(events.slice(0, report.index + 1), wrong);
  return pairsOf(before, versions, terms.sides, terms.solves).pairs;
}

/** One campaign's reported comparisons that scored a task. */
export function comparisonsIn(name: string, events: readonly LogEvent[]): Comparison[] {
  const finished = new Map(solvesIn(events).map(({ id, end }) => [id, end]));
  const opened = Date.parse(events[0]?.at ?? "");
  const reports = lastReports(events);
  const promotions = events.flatMap(({ kind, data }, index) =>
    kind === "harness.promoted" && isString(data.harness) ? [{ index, harness: data.harness }] : [],
  );
  return reports.flatMap((report, at): Comparison[] => {
    const { old, fresh, reading, level } = report.data;
    const pairs = pairsReported(events, report);
    if (pairs.length === 0 || !isString(old) || !isString(fresh)) return [];
    const start = startOf(events, report.session) ?? {};
    const retained = new Set(Array.isArray(start.retained) ? start.retained.filter(isString) : []);
    const starter = start.starter ?? report.data.starter;
    const versions = pairs.map(({ task }) => task);
    const of = (pair: Paired) => taskOf(pair, retained, finished);
    return [
      {
        campaign: name,
        pack: packOf(name),
        opened,
        session: report.session,
        kind: fresh === starter ? "starter" : "candidate",
        old,
        fresh,
        level: numberOr(level) ?? 0,
        reading: isString(reading) ? reading : "",
        tasks: pairs.map(of),
        aa: selfPairs(events, report, versions).map(of),
        after: {
          promoted: promotions.filter(({ index }) => index > report.index).map(({ harness }) => harness),
          readings: reports.length - at - 1,
        },
      },
    ];
  });
}

/** `comparisons` with a fork's copies dropped, each kept in the campaign that opened first. */
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

/** The reduced record of the campaigns opened at or after `from`, and the logs it could not read. */
async function readRecord(home: string | null, names: readonly string[], from: number) {
  const comparisons: Comparison[] = [];
  const unread: string[] = [];
  for (const { name, path } of await campaignLogs(home, names, "")) {
    const head = await Bun.file(path)
      .slice(0, AT.length + 24)
      .text();
    if (!(Date.parse(head.slice(AT.length)) >= from)) continue;
    try {
      const events = read(path, UNREAD);
      if (!rehearsed(events)) comparisons.push(...comparisonsIn(name, events));
    } catch (error) {
      unread.push(`${name}: ${errorMessage(error)}`);
    }
    Bun.gc(true);
  }
  return { comparisons, unread };
}

/** The record, from `file` where it is given and exists, and read from the logs otherwise, then kept
 *  in `file`. */
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
