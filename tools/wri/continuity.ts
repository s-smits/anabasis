/**
 * Seat continuity, context compaction, post-compaction `read_opening` recovery, resting Examiner
 * multi-ask conversations, and interrupted Builder handovers (lane 15):
 *
 *   bun tools/wri/wri.ts reader continuity --log <log>
 */
import { type EventKind, eventsOf, type LogEvent } from "#src/kernel/log.ts";
import type { Call, Traced } from "#src/kernel/trace.ts";
import { isNumber, isString, type JsonObject } from "#src/meta/json-shape.ts";
import { plural } from "#src/meta/text.ts";
import { indexOf } from "./folds.ts";

const NOT_RECORDED = "not recorded";
const REREAD_WINDOW = 3;
const END_KINDS: readonly EventKind[] = [
  "build.finished",
  "exam.finished",
  "draft.finished",
  "solve.finished",
];

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

function endBilled(events: readonly LogEvent[], seat: string, id: string): number | null | undefined {
  const want = `${seat}.finished`;
  const end = eventsOf(events, END_KINDS).findLast(
    ({ event: { kind, data } }) => kind === want && (data.session === id || data.solve === id),
  );
  if (end === undefined) return undefined;
  return isNumber(end.event.data.billed) ? end.event.data.billed : null;
}

function compactionSection(events: readonly LogEvent[], traces: readonly Traced[]): string[] {
  const compactions = traces.filter((each) => each.part === "compacted");
  if (compactions.length === 0) return ["compactions: none on record"];
  const lines = compactions.map((each) => {
    const data: JsonObject = events[each.index]?.data ?? {};
    const tokens = isNumber(data.tokensBefore) ? data.tokensBefore.toLocaleString("en-US") : NOT_RECORDED;
    const seconds = isNumber(data.seconds) ? data.seconds.toFixed(0) : NOT_RECORDED;
    const error = isString(data.error) ? data.error.slice(0, 80) : "none";
    const usages = Array.isArray(data.usages) ? String(data.usages.length) : NOT_RECORDED;
    const reread = each.seat === "solve" ? "n/a" : rereadAfter(traces, each.seat, each.id, each.index);
    return `  line ${String(each.index + 1)} ${each.seat} ${each.id}: ${tokens} tok, ${seconds} s, err ${error}, ${usages} usages ($${each.billed.toFixed(2)}), read_opening<=3: ${reread}`;
  });
  const totals = [...Map.groupBy(compactions, ({ seat, id }) => `${seat} ${id}`)].map(([name, own]) => {
    const [seat = "", id = ""] = name.split(" ");
    const sum = own.reduce((total, each) => total + each.billed, 0);
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

function examinerContinuity(events: readonly LogEvent[]): string[] {
  const finished = new Map(
    eventsOf(events, "exam.finished").flatMap(({ index, event: { data } }) =>
      isString(data.session)
        ? [[data.session, { index, ended: isString(data.ended) ? data.ended : NOT_RECORDED }] as const]
        : [],
    ),
  );
  const starts = eventsOf(events, "exam.started").flatMap(({ index, event: { data } }) =>
    isString(data.session)
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
  const promotions = eventsOf(events, "harness.promoted").map(({ index }) => index);
  return [...Map.groupBy(starts, ({ conversation }) => conversation)].flatMap(([conversation, asks]) => {
    if (asks.length < 2 && asks.every(({ end }) => end === undefined || end.ended === "finished")) return [];
    const first = asks[0]?.index ?? 0;
    const last = asks.at(-1)?.end?.index ?? events.length;
    const crossed = promotions.filter((at) => at > first && at < last).length;
    const nonFinished = asks.filter(({ end }) => end !== undefined && end.ended !== "finished");
    const badNote =
      nonFinished.map(({ session, end }) => `${session} ${end?.ended ?? "open"}`).join(", ") ||
      "all finished";
    const latest = asks.at(-1)?.session ?? conversation;
    return [
      `${latest} (exam conversation ${conversation}): ${plural(asks.length, "ask")} (${asks.map(({ session }) => session).join(" -> ")}), crossed ${plural(crossed, "promotion")}, ${badNote}`,
    ];
  });
}

function handoverSection(events: readonly LogEvent[]): string[] {
  const ends = new Map(
    eventsOf(events, "build.finished").flatMap(({ event: { data } }) =>
      isString(data.session) ? [[data.session, data] as const] : [],
    ),
  );
  const starts = eventsOf(events, "build.started").flatMap(({ event: { data } }) =>
    isString(data.session)
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
  const { traces } = indexOf(events);
  const exams = examinerContinuity(events);
  return [
    "continuity: compactions with read_opening recovery (within 3 calls), resting Examiner multi-ask spans, and interrupted Builder handovers",
    ...compactionSection(events, traces),
    ...(exams.length === 0 ? ["examiner conversations: single-ask and cleanly finished"] : exams),
    ...handoverSection(events),
  ];
}
