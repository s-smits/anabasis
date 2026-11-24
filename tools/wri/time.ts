/**
 * The lanes of a whole-run investigation that read the clock: the solver's deadlines, limits and load
 * (lane 22), and where the campaign's hours, dollars and silences went (lane 23).
 * Role hours are elapsed open spans and can overlap. Every recorded wait, a provider's reset
 * (its grace minute included), a network wait and a solve-queue wait, joins one union, and the hours
 * a promotion stand with and without it.
 */
import { type EventKind, eventsOf, type LogEvent } from "#src/kernel/log.ts";
import { AT_A_LIMIT } from "#src/kernel/reports.ts";
import { degradations, type Turn, tracesIn } from "#src/kernel/trace.ts";
import { roleOf, spendOf } from "#src/kernel/meter.ts";
import { HOUR_MS, MINUTE_MS } from "#src/meta/clock.ts";
import { isNumber, type JsonValue } from "#src/meta/json-shape.ts";
import { countBy, median } from "#src/meta/tally.ts";
import { plural } from "#src/meta/text.ts";
import {
  type Compared,
  fired,
  emitIf,
  type Index,
  measured,
  percent,
  type Solve,
  share,
  strings,
  tally,
  text,
  type Trigger,
} from "./folds.ts";
import { firstComparisonDelay } from "#tools/runs/view.ts";

const SAMPLE_MS = 15 * 60_000;
const ONWARD: ReadonlySet<EventKind> = new Set(["campaign.ended", "build.started", "exam.started"]);
const WAIT_SCAN_KINDS: readonly EventKind[] = ["campaign.waited", ...ONWARD];
const LOAD_SCAN_KINDS: readonly EventKind[] = ["solve.started", "solve.finished", "campaign.waited"];
const DEADLINE_BOUND_SHARE = 0.95;
const LOAD_MOVED = 2;
const LOAD_WORTH_A_LINE = 4;
const MIRRORS = ["offo", "foof"] as const;
const SILENCE_SOLVES = 5;
const SILENCE_FLOOR_SECONDS = 600;
const SILENCES_NAMED = 5;
const BURST_MS = 1000;
const BETWEEN_MOVES = "between moves";
const WAIT_KINDS = ["provider", "network", "load"] as const;

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

interface Span {
  readonly part: string;
  readonly id: string;
  readonly from: number;
  readonly until: number;
}

const atALimit = (solve: Solve) =>
  AT_A_LIMIT.has(solve.kind) ||
  solve.limit !== null ||
  (solve.wallSeconds > 0 && solve.seconds > solve.wallSeconds * DEADLINE_BOUND_SHARE);
const limitOf = (solve: Solve) => (AT_A_LIMIT.has(solve.kind) ? solve.kind : solve.limit) ?? "wall share";

const tallied = ({ own, scoring }: Compared) => {
  const versions = new Set(strings(own.versions));
  return scoring.filter((solve) => versions.has(solve.version));
};

/** The misses at a limit by comparison and side, and outside comparisons. */
function limitTriggers(log: Index): Trigger[] {
  const misses = (solves: readonly Solve[]) => solves.filter((solve) => solve.outcome === "fail");
  const detail = (missed: readonly Solve[]) => {
    const at = missed.filter(atALimit);
    const told = [...new Set(at.flatMap((solve) => (solve.modelTurns === null ? [] : [solve.modelTurns])))];
    const bound = told.length === 0 ? "" : `; turns ${told.toSorted((a, b) => a - b).join(", ")}`;
    return { at: at.length, of: `(${tally(countBy(at, limitOf))}${bound})` };
  };
  const compared = log.compared.flatMap((each) => {
    const { session, own } = each;
    const missed = misses(tallied(each));
    const side = (harness: JsonValue | undefined) => {
      const mine = missed.filter((solve) => solve.harness === harness);
      return share(mine.filter(atALimit).length, mine.length);
    };
    const { at, of } = detail(missed);
    return emitIf(
      at !== 0,
      "MISSES AT A LIMIT",
      `${session}: ${side(own.old)} reference misses and ${side(own.fresh)} new at a limit ${of}`,
    );
  });
  const started = new Set(log.of("comparison.started").map((start) => text(start.session)));
  const outside = misses(log.solves.filter((solve) => !started.has(solve.comparison ?? "")));
  const { at, of } = detail(outside);
  return [
    ...compared,
    ...emitIf(
      at > 0,
      "MISSES AT A LIMIT",
      `outside a comparison: ${share(at, outside.length)} misses at a limit ${of}`,
    ),
  ];
}

