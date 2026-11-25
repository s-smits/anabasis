/**
 * Solver execution, tool friction, route diversity, wait share and resource limits, in one `Index`
 * pass (lane 19):
 *
 *   bun tools/wri/wri.ts reader execution --log <log>
 */
import { AT_A_LIMIT } from "#src/kernel/reports.ts";
import type { Call, Traced } from "#src/kernel/trace.ts";
import { HOUR_MS, MINUTE_MS } from "#src/meta/clock.ts";
import { isNumber, isString } from "#src/meta/json-shape.ts";
import { median } from "#src/meta/tally.ts";
import { type Index, measured, type Solve } from "./folds.ts";

const LONG_CALL = 0.95;
const SIDES = new Set(["old", "new", "both"]);
const SESSION_SEATS: ReadonlySet<string> = new Set(["build", "exam", "draft"]);
const NONZERO = /Command exited with code [1-9]\d*\s*$/u;

const isTimedCall = (each: Traced): each is Call & { readonly ms: number } =>
  each.part === "call" && each.ms !== null;

const most = (values: readonly number[]) => (values.length === 0 ? null : Math.max(...values));
const said = (value: number | null, digits = 0) => (value === null ? "none" : value.toFixed(digits));

/** Format a `[0, 1]` share as a whole percentage, or `"none"` when missing. */
export const percent = (value: number | null) =>
  value === null ? "none" : `${String(Math.round(value * 100))}%`;

function insideMs(calls: readonly Traced[]): number {
  const spans = calls
    .filter(isTimedCall)
    .map(({ at, ms }) => [Date.parse(at) - ms, Date.parse(at)] as const)
    .toSorted(([one], [other]) => one - other);
  let [total, reached] = [0, Number.NEGATIVE_INFINITY];
  for (const [from, until] of spans) {
    total += Math.max(0, until - Math.max(from, reached));
    reached = Math.max(reached, until);
  }
  return total;
}

function waitShare(solves: readonly Solve[], tracesBySolve: ReadonlyMap<string, readonly Traced[]>): string {
  const shares = solves.flatMap((solve) => {
    const calls = tracesBySolve.get(solve.id) ?? [];
    return solve.seconds > 0 && calls.some(isTimedCall)
      ? [Math.min(1, insideMs(calls) / (solve.seconds * 1000))]
      : [];
  });
  const middle = median(shares);
  return middle === null ? "none" : `${middle.toFixed(2)} (${String(shares.length)})`;
}

function bump(counts: Map<string, number>, id: string): void {
  counts.set(id, (counts.get(id) ?? 0) + 1);
}

function traceStatsOf(index: Index) {
  const bySolve = new Map<string, Traced[]>();
  const long = new Map<string, number>();
  const nonzero = new Map<string, number>();
  const compacted = new Map<string, number>();
  const solves = new Map(index.solves.map((solve) => [solve.id, solve]));
  for (const each of index.traces) {
    if (each.seat !== "solve") continue;
    const list = bySolve.get(each.id);
    if (list === undefined) bySolve.set(each.id, [each]);
    else list.push(each);
    if (each.part === "compacted") {
      bump(compacted, each.id);
      continue;
    }
    if (each.part !== "call") continue;
    if (NONZERO.test(each.text)) bump(nonzero, each.id);
    const solve = solves.get(each.id);
    const limit =
      solve === undefined ? undefined : index.conditions.get(solve.condition)?.limits.shellDefaultSeconds;
    if (each.ms !== null && isNumber(limit) && each.ms >= limit * 1000 * LONG_CALL) bump(long, each.id);
  }
  return { bySolve, long, nonzero, compacted };
}

