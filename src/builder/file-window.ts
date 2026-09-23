/**
 * Reads a file's facts, lines and pages while holding one chunk rather than the file.
 *
 * This is opencode's read tool with one change. Theirs walks the file in 256 KiB leaves, keeps every
 * leaf in an augmented rope and asks the rope for the byte offset of the first wanted line. A rope
 * answers repeated line queries cheaply, but a request here asks exactly once and the leaves are
 * never released, so paging to a late line in a large file holds every byte before it. Counting
 * newlines forward and discarding each chunk answers the same question in constant memory, which is
 * what these functions do and what `test/builder-file-window.test.ts` measures on a 24 MiB fixture.
 *
 * That difference is worth the rewrite because user context admits 25 MB per file and 200 MB across
 * the corpus: holding admitted text for the life of a run is the one place where the raised ceiling
 * would be paid in resident memory. The four exports are one boundary — everything a caller used to
 * need the whole text for.
 *
 * `readWindow` and `characterWindow` in read-window.ts stay the owners of what a window means and of
 * what it says it left out. These functions only put the right bytes in front of them.
 */
import { closeSync, openSync, readSync } from "../meta/filesystem.ts";
import {
  type CharacterWindow,
  type ReadWindow,
  READ_WINDOW_LINES,
  readWindow,
  windowRange,
} from "./read-window.ts";

/** opencode's FIRST_CHUNK. One page-sized read per step, whether skipping or collecting. */
const CHUNK_BYTES = 256 * 1024;
const NEWLINE = 0x0a;

/** Enough bytes for any window `readWindow` will keep, plus one chunk so the last line is whole. */
const SPAN_BYTES = 64 * 1024 + CHUNK_BYTES;

/**
 * What admission records about a file, from one forward pass that keeps no text.
 *
 * `lines` and `characters` are the totals every later window states as its `total`, and both are
 * recorded at admission, so a window never counts the file again. `text` is false when a byte is
 * zero or the file is not valid UTF-8: the whole-file half of the content sniff, which the first
 * chunk alone cannot answer for a file that hides a zero byte in its tail.
 */
interface TextFileFacts {
  bytes: number;
  lines: number;
  characters: number;
  text: boolean;
}

/**
 * The window of `path` covering lines `offset`..`offset + limit - 1`, where `totalLines` is the
 * count recorded when the file was admitted. Taking the total from admission rather than counting it
 * again is what keeps this to one forward pass: the caller already recorded that number.
 */
export function readFileWindow(
  path: string,
  totalLines: number,
  offset?: number,
  limit?: number,
): ReadWindow {
  const count = limit ?? READ_WINDOW_LINES;
  const range = windowRange(totalLines, offset, count);
  // An offset past the end is how a caller walking a file finds the end, so it answers without a
  // read. Without this the span would be empty, and an empty span still holds one empty line.
  if (range.to < range.from) return { ...range, total: totalLines, text: "", cut: false };
  const handle = openSync(path, "r");
  try {
    const chunk = new Uint8Array(CHUNK_BYTES);
    const start = skipLines(handle, chunk, range.from - 1);
    const span = collect(handle, chunk, start, count + 1);
    const window = readWindow(span, 1, count);
    // The span is a slice of the file, so `readWindow` counted the lines it was handed rather than
    // the file's. The file's own total decides what follows, or a windowed read of a large file
    // would announce itself complete at the end of every span.
    const to = Math.min(range.to, range.from - 1 + (window.to - window.from + 1));
    return { ...window, from: range.from, to, total: totalLines, more: to < totalLines };
  } finally {
    closeSync(handle);
  }
}

export function scanTextFile(path: string): TextFileFacts {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const facts: TextFileFacts = { bytes: 0, lines: 0, characters: 0, text: true };
  const count = (piece: string): void => {
    if (piece !== "" && facts.lines === 0) facts.lines = 1;
    for (const character of piece) {
      facts.characters += 1;
      if (character === "\n") facts.lines += 1;
    }
  };
  for (const chunk of fileChunks(path)) {
    facts.bytes += chunk.length;
    if (chunk.includes(0)) {
      facts.text = false;
      return facts;
    }
    try {
      // Streaming, so a character split across this boundary is completed by the next chunk rather
      // than failing here as a truncated sequence and marking a text file binary.
      count(decoder.decode(chunk, { stream: true }));
    } catch {
      facts.text = false;
      return facts;
    }
  }
  // The flush is where a sequence truncated at the end of the file finally fails.
  try {
    count(decoder.decode());
  } catch {
    facts.text = false;
  }
  return facts;
}

