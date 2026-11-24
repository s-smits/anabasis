/**
 * The move table replayed over a campaign's log, one row a change point: each recorded
 * `campaign.move` beside what this tree's table names on the log just before it (`decidedOn`), each
 * point where the replayed move changes, with what comparison admission would refuse there and how
 * long the table named that move before it began, the Builder's `wait` calls, and the Examiner's
 * sessions. One `admissible` row marks where admission first refused no comparison, before the first
 * one started, and each `compare` move names the pool it began on, held out and released: the
 * Builder's calls between the two rows are what it chose while it could have compared.
 *
 *   bun tools/wri/table-timeline.ts <log>
 */
import { type Decided, short } from "#src/campaign/move.ts";
import { decide } from "#src/campaign/decide.ts";
import { type EventKind, eventsOf, type LogEvent, TRACE_KINDS } from "#src/kernel/log.ts";
import type { Call } from "#src/kernel/trace.ts";
import { HOUR_MS, MINUTE_MS } from "#src/meta/clock.ts";
import { asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { resolve } from "#src/meta/path.ts";
import { codeOf } from "#tools/d2/campaign.ts";
import { logEvents } from "#tools/runs/registry.ts";
import { builderWaits, firstComparisonDelay, planOn, poolOn, waitedIn } from "#tools/runs/view.ts";
import { printRows } from "./folds.ts";
import { openAt } from "./launches.ts";

/** The table at one prefix of the log: what it names, and that as a short key. */
interface Table {
  readonly decided: Decided;
  readonly key: string;
}

/** A point where the replayed move changed, and how long it stood. */
interface Change {
  /** The prefix the table was read on: the first `upTo` events. */
  readonly upTo: number;
  readonly table: Table;
  readonly hours: number;
  readonly waited: number;
  readonly until: string;
}

/** The events after which the table is asked again. */
const POINTS: readonly EventKind[] = [
  "campaign.opened",
  "campaign.move",
  "campaign.word",
  "campaign.ended",
  "comparison.started",
  "comparison.reported",
  "harness.promoted",
  "harness.reverted",
  "build.checkpoint",
  "build.started",
  "build.finished",
  "exam.started",
  "exam.finished",
];
/** The events between two points that can move the table without being a point themselves. */
const FINE: readonly EventKind[] = ["task.proposed", "task.state", "task.feasible"];
const EXAM_BOUNDS: readonly EventKind[] = ["exam.started", "exam.finished"];
const MOVED = "campaign.move";
const NOT_RECORDED = "not recorded";
const REPO = resolve(import.meta.dir, "../..");

const named = (harness: string) => (harness.length > 16 ? short(harness) : harness);

/** A decided move as a short key: its move and row, and the harnesses or ending it names. */
function keyOf(decided: Decided): string {
  const head = `${decided.move}/${decided.code}`;
  if (decided.move === "compare") {
    return `${head} ${named(decided.fresh)} against ${named(decided.reference)}`;
  }
  if (decided.move === "promote") return `${head} ${short(decided.harness)}`;
  if (decided.move === "end") return `${head} ${decided.ending}`;
  return head;
}

/** Non-trace events plus the last `solve.turn` of each `turns-ended` solve (`poolOf` reads no other
 *  trace events), keeping each kept event's raw log index for prefix mapping. */
function compactReplay(events: readonly LogEvent[]) {
  const turnsEnded = new Set(
    eventsOf(events, "solve.finished").flatMap(({ event: { data } }) =>
      isString(data.solve) && asRecord(data.ending)?.kind === "turns-ended" ? [data.solve] : [],
    ),
  );
  const lastTurn = new Map<string, number>();
  for (const { index, event } of eventsOf(events, "solve.turn")) {
    if (isString(event.data.solve) && turnsEnded.has(event.data.solve)) lastTurn.set(event.data.solve, index);
  }
  const keepTurns = new Set(lastTurn.values());
  const raw: number[] = [];
  const compact: LogEvent[] = [];
  for (const [index, event] of events.entries()) {
    if (!TRACE_KINDS.has(event.kind) || keepTurns.has(index)) {
      raw.push(index);
      compact.push(event);
    }
  }
  const cutOf = (upTo: number): number => {
    let [lo, hi] = [0, raw.length];
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((raw[mid] ?? upTo) < upTo) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const prefixes = new Map<number, LogEvent[]>();
  const prefixAt = (upTo: number): { readonly cut: number; readonly prefix: LogEvent[] } => {
    const cut = cutOf(upTo);
    const cached = prefixes.get(cut);
    if (cached !== undefined) return { cut, prefix: cached };
    const prefix = compact.slice(0, cut);
    prefixes.set(cut, prefix);
    return { cut, prefix };
  };
  const tables = new Map<number, Table>();
  const pools = new Map<number, ReturnType<typeof poolOn>>();
  return {
    tableAt: (upTo: number): Table => {
      const { cut, prefix } = prefixAt(upTo);
      const known = tables.get(cut);
      if (known !== undefined) return known;
      const decided = decide(prefix, planOn(prefix));
      const table = { decided, key: keyOf(decided) };
      tables.set(cut, table);
      return table;
    },
    poolAt: (upTo: number) => {
      const { cut, prefix } = prefixAt(upTo);
      const known = pools.get(cut);
      if (known !== undefined) return known;
      const pool = poolOn(prefix, prefix.length);
      pools.set(cut, pool);
      return pool;
    },
  };
}

/**
 * Each prefix where the replayed move changes. The table is read just before each point event, so a
 * move's own row and the point share one replay; where it changed since the point before, the first
 * prefix that reads as now is found by halving over that point's event and the task events after it.
 */
function changesOf(events: readonly LogEvent[], tableAt: (upTo: number) => Table): number[] {
  const points = [...eventsOf(events, POINTS).map(({ index }) => index), events.length];
  const fine = eventsOf(events, FINE).map(({ index }) => index + 1);
  const changes: number[] = [];
  let before = -1;
  for (const point of points) {
    if (point <= before || point === 0) continue;
    const key = tableAt(point).key;
    if (before !== -1 && key === tableAt(before).key) {
      before = point;
      continue;
    }
    const between =
      before === -1 ? [] : [before + 1, ...fine.filter((upTo) => upTo > before + 1 && upTo < point)];
    let [low, high] = [0, between.length];
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (tableAt(between[middle] ?? point).key === key) high = middle;
      else low = middle + 1;
    }
    changes.push(between[low] ?? point);
    before = point;
  }
  return changes;
}

/** Each change with how long it stood: until the move it names begins, the table names another, or
 *  the log ends. */
function tableDecisionsOf(
  events: readonly LogEvent[],
  tableAt: (upTo: number) => Table,
  waits: readonly Call[],
) {
  const changes = changesOf(events, tableAt);
  const moves = eventsOf(events, MOVED);
  const end = events.at(-1)?.at ?? "";
  return changes.map((upTo, index): Change => {
    const table = tableAt(upTo);
    const next = changes[index + 1];
    const began =
      moves.find(({ index: at, event }) => at >= upTo && event.data.move === table.decided.move)?.index ?? -1;
    const cut = next ?? events.length;
    const ran = began !== -1 && began < cut;
    const from = events[Math.max(0, upTo - 1)]?.at ?? end;
    const to = ran ? (events[began]?.at ?? end) : (events[cut - 1]?.at ?? end);
    const until = ran
      ? `the move began at line ${String(began + 1)}`
      : next === undefined
        ? "the log ends"
        : `the table named another at line ${String(next)}`;
    return {
      upTo,
      table,
      hours: (Date.parse(to) - Date.parse(from)) / HOUR_MS,
      waited: waitedIn(waits, from, to),
      until,
    };
  });
}

/** What one Examiner event says of its session. */
function examinerLine({ kind, data }: LogEvent): string {
  const session = isString(data.session) ? data.session : "?";
  if (kind === "exam.started") return `examiner ${session} started`;
  const held = Array.isArray(data.held) ? data.held.length : data.held;
  const seconds = isNumber(data.seconds) ? `${(data.seconds / 3600).toFixed(2)} h` : "seconds not recorded";
  return `examiner ${session} ${isString(data.ended) ? data.ended : "finished"} after ${seconds}, ${isNumber(held) ? String(held) : NOT_RECORDED} held`;
}

/** The timeline's lines, `here` being the host-code digest of the tree the table is replayed under. */
function timelineLines(events: readonly LogEvent[], here: string): string[] {
  const { tableAt, poolAt } = compactReplay(events);
  const conditions = eventsOf(events, "condition.recorded").flatMap(({ index, event: { data } }) => {
    const host = asRecord(data.condition)?.host;
    return isString(host) ? [{ index, host }] : [];
  });
  const ranAt = (index: number) => {
    const digest = conditions.findLast((each) => each.index <= index)?.host ?? null;
    if (digest === null) return NOT_RECORDED;
    return `${digest === here ? "=" : ""}${digest.slice(0, 8)}`;
  };
  const waits = builderWaits(events);
  const rows = new Map<number, string[]>();
  const put = (index: number, what: string) => {
    const at = (events[index]?.at ?? "").slice(0, 16);
    const row = `${String(index + 1).padStart(6)}  ${at}Z  ${ranAt(index).padEnd(12)}  ${what}`;
    rows.set(index, [...(rows.get(index) ?? []), row]);
  };
  for (const change of tableDecisionsOf(events, tableAt, waits)) {
    const { upTo, table, hours, waited, until } = change;
    put(
      Math.max(0, upTo - 1),
      `table      replayed ${table.key} · ${poolAt(upTo).text} · named ${hours.toFixed(2)} h, ${waited.toFixed(2)} h of it inside Builder waits, until ${until}`,
    );
  }
  const delay = firstComparisonDelay(events);
  if (delay !== null) {
    put(
      delay.index,
      `admissible first comparison from ${(events[delay.index]?.at ?? "").slice(11, 19)}: ${poolAt(delay.index + 1).text} · ${delay.summary}`,
    );
  }
  const moves = eventsOf(events, MOVED);
  const lastMove = moves.at(-1)?.index ?? events.length;
  const endedAfter = (eventsOf(events, "campaign.ended").at(-1)?.index ?? -1) >= lastMove;
  const open = endedAfter ? [] : openAt(events);
  const moveSessions = new Set(moves.map(({ event: { data } }) => data.session));
  const unmatched = open.filter((id) => !moveSessions.has(id));
  for (const { index, event } of moves) {
    const { data } = event;
    const text = (value: unknown) => (isString(value) ? value : NOT_RECORDED);
    const recorded = `${text(data.move)}/${text(data.code)}${isString(data.session) ? ` ${data.session}` : ""}`;
    const mine = open.filter((id) => id === data.session);
    const left = index === lastMove ? [...mine, ...unmatched] : mine;
    const last = left.length > 0 ? ` · begun, ${left.join(", ")} open at the log's end` : "";
    const pool = data.move === "compare" ? ` · ${poolAt(index).text}` : "";
    put(index, `move       recorded ${recorded.padEnd(24)} replayed ${tableAt(index).key}${pool}${last}`);
  }
  for (const { index, at, ms } of waits) {
    const from = new Date(Date.parse(at) - (ms ?? 0)).toISOString();
    put(
      index,
      `wait       Builder wait from ${from.slice(11, 19)} to ${at.slice(11, 19)} (${((ms ?? 0) / MINUTE_MS).toFixed(1)} min)`,
    );
  }
  for (const { index, event } of eventsOf(events, EXAM_BOUNDS)) put(index, examinerLine(event));
  const distinct = [...new Set(conditions.map(({ host }) => host))];
  return [
    `table-timeline: this tree's table (host-code digest ${here.slice(0, 8)}) replayed on each prefix of the log; "recorded" is the log's own, "replayed" this tree's`,
    distinct.some((each) => each !== here)
      ? `warning: the log ran under ${distinct.map((each) => each.slice(0, 8)).join(", ")}; on a row without "=" the replayed move is this tree's rule on an old log`
      : `the log ran under this tree's digest${distinct.length === 0 ? " (no condition recorded)" : ""}`,
    `a table row stands at the last line it read; a move row's replay reads the lines before the move`,
    `  line  at                 ran under     row`,
    ...[...rows].toSorted(([one], [other]) => one - other).flatMap(([, lines]) => lines),
  ];
}

if (import.meta.main) printRows("table-timeline", (log) => timelineLines(logEvents(log), codeOf(REPO).host));
