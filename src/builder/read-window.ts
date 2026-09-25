import { errorMessage } from "../meta/runtime-values.ts";
/**
 * The one owner of how much text a model-facing read returns, and of saying what it left out.
 *
 * Every Builder tool result passes through `evidenceResult`, which throws when the text exceeds
 * `TOOL_TEXT_LIMITS.evidence` (64 KB). The admission ceilings above it are larger — user context
 * admits files up to 25 MB and the correctness-model workshop reads up to 256 KB — so a file in that
 * gap was admitted, listed in the manifest with its line count, and then threw on the read the
 * manifest had just invited. The window closes that gap: a large file becomes several reads instead
 * of one refusal.
 *
 * Announcing the cut is the required half. A read that silently returns the first part of a file
 * reads exactly like a read that returned all of it, and a Builder that believes it has seen a whole
 * checker will author against the part it saw. Every window states `from`, `to` and `total`, so a
 * partial read is a fact the model holds rather than one it has to infer.
 */

/** Lines per text read. Roughly a long source file's worth, and far enough under the evidence
 *  ceiling that the byte guard below stays a guard rather than the usual path. */
export const READ_WINDOW_LINES = 400;
/** Rows per listing. Listings are denser per row than source lines, so the count is lower. */
export const LIST_WINDOW_ROWS = 200;
/** Code points per exact text page. Six thousand JSON control characters still fit below the 64 KB
 *  tool-result ceiling after escaping, and ordinary UTF-8 stays considerably smaller. */
const CHARACTER_WINDOW_CHARS = 6_000;
/** Code points of a thrown cause the Builder is shown. `harness_trial` and `check-tool` each chose
 *  3,000 for this independently, which is the sign that how much of a cause is worth reading belongs
 *  to the sentence reporting it rather than to the tool that threw. */
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
  /** The first line alone exceeded the byte guard and was returned cut mid-line. Stated because a
   *  cut line otherwise reads exactly like a whole one, and line offsets cannot reach its tail. */
  cut: boolean;
}

export interface CharacterWindow extends WindowRange {
  total: number;
  text: string;
}

/** The shared arithmetic, so listings and text reads page by one convention. An offset past the end
 *  is an empty window rather than an error: it is how a caller walking a file finds the end. */
export function windowRange(total: number, offset = 1, limit = READ_WINDOW_LINES): WindowRange {
  const from = Math.max(1, Math.trunc(offset));
  const count = Math.max(1, Math.trunc(limit));
  const to = Math.min(total, from + count - 1);
  return { from, to: Math.max(to, from - 1), more: to < total };
}

/** The hard cap on one exact character page, applied wherever a page is built — including by the
 *  streaming reader in file-window.ts, which pages a file it never holds. Stated once so a request
 *  for more cannot be honoured by one caller and refused by the other. */
export function characterLimit(limit = CHARACTER_WINDOW_CHARS): number {
  return Number.isFinite(limit)
    ? Math.min(Math.max(1, Math.trunc(limit)), CHARACTER_WINDOW_CHARS)
    : CHARACTER_WINDOW_CHARS;
}

/** Exact character paging for minified or otherwise single-line text. `readWindow` stays the normal
 *  source reader because line numbers are useful; this is its reachable continuation when one line
 *  alone crosses the byte guard. The hard cap applies even when a caller asks for more. */
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
 * Windows `text` by lines, then holds the result under the byte guard. Both cuts are needed: a line
 * count alone does not bound bytes, and minified data arrives as one very long line. A first line
 * that does not fit on its own is returned cut to the guard rather than refused, because a Builder
 * inspecting minified public data still needs to see its beginning. Cutting mid-character yields one
 * replacement character and never a decode failure.
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
 * A thrown cause as the Builder may read it: one page, and the count of what did not fit. It is held
 * here beside the paging it reports on because `harness_trial` and `correctness_check` each had a
 * copy of it that differed from the other's only in its page size, and both of them said
 * "1 characters omitted" on the cause that is one character too long.
 *
 * This is deliberately not `windowNote`: there is no offset to call again with, so the sentence must
 * not offer one.
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
  // A cut line is stated in the same sentence as the range: without it, "lines 1-1 of 1" over a
  // minified file reads as a complete read of a file whose later bytes no offset can reach.
  const cut =
    window.cut === true
      ? `; ${unit.replace(/s$/, "")} ${window.from} was cut at the byte guard and its remaining bytes are not reachable by offset`
      : "";
  return window.more
    ? `${seen}${cut}; call again with ${offsetName} ${window.to + 1} for the rest`
    : `${seen}${cut}`;
}

/** The line a limit-cut listing or search ends with, empty when nothing was cut. The rest is one
 *  larger limit away, so the result owes the count and nothing more; without it a cut search reads
 *  exactly like a complete one. */
export function moreRowsNote(total: number, shown: number, one: string, many: string): string {
  const more = total - shown;
  return more > 0 ? `\n\n[${more} more ${more === 1 ? one : many}. Use a larger limit.]` : "";
}
