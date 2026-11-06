/**
 * How much of a solve's or a session's time went inside its tool calls, read by side and ending:
 *
 *   bun tools/wri/waits.ts <log>
 *
 * A deadline counts elapsed time, and a long solve is the model's thinking or a program's running.
 * `WALL SHARE` says how much of the deadline a solve took, and nothing says which of the two took it.
 * v1's `timeline.ts` read it for Builder rounds (`5bc9988`, `references/deterministic-lanes.md`): 79 to
 * 91% of a round's wall on 30 September, which decided whether a long round was the model's or the
 * host's. Here it is a solve's as well as a session's, since that is where a deadline binds. Changed
 * from v1: the logged `ms` of each call in place of the observability stream, which v2 does not write,
 * and overlapping calls counted once.
 *
 * Over the scored solves of 103 recorded logs, a median pass spent 0.23 of its time in calls (of 34,236),
 * a rejected solve 0.62 (of 1,033) and one out of turns 0.80 (of 141); within one log misses stood higher
 * than passes in 29 of 44, which at that size could be chance. It is a lead and decides nothing.
 */
import { read } from "#src/kernel/log.ts";
import type { Call, Traced } from "#src/kernel/trace.ts";
import type { JsonValue } from "#src/meta/json-shape.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { median } from "#src/meta/tally.ts";
import { type Index, indexOf, type Solve } from "./folds.ts";

const SESSION_SEATS: ReadonlySet<string> = new Set(["build", "exam", "draft"]);
const MINUTE_MS = 60_000;

const isCall = (each: Traced): each is Call & { readonly ms: number } =>
  each.part === "call" && each.ms !== null;

/** Milliseconds under at least one call, each call ending at its mark, so overlaps count once. */
function insideMs(calls: readonly Traced[]): number {
  const spans = calls
    .filter(isCall)
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

/** The solves' median share, with how many it is of. */
function shareOf(solves: readonly Solve[], callsOf: ReadonlyMap<string, readonly Traced[]>): string {
  const shares = solves.flatMap((solve) => {
    const calls = callsOf.get(solve.id) ?? [];
    return solve.seconds > 0 && calls.some(isCall)
      ? [Math.min(1, insideMs(calls) / (solve.seconds * 1000))]
      : [];
  });
  const middle = median(shares);
  return middle === null ? "none" : `${middle.toFixed(2)} of ${String(shares.length)}`;
}

/** A comparison's row: its two sides, their passes and misses apart. Non-results are counted nowhere. */
function comparisonRows(index: Index, callsOf: ReadonlyMap<string, readonly Traced[]>): string[] {
  return index.compared.flatMap(({ session, own, scoring }) => {
    if (scoring.length === 0) return [];
    const of = (harness: JsonValue | undefined, outcome: string) =>
      shareOf(
        scoring.filter((solve) => solve.harness === harness && solve.outcome === outcome),
        callsOf,
      );
    return [
      `${session} inside calls, median share of a solve: reference passes ${of(own.old, "pass")}, misses ${of(own.old, "fail")}; new passes ${of(own.fresh, "pass")}, misses ${of(own.fresh, "fail")}`,
    ];
  });
}

/** A session's row: from its first mark to its last, as a stopped one has no end on record. */
function sessionRows(index: Index): string[] {
  const sessions = Map.groupBy(
    index.traces.filter(({ seat }) => SESSION_SEATS.has(seat)),
    ({ seat, id }) => `${seat} ${id}`,
  );
  return [...sessions].flatMap(([name, marks]) => {
    const times = marks.map(({ at }) => Date.parse(at));
    const span = Math.max(...times) - Math.min(...times);
    if (span <= 0 || !marks.some(isCall)) return [];
    const share = Math.min(1, insideMs(marks) / span);
    return [`${name} inside calls: ${share.toFixed(2)} of ${String(Math.round(span / MINUTE_MS))} minutes`];
  });
}

/** Each comparison's row, then each session's, and one line where no call holds its time. */
export function waitRows(index: Index): string[] {
  const callsOf = Map.groupBy(
    index.traces.filter(({ seat }) => seat === "solve"),
    ({ id }) => id,
  );
  const rows = [...comparisonRows(index, callsOf), ...sessionRows(index)];
  return rows.length === 0 ? ["waits: no call on record holds its time"] : rows;
}

if (import.meta.main) {
  const [log] = runtimeProcess.argv.slice(2);
  if (log === undefined) throw new Error("name a log: bun tools/wri/waits.ts <log>");
  console.log(waitRows(indexOf(read(log))).join("\n"));
}
