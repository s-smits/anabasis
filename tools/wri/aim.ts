/**
 * What each Examiner writing session could read and what it wrote, one block a session, then how
 * each side of every comparison measured on the tasks each session wrote, against the best answer
 * its author has on record:
 *
 *   bun tools/wri/wri.ts reader aim --log <log>
 *
 * Lanes 17, 19 and 20 ask whether the tasks written after a promotion were written against the
 * reference in force, and a starter read pools them with the rest. Without it a lane 20 session
 * joins each session's tasks to the comparisons' solves by hand, in dozens of calls, and builds the
 * measure against the author's best by writing session and harness in a scratch script, since
 * validity reads every solve valid there. A writer taken from `task.feasible.session`, which a later
 * session's `try_answer` on an earlier task also writes; the writer here is the proposal's
 * (`proposalsOf`).
 *
 * A session's block gives its span against each promotion: the reference at its start and at its
 * end, since a continued conversation can span one, the last comparison reported before it, the
 * conversation it continues, whether the reference's copy lay in its home and its shell calls
 * that name the copy's folder (both read in logs of the code that laid the copy), its
 * `try_reference` calls and the harness each try was solved under,
 * the tasks the gate admitted, and the comparisons that later tallied them, starter reads named
 * apart. The table gives, per writer and harness, the valid solves, how many reached the author's
 * best within the floor (`gapAgainst`, `GAP_FLOOR`), and the median of measure over best where both are
 * positive. It prints counts and digest prefixes, never a measure, an answer or a task, and no
 * column says what a session aimed at: that is the lane's reading. A field an older log's code did
 * not write reads `not recorded`.
 */
import { epochsOf, tasksByEpoch } from "#src/campaign/climb.ts";
import { gainOver, gapAgainst, type Paired } from "#src/kernel/compare.ts";
import { OPENING, proposalsOf, writersOf } from "#src/kernel/history.ts";
import { eventsOf, type LogEvent } from "#src/kernel/log.ts";
import { poolOf } from "#src/kernel/reports.ts";
import { type Call, callsOf } from "#src/kernel/trace.ts";
import { asRecord, isNumber, isString, type JsonObject } from "#src/meta/json-shape.ts";
import { countBy, median } from "#src/meta/tally.ts";
import { type Index, indexOf } from "./folds.ts";

/** Where a writing session's home held the reference harness, under code that laid a copy there. */
const REFERENCE_HOME = "reference-harness";

/** A comparison's last report with the pairs it tallied. */
interface PairedReport {
  readonly session: string;
  readonly data: JsonObject;
  readonly pairs: readonly Paired[];
}

interface KeyedEvent {
  readonly index: number;
  readonly value: string;
  readonly data: JsonObject;
}

/** One Examiner writing session (an ask, `exam.started`), as the log records it. */
interface ExamSession {
  readonly session: string;
  /** The conversation it continues, null where it opened one. */
  readonly conversation: string | null;
  /** Its start and its end by line of the log (from 1), null while no end is on record. */
  readonly started: number;
  readonly finished: number | null;
  readonly ended: string | null;
  /** The reference in force at its start and at its end, by digest, or "starter". */
  readonly reference: { readonly start: string; readonly finish: string | null };
  /** Harnesses promoted between its start and its end. */
  readonly promotedWithin: readonly string[];
  /** The last comparison reported before its start. */
  readonly lastReport: string | null;
  /** Whether its home held the reference's copy, which `exam.started` recorded under code that laid
   *  one; a log without the field was written by code that laid none. */
  readonly referenceHome: boolean;
  readonly tryCalls: number | null;
  /** The solves it asked for, by the harness each ran under. */
  readonly tries: ReadonlyMap<string, number>;
  /** Its shell calls naming the reference's folder, of all its shell calls; null where no call is traced. */
  readonly referenceShell: { readonly naming: number; readonly of: number } | null;
  readonly proposed: readonly string[];
  readonly admitted: readonly string[];
  /** Distinct families across admitted tasks and the largest family's count (wall-safe: no names). */
  readonly familySpread: { readonly distinct: number; readonly top: number };
  /** Authoring tool friction: `try_answer` calls/errors and `bash` errors. */
  readonly friction: { readonly tryAnswers: number; readonly tryErrors: number; readonly bashErrors: number };
  /** Session billed dollars recorded on `exam.finished`, null when unrecorded. */
  readonly billed: number | null;
  /** Each comparison that later tallied any of its admitted tasks, and how many. */
  readonly scoredIn: readonly {
    readonly comparison: string;
    readonly tasks: number;
    readonly starterRead: boolean;
  }[];
}

