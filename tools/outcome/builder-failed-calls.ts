/**
 * Which Builder tool calls failed, grouped by recorded session.
 *
 * The tool census reported failures as per-name counts. Run esp32-w23 recorded "28 failed
 * commandExecution" and run esp32-sol-329 recorded 19 failures out of 19 calls, and a reader of the
 * census could say neither which calls those were nor that a turn had been cut mid-flight.
 * The execution record carries both — a bounded row per failure, already redacted and cut by the
 * writer, and the turn that was still running. This reader carries those records into the outcome
 * report.
 *
 * It reports the recorded snapshot: no threshold, no classification, and no reinterpretation of
 * what an excerpt says.
 */
import type { BuilderExecutionEvidence, BuilderFailedCall } from "../../src/author/builder-execution.ts";

/** Null in the record when no turn was open, and the tally itself when one was. */
type BuilderPartialTurn =
  | { state: "none" }
  | { state: "recorded"; turn: number; calls: number; failed: number };

export interface BuilderFailureSession {
  /** The record's on-disk session number; null when the caller read no filenames. */
  session: number | null;
  /** The record's own write time, and the census ordering key. */
  writtenAt: string;
  /** Failures the record counted. */
  failed: number;
  /** The recorded rows as the writer redacted and bounded them. */
  rows: readonly BuilderFailedCall[];
  /** Failures past the recorded row bound. */
  omitted: number;
  partialTurn: BuilderPartialTurn;
}

export interface BuilderFailureCensus {
  /** Every record, latest recorded work first. */
  sessions: BuilderFailureSession[];
  /** Failures counted over every record. */
  failed: number;
  /** Failure rows recorded over every record. */
  rows: number;
  /** Failures past the row bound. */
  omitted: number;
  /** Records that recorded a turn still in flight. */
  withPartialTurn: number;
}

function partialTurnOf(record: BuilderExecutionEvidence): BuilderPartialTurn {
  const partial = record.partialTurn;
  if (partial === null) return { state: "none" };
  return {
    state: "recorded",
    turn: partial.turn,
    calls: partial.toolCalls.total,
    failed: partial.toolCalls.failed,
  };
}

/** A damaged time sorts oldest rather than throwing: the reader accepted the record on its shape,
 *  and a census must not lose a session over an unparsable timestamp. */
function recordedMs(writtenAt: string): number {
  const parsed = Date.parse(writtenAt);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/** Latest authoring work first, by the time the record itself carries. Filename order and read
 *  order decide nothing here; two records written in the same millisecond keep the lower session
 *  number first so the order stays stable. */
function byRecordedTime(left: BuilderFailureSession, right: BuilderFailureSession): number {
  const moved = recordedMs(right.writtenAt) - recordedMs(left.writtenAt);
  if (moved !== 0) return moved;
  return (left.session ?? Number.MAX_SAFE_INTEGER) - (right.session ?? Number.MAX_SAFE_INTEGER);
}

function failureSession(record: BuilderExecutionEvidence, session: number | null): BuilderFailureSession {
  return {
    session,
    writtenAt: record.writtenAt,
    failed: record.toolCalls.failed,
    rows: record.failedCalls,
    omitted: record.failedCallsOmitted,
    partialTurn: partialTurnOf(record),
  };
}

/** Every record the epoch read, aggregated and ordered. `sessions` are the on-disk numbers aligned
 *  with `records`; a caller without them (a fixture) still gets every row. */
export function builderFailureCensus(
  records: readonly BuilderExecutionEvidence[],
  sessions: readonly number[] = [],
): BuilderFailureCensus {
  const rows = records.map((record, index) => failureSession(record, sessions[index] ?? null));
  rows.sort(byRecordedTime);
  return {
    sessions: rows,
    failed: rows.reduce((sum, row) => sum + row.failed, 0),
    rows: rows.reduce((sum, row) => sum + row.rows.length, 0),
    omitted: rows.reduce((sum, row) => sum + row.omitted, 0),
    withPartialTurn: rows.filter((row) => row.partialTurn.state === "recorded").length,
  };
}

/** The tools a session's recorded rows name, with how often each appears among them. The excerpts
 *  themselves stay in the report's rows; a finding line says a failure identity exists and where
 *  to read it. */
function namedTools(rows: readonly BuilderFailedCall[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.tool, (counts.get(row.tool) ?? 0) + 1);
  return [...counts]
    .sort(([leftName, left], [rightName, right]) => right - left || leftName.localeCompare(rightName))
    .map(([tool, count]) => `${tool}=${String(count)}`)
    .join(", ");
}

function sessionFindings(label: string, row: BuilderFailureSession): string[] {
  const out: string[] = [];
  if (row.rows.length > 0) {
    out.push(
      `${label}: ${String(row.failed)} failed tool calls; ${String(row.rows.length)} recorded with a redacted request and error (${namedTools(row.rows)}), ${String(row.omitted)} beyond the row bound`,
    );
  }
  if (row.partialTurn.state === "recorded") {
    out.push(
      `${label}: turn ${String(row.partialTurn.turn)} was still running when the record was written, with ${String(row.partialTurn.calls)} tool calls of which ${String(row.partialTurn.failed)} failed`,
    );
  }
  return out;
}

/** Diagnostic lines over the census. Counts and recorded names only; they change no decision. */
export function builderFailureFindings(epoch: string, census: BuilderFailureCensus): string[] {
  const only = census.sessions.length === 1;
  return census.sessions.flatMap((row) =>
    sessionFindings(only || row.session === null ? epoch : `${epoch} session ${String(row.session)}`, row),
  );
}
