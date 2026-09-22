import { errorMessage } from "../meta/runtime-values.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
/**
 * The one owner of how much text a model-facing read returns, and of saying what it left out.
 *
 * Every Builder tool result must fit `TOOL_TEXT_LIMITS.evidence` (64 KB), while admitted files may
 * be far larger, so a large file becomes several windowed reads instead of one refusal. Every window
 * states `from`, `to` and `total`, so a partial read never looks like a whole one.
 */

/** Lines per text read. Roughly a long source file's worth, and far enough under the evidence
 *  ceiling that the byte guard below stays a guard rather than the usual path. */
export const READ_WINDOW_LINES = 400;
/** Rows per listing. Listings are denser per row than source lines, so the count is lower. */
export const LIST_WINDOW_ROWS = 200;
/** Code points per exact text page: even all control characters fit the 64 KB ceiling once
 *  JSON-escaped. */
const CHARACTER_WINDOW_CHARS = 6_000;
/** Code points of a thrown cause the Builder is shown. */
const ERROR_PAGE_CHARS = 3_000;
/** Headroom under the 64 KB evidence ceiling for the header line the caller adds around the body. */
const WINDOW_BYTES = 48 * 1024;

interface WindowRange {
  /** First 1-based index included. */
  from: number;
  /** Last 1-based index included; `from - 1` when the window is empty. */
  to: number;
  /** Whether anything follows `to`. */
  more: boolean;
}

export interface ReadWindow extends WindowRange {
  total: number;
  text: string;
  /** The first line alone exceeded the byte guard and was returned cut mid-line; line offsets
   *  cannot reach its tail. */
  cut: boolean;
}

export interface CharacterWindow extends WindowRange {
  total: number;
  text: string;
}

interface JsonListPage extends WindowRange {
  total: number;
  /** The rendered body: this range, the total, and the taken records under the caller's key. */
  text: string;
  /** How many records the body carries. */
  count: number;
}

/** The shared paging arithmetic. An offset past the end is an empty window, not an error. */
export function windowRange(total: number, offset = 1, limit = READ_WINDOW_LINES): WindowRange {
  const from = Math.max(1, Math.trunc(offset));
  const count = Math.max(1, Math.trunc(limit));
  const to = Math.min(total, from + count - 1);
  return { from, to: Math.max(to, from - 1), more: to < total };
}

/** The hard cap on one exact character page, shared by every page builder including the streaming
 *  reader in file-window.ts. */
export function characterLimit(limit = CHARACTER_WINDOW_CHARS): number {
  return Number.isFinite(limit)
    ? Math.min(Math.max(1, Math.trunc(limit)), CHARACTER_WINDOW_CHARS)
    : CHARACTER_WINDOW_CHARS;
}

/** Exact character paging for minified or single-line text, where one line crosses the byte guard.
 *  The hard cap applies even when a caller asks for more. */
export function characterWindow(text: string, offset = 1, limit = CHARACTER_WINDOW_CHARS): CharacterWindow {
  const characters = Array.from(text);
  const range = windowRange(characters.length, offset, characterLimit(limit));
  return {
    ...range,
    total: characters.length,
    text: characters.slice(range.from - 1, range.to).join(""),
  };
}

/**
 * Windows `text` by lines, then holds the result under the byte guard, since a line count alone
 * does not bound bytes. A first line too long on its own is returned cut rather than refused;
 * cutting mid-character yields one replacement character, never a decode failure.
 */
export function readWindow(text: string, offset?: number, limit?: number): ReadWindow {
  const lines = text.split(/\r?\n/);
  const range = windowRange(lines.length, offset, limit);
  const taken: string[] = [];
  let bytes = 0;
  let cut = false;
  for (const line of lines.slice(range.from - 1, range.to)) {
    // The line's UTF-8 cost, counting the newline that rejoins it.
    const cost = new TextEncoder().encode(line).byteLength + 1;
    if (bytes + cost > WINDOW_BYTES) {
      if (taken.length === 0) {
        taken.push(new TextDecoder().decode(new TextEncoder().encode(line).subarray(0, WINDOW_BYTES)));
        cut = true;
      }
      break;
    }
    taken.push(line);
    bytes += cost;
  }
  const to = range.from - 1 + taken.length;
  return { from: range.from, to, total: lines.length, more: to < lines.length, text: taken.join("\n"), cut };
}

/**
 * A listing the model receives as one JSON body. The byte guard stops before the tool ceiling
 * would cut the JSON mid-structure, so `to` and `more` name the records the body carries.
 *
 * One record is always taken, so paging always advances; a single record past the guard is left
 * to the ceiling.
 */
export function jsonListPage<T>(
  records: readonly T[],
  key: string,
  offset?: number,
  limit?: number,
): JsonListPage {
  const range = windowRange(records.length, offset, limit);
  const encoder = new TextEncoder();
  // The envelope is measured with the records.
  const body = (rows: readonly T[], to: number) =>
    capturedJsonStringify({
      from: range.from,
      to,
      more: to < records.length,
      total: records.length,
      [key]: rows,
    });
  const taken: T[] = [];
  let bytes = encoder.encode(body([], range.from - 1)).byteLength;
  for (const record of records.slice(range.from - 1, range.to)) {
    // The record's own JSON cost, counting the comma that joins it to the previous one.
    const cost = encoder.encode(capturedJsonStringify(record)).byteLength + 1;
    if (taken.length > 0 && bytes + cost > WINDOW_BYTES) break;
    taken.push(record);
    bytes += cost;
  }
  const to = range.from - 1 + taken.length;
  return {
    from: range.from,
    to,
    more: to < records.length,
    total: records.length,
    text: body(taken, to),
    count: taken.length,
  };
}

/**
 * A thrown cause as the Builder may read it: one page, and the count of what did not fit. Unlike
 * `windowNote` it offers no offset, since there is nothing to call again.
 */
export function visibleError(cause: unknown, limit = ERROR_PAGE_CHARS): string {
  const text = errorMessage(cause);
  const page = characterWindow(text, 1, limit);
  const omitted = page.total - page.to;
  return page.more ? `${page.text}… (${omitted} character${omitted === 1 ? "" : "s"} omitted)` : page.text;
}

/** The one sentence a windowed read carries, so every tool says it the same way. */
export function windowNote(
  window: WindowRange & { total: number; cut?: boolean },
  unit: string,
  offsetName = "offset",
): string {
  const seen = `${unit} ${window.from}-${window.to} of ${window.total}`;
  // A cut line is stated with the range, or "lines 1-1 of 1" would read as complete.
  const cut =
    window.cut === true
      ? `; ${unit.replace(/s$/, "")} ${window.from} was cut at the byte guard and its remaining bytes are not reachable by offset`
      : "";
  return window.more
    ? `${seen}${cut}; call again with ${offsetName} ${window.to + 1} for the rest`
    : `${seen}${cut}`;
}
