import { type EventKind, eventsOf, type LogEvent } from "../kernel/log.ts";
import { INTERRUPTED, lastReports, latestBuilt, referenceOf } from "../kernel/reports.ts";
import { isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import { refusals, supplyOf, type Wanted } from "./admission.ts";

export interface Plan {
  readonly patience: number;
  readonly unprepared: boolean;
  readonly practice: number | null;
  readonly wanted: Pick<Wanted, "target" | "level" | "solves">;
  readonly pastStop: string | null;
  readonly prompted: boolean;
  readonly admits: readonly string[];
  readonly left: { readonly dollars: number; readonly reserve: number } | null;
  readonly promotions: number | null;
  readonly canRevise?: boolean;
}

interface Compared {
  readonly id: string;
  readonly at: number;
  readonly old: string;
  readonly fresh: string;
  readonly report: JsonObject | null;
  readonly reported: number | null;
}

type Reported = Compared & { readonly report: JsonObject; readonly reported: number };

const SESSION_FINISHED_KINDS: readonly EventKind[] = ["build.finished", "exam.finished", "draft.finished"];
const SESSION_TURN_KINDS: readonly EventKind[] = ["build.turn", "exam.turn", "draft.turn"];

export function comparisonsOf(events: readonly LogEvent[]): Compared[] {
  const reports = new Map(lastReports(events).map((report) => [report.session, report]));
  const begun = new Map<string, Compared>();
  for (const { index: at, event } of eventsOf(events, "comparison.started")) {
    const { session, old, fresh, ladder } = event.data;
    if (!isString(session) || !isString(old) || !isString(fresh) || ladder === true) continue;
    const last = reports.get(session);
    begun.set(session, {
      id: session,
      at,
      old,
      fresh,
      report: last?.data ?? null,
      reported: last?.index ?? null,
    });
  }
  return [...begun.values()].toSorted((one, other) => one.at - other.at);
}

export const sessionEnded = ({ kind, data }: LogEvent) =>
  kind.endsWith(".finished") && isString(data.session);

export const heldOut = (data: JsonObject) => Array.isArray(data.held) && data.held.length > 0;

export const cutShort = (event: LogEvent) =>
  sessionEnded(event) && INTERRUPTED.has(event.data.ended) && !heldOut(event.data);

export function crashedRun(events: readonly LogEvent[]) {
  const endedAt = eventsOf(events, "campaign.ended").at(-1)?.index ?? -1;
  const waitedAt =
    eventsOf(events, "campaign.waited").findLast(({ event: { data } }) => data.for === "provider")?.index ??
    -1;
  const since = Math.max(endedAt, waitedAt);
  const ended = SESSION_FINISHED_KINDS.flatMap((kind) =>
    eventsOf(events, kind).filter(({ index, event }) => index > since && sessionEnded(event)),
  );
  const crashed = new Set(
    ended.flatMap(({ event: { data } }) => (data.ended === "crashed" ? [data.session] : [])),
  );
  if (crashed.size === 0) return { count: 0, crash: null };
  ended.sort((a, b) => a.index - b.index);
  const firstTurn = new Map<string, number>();
  for (const {
    index,
    event: { data },
  } of SESSION_TURN_KINDS.flatMap((kind) => eventsOf(events, kind))) {
    if (index <= since || !isString(data.session) || isString(data.error) || crashed.has(data.session)) {
      continue;
    }
    const prev = firstTurn.get(data.session);
    if (prev === undefined || index < prev) firstTurn.set(data.session, index);
  }
  const back = Math.max(since, ...firstTurn.values());
  const sessions = ended
    .flatMap(({ index, event }) => (index > back && event.data.ended !== "stopped" ? [event] : []))
    .toReversed();
  const kept = new Set(
    eventsOf(events, "build.checkpoint").flatMap(({ index, event: { data } }) =>
      index > since ? [data.session] : [],
    ),
  );
  const moved = (data: JsonObject) =>
    heldOut(data) ||
    (isNumber(data.tries) && data.tries > 0) ||
    (data.changed === true && (data.ended !== "crashed" || kept.has(data.session)));
  const whole = sessions.findIndex(({ data }) => data.ended !== "crashed" || moved(data));
  const [last] = sessions;
  return {
    count: whole === -1 ? sessions.length : whole,
    crash: last?.data.ended === "crashed" && isString(last.data.crash) ? last.data.crash : null,
  };
}

export const askedOf = (plan: Plan) => ({
  ...plan.wanted,
  cap: plan.left,
  pastStop: plan.pastStop ?? undefined,
});

export function campaignState(events: readonly LogEvent[], plan: Plan) {
  const supply = supplyOf(events);
  const all = comparisonsOf(events);
  const reports = all.filter((each): each is Reported => each.report !== null && each.reported !== null);
  const reference = referenceOf(events);
  const starter = reports.map(({ report }) => report.starter).find(isString) ?? null;
  const latest = latestBuilt(events);
  const waiting = latest === reference ? null : latest;
  const last = reports.at(-1);
  const starterComparison =
    last?.fresh === starter && last.old === reference && starter !== reference ? last : undefined;
  const pair = reports.findLast(({ fresh, old }) => fresh === waiting && old === reference);
  const read = waiting === null ? starterComparison : pair;
  return {
    events,
    plan,
    supply,
    refused: new Set<string>(refusals(supply, askedOf(plan)).map(({ code }) => code)),
    all,
    reports,
    reference,
    starter,
    latest,
    waiting,
    read: read === undefined ? null : { ...read, starterComparison: waiting === null },
  };
}
