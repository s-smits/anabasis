/**
 * Unified solver execution, tool friction, route diversity, wait share, and resource-limit reader
 * (lane 17), replacing the separate `budget`, `waits`, and `routes` readers in one `Index` pass:
 *
 *   bun tools/wri/wri.ts reader execution --log <log>
 *
 * For each comparison side (`old`, `new`, or `both` for an A/A control): endings, turns against
 * bound, wall seconds and deadline share, tool-call wait share for passes and misses, route
 * diversity (median calls and distinct tool orders per pass), tool error and non-zero exit rates,
 * solver compactions, long shell calls, solve-queue hours, and median load per core. Also reports
 * tool-call wait share for Builder, Examiner, and drafting sessions.
 */
import { AT_A_LIMIT } from "#src/kernel/reports.ts";
import type { Call, Traced } from "#src/kernel/trace.ts";
import { HOUR_MS, MINUTE_MS } from "#src/meta/clock.ts";
import { isNumber, isString } from "#src/meta/json-shape.ts";
import { median } from "#src/meta/tally.ts";
import { type Index, measured, type Solve } from "./folds.ts";

/** A call running at least this share of the shell's default timeout counts as a long call. */
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

/** Milliseconds spent inside at least one tool call, merging overlapping call intervals. */
function insideMs(calls: readonly Traced[]): number {
  const spans = calls
    .filter(isTimedCall)
    .map(({ at, ms }) => [Date.parse(at) - ms, Date.parse(at)] as const)
    .toSorted(([one], [other]) => one - other);
  let total = 0;
  let reached = Number.NEGATIVE_INFINITY;
  for (const [from, until] of spans) {
    total += Math.max(0, until - Math.max(from, reached));
    reached = Math.max(reached, until);
  }
  return total;
}

/** Median share of solve wall time spent inside tool calls for `solves`. */
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

/** Pre-computed per-solve trace metrics: timed calls, long shell calls, non-zero exits, compactions. */
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
      compacted.set(each.id, (compacted.get(each.id) ?? 0) + 1);
      continue;
    }
    if (each.part !== "call") continue;
    if (NONZERO.test(each.text)) nonzero.set(each.id, (nonzero.get(each.id) ?? 0) + 1);
    const solve = solves.get(each.id);
    const limit =
      solve === undefined ? undefined : index.conditions.get(solve.condition)?.limits.shellDefaultSeconds;
    if (each.ms !== null && isNumber(limit) && each.ms >= limit * 1000 * LONG_CALL) {
      long.set(each.id, (long.get(each.id) ?? 0) + 1);
    }
  }
  return { bySolve, long, nonzero, compacted };
}

/** One comparison side's compact pulse-friendly summary line and full telemetry line. */
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
    solve.load === null || solve.cores === null || solve.cores === 0 ? [] : [solve.load / solve.cores],
  );
  const atLimit = solves.filter((solve) => AT_A_LIMIT.has(solve.kind)).length;
  const totalCalls = solves.reduce((sum, solve) => sum + solve.calls.length, 0);
  const totalErrors = solves.reduce((sum, solve) => sum + solve.errors, 0);
  const totalNonzero = solves.reduce((sum, solve) => sum + (stats.nonzero.get(solve.id) ?? 0), 0);
  const totalLong = solves.reduce((sum, solve) => sum + (stats.long.get(solve.id) ?? 0), 0);
  const totalCompact = solves.reduce((sum, solve) => sum + (stats.compacted.get(solve.id) ?? 0), 0);
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
    if (!isString(comparison) || !isString(harness) || !isNumber(ms)) continue;
    const key = `${comparison} ${harness}`;
    waited.set(key, (waited.get(key) ?? 0) + ms / HOUR_MS);
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
