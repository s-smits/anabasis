/**
 * v4 boundary: the summaries the Claude CLI wrote when it compacted, read from its own transcript.
 *
 * The CLI reports a compaction to the SDK stream as a boundary carrying only a token count; the
 * summary itself goes into the session transcript as a user record marked `isCompactSummary`. The
 * bridge deletes that transcript when it rewrites or abandons the session, so the turn end reads
 * the summaries first. Reading is best-effort: a transcript that is gone, or a line that does not
 * parse, yields no summary rather than failing the turn it reports on.
 */
import { getSessionPath } from "cc-session-io";
import { existsSync, readFileSync } from "../../src/meta/filesystem.ts";
import { isRecord, isString } from "../../src/meta/json-shape.ts";
import { capturedJsonParse } from "../../src/meta/json-runtime.ts";
import { hasText } from "../../src/meta/text.ts";

/** What one query has seen that outlives how it ends: its stop, the session the CLI announced,
 *  and the compactions whose summaries have not been handed over yet. */
export type QueryTally = { aborted: boolean; compactions: number; sessionId: string | undefined };

/** The text of one transcript line when it is a compaction summary, else null. */
function summaryText(line: string): string | null {
  let record;
  try {
    record = capturedJsonParse(line);
  } catch {
    return null;
  }
  if (!isRecord(record) || record.type !== "user" || record.isCompactSummary !== true) return null;
  const message = record.message;
  if (!isRecord(message)) return null;
  const content = message.content;
  if (isString(content)) return content;
  if (!Array.isArray(content)) return null;
  const text = content.flatMap((block) => (isRecord(block) && isString(block.text) ? [block.text] : []));
  return text.length === 0 ? null : text.join("\n");
}

/** The newest `count` compaction summaries in a CLI transcript, oldest of them first. */
export function compactSummaries(transcript: string, count: number): string[] {
  if (count <= 0 || !existsSync(transcript)) return [];
  let body: string;
  try {
    body = readFileSync(transcript, "utf8");
  } catch {
    return [];
  }
  const summaries = body.split("\n").flatMap((line) => {
    const text = summaryText(line);
    return text === null ? [] : [text];
  });
  return summaries.slice(-count);
}

/** The summaries of the compactions the tally still owes, read from the session's transcript. The
 *  count goes back to zero, so a query whose abort reported them does not report them again when
 *  it later settles or fails. */
export function takeCompactSummaries(
  tally: QueryTally,
  fallbackSessionId: string | undefined,
  cwd: string,
  configDir: string | undefined,
): string[] {
  const sessionId = tally.sessionId ?? fallbackSessionId;
  const count = tally.compactions;
  tally.compactions = 0;
  if (count === 0 || !hasText(sessionId)) return [];
  return compactSummaries(getSessionPath(sessionId, cwd, configDir), count);
}
