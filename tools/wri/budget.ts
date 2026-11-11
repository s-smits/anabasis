/**
 * Whether a solve's budget bound, one block a comparison and side (lane 24):
 *
 *   bun tools/wri/wri.ts reader budget --log <log>
 *
 * For the solves each side of each comparison ran, as the folds place them (`Solve.role`,
 * `folds.ts`): how they ended, their turns against the bound their start set and how many used every
 * turn, their seconds and share of the deadline at the median and the most, the calls that ran to
 * the shell's default limit, the time the solve queue held them (`campaign.waited`) and the load at
 * their starts. `WALL SHARE` gives the median share alone, which hides a side whose few long solves
 * met the deadline.
 *
 * Every one of the 7 lane 24 sessions between 3 and 10 November built this table by hand, in three
 * scripts, one of which placed each solve by the last comparison to start and so misplaced every solve
 * of two comparisons that overlapped. It counts and decides nothing: a solve at its bound may have
 * been near an answer or far from one.
 */
import { AT_A_LIMIT } from "#src/kernel/reports.ts";
import { isNumber, isString } from "#src/meta/json-shape.ts";
import { median } from "#src/meta/tally.ts";
import { type Index, measured, type Solve } from "./folds.ts";

/** A call within this share of the shell's default limit ran to it. */
const AT_SHELL_LIMIT = 0.95;
const SIDES = new Set(["old", "new", "both"]);
const HOUR_S = 3600;

const most = (values: readonly number[]) => (values.length === 0 ? null : Math.max(...values));
const said = (value: number | null, digits = 0) => (value === null ? "none" : value.toFixed(digits));
export const percent = (value: number | null) =>
  value === null ? "none" : `${String(Math.round(value * 100))}%`;

/** The comparison each solve counted in: its start's, else the fold's window for an older report. */
function comparisonsOf(index: Index): Map<string, string> {
  const of = new Map<string, string>();
  for (const { session, scoring } of index.compared) for (const solve of scoring) of.set(solve.id, session);
  for (const solve of index.solves) if (solve.comparison !== null) of.set(solve.id, solve.comparison);
  return of;
}

/** The calls of each solve that ran to its shell's default limit. */
function longCalls(index: Index): Map<string, number> {
  const long = new Map<string, number>();
  const solves = new Map(index.solves.map((solve) => [solve.id, solve]));
  for (const each of index.traces) {
    if (each.seat !== "solve" || each.part !== "call" || each.ms === null) continue;
    const solve = solves.get(each.id);
    const limit =
      solve === undefined ? undefined : index.conditions.get(solve.condition)?.limits.shellDefaultSeconds;
    if (isNumber(limit) && each.ms >= limit * 1000 * AT_SHELL_LIMIT) {
      long.set(each.id, (long.get(each.id) ?? 0) + 1);
    }
  }
  return long;
}

/** Hours the solve queue held a comparison's solves under one harness. */
function waitedOf(index: Index): Map<string, number> {
  const waited = new Map<string, number>();
  for (const { comparison, harness, ms } of index.of("campaign.waited")) {
    if (!isString(comparison) || !isString(harness) || !isNumber(ms)) continue;
    const key = `${comparison} ${harness}`;
    waited.set(key, (waited.get(key) ?? 0) + ms / 1000 / HOUR_S);
  }
  return waited;
}

/** One side's block: two lines. */
function block(
  name: string,
  solves: readonly Solve[],
  long: ReadonlyMap<string, number>,
  waited: number,
): string[] {
  const done = solves.filter(measured);
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
  const calls = solves.reduce((sum, solve) => sum + (long.get(solve.id) ?? 0), 0);
  return [
    `${name}: ${String(solves.length)} solves, ${String(done.length)} measured; ${[...endings].map(([ending, each]) => `${ending} ${String(each.length)}`).join(", ")}`,
    `  turns median ${said(median(turns))}, most ${said(most(turns))} of ${[...bound].map((each) => said(each)).join("/")}, ${String(done.filter((solve) => solve.limit === "last turn").length)} at the last turn · seconds median ${said(median(seconds))}, most ${said(most(seconds))} · deadline median ${percent(median(shares))}, most ${percent(most(shares))}, ${String(atLimit)} ended at a limit · calls at the shell's limit ${String(calls)} · queued ${waited.toFixed(1)} h · load per core median ${said(median(loads), 2)}`,
  ];
}

/** Each comparison's sides, in the order the comparisons started. */
export function budgetRows(index: Index): string[] {
  const of = comparisonsOf(index);
  const long = longCalls(index);
  const waited = waitedOf(index);
  const groups = Map.groupBy(
    index.solves.filter((solve) => of.has(solve.id) && SIDES.has(solve.role ?? "")),
    (solve) => `${of.get(solve.id) ?? ""} ${solve.role ?? ""}`,
  );
  const rows = [...groups].flatMap(([key, solves]) => {
    const harness = solves[0]?.harness ?? "";
    return block(
      `${key} ${harness.slice(0, 8)}`,
      solves,
      long,
      waited.get(`${key.split(" ")[0] ?? ""} ${harness}`) ?? 0,
    );
  });
  return rows.length === 0
    ? ["budget: no comparison's solve on record"]
    : [
        "budget: each comparison's side (old, new, or both for an A/A control): endings, then turns, seconds, share of the deadline, long calls, queue and load; measured solves exclude non-results",
        ...rows,
      ];
}
