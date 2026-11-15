/**
 * What each Examiner writing session could read and what it wrote, one block a session, then how
 * each side of every comparison measured on the tasks each session wrote, against the best answer
 * its author has on record:
 *
 *   bun tools/wri/wri.ts reader aim --log <log>
 *
 * Lanes 11, 28 and 31 ask whether the tasks written after a promotion were written against the
 * reference in force, and a starter read pools them with the rest. Between 3 and 10 November 14 of
 * 18 lane-11 sessions joined each session's tasks to the comparisons' solves by hand, about 30 calls,
 * and the three best reports of 9 and 10 November each built the measure against the author's best
 * by writing session and harness in a scratch script, since validity read every solve valid there.
 * One esp32 report took the writer from `task.feasible.session`, which a later session's
 * `try_answer` on an earlier task also writes; the writer here is the proposal's (`proposalsOf`).
 *
 * A session's block gives its span against each promotion: the reference at its start and at its
 * end, since a continued conversation can span one, the last comparison reported before it, the
 * conversation it continues, whether the reference's copy lay in its home, its `try_reference`
 * calls and the harness each try was solved under, its shell calls that name the copy's folder,
 * the tasks the gate admitted, and the comparisons that later tallied them, starter reads named
 * apart. The table gives, per writer and harness, the valid solves, how many reached the author's
 * best within the floor (`gapAgainst`, `ROOM`), and the median of measure over best where both are
 * positive. It prints counts and digest prefixes, never a measure, an answer or a task, and no
 * column says what a session aimed at: that is the lane's reading. A field an older log's code did
 * not write reads `not recorded`.
 */
import { epochsOf, tasksByEpoch } from "#src/campaign/climb.ts";
import { REFERENCE_HOME } from "#src/examiner/shell.ts";
import { gapAgainst, type Paired } from "#src/kernel/compare.ts";
import { conditionsOf } from "#src/kernel/condition.ts";
import { proposalsOf } from "#src/kernel/history.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { lastReports, pairsReported, type Reported, taskRecords } from "#src/kernel/reports.ts";
import { solvesIn } from "#src/kernel/solves.ts";
import { type Call, tracesIn } from "#src/kernel/trace.ts";
import { asRecord, isBoolean, isString, type JsonObject } from "#src/meta/json-shape.ts";
import { median } from "#src/meta/tally.ts";

/** A comparison's last report with the pairs it tallied. */
interface PairedReport {
  readonly report: Reported;
  readonly pairs: readonly Paired[];
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
  /** Null where the log does not record it. */
  readonly referenceHome: boolean | null;
  readonly tryCalls: number | null;
  /** The solves it asked for, by the harness each ran under. */
  readonly tries: ReadonlyMap<string, number>;
  /** Its shell calls naming the reference's folder, of all its shell calls; null where no call is traced. */
  readonly referenceShell: { readonly naming: number; readonly of: number } | null;
  readonly proposed: readonly string[];
  readonly admitted: readonly string[];
  /** Each comparison that later tallied any of its admitted tasks, and how many. */
  readonly scoredIn: readonly {
    readonly comparison: string;
    readonly tasks: number;
    readonly starterRead: boolean;
  }[];
}

