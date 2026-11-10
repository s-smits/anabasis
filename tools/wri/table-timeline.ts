/**
 * The move table replayed over a campaign's log, one row a change point: each recorded
 * `campaign.move` beside what this tree's table names on the log just before it (`decidedOn`), each
 * point where the replayed move changes, with what comparison admission would refuse there and how
 * long the table named that move before it began, the Builder's `wait` calls, and the Examiner's
 * sessions.
 *
 *   bun tools/wri/table-timeline.ts <log>        (or --log <log>)
 *
 * For lanes 21 and 23, and 22 and 26 for time. Lane 23 wrote this replay twice by hand (6 and
 * 10 November), and 1 of 18 lane-21 sessions rebuilt it from copies of the log's prefixes; that one
 * found an owed starter comparison the table named for 4.7 hours while the Builder sat in a `wait`.
 *
 * The replay is this tree's `decide` on an old log. Where the rule changed since the run, the
 * replayed column is what this tree would have named, not what the run's code named, so the two
 * columns stand apart and nothing here counts where they differ. Each row names the host-code
 * digest the log last recorded before it (`condition.recorded`), with `=` where it is this tree's.
 * A move is recorded as it begins (row F), so one may still be under way at the log's end: the move
 * that began each step open there is marked (`openAt`, `launches.ts`), and the last move carries
 * any open step no move names. A move the Builder chose reads `led`, and
 * `asked` before 5 November.
 *
 * The table is asked at each event of the kinds in `POINTS`; where it names another move between two
 * of them, the first task event that moved it is found by halving (`FINE`), so a move the table
 * named and dropped again between two such points is not seen. Each replay folds its prefix from the
 * start, so a log of 50,000 events takes tens of seconds: this is a tool a lane runs, not a derived
 * reader. It prints ids, codes, digest heads and hours, never a task.
 */
