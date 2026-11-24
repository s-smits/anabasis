/**
 * Seat continuity, context compaction, post-compaction `read_opening` recovery, resting Examiner
 * multi-ask conversations, and interrupted Builder handovers (lane 15):
 *
 *   bun tools/wri/wri.ts reader continuity --log <log>
 *
 * Replaces `compactions.ts` by pairing every compaction record (tokens, seconds, error, priced
 * dollars, and whether `read_opening` followed within `REREAD_WINDOW` calls) with resting Examiner
 * conversation spans and interrupted Builder handover chains. Session lines open on the session id
 * so `bun run runs pulse` surfaces compactions and interrupted handovers directly on `BUILT` and
 * `EXAMINED` moments.
 */
import type { LogEvent } from "#src/kernel/log.ts";
import { type Call, type Traced, tracesIn } from "#src/kernel/trace.ts";
import { isNumber, isString, type JsonObject } from "#src/meta/json-shape.ts";
import { plural } from "#src/meta/text.ts";

const NOT_RECORDED = "not recorded";
/** How many subsequent tool calls after a compaction we check for `read_opening` recovery. */
const REREAD_WINDOW = 3;

/** Whether `seat` / `id` called `read_opening` within `REREAD_WINDOW` calls after log line `after`. */
export function rereadAfter(
  traces: readonly Traced[],
  seat: string,
  id: string,
  after: number,
): "yes" | "no" | "end" {
  const next = traces.filter(
    (each): each is Call =>
      each.part === "call" && each.seat === seat && each.id === id && each.index > after,
  );
  if (next.length === 0) return "end";
  return next.slice(0, REREAD_WINDOW).some((call) => call.tool === "read_opening") ? "yes" : "no";
}

/** What a session's end records it billed, or undefined when no end event exists. */
function endBilled(events: readonly LogEvent[], seat: string, id: string): number | null | undefined {
  const end = events.findLast(
    ({ kind, data }) => kind === `${seat}.finished` && (data.session === id || data.solve === id),
  );
  if (end === undefined) return undefined;
  return isNumber(end.data.billed) ? end.data.billed : null;
}

/** Compaction event lines plus per-session compaction totals with `read_opening` recovery counts. */
function compactionSection(events: readonly LogEvent[], traces: readonly Traced[]): string[] {
  const compactions = traces.filter((each) => each.part === "compacted");
  if (compactions.length === 0) return ["compactions: none on record"];
  const lines = compactions.map((each) => {
    const data: JsonObject = events[each.index]?.data ?? {};
    const tokens = isNumber(data.tokensBefore) ? data.tokensBefore.toLocaleString("en-US") : NOT_RECORDED;
    const seconds = isNumber(data.seconds) ? data.seconds.toFixed(0) : NOT_RECORDED;
    const error = isString(data.error) ? data.error.slice(0, 80) : "none";
    const billed = each.part === "compacted" ? each.billed.toFixed(2) : "0.00";
    const usages = Array.isArray(data.usages) ? String(data.usages.length) : NOT_RECORDED;
    const reread = each.seat === "solve" ? "n/a" : rereadAfter(traces, each.seat, each.id, each.index);
    return `  line ${String(each.index + 1)} ${each.seat} ${each.id}: ${tokens} tok, ${seconds} s, err ${error}, ${usages} usages ($${billed}), read_opening<=3: ${reread}`;
  });
  const sessions = Map.groupBy(compactions, ({ seat, id }) => `${seat} ${id}`);
  const totals = [...sessions].map(([name, own]) => {
    const [seat = "", id = ""] = name.split(" ");
    const sum = own.reduce((total, each) => total + (each.part === "compacted" ? each.billed : 0), 0);
    const missed =
      seat === "solve" ? 0 : own.filter((each) => rereadAfter(traces, seat, id, each.index) === "no").length;
    const ended = endBilled(events, seat, id);
    const end =
      ended === undefined
        ? "no end"
        : ended === null
          ? `end billed ${NOT_RECORDED}`
          : `end billed $${ended.toFixed(2)}`;
    const missedNote = missed === 0 ? "" : `, ${String(missed)} missed read_opening`;
    return `${id} (${seat}): ${plural(own.length, "compaction")} ($${sum.toFixed(2)}${missedNote}; ${end})`;
  });
  return [...totals, ...lines];
}