/** What `examSessionsOf` reads once for every session. */
interface Gathered {
  readonly total: number;
  readonly epochs: ReturnType<typeof epochsOf>;
  readonly admitted: ReadonlySet<string>;
  readonly proposalsBy: ReadonlyMap<string | null, readonly ReturnType<typeof proposalsOf>[number][]>;
  readonly starterReads: ReadonlySet<string>;
  readonly callsBy: ReadonlyMap<string, readonly Call[]>;
  readonly anyCall: boolean;
  readonly anyTry: boolean;
  /** Each solve's harness, by the session or comparison its start names. */
  readonly tries: ReadonlyMap<string, readonly string[]>;
  readonly reported: readonly PairedReport[];
  readonly finishedBy: ReadonlyMap<string, readonly KeyedEvent[]>;
  readonly reports: readonly KeyedEvent[];
  readonly promoted: readonly KeyedEvent[];
}

/** Per writer and harness, over every comparison's tallied pairs. */
interface Measured {
  readonly writer: string;
  readonly harness: string;
  readonly tasks: Set<string>;
  readonly comparisons: Set<string>;
  valid: number;
  invalid: number;
  /** Valid solves with a measure on a task whose author has a best on record. */
  againstBest: number;
  atBest: number;
  readonly ratios: number[];
}

const NOT_RECORDED = "not recorded";
const str = (value: unknown): string | null => (isString(value) ? value : null);
const orNone = (value: string): string => (value === "" ? "none" : value);
const keyed = (events: readonly LogEvent[], kind: LogEvent["kind"], field: "session" | "harness") =>
  eventsOf(events, kind).flatMap(({ index, event: { data } }) => {
    const value = data[field];
    return isString(value) ? [{ index, value, data }] : [];
  });

/** A harness by its digest's prefix, the starter marked where the reports name one. */
const labelOf = (digest: string, starter: string | null) =>
  `${digest === "starter" ? digest : digest.slice(0, 8)}${digest === starter ? " starter" : ""}`;

/** The reference in force at event `index`, by the epochs of the climb. */
function referenceAt(epochs: ReturnType<typeof epochsOf>, index: number): string {
  return epochs.findLast(({ from }) => from <= index)?.reference ?? "starter";
}

function readOnce(
  log: Index,
  reported: readonly PairedReport[],
): { readonly gathered: Gathered; readonly starts: readonly KeyedEvent[] } {
  const { events } = log;
  const epochs = epochsOf(events);
  const calls = callsOf(log.traces, "exam");
  const tries = Map.groupBy(log.solves, ({ comparison }) => comparison ?? "");
  return {
    starts: keyed(events, "exam.started", "session"),
    gathered: {
      total: events.length,
      epochs,
      admitted: new Set(tasksByEpoch(events).flat()),
      proposalsBy: Map.groupBy(proposalsOf(events), ({ session }) => session),
      starterReads: new Set(epochs.flatMap(({ starter_read: found }) => (found === null ? [] : [found]))),
      callsBy: Map.groupBy(calls, ({ id }) => id),
      anyCall: calls.length > 0,
      anyTry: calls.some(({ tool }) => tool === "try_reference"),
      tries: new Map(
        [...tries].map(([named, solves]) => [
          named,
          solves.map(({ condition }) => log.conditions.get(condition)?.harness ?? NOT_RECORDED),
        ]),
      ),
      reported,
      finishedBy: Map.groupBy(keyed(events, "exam.finished", "session"), ({ value }) => value),
      reports: keyed(events, "comparison.reported", "session"),
      promoted: keyed(events, "harness.promoted", "harness"),
    },
  };
}