/** Where another model answered than a seat asked for. */
function servedTriggers(log: Index, results: ReturnType<typeof scoredOf>): Trigger[] {
  const degraded = degradations(log.events);
  const servedBy = Map.groupBy(
    degraded.filter((row) => row.seat === "solve"),
    (row) => row.id,
  );
  const otherModel = results.flatMap(({ session, own, scoring }) => {
    const other = scoring.filter((solve) => servedBy.has(solve.id));
    const under = other.filter((solve) => solve.harness === own.old).length;
    const models = other.flatMap((solve) => (servedBy.get(solve.id) ?? []).map((row) => row.served));
    return emitIf(
      other.length > 0,
      "SERVED ANOTHER MODEL",
      `${session}: ${share(other.length, scoring.length)} solves, ${String(under)} of them under the reference harness; ${tally(
        countBy(models, (model) => model),
      )}`,
    );
  });
  const turns = degraded.reduce((sum, row) => sum + row.turns, 0);
  return [
    ...otherModel,
    ...emitIf(
      otherModel.length === 0 && turns > 0,
      "SERVED ANOTHER MODEL",
      `the campaign: ${plural(turns, "turn")} in ${String(new Set(degraded.map((row) => row.id)).size)} sessions and solves, none a comparison's scored solve; served by ${[...new Set(degraded.map((row) => row.served))].join(", ")}`,
    ),
  ];
}

const scoredOf = (log: Index) =>
  log.compared.map((each) => ({ ...each, scoring: tallied(each).filter(measured) }));

/** Lane 22: misses at a limit, deadline share, host load, mirrored start order, and served model. */
export function deadlineTriggers(log: Index): Trigger[] {
  const results = scoredOf(log);
  const deadlineShares = results.flatMap(({ session, own, scoring }) => {
    if (own.old === own.fresh) return [];
    const under = (harness: JsonValue | undefined) =>
      median(
        scoring.flatMap((solve) =>
          solve.harness === harness && solve.wallSeconds > 0 ? [solve.seconds / solve.wallSeconds] : [],
        ),
      );
    const [before, after] = [under(own.old), under(own.fresh)];
    return before === null || after === null
      ? []
      : [
          fired(
            "WALL SHARE",
            `${session}: median ${percent(before)} under the reference harness, ${percent(after)} under the new`,
          ),
        ];
  });
  const loads = results.flatMap(({ session, scoring }) => {
    const at = scoring.flatMap((solve) => (solve.load === null ? [] : [solve.load]));
    const middle = median(at);
    if (middle === null) return [];
    const halves = [at.slice(0, at.length / 2), at.slice(at.length / 2)].flatMap(
      (half) => median(half) ?? [],
    );
    const cores = scoring.findLast((solve) => solve.cores !== null)?.cores ?? null;
    return [{ session, middle, most: Math.max(...at), cores, halves }];
  });
  const loaded = loads.flatMap(({ session, middle, most, cores }) =>
    cores !== null && middle > cores
      ? [
          fired(
            "HOST LOADED",
            `${session}: load ${middle.toFixed(1)} at the median and ${most.toFixed(1)} at most when its solves started, on ${plural(cores, "core")}`,
          ),
        ]
      : [],
  );
  const outOfTurn = results.flatMap(({ session, own, scoring }) => {
    if (own.old === own.fresh) return [];
    const tasks = Map.groupBy(
      scoring.toSorted((one, other) => one.index - other.index),
      (solve) => solve.version,
    );
    const late = [...tasks.values()].filter((solves) => {
      const order = solves.map((solve) => (solve.harness === own.old ? "o" : "f")).join("");
      return !MIRRORS.some((mirror) => mirror.repeat(order.length).startsWith(order));
    }).length;
    return emitIf(
      late > 0,
      "STARTS OUT OF TURN",
      `${session}: ${share(late, tasks.size)} tasks started their harnesses' solves out of turn`,
    );
  });
  const middles = loads.flatMap(({ halves }) => halves);
  const [calmest, busiest] = [Math.min(...middles), Math.max(...middles)];
  return [
    ...limitTriggers(log),
    ...deadlineShares,
    ...loaded,
    ...outOfTurn,
    ...servedTriggers(log, results),
    ...emitIf(
      busiest >= LOAD_WORTH_A_LINE && busiest >= calmest * LOAD_MOVED,
      "LOAD MOVED",
      `median load when each comparison's solves started, its first half then its second: ${loads.map(({ session, halves }) => `${session} ${halves.map((half) => half.toFixed(1)).join(" then ")}`).join("; ")}`,
    ),
  ];
}

