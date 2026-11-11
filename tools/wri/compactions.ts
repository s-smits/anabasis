/**
 * Every compaction of a seat's context, one line each, then each compacted session's total (lane 25):
 *
 *   bun tools/wri/wri.ts reader compactions --log <log>
 *
 * A line gives the log line, the seat and session, the tokens the context held before
 * (`tokensBefore`), the seconds the summary took, its error if any, the usages it holds and the
 * dollars they price to (`Compaction.billed`, `tracesIn`, `src/kernel/trace.ts`). The pi loop writes
 * a compaction's usages; the Claude CLI's compaction arrives as a diagnostic and is written with none
 * (`CLAUDE_COMPACTED`, `src/agent/session.ts`), so it reads 0 here. A session's line sets those dollars beside what its end records as `billed`, which
 * holds them, or says that it has no end, where `unfinished` (`trace.ts`) meters them instead.
 *
 * Ten of the 13 lane 25 sessions between 3 and 10 November built the compaction table by hand, and 12
 * read `src/agent/session.ts` or `src/kernel/meter.ts` (37 commands) to learn whether a compaction is
 * billed. It counts and decides nothing.
 */
import type { LogEvent } from "#src/kernel/log.ts";
import { type Traced, tracesIn } from "#src/kernel/trace.ts";
import { isNumber, isString, type JsonObject } from "#src/meta/json-shape.ts";

const NOT_RECORDED = "not recorded";

const isCompaction = (each: Traced): boolean => each.part === "compacted";

/** What a session's end records it billed, or null where it has no end on record. */
function endBilled(events: readonly LogEvent[], seat: string, id: string): number | null | undefined {
  const end = events.findLast(
    ({ kind, data }) => kind === `${seat}.finished` && (data.session === id || data.solve === id),
  );
  if (end === undefined) return undefined;
  return isNumber(end.data.billed) ? end.data.billed : null;
}

/** Each compaction's line, then each session's. */
export function compactionRows(events: readonly LogEvent[]): string[] {
  const compactions = tracesIn(events).filter(isCompaction);
  if (compactions.length === 0) return ["compactions: none on record"];
  const rows = [
    "compactions: a line each (log line, seat and session, tokens before, seconds, error, dollars its summaries were billed), then each session's sum against its end's billed",
  ];
  for (const each of compactions) {
    const data: JsonObject = events[each.index]?.data ?? {};
    const tokens = isNumber(data.tokensBefore) ? data.tokensBefore.toLocaleString("en-US") : NOT_RECORDED;
    const seconds = isNumber(data.seconds) ? data.seconds.toFixed(0) : NOT_RECORDED;
    const error = isString(data.error) ? data.error.slice(0, 80) : "none";
    const billed = each.part === "compacted" ? each.billed.toFixed(2) : "";
    const usages = Array.isArray(data.usages) ? String(data.usages.length) : NOT_RECORDED;
    rows.push(
      `${String(each.index + 1)} ${each.seat} ${each.id}: ${tokens} tokens before, ${seconds} s, error ${error}, ${usages} usages billed ${billed}`,
    );
  }
  const sessions = Map.groupBy(compactions, ({ seat, id }) => `${seat} ${id}`);
  for (const [name, own] of sessions) {
    const [seat = "", id = ""] = name.split(" ");
    const sum = own.reduce((total, each) => total + (each.part === "compacted" ? each.billed : 0), 0);
    const ended = endBilled(events, seat, id);
    const end =
      ended === undefined
        ? "no end on record"
        : ended === null
          ? `its end's billed ${NOT_RECORDED}`
          : `its end billed ${ended.toFixed(2)}`;
    rows.push(`${name}: ${String(own.length)} compactions billed ${sum.toFixed(2)}; ${end}`);
  }
  return rows;
}