/**
 * The exact character page `characterWindow` would return for the whole text, built by decoding
 * forward and keeping only the wanted characters. Paging costs one pass over the characters before
 * the page, which is what a file read without an index costs; it never costs the file in memory.
 *
 * `limit` is required and is honoured as asked, because how large a page may be belongs to the
 * caller's result ceiling rather than to reading a file: the Builder's context tool applies
 * `characterLimit` before calling here.
 */
export function readFileCharacterWindow(
  path: string,
  totalCharacters: number,
  offset: number | undefined,
  limit: number,
): CharacterWindow {
  const range = windowRange(totalCharacters, offset, limit);
  if (range.to < range.from) return { ...range, total: totalCharacters, text: "" };
  const taken: string[] = [];
  let seen = 0;
  pages: for (const piece of textPieces(path)) {
    for (const character of piece) {
      seen += 1;
      if (seen < range.from) continue;
      taken.push(character);
      if (seen >= range.to) break pages;
    }
  }
  return { ...range, total: totalCharacters, text: taken.join("") };
}

/**
 * Every line of the file in order, 1-based, split the way `readWindow` splits text so a line number
 * from a search reaches the same line through a read. The caller sees one line at a time and decides
 * what to keep, which is what lets a search over a 200 MB corpus hold only its matches.
 */
export function eachFileLine(path: string, visit: (line: string, number: number) => void): void {
  let rest = "";
  let number = 0;
  let any = false;
  for (const piece of textPieces(path)) {
    any = true;
    const parts = (rest + piece).split(/\r?\n/);
    rest = parts.pop() ?? "";
    for (const line of parts) visit(line, (number += 1));
  }
  // An empty file has no lines at all, which is what `scanTextFile` records for it; every other file
  // ends with one more line, empty when the file ends in a newline.
  if (any) visit(rest, number + 1);
}

/**
 * The file's bytes, one chunk at a time. Each chunk is a view on one reused buffer, valid until the
 * loop asks for the next one — the same contract the callback form had, stated rather than enforced.
 *
 * A caller that breaks out of the loop still closes the handle at the break, because a `for...of`
 * over a generator calls its `return()` and that runs the `finally` here.
 */
function* fileChunks(path: string): Generator<Uint8Array> {
  const handle = openSync(path, "r");
  try {
    const chunk = new Uint8Array(CHUNK_BYTES);
    for (let position = 0; ; ) {
      const read = readSync(handle, chunk, 0, chunk.length, position);
      if (read === 0) return;
      position += read;
      yield chunk.subarray(0, read);
    }
  } finally {
    closeSync(handle);
  }
}

/**
 * The same walk, decoded. A piece never splits a character, so a caller may iterate it directly.
 *
 * The last piece is the decoder's flush, which holds whatever a truncated sequence at the end of the
 * file leaves behind. A caller that breaks early never reaches it, which is right: it stopped before
 * the end of the file, and there is no end to flush.
 */
function* textPieces(path: string): Generator<string> {
  const decoder = new TextDecoder();
  for (const chunk of fileChunks(path)) yield decoder.decode(chunk, { stream: true });
  const tail = decoder.decode();
  if (tail !== "") yield tail;
}

/** Byte offset of the line after `count` newlines, reading forward one chunk at a time. */
function skipLines(handle: number, chunk: Uint8Array, count: number): number {
  let position = 0;
  let seen = 0;
  while (seen < count) {
    const read = readSync(handle, chunk, 0, chunk.length, position);
    if (read === 0) return position;
    let index = 0;
    while (index < read && seen < count) {
      if (chunk[index] === NEWLINE) seen += 1;
      index += 1;
    }
    position += index;
  }
  return position;
}

/** Text from `start` covering at most `lines` newlines and `SPAN_BYTES` bytes. */
function collect(handle: number, chunk: Uint8Array, start: number, lines: number): string {
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let position = start;
  let newlines = 0;
  while (position - start < SPAN_BYTES && newlines < lines) {
    const read = readSync(handle, chunk, 0, chunk.length, position);
    if (read === 0) break;
    let index = 0;
    while (index < read && newlines < lines) {
      if (chunk[index] === NEWLINE) newlines += 1;
      index += 1;
    }
    // Streaming, so a character split across this boundary is completed by the next chunk instead of
    // decoding as a replacement character in the middle of a window the model will read.
    parts.push(decoder.decode(chunk.subarray(0, index), { stream: true }));
    position += index;
  }
  parts.push(decoder.decode());
  return parts.join("");
}