/** Resting Examiner conversations that span multiple asks, noting promotions crossed and bad ends. */
function examinerContinuity(events: readonly LogEvent[]): string[] {
  const finished = new Map(
    events.flatMap(({ kind, data }, index) =>
      kind === "exam.finished" && isString(data.session)
        ? [[data.session, { index, ended: isString(data.ended) ? data.ended : NOT_RECORDED }] as const]
        : [],
    ),
  );
  const starts = events.flatMap(({ kind, data }, index) =>
    kind === "exam.started" && isString(data.session)
      ? [
          {
            session: data.session,
            conversation: isString(data.conversation) ? data.conversation : data.session,
            index,
            end: finished.get(data.session),
          },
        ]
      : [],
  );
  const groups = Map.groupBy(starts, ({ conversation }) => conversation);
  const promotions = events.flatMap(({ kind }, index) => (kind === "harness.promoted" ? [index] : []));
  return [...groups].flatMap(([conversation, asks]) => {
    if (asks.length < 2 && asks.every(({ end }) => end === undefined || end.ended === "finished")) {
      return [];
    }
    const first = asks[0]?.index ?? 0;
    const last = asks.at(-1)?.end?.index ?? events.length;
    const crossed = promotions.filter((at) => at > first && at < last).length;
    const nonFinished = asks.filter(({ end }) => end !== undefined && end.ended !== "finished");
    const badNote =
      nonFinished.length === 0
        ? "all finished"
        : nonFinished.map(({ session, end }) => `${session} ${end?.ended ?? "open"}`).join(", ");
    const latest = asks.at(-1)?.session ?? conversation;
    return [
      `${latest} (exam conversation ${conversation}): ${plural(asks.length, "ask")} (${asks.map(({ session }) => session).join(" -> ")}), crossed ${plural(crossed, "promotion")}, ${badNote}`,
    ];
  });
}

/** Builder sessions that opened after an interrupted (non-`finished`) predecessor. */
function handoverSection(events: readonly LogEvent[]): string[] {
  const ends = new Map(
    events.flatMap(({ kind, data }) =>
      kind === "build.finished" && isString(data.session) ? [[data.session, data] as const] : [],
    ),
  );
  const starts = events.flatMap(({ kind, data }) =>
    kind === "build.started" && isString(data.session)
      ? [{ session: data.session, parent: isString(data.parent) ? data.parent.slice(0, 8) : "-" }]
      : [],
  );
  const handovers = starts.slice(1).flatMap((build, index) => {
    const prev = starts[index];
    if (prev === undefined) return [];
    const prevEnd = ends.get(prev.session);
    const ended =
      prevEnd === undefined ? "unfinished" : isString(prevEnd.ended) ? prevEnd.ended : NOT_RECORDED;
    if (ended === "finished") return [];
    const prevTurns = isNumber(prevEnd?.turns) ? `${String(prevEnd.turns)} turns` : "turns n/a";
    return [
      `${build.session} (interrupted handover): opened after ${prev.session} (${ended}, ${prevTurns}) on parent ${build.parent} (prev parent ${prev.parent})`,
    ];
  });
  return handovers.length === 0 ? ["handovers: every Builder predecessor finished cleanly"] : handovers;
}

/** Compaction recovery, resting Examiner continuity, and interrupted Builder handovers. */
export function continuityRows(events: readonly LogEvent[]): string[] {
  const traces = tracesIn(events);
  const exams = examinerContinuity(events);
  return [
    "continuity: compactions with read_opening recovery (within 3 calls), resting Examiner multi-ask spans, and interrupted Builder handovers",
    ...compactionSection(events, traces),
    ...(exams.length === 0 ? ["examiner conversations: single-ask and cleanly finished"] : exams),
    ...handoverSection(events),
  ];
}