import { refusals, supplyOf } from "#src/campaign/admission.ts";
import { askedOf } from "#src/campaign/ground.ts";
import { type Decided, short } from "#src/campaign/move.ts";
import { decide } from "#src/campaign/decide.ts";
import type { EventKind, LogEvent } from "#src/kernel/log.ts";
import { type Call, tracesIn } from "#src/kernel/trace.ts";
import { asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { resolve } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import { codeOf } from "#tools/d2/campaign.ts";
import { logEvents } from "#tools/runs/registry.ts";
import { planOn } from "#tools/runs/view.ts";
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
const POINTS: ReadonlySet<EventKind> = new Set([
  "campaign.opened",
  "campaign.move",
  "campaign.word",
  "campaign.ended",
  "comparison.started",
  "comparison.reported",
  "harness.promoted",
  "build.checkpoint",
  "build.started",
  "build.finished",
  "exam.started",
  "exam.finished",
]);
/** The events between two points that can move the table without being a point themselves. */
const FINE: ReadonlySet<EventKind> = new Set(["task.proposed", "task.state", "task.feasible"]);
const MOVED = "campaign.move";
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
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

/** The table's move on the first `upTo` events, each prefix read once. */
function tableReader(events: readonly LogEvent[]) {
  const seen = new Map<number, Table>();
  return (upTo: number): Table => {
    const known = seen.get(upTo);
    if (known !== undefined) return known;
    const prefix = events.slice(0, upTo);
    const decided = decide(prefix, planOn(prefix));
    const table = { decided, key: keyOf(decided) };
    seen.set(upTo, table);
    return table;
  };
}

/**
 * Each prefix where the replayed move changes. The table is read just before each point event, so a
 * move's own row and the point share one replay; where it changed since the point before, the first
 * prefix that reads as now is found by halving over that point's event and the task events after it.
 */
function changesOf(events: readonly LogEvent[], tableAt: (upTo: number) => Table): number[] {
  const points = [...events.flatMap(({ kind }, index) => (POINTS.has(kind) ? [index] : [])), events.length];
  const fine = events.flatMap(({ kind }, index) => (FINE.has(kind) ? [index + 1] : []));
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

/** Hours of `[from, to)` spent inside the Builder's `wait` calls. */
function waitedIn(waits: readonly Call[], from: string, to: string): number {
  const [start, end] = [Date.parse(from), Date.parse(to)];
  let total = 0;
  for (const { at, ms } of waits) {
    const [began, ended] = [Date.parse(at) - (ms ?? 0), Date.parse(at)];
    total += Math.max(0, Math.min(end, ended) - Math.max(start, began));
  }
  return total / HOUR_MS;
}

/** Each change with how long it stood: until the move it names begins, the table names another, or
 *  the log ends. */
function stoodOf(events: readonly LogEvent[], tableAt: (upTo: number) => Table, waits: readonly Call[]) {
  const changes = changesOf(events, tableAt);
  const end = events.at(-1)?.at ?? "";
  return changes.map((upTo, index): Change => {
    const table = tableAt(upTo);
    const next = changes[index + 1];
    const began = events.findIndex(
      (event, at) => at >= upTo && event.kind === MOVED && event.data.move === table.decided.move,
    );
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

/** The host-code digest each line ran under: the last `condition.recorded` at or before it. */
function digestsOf(events: readonly LogEvent[]): (string | null)[] {
  let last: string | null = null;
  return events.map(({ kind, data }) => {
    const host = kind === "condition.recorded" ? asRecord(data.condition)?.host : undefined;
    if (isString(host)) last = host;
    return last;
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
export function timelineLines(events: readonly LogEvent[], here: string): string[] {
  const tableAt = tableReader(events);
  const digests = digestsOf(events);
  const ranAt = (index: number) => {
    const digest = digests[index] ?? null;
    if (digest === null) return NOT_RECORDED;
    return `${digest === here ? "=" : ""}${digest.slice(0, 8)}`;
  };
  const waits = tracesIn(events).filter(
    (each): each is Call => each.seat === "build" && each.part === "call" && each.tool === "wait",
  );
  const rows = new Map<number, string[]>();
  const put = (index: number, what: string) => {
    const at = (events[index]?.at ?? "").slice(0, 16);
    const row = `${String(index + 1).padStart(6)}  ${at}Z  ${ranAt(index).padEnd(12)}  ${what}`;
    rows.set(index, [...(rows.get(index) ?? []), row]);
  };
  for (const change of stoodOf(events, tableAt, waits)) {
    const { upTo, table, hours, waited, until } = change;
    const prefix = events.slice(0, upTo);
    const codes = refusals(supplyOf(prefix), askedOf(planOn(prefix))).map(({ code }) => code);
    const refused = codes.length === 0 ? "nothing" : codes.join(", ");
    put(
      Math.max(0, upTo - 1),
      `table      replayed ${table.key} · admission refuses ${refused} · named ${hours.toFixed(2)} h, ${waited.toFixed(2)} h of it inside Builder waits, until ${until}`,
    );
  }
  const moves = events.flatMap((event, index) => (event.kind === MOVED ? [index] : []));
  const open = events.slice(moves.at(-1) ?? events.length).some(({ kind }) => kind === "campaign.ended")
    ? []
    : openAt(events);
  for (const index of moves) {
    const data = events[index]?.data;
    if (data === undefined) continue;
    const text = (value: unknown) => (isString(value) ? value : NOT_RECORDED);
    const recorded = `${text(data.move)}/${text(data.code)}${isString(data.session) ? ` ${data.session}` : ""}`;
    const mine = open.filter((id) => id === data.session);
    const unmatched = open.filter((id) => !moves.some((at) => events[at]?.data.session === id));
    const left = index === moves.at(-1) ? [...mine, ...unmatched] : mine;
    const last = left.length > 0 ? ` · begun, ${left.join(", ")} open at the log's end` : "";
    put(index, `move       recorded ${recorded.padEnd(24)} replayed ${tableAt(index).key}${last}`);
  }
  for (const { index, at, ms } of waits) {
    const from = new Date(Date.parse(at) - (ms ?? 0)).toISOString();
    put(
      index,
      `wait       Builder wait from ${from.slice(11, 16)} to ${at.slice(11, 16)} (${((ms ?? 0) / MINUTE_MS).toFixed(1)} min)`,
    );
  }
  for (const [index, event] of events.entries()) {
    if (event.kind === "exam.started" || event.kind === "exam.finished") put(index, examinerLine(event));
  }
  const distinct = [...new Set(digests.filter((each) => each !== null))];
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

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { log: { type: "string" } } });
  const given = values.log ?? positionals[0];
  if (given === undefined) throw new Error("name a log: bun tools/wri/table-timeline.ts <log>");
  console.log(timelineLines(logEvents(resolve(given)), codeOf(REPO).host).join("\n"));
}
