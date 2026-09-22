/**
 * Reads a file's facts, lines and pages while holding one chunk rather than the file.
 *
 * Each request counts newlines forward and discards every chunk, so memory stays constant however
 * late the wanted line is. User context may admit large files, so no admitted text is held.
 *
 * `readWindow` and `characterWindow` in read-window.ts own what a window means; these functions
 * only supply the bytes.
 */
import { closeSync, openSync, readSync } from "../meta/filesystem.ts";
import {
  type CharacterWindow,
  type ReadWindow,
  READ_WINDOW_LINES,
  readWindow,
  windowRange,
} from "./read-window.ts";

/** One page-sized read per step, whether skipping or collecting. */
const CHUNK_BYTES = 256 * 1024;
const NEWLINE = 0x0a;

/** Enough bytes for any window `readWindow` will keep, plus one chunk so the last line is whole. */
const SPAN_BYTES = 64 * 1024 + CHUNK_BYTES;

/**
 * What admission records about a file, from one forward pass that keeps no text.
 *
 * `lines` and `characters` are the totals every later window states, so no window counts the file
 * again. `text` is false when any byte is zero or the file is not valid UTF-8.
 */
interface TextFileFacts {
  bytes: number;
  lines: number;
  characters: number;
  text: boolean;
}

/**
 * The window of `path` covering lines `offset`..`offset + limit - 1`, where `totalLines` is the
 * count recorded at admission, so the read is one forward pass.
 */
export function readFileWindow(
  path: string,
  totalLines: number,
  offset?: number,
  limit?: number,
): ReadWindow {
  const count = limit ?? READ_WINDOW_LINES;
  const range = windowRange(totalLines, offset, count);
  // An offset past the end answers without a read; an empty span would still hold one empty line.
  if (range.to < range.from) return { ...range, total: totalLines, text: "", cut: false };
  const handle = openSync(path, "r");
  try {
    const chunk = new Uint8Array(CHUNK_BYTES);
    const start = skipLines(handle, chunk, range.from - 1);
    const span = collect(handle, chunk, start, count + 1);
    const window = readWindow(span, 1, count);
    // `readWindow` counted only the span; the file's own total decides whether more follows.
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
      // Streaming, so a character split across chunks is not a truncated sequence.
      count(decoder.decode(chunk, { stream: true }));
    } catch {
      facts.text = false;
      return facts;
    }
  }
  // The flush fails on a sequence truncated at the end of the file.
  try {
    count(decoder.decode());
  } catch {
    facts.text = false;
  }
  return facts;
}

/**
 * The exact character page `characterWindow` would return for the whole text, decoded forward
 * keeping only the wanted characters. `limit` is honoured as asked; the caller owns the page ceiling.
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
 * from a search reaches the same line through a read. The caller keeps only what it needs.
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
  // An empty file has no lines; any other file ends with one more line, empty after a final newline.
  if (any) visit(rest, number + 1);
}

/**
 * The file's bytes, one chunk at a time. Each chunk is a view on one reused buffer, valid until the
 * next one is requested. Breaking out of the loop runs the `finally` and closes the handle.
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
 * The same walk, decoded. A piece never splits a character; the last piece is the decoder's flush.
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
    // Streaming, so a character split across chunks is not decoded as a replacement character.
    parts.push(decoder.decode(chunk.subarray(0, index), { stream: true }));
    position += index;
  }
  parts.push(decoder.decode());
  return parts.join("");
}
