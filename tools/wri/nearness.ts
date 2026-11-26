/**
 * How alike an exam's tasks read, by Examiner session and by comparison, for an investigator asking
 * whether an exam kept moving:
 *
 *   bun tools/wri/nearness.ts <log> [--store <dir>]
 *
 * A writing session refuses only a task identical to an earlier one (`contentOf`). Near means alike
 * in words, up to the model's 512 tokens, and a task can move only in its values and be another
 * problem, so this is a lead and gives no second reading: rule 1 gives that to the comparison.
 */
import { differenceOf } from "#src/kernel/compare.ts";
import { proposalsOf } from "#src/kernel/history.ts";
import { type LogEvent, read, TRACE_KINDS } from "#src/kernel/log.ts";
import { lastReports, pairsReported } from "#src/kernel/reports.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { isString } from "#src/meta/json-shape.ts";
import { dot, type EmbedWays, groupsOf, runVectorReader, vectorLines } from "./embed.ts";

const NEAR = 0.98;

interface Written {
  readonly version: string;
  readonly session: string | null;
  readonly vector: Float32Array;
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

async function nearnessOf(log: string, ways: EmbedWays): Promise<string[]> {
  const events = read(log, TRACE_KINDS);
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
