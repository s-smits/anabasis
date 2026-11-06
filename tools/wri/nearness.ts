/**
 * How alike an exam's tasks read, for an investigator asking whether an exam kept moving:
 *
 *   bun tools/wri/nearness.ts <log> [--store <dir>]
 *
 * A writing session refuses a task identical to an earlier one (`contentOf`), and nothing reads how near
 * the rest stand. Merged from two scripts that did: v1's `noveltyOf` (`5bc9988`, `scripts/climb-velocity.ts`,
 * with `RESTATED_COSINE` 0.98), one number an edge of the climb, and `taskSetFacts` of the fourth repository
 * (`final-harness-audit/scripts/harness-task-facts.mjs`), by word counts. Changed from both: by Examiner
 * session and by comparison, on the local model, with groups in place of a number.
 *
 * What the record says, over 103 logs with a comparison, 5 November. It reads differently from run to
 * run: a task stood at 0.98 or above to an earlier one in 2,303 of 5,931, a session's median ran from
 * 0.85 to 1.00 (p10 to p90 of 354), and the groups a comparison's scored tasks fell in, per task, from
 * 0.15 to 1.00 (of 237). It says how alike an exam's words are, and little else. Within a log, steps were
 * read on more groups a task than other readings in 12 logs and on fewer in 4, of 27, which could be
 * chance. Logs that promoted held no lower share of near tasks than logs that did not (0.41 of 74, 0.39
 * of 25). Two tasks of one comparison at 0.98 or above split the same way in 1,741 of 1,957 pairs, and two
 * under 0.90 in 10,746 of 11,670, so a near task is no dependent one. A task at 0.995 or above was answered
 * less often by the reference in 10 logs of 24 and more in 11. And 30 of 152 steps held over half their
 * wins in one group, yet counting each group once at 0.98 kept 103 of the 105 steps that clear. Hence no
 * second reading here: rule 1 gives that to the comparison. Near means alike in words, up to the model's
 * 512 tokens, and a task can move only in its values and be another problem. Whole texts' word counts
 * agree at the top (median cosine 0.996 at 0.995 or above).
 */
import { differenceOf } from "#src/kernel/compare.ts";
import { proposalsOf } from "#src/kernel/history.ts";
import { type LogEvent, read } from "#src/kernel/log.ts";
import { lastReports, pairsReported } from "#src/kernel/reports.ts";
import { SEATS, traceKind } from "#src/kernel/trace.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { isString } from "#src/meta/json-shape.ts";
import { dot, type EmbedWays, groupsOf, runVectorReader, vectorLines } from "./embed.ts";

/** v1's line for a restated task. */
const NEAR = 0.98;
const NO_TRACES: ReadonlySet<LogEvent["kind"]> = new Set(
  SEATS.flatMap((seat) => [traceKind(seat, "call"), traceKind(seat, "turn")]),
);

interface Written {
  readonly version: string;
  readonly session: string | null;
  readonly vector: Float32Array;
  /** Its closeness to the nearest task before it, null for the log's first. */
  readonly nearest: number | null;
}

function sessionRows(written: readonly Written[]): string[] {
  const own = Map.groupBy(
    written.filter(({ session }) => session !== null),
    ({ session }) => session,
  );
  return [...own].flatMap(([session, tasks]) => {
    const near = tasks.flatMap(({ nearest }) => (nearest === null ? [] : [nearest]));
    const sorted = near.toSorted((one, other) => one - other);
    const middle = sorted[sorted.length >> 1];
    return middle === undefined
      ? []
      : [
          `session ${String(session)}: ${String(tasks.length)} tasks, median nearest earlier ${middle.toFixed(2)}, ${String(near.filter((each) => each >= NEAR).length)} at ${String(NEAR)} or above`,
        ];
  });
}

function comparisonRows(events: readonly LogEvent[], written: readonly Written[]): string[] {
  const vectors = new Map(written.map(({ version, vector }) => [version, vector]));
  return lastReports(events).flatMap((report) => {
    const scored = pairsReported(events, report).flatMap((pair) => {
      const vector = vectors.get(pair.task);
      return vector === undefined ? [] : [{ vector, won: differenceOf(pair) > 0 }];
    });
    if (scored.length === 0) return [];
    const roots = groupsOf(
      scored.map(({ vector }) => vector),
      NEAR,
    );
    const groups = [...Map.groupBy(scored, (_, at) => roots[at]).values()];
    const largest = groups.toSorted((one, other) => other.length - one.length)[0] ?? [];
    const wins = (tasks: typeof scored) => tasks.filter(({ won }) => won).length;
    const reading = isString(report.data.reading) ? report.data.reading : "unread";
    return [
      `${report.session} ${reading}: ${String(scored.length)} scored tasks in ${String(groups.length)} groups at ${String(NEAR)}, the largest ${String(largest.length)}, with ${String(wins(largest))} of ${String(wins(scored))} wins`,
    ];
  });
}

/** One read of `log`: a head line, a row a session and a comparison, or one line where there is nothing. */
export async function nearnessOf(log: string, ways: EmbedWays): Promise<string[]> {
  const events = read(log, NO_TRACES);
  const tasks = proposalsOf(events).flatMap(({ version, session, task }) => {
    const input = task?.publicInput ?? null;
    if (input === null) return [];
    return [{ version, session, words: isString(input) ? input : capturedJsonStringify(input) }];
  });
  if (tasks.length === 0) return ["nearness: no task's public input is on record in this log"];
  const { vectorOf, embedded, unkept, stopped } = await vectorLines(
    "nearness",
    log,
    tasks.map(({ words }) => words),
    ways,
  );
  if (stopped !== null) return [stopped];
  const written: Written[] = [];
  for (const { version, session, words } of tasks) {
    const vector = vectorOf(words);
    const closeness = written.map((earlier) => dot(vector, earlier.vector));
    written.push({
      version,
      session,
      vector,
      nearest: closeness.length === 0 ? null : Math.max(...closeness),
    });
  }
  const near = written.filter(({ nearest }) => nearest !== null && nearest >= NEAR).length;
  return [
    `nearness: ${String(tasks.length)} tasks, ${String(near)} at ${String(NEAR)} or above to an earlier one; embedded ${String(embedded)} this read`,
    ...unkept,
    ...sessionRows(written),
    ...comparisonRows(events, written),
  ];
}

if (import.meta.main) await runVectorReader("nearness", nearnessOf);