/** One session of `events`, whose start is at `started`. */
function sessionAt(started: KeyedEvent, log: Gathered): ExamSession {
  const { index, value: session, data } = started;
  const endRow = log.finishedBy.get(session)?.find((each) => each.index > index);
  const until = endRow === undefined ? log.total : endRow.index;
  const proposedRows = log.proposalsBy.get(session) ?? [];
  const proposed = proposedRows.map(({ version }) => version);
  const admitted = proposed.filter((version) => log.admitted.has(version));
  const admittedSet = new Set(admitted);
  const famCounts = Object.values(
    countBy(
      proposedRows.filter(({ version, family }) => admittedSet.has(version) && isString(family)),
      ({ family }) => family ?? "",
    ),
  );
  const own = log.callsBy.get(session) ?? [];
  const shells = own.filter(({ tool }) => tool === "bash");
  const tryAnswers = own.filter(({ tool }) => tool === "try_answer");
  const tries = new Map<string, number>();
  for (const harness of log.tries.get(session) ?? []) tries.set(harness, (tries.get(harness) ?? 0) + 1);
  return {
    session,
    conversation: str(data.conversation),
    started: index + 1,
    finished: endRow === undefined ? null : endRow.index + 1,
    ended: endRow === undefined ? null : (str(endRow.data.ended) ?? NOT_RECORDED),
    reference: {
      start: referenceAt(log.epochs, index),
      finish: endRow === undefined ? null : referenceAt(log.epochs, endRow.index),
    },
    promotedWithin: log.promoted
      .filter((each) => each.index > index && each.index < until)
      .map(({ value }) => value),
    lastReport: log.reports.findLast((each) => each.index < index)?.value ?? null,
    referenceHome: data.referenceHome === true,
    tryCalls: log.anyTry ? own.filter(({ tool }) => tool === "try_reference").length : null,
    tries,
    referenceShell: log.anyCall
      ? {
          naming: shells.filter(({ args }) => {
            const command = str(args) ?? str(asRecord(args)?.command);
            return command?.includes(REFERENCE_HOME) === true;
          }).length,
          of: shells.length,
        }
      : null,
    proposed,
    admitted,
    familySpread: { distinct: famCounts.length, top: Math.max(0, ...famCounts) },
    friction: {
      tryAnswers: tryAnswers.length,
      tryErrors: tryAnswers.filter(({ isError }) => isError).length,
      bashErrors: shells.filter(({ isError }) => isError).length,
    },
    billed: isNumber(endRow?.data.billed) ? endRow.data.billed : null,
    scoredIn: log.reported.flatMap(({ session: comparison, pairs }) => {
      const tasks = pairs.filter(({ task }) => admittedSet.has(task)).length;
      return tasks === 0 ? [] : [{ comparison, tasks, starterRead: log.starterReads.has(comparison) }];
    }),
  };
}

function sessionLines(each: ExamSession, starter: string | null): string[] {
  const { reference, referenceShell, tryCalls } = each;
  const label = (digest: string) => labelOf(digest, starter);
  const finish = reference.finish === null ? "no end on record" : `${label(reference.finish)} at its end`;
  const promoted =
    each.promotedWithin.length === 0
      ? "none promoted within"
      : `promoted within: ${each.promotedWithin.map(label).join(", ")}`;
  const tries = orNone(
    [...each.tries].map(([harness, count]) => `${String(count)} under ${label(harness)}`).join(", "),
  );
  const shell =
    referenceShell === null
      ? NOT_RECORDED
      : `${String(referenceShell.naming)} of ${String(referenceShell.of)}`;
  const scored = orNone(
    each.scoredIn
      .map(
        ({ comparison, tasks, starterRead }) =>
          `${comparison}${starterRead ? " (starter read)" : ""} ${String(tasks)}`,
      )
      .join(", "),
  );
  const span = each.finished === null ? "open" : `${String(each.finished)} (${each.ended ?? NOT_RECORDED})`;
  const perHeld =
    each.billed !== null && each.admitted.length > 0
      ? ` ($${(each.billed / each.admitted.length).toFixed(2)}/held)`
      : " (zero-yield)";
  const costPart = each.billed === null ? "billed n/a" : `billed $${each.billed.toFixed(2)}${perHeld}`;
  const famPart =
    each.familySpread.distinct === 0
      ? "families none"
      : `${String(each.familySpread.distinct)} families (largest ${String(each.familySpread.top)}/${String(each.admitted.length)})`;
  return [
    `${each.session}: ${each.conversation === null ? "opens a conversation" : `continues ${each.conversation}`}; lines ${String(each.started)} to ${span}; reference ${label(reference.start)} at its start, ${finish}; ${promoted}; last report before it: ${each.lastReport ?? "none"}`,
    `  reference copy in its home: ${String(each.referenceHome)}; try_reference calls: ${tryCalls === null ? NOT_RECORDED : String(tryCalls)}; tries solved: ${tries}; shell calls naming ${REFERENCE_HOME}/: ${shell}; try_answer ${String(each.friction.tryAnswers)} (${String(each.friction.tryErrors)} err), bash err ${String(each.friction.bashErrors)}`,
    `  admitted ${String(each.admitted.length)} of ${String(each.proposed.length)} proposed (${famPart}; ${costPart}); tallied later in: ${scored}`,
  ];
}