function sideLines(
  name: string,
  solves: readonly Solve[],
  stats: ReturnType<typeof traceStatsOf>,
  waitedHours: number,
): string[] {
  const done = solves.filter(measured);
  const passes = done.filter((solve) => solve.outcome === "pass");
  const misses = done.filter((solve) => solve.outcome === "fail");
  const endings = Map.groupBy(solves, (solve) =>
    solve.outcome === null ? "open" : `${solve.outcome}${solve.kind === null ? "" : ` ${solve.kind}`}`,
  );
  const turns = done.flatMap((solve) => (solve.turns === null ? [] : [solve.turns]));
  const bound = new Set(done.map((solve) => solve.modelTurns));
  const shares = done.flatMap((solve) => (solve.wallSeconds > 0 ? [solve.seconds / solve.wallSeconds] : []));
  const seconds = done.map((solve) => solve.seconds);
  const loads = solves.flatMap((solve) =>
    solve.load !== null && solve.cores !== null && solve.cores > 0 ? [solve.load / solve.cores] : [],
  );
  let [atLimit, totalCalls, totalErrors, totalNonzero, totalLong, totalCompact] = [0, 0, 0, 0, 0, 0];
  for (const solve of solves) {
    atLimit += Number(AT_A_LIMIT.has(solve.kind));
    totalCalls += solve.calls.length;
    totalErrors += solve.errors;
    totalNonzero += stats.nonzero.get(solve.id) ?? 0;
    totalLong += stats.long.get(solve.id) ?? 0;
    totalCompact += stats.compacted.get(solve.id) ?? 0;
  }
  const passCalls = median(passes.map(({ calls }) => calls.length));
  const routes = new Set(passes.map(({ calls }) => calls.join(" "))).size;
  const errPct = totalCalls === 0 ? "0%" : percent(totalErrors / totalCalls);
  const compactPart = totalCompact === 0 ? "" : ` · ${String(totalCompact)} compactions`;
  return [
    `${name}: ${String(solves.length)} solves (${String(done.length)} measured: ${[...endings].map(([ending, each]) => `${ending} ${String(each.length)}`).join(", ")}) · turns med ${said(median(turns))}/${[...bound].map((each) => said(each)).join("/")} · wall med ${percent(median(shares))} max ${percent(most(shares))} (${String(atLimit)} at limit) · err ${String(totalErrors)}/${String(totalCalls)} (${errPct}, ${String(totalNonzero)} non-zero)${compactPart}`,
    `  detail: turns max ${said(most(turns))} (${String(done.filter((solve) => solve.limit === "last turn").length)} last-turn) · sec med ${said(median(seconds))} max ${said(most(seconds))} · inside-calls pass ${waitShare(passes, stats.bySolve)} miss ${waitShare(misses, stats.bySolve)} · pass routes ${passCalls === null ? "none" : `${String(passCalls)} med calls, ${String(routes)} routes in ${String(passes.length)}`} · long calls ${String(totalLong)} · queued ${waitedHours.toFixed(1)} h · load/core med ${said(median(loads), 2)}`,
  ];
}

/** Per-comparison solver execution rows, followed by session-level tool-wait shares. */
export function executionRows(index: Index): string[] {
  const ofComparison = new Map<string, string>();
  for (const { session, scoring } of index.compared) {
    for (const solve of scoring) ofComparison.set(solve.id, session);
  }
  for (const solve of index.solves) {
    if (solve.comparison !== null) ofComparison.set(solve.id, solve.comparison);
  }
  const waited = new Map<string, number>();
  for (const { comparison, harness, ms } of index.of("campaign.waited")) {
    if (isString(comparison) && isString(harness) && isNumber(ms)) {
      const key = `${comparison} ${harness}`;
      waited.set(key, (waited.get(key) ?? 0) + ms / HOUR_MS);
    }
  }
  const stats = traceStatsOf(index);
  const groups = Map.groupBy(
    index.solves.filter((solve) => ofComparison.has(solve.id) && SIDES.has(solve.role ?? "")),
    (solve) => `${ofComparison.get(solve.id) ?? ""} ${solve.role ?? ""}`,
  );
  const armRows = [...groups].flatMap(([key, solves]) => {
    const harness = solves[0]?.harness ?? "";
    const comparison = key.split(" ")[0] ?? "";
    return sideLines(
      `${key} ${harness.slice(0, 8)}`,
      solves,
      stats,
      waited.get(`${comparison} ${harness}`) ?? 0,
    );
  });
  const sessions = Map.groupBy(
    index.traces.filter(({ seat }) => SESSION_SEATS.has(seat)),
    ({ seat, id }) => `${seat} ${id}`,
  );
  const sessionRows = [...sessions].flatMap(([name, marks]) => {
    const times = marks.map(({ at }) => Date.parse(at));
    const span = Math.max(...times) - Math.min(...times);
    if (span <= 0 || !marks.some(isTimedCall)) return [];
    const share = Math.min(1, insideMs(marks) / span);
    return [
      `session ${name} inside calls: ${share.toFixed(2)} of ${String(Math.round(span / MINUTE_MS))} min`,
    ];
  });
  if (armRows.length === 0 && sessionRows.length === 0) {
    return ["execution: no comparison solve or timed session call on record"];
  }
  return [
    "execution: per comparison side (old, new, or both for A/A): endings, turns, deadline share, tool errors/non-zero exits, compactions, inside-call wait share, pass routes, long calls, queue and load; then seat session inside-call shares",
    ...armRows,
    ...sessionRows,
  ];
}