/** The parts of the campaign's clock: each Builder and Examiner session and each comparison. */
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
      const id = text(data.session);
      const key = `${kind}:${id}`;
      if (!open.has(key)) open.set(key, { part, id, from: time });
      continue;
    }
    const start = SPAN_ENDS.get(kind);
    if (start !== undefined) {
      close(`${start}:${text(data.session)}`, time);
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

/** The union of intervals, so concurrent sessions or provider waits count their overlap once. */
export function unionMs(windows: readonly { readonly from: number; readonly until: number }[]): number {
  let [held, reached] = [0, -Infinity];
  for (const { from, until } of windows.toSorted((a, b) => a.from - b.from)) {
    held += Math.max(0, until - Math.max(from, reached));
    reached = Math.max(reached, until);
  }
  return held;
}

/** Every wait a log records, as the interval it covered. */
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

/** The milliseconds between `from` and `to` inside the waits `waitsOf` read, each counted once. */
export const waitedMs = (waits: readonly { from: number; until: number }[], from: number, to: number) =>
  unionMs(
    waits.flatMap((wait) =>
      wait.until > from && wait.from < to
        ? [{ from: Math.max(wait.from, from), until: Math.min(wait.until, to) }]
        : [],
    ),
  );

/** The milliseconds between two moments lost to an overloaded host, outside every wait. */
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

/** Row A's overlapping elapsed spans beside its billed dollars, and the union of every recorded wait. */
export function hoursLine(log: Index): string {
  const spans = spansOf(log.events);
  const [first, last] = [Date.parse(log.events[0]?.at ?? ""), Date.parse(log.events.at(-1)?.at ?? "")];
  const whole = Number.isNaN(first) ? 0 : last - first;
  const parts = new Map<string, number>();
  for (const { part, from, until } of spans) parts.set(part, (parts.get(part) ?? 0) + until - from);
  const waits = waitsOf(log.events);
  const promotions = log.of("harness.promoted").length;
  const hours = (ms: number) => (ms / HOUR_MS).toFixed(1);
  const named = [...parts]
    .toSorted(([, a], [, b]) => b - a)
    .concat([[BETWEEN_MOVES, whole - unionMs(spans)]])
    .map(([part, ms]) => `${part} ${hours(ms)} (${whole > 0 ? ((ms / whole) * 100).toFixed(0) : "0"}%)`);
  const waited = unionMs(waits);
  const kinds = WAIT_KINDS.filter((kind) => waits.some((wait) => wait.kind === kind)).map(
    (kind) => `${kind} ${hours(unionMs(waits.filter((wait) => wait.kind === kind)))}`,
  );
  const perPromotion =
    promotions > 0
      ? `; ${hours(whole / promotions)} h per promotion, ${hours((whole - waited) / promotions)} h excluding recorded waits`
      : "";
  return `hours: elapsed open spans (overlapping), ${named.join(", ")}, of ${hours(whole)}; recorded waits ${hours(waited)} h${kinds.length > 0 ? ` (${kinds.join(", ")})` : ""}${perPromotion}`;
}

/** What ran through the gap that ends at event `index`. */
function causeOf(log: Index, spans: readonly Span[], index: number, gap: number): string {
  const end = Date.parse(log.events[index]?.at ?? "");
  const burst: LogEvent[] = [];
  for (let i = index; i < log.events.length; i += 1) {
    const event = log.events[i];
    if (event === undefined || Date.parse(event.at) - end > BURST_MS) break;
    burst.push(event);
  }
  const traces = tracesIn(burst);
  const command = traces.find((each) => each.part === "call" && each.ms !== null && each.ms * 2 >= gap);
  if (command !== undefined) return `${roleOf(command.seat) ?? command.seat} command`;
  const turn = traces.find((each): each is Turn => each.part === "turn");
  if (turn !== undefined) {
    const output = turn.usage?.output;
    return `${roleOf(turn.seat) ?? turn.seat} turn${isNumber(output) ? ` (${output.toLocaleString("en-US")} output tokens)` : ""}`;
  }
  const open = spans.some(({ from, until }) => from <= end - gap && end - gap < until);
  return open ? `before ${log.events[index]?.kind ?? ""}` : BETWEEN_MOVES;
}

/** Lane 23: the longest silences, each by what ran through it, and a role that took most of the dollars. */
export function costTriggers(log: Index): Trigger[] {
  const scaled = (median(log.solves.filter(measured).map((solve) => solve.seconds)) ?? 0) * SILENCE_SOLVES;
  const threshold = Math.max(scaled, SILENCE_FLOOR_SECONDS) * 1000;
  const why =
    scaled > SILENCE_FLOOR_SECONDS
      ? `${String(SILENCE_SOLVES)} times the median measured solve`
      : "the floor";
  const gaps: { index: number; gap: number }[] = [];
  let prev = Date.parse(log.events[0]?.at ?? "");
  for (let index = 1; index < log.events.length; index += 1) {
    const at = Date.parse(log.events[index]?.at ?? "");
    const gap = at - prev;
    if (gap > threshold) gaps.push({ index, gap });
    prev = at;
  }
  gaps.sort((a, b) => b.gap - a.gap);
  const spans = gaps.length > 0 ? spansOf(log.events) : [];
  const named = gaps
    .slice(0, SILENCES_NAMED)
    .map(
      ({ index, gap }) =>
        `${(gap / MINUTE_MS).toFixed(1)} min ${causeOf(log, spans, index, gap)} (lines ${String(index)}-${String(index + 1)})`,
    );
  const spend = spendOf(log.events);
  const total = spend.reduce((sum, [, dollars]) => sum + dollars, 0);
  const [[leader, most] = ["", 0]] = spend;
  const delay = firstComparisonDelay(log.events);
  return [
    // Delay after admissibility belongs to the Builder rather than the Examiner (`table-timeline.ts`).
    ...emitIf(delay?.long === true, "FIRST COMPARISON HELD OFF", `admissible ${delay?.summary ?? ""}`),
    ...emitIf(
      gaps.length > 0,
      "LONG SILENCES",
      `${plural(gaps.length, "gap")} over ${(threshold / MINUTE_MS).toFixed(1)} min, ${why}: ${named.join("; ")}`,
    ),
    ...emitIf(
      total > 0 && leader !== "solver" && most > total / 2,
      "SPEND LED BY A ROLE",
      `${leader}: ${percent(most / total)} of billed dollars`,
    ),
  ];
}