/** What `examSessionsOf` reads once for every session. */
interface Gathered {
  readonly epochs: ReturnType<typeof epochsOf>;
  readonly admitted: ReadonlySet<string>;
  readonly proposals: ReturnType<typeof proposalsOf>;
  readonly starterReads: ReadonlySet<string>;
  readonly calls: readonly Call[];
  readonly anyTry: boolean;
  /** Each solve's harness, by the session or comparison its start names. */
  readonly tries: ReadonlyMap<string, readonly string[]>;
  readonly reported: readonly PairedReport[];
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

const OPENING = "the opening exam";
const NOT_RECORDED = "not recorded";

/** A harness by its digest's prefix, the starter marked where the reports name one. */
const labelOf = (digest: string, starter: string | null) =>
  `${digest === "starter" ? digest : digest.slice(0, 8)}${digest === starter ? " starter" : ""}`;

/** The pairs every comparison's last report tallied, read once. */
function pairedReports(events: readonly LogEvent[]): PairedReport[] {
  return lastReports(events).map((report) => ({ report, pairs: pairsReported(events, report) }));
}

/** The reference in force at event `index`, by the epochs of the climb. */
function referenceAt(epochs: ReturnType<typeof epochsOf>, index: number): string {
  return epochs.findLast(({ from }) => from <= index)?.reference ?? "starter";
}

function readOnce(events: readonly LogEvent[], reported: readonly PairedReport[]): Gathered {
  const epochs = epochsOf(events);
  const calls = tracesIn(events).flatMap((each) =>
    each.seat === "exam" && each.part === "call" ? [each] : [],
  );
  // An Examiner's tries are no counted solve (`countedSolves`), so they are read with their
  // conditions here rather than through `ranUnder`, which leaves them out.
  const conditions = conditionsOf(events);
  const tries = Map.groupBy(solvesIn(events), ({ start }) =>
    isString(start.comparison) ? start.comparison : "",
  );
  return {
    epochs,
    admitted: new Set(tasksByEpoch(events).flat()),
    proposals: proposalsOf(events),
    starterReads: new Set(epochs.flatMap(({ starter_read: found }) => (found === null ? [] : [found]))),
    calls,
    anyTry: calls.some(({ tool }) => tool === "try_reference"),
    tries: new Map(
      [...tries].map(([named, solves]) => [
        named,
        solves.map(({ condition }) => conditions.get(condition)?.harness ?? NOT_RECORDED),
      ]),
    ),
    reported,
  };
}

/** One session of `events`, whose start is at `index`. */
function sessionAt(events: readonly LogEvent[], index: number, session: string, log: Gathered): ExamSession {
  const data: JsonObject = events[index]?.data ?? {};
  const end = events.findIndex(
    (event, at) => at > index && event.kind === "exam.finished" && event.data.session === session,
  );
  const until = end === -1 ? events.length : end;
  const ended = events[end]?.data.ended;
  const proposed = log.proposals.filter((each) => each.session === session).map(({ version }) => version);
  const admitted = proposed.filter((version) => log.admitted.has(version));
  const own = log.calls.filter(({ id }) => id === session);
  const shells = own.filter(({ tool }) => tool === "bash");
  const lastReport = events.findLast(
    (event, at) => at < index && event.kind === "comparison.reported" && isString(event.data.session),
  )?.data.session;
  const tries = new Map<string, number>();
  for (const harness of log.tries.get(session) ?? []) tries.set(harness, (tries.get(harness) ?? 0) + 1);
  return {
    session,
    conversation: isString(data.conversation) ? data.conversation : null,
    started: index + 1,
    finished: end === -1 ? null : end + 1,
    ended: end === -1 ? null : isString(ended) ? ended : NOT_RECORDED,
    reference: {
      start: referenceAt(log.epochs, index),
      finish: end === -1 ? null : referenceAt(log.epochs, end),
    },
    promotedWithin: events.flatMap((event, at) =>
      at > index && at < until && event.kind === "harness.promoted" && isString(event.data.harness)
        ? [event.data.harness]
        : [],
    ),
    lastReport: isString(lastReport) ? lastReport : null,
    referenceHome: isBoolean(data.referenceHome) ? data.referenceHome : null,
    tryCalls: log.anyTry ? own.filter(({ tool }) => tool === "try_reference").length : null,
    tries,
    referenceShell:
      log.calls.length === 0
        ? null
        : {
            naming: shells.filter(({ args }) => {
              const command = isString(args) ? args : asRecord(args)?.command;
              return isString(command) && command.includes(REFERENCE_HOME);
            }).length,
            of: shells.length,
          },
    proposed,
    admitted,
    scoredIn: log.reported.flatMap(({ report, pairs }) => {
      const tasks = pairs.filter(({ task }) => admitted.includes(task)).length;
      return tasks === 0
        ? []
        : [{ comparison: report.session, tasks, starterRead: log.starterReads.has(report.session) }];
    }),
  };
}

/** Every Examiner writing session of `events`, in the order they started: what each could read
 *  (the reference in force, the last report, its home, its tries and shell calls) and what it wrote
 *  (tasks proposed and admitted, and the comparisons that tallied them). */
export function examSessionsOf(
  events: readonly LogEvent[],
  reported: readonly PairedReport[] = pairedReports(events),
): ExamSession[] {
  const log = readOnce(events, reported);
  return events.flatMap(({ kind, data }, index) =>
    kind === "exam.started" && isString(data.session) ? [sessionAt(events, index, data.session, log)] : [],
  );
}

function sessionLines(each: ExamSession, starter: string | null): string[] {
  const { reference, referenceShell, tryCalls } = each;
  const label = (digest: string) => labelOf(digest, starter);
  const finish = reference.finish === null ? "no end on record" : `${label(reference.finish)} at its end`;
  const promoted =
    each.promotedWithin.length === 0
      ? "none promoted within"
      : `promoted within: ${each.promotedWithin.map(label).join(", ")}`;
  const tries =
    [...each.tries].map(([harness, count]) => `${String(count)} under ${label(harness)}`).join(", ") ||
    "none";
  const shell =
    referenceShell === null
      ? NOT_RECORDED
      : `${String(referenceShell.naming)} of ${String(referenceShell.of)}`;
  const scored =
    each.scoredIn
      .map(
        ({ comparison, tasks, starterRead }) =>
          `${comparison}${starterRead ? " (starter read)" : ""} ${String(tasks)}`,
      )
      .join(", ") || "none";
  const span = each.finished === null ? "open" : `${String(each.finished)} (${each.ended ?? NOT_RECORDED})`;
  return [
    `${each.session}: ${each.conversation === null ? "opens a conversation" : `continues ${each.conversation}`}; lines ${String(each.started)} to ${span}; reference ${label(reference.start)} at its start, ${finish}; ${promoted}; last report before it: ${each.lastReport ?? "none"}`,
    `  reference copy in its home: ${String(each.referenceHome ?? NOT_RECORDED)}; try_reference calls: ${tryCalls === null ? NOT_RECORDED : String(tryCalls)}; tries solved: ${tries}; shell calls naming ${REFERENCE_HOME}/: ${shell}`,
    `  admitted ${String(each.admitted.length)} of ${String(each.proposed.length)} proposed; tallied later in: ${scored}`,
  ];
}

/** One side of one pair added to its writer's and harness's row. */
function tick(row: Measured, pair: Paired, side: "old" | "fresh", best: number | null): void {
  const rule = pair.objective;
  if (rule === undefined) return;
  row.tasks.add(pair.task);
  row.valid += pair[side].filter(Boolean).length;
  row.invalid += pair[side].filter((valid) => !valid).length;
  for (const measure of rule[side]) {
    if (measure === null || best === null) continue;
    row.againstBest += 1;
    // One solve's measure alone against the author's, so the floor is read by its owner.
    const alone: Paired = { ...pair, objective: { ...rule, [side]: [measure] } };
    if (!gapAgainst(alone, side, [best])) row.atBest += 1;
    if (best > 0 && measure >= 0) row.ratios.push(measure / best);
  }
}

/** Each side's valid measures against the author's best, by writer and harness. */
function measuredOf(events: readonly LogEvent[], reported: readonly PairedReport[]): Measured[] {
  const writers = new Map(proposalsOf(events).map(({ version, session }) => [version, session ?? OPENING]));
  const bests = new Map(taskRecords(events).records.map(({ version, best }) => [version, best]));
  const rows = new Map<string, Measured>();
  for (const { report, pairs } of reported) {
    const starter = isString(report.data.starter) ? report.data.starter : null;
    for (const pair of pairs) {
      const writer = writers.get(pair.task) ?? OPENING;
      for (const side of ["old", "fresh"] as const) {
        const digest = report.data[side];
        if (!isString(digest) || pair.objective === undefined) continue;
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
        row.comparisons.add(report.session);
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
  const reported = pairedReports(events);
  const sessions = examSessionsOf(events, reported);
  if (sessions.length === 0) return ["aim: the log holds no Examiner writing session"];
  const starter = reported.map(({ report }) => report.data.starter).find(isString) ?? null;
  const unrecorded = sessions.some(
    ({ referenceHome, tryCalls, referenceShell }) =>
      referenceHome === null || tryCalls === null || referenceShell === null,
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