/** One side of one pair added to its writer's and harness's row. */
function tick(row: Measured, pair: Paired, side: "old" | "fresh", best: number | null): void {
  const rule = pair.objective;
  if (rule === undefined) return;
  row.tasks.add(pair.task);
  for (const ok of pair[side]) {
    if (ok) row.valid += 1;
    else row.invalid += 1;
  }
  for (const measure of rule[side]) {
    if (measure === null || best === null) continue;
    row.againstBest += 1;
    // One solve's measure alone against the author's, so the floor is read by its owner.
    const alone: Paired = { ...pair, objective: { ...rule, [side]: [measure] } };
    if (!gapAgainst(alone, side, [best])) row.atBest += 1;
    if (rule.scale === "unit") row.ratios.push(1 - gainOver(rule, best, measure));
    else if (best > 0 && measure >= 0) row.ratios.push(measure / best);
  }
}

/** Each side's valid measures against the author's best, by writer and harness. */
function measuredOf(events: readonly LogEvent[], reported: readonly PairedReport[]): Measured[] {
  const writers = writersOf(events);
  const bests = poolOf(events).bests;
  const rows = new Map<string, Measured>();
  for (const { session, data, pairs } of reported) {
    const starter = str(data.starter);
    for (const pair of pairs) {
      const writer = writers.get(pair.task) ?? OPENING;
      for (const side of ["old", "fresh"] as const) {
        const digest = str(data[side]);
        if (digest === null || pair.objective === undefined) continue;
        const harness = labelOf(digest, starter);
        const key = `${writer} ${harness}`;
        const row = rows.get(key) ?? {
          writer,
          harness,
          tasks: new Set(),
          comparisons: new Set(),
          valid: 0,
          invalid: 0,
          againstBest: 0,
          atBest: 0,
          ratios: [],
        };
        rows.set(key, row);
        row.comparisons.add(session);
        tick(row, pair, side, bests.get(pair.task) ?? null);
      }
    }
  }
  return [...rows.values()];
}

function tableLines(rows: readonly Measured[], order: readonly string[]): string[] {
  if (rows.length === 0) return ["no comparison tallied a task under an objective"];
  const rank = (writer: string) => (writer === OPENING ? -1 : order.indexOf(writer));
  return [
    "writer, harness: tasks, valid solves (invalid), at the author's best within the floor of the valid measures on tasks with a best on record, median measure over best, comparisons",
    ...rows
      .toSorted((one, other) => rank(one.writer) - rank(other.writer))
      .map((row) => {
        const ratio = median(row.ratios);
        return `${row.writer}, ${row.harness}: ${String(row.tasks.size)} tasks, ${String(row.valid)} valid (${String(row.invalid)}), at best ${String(row.atBest)} of ${String(row.againstBest)}, median over best ${ratio === null ? "none" : ratio.toFixed(2)}, in ${[...row.comparisons].join(" ")}`;
      }),
  ];
}

/** The reader's whole output for one log. */
export function aimRows(events: readonly LogEvent[]): string[] {
  const log = indexOf(events);
  const reported = log.compared.map((each) => ({
    session: each.session,
    data: each.last,
    pairs: each.pairs(),
  }));
  const { starts, gathered } = readOnce(log, reported);
  const sessions = starts.map((started) => sessionAt(started, gathered));
  if (sessions.length === 0) return ["aim: the log holds no Examiner writing session"];
  const starter = reported.map(({ data }) => data.starter).find(isString) ?? null;
  const unrecorded = sessions.some(
    ({ tryCalls, referenceShell }) => tryCalls === null || referenceShell === null,
  );
  return [
    "aim: each Examiner writing session as the log records it, then each side's measures on the tasks each session wrote, against the author's best on record; counts and digest prefixes only",
    ...(unrecorded ? [`${NOT_RECORDED}: a field or call this log's code did not write`] : []),
    ...sessions.flatMap((each) => sessionLines(each, starter)),
    ...tableLines(
      measuredOf(events, reported),
      sessions.map(({ session }) => session),
    ),
  ];
}
