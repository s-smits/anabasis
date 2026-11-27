import { type EventKind, eventsOf, type LogEvent } from "#src/kernel/log.ts";
import { MINUTE_MS } from "#src/meta/clock.ts";
import { isNumber, isString } from "#src/meta/json-shape.ts";

const SAMPLE_MS = 15 * MINUTE_MS;
const ONWARD: ReadonlySet<EventKind> = new Set(["campaign.ended", "build.started", "exam.started"]);
const WAIT_SCAN_KINDS: readonly EventKind[] = ["campaign.waited", ...ONWARD];
const LOAD_SCAN_KINDS: readonly EventKind[] = ["solve.started", "solve.finished", "campaign.waited"];

const SPAN_STARTS = new Map<EventKind, string>([
  ["build.started", "builder"],
  ["exam.started", "examiner"],
  ["draft.started", "examiner"],
  ["comparison.started", "comparisons"],
]);
const SPAN_ENDS = new Map<EventKind, EventKind>([
  ["build.finished", "build.started"],
  ["exam.finished", "exam.started"],
  ["draft.finished", "draft.started"],
  ["comparison.reported", "comparison.started"],
]);
const SPAN_KINDS: readonly EventKind[] = [...SPAN_STARTS.keys(), ...SPAN_ENDS.keys(), "campaign.ended"];

export interface Span {
  readonly part: string;
  readonly id: string;
  readonly from: number;
  readonly until: number;
}

export function spansOf(events: readonly LogEvent[]): Span[] {
  const spans: Span[] = [];
  const open = new Map<string, Omit<Span, "until">>();
  const close = (key: string, until: number) => {
    const started = open.get(key);
    if (started !== undefined) spans.push({ ...started, until });
    open.delete(key);
  };
  for (const { index, event } of eventsOf(events, SPAN_KINDS)) {
    const { at, kind, data } = event;
    const time = Date.parse(at);
    if (kind === "draft.started") {
      for (const key of [...open.keys()].filter((each) => each.startsWith("draft.started:"))) {
        close(key, time);
      }
    }
    const part = SPAN_STARTS.get(kind);
    if (part !== undefined) {
      const id = isString(data.session) ? data.session : "";
      const key = `${kind}:${id}`;
      if (!open.has(key)) open.set(key, { part, id, from: time });
      continue;
    }
    const start = SPAN_ENDS.get(kind);
    if (start !== undefined) {
      close(`${start}:${isString(data.session) ? data.session : ""}`, time);
      continue;
    }
    const cut = [...open].filter(([, span]) => span.part === "comparisons");
    for (const key of open.keys()) close(key, time);
    const next = events[index + 1];
    if (next === undefined) continue;
    const resumed = Date.parse(next.at);
    for (const [key, span] of cut) open.set(key, { ...span, from: resumed });
  }
  const last = Date.parse(events.at(-1)?.at ?? "");
  for (const key of open.keys()) close(key, last);
  return spans;
}

export function unionMs(windows: readonly { readonly from: number; readonly until: number }[]): number {
  let [held, reached] = [0, -Infinity];
  for (const { from, until } of windows.toSorted((a, b) => a.from - b.from)) {
    held += Math.max(0, until - Math.max(from, reached));
    reached = Math.max(reached, until);
  }
  return held;
}

export function waitsOf(events: readonly LogEvent[]): { from: number; until: number; kind: string }[] {
  const waits: { from: number; until: number; kind: string }[] = [];
  let boundary = Date.parse(events.at(-1)?.at ?? "");
  const hits = eventsOf(events, WAIT_SCAN_KINDS);
  for (let i = hits.length - 1; i >= 0; i -= 1) {
    const hit = hits[i];
    if (hit === undefined) continue;
    const { at, kind, data } = hit.event;
    const from = Date.parse(at);
    if (ONWARD.has(kind)) {
      boundary = from;
      continue;
    }
    if (!isNumber(data.ms)) continue;
    if (data.for === undefined) waits.push({ from: from - data.ms, until: from, kind: "load" });
    else if (data.for === "provider" || data.for === "network") {
      waits.push({ from, until: Math.min(from + data.ms, boundary), kind: data.for });
    }
  }
  return waits;
}

export const waitedMs = (waits: readonly { from: number; until: number }[], from: number, to: number) =>
  unionMs(
    waits.flatMap((wait) =>
      wait.until > from && wait.from < to
        ? [{ from: Math.max(wait.from, from), until: Math.min(wait.until, to) }]
        : [],
    ),
  );

export function overloadOf(events: readonly LogEvent[]): (from: number, to: number) => number {
  const waits = waitsOf(events);
  let cores: number | undefined;
  const samples = eventsOf(events, LOAD_SCAN_KINDS).flatMap(({ event: { at, data } }) => {
    if (isNumber(data.cores) && data.cores > 0) cores = data.cores;
    const load = Array.isArray(data.load) ? data.load[0] : data.load;
    return isNumber(load) && cores !== undefined
      ? [{ at: Date.parse(at), unserved: Math.max(0, 1 - cores / load) }]
      : [];
  });
  const overloaded = samples.flatMap(({ at, unserved }, index) =>
    unserved > 0
      ? [{ at, until: Math.min(at + SAMPLE_MS, samples[index + 1]?.at ?? Infinity), unserved }]
      : [],
  );
  return (from, to) => {
    let lost = 0;
    for (const { at, until, unserved } of overloaded) {
      const [start, end] = [Math.max(at, from), Math.min(until, to)];
      if (end > start) lost += (end - start - waitedMs(waits, start, end)) * unserved;
    }
    return lost;
  };
}
