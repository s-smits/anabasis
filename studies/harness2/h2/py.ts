/**
 * The few Python behaviours the port has to repeat byte for byte, because Harness²'s evidence
 * trees and missions are built from them: how Python prints a value inside an f-string and a `!r`,
 * how `json.dumps` writes, what `str.strip` and `str.splitlines` treat as space and line ends, that
 * `len` and slices count code points, that `sorted(Path.rglob("*"))` orders by path parts, what
 * `fnmatch` matches, and `difflib`'s unified diff, whose hunks come from `SequenceMatcher` with its
 * autojunk rule. Each is CPython's behaviour for the inputs Harness² gives it; where the port
 * knowingly falls short, the function says so. Ported 3 November 2026 for `../README.md`'s
 * TypeScript Harness² (`h2/`), so that its evidence matches the pilot's recorded trees.
 */
import { readdirSync, statSync } from "#src/meta/filesystem.ts";
import { isNumber, isRecord, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";

type Tag = "equal" | "replace" | "delete" | "insert";
type Opcode = readonly [tag: Tag, i1: number, i2: number, j1: number, j2: number];

/** Python's `str.isspace` set, which `strip` removes; JavaScript's `trim` differs at six code points. */
const SPACE = String.raw`\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000`;
const STRIP = new RegExp(`^[${SPACE}]+|[${SPACE}]+$`, "gu");
const LSTRIP = new RegExp(`^[${SPACE}]+`, "u");
/** Every line boundary `str.splitlines` breaks on; the three separators U+001C to U+001E among them. */
const LINE_END = new RegExp(
  String.raw`\r\n|[\n\r\v\f\x85\u2028\u2029${String.fromCodePoint(0x1c, 0x1d, 0x1e)}]`,
  "gu",
);
const SURROGATE = /[\uD800-\uDFFF]/u;
/** What `repr` escapes beyond the quote and the backslash: the categories Python calls unprintable. */
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;
const SHORT_ESCAPES = new Map([
  ["\n", String.raw`\n`],
  ["\r", String.raw`\r`],
  ["\t", String.raw`\t`],
  ["\\", String.raw`\\`],
]);
/** `get_opcodes`' tag for a gap before a match, keyed by whether `a` and then `b` skip lines. */
const GAP_TAG = new Map<string, Tag>([
  ["true,true", "replace"],
  ["true,false", "delete"],
  ["false,true", "insert"],
]);
/** `get_grouped_opcodes`' default context, as `unified_diff` passes it. */
const CONTEXT = 3;

/** `str.strip()`. */
export function pyStrip(text: string): string {
  return text.replaceAll(STRIP, "");
}

/** `str.lstrip()`. */
export function pyLstrip(text: string): string {
  return text.replace(LSTRIP, "");
}

/** `str.splitlines()`, or with `keep` set `splitlines(keepends=True)`. */
export function splitLines(text: string, keep: "keep" | "drop" = "drop"): string[] {
  const lines: string[] = [];
  let start = 0;
  for (const match of text.matchAll(LINE_END)) {
    const end = match.index + match[0].length;
    lines.push(text.slice(start, keep === "keep" ? end : match.index));
    start = end;
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

/** `len(text)`: code points, not UTF-16 units. */
export function pyLen(text: string): number {
  return SURROGATE.test(text) ? Array.from(text).length : text.length;
}

/** `text[start:end]` over code points; `end` undefined runs to the end. */
export function pySlice(text: string, start: number, end?: number): string {
  if (!SURROGATE.test(text)) return text.slice(start, end);
  return Array.from(text).slice(start, end).join("");
}

/** Python's truthiness of a decoded JSON value: what `x or y` and `if x` read. */
export function truthy(value: JsonValue | undefined): boolean {
  if (value === null || value === undefined || value === false || value === 0 || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return !isRecord(value) || Object.keys(value).length > 0;
}

/**
 * `repr` of a decoded JSON number. JSON's `1.0` and `1` both arrive as 1, so a whole number prints
 * as Python prints the int: the one place the port can differ from a float Python held.
 */
function pyNumber(value: number): string {
  if (!Number.isFinite(value)) return Number.isNaN(value) ? "nan" : value > 0 ? "inf" : "-inf";
  if (Number.isInteger(value) && Math.abs(value) < 1e16) return String(value);
  const [mantissa = "", exponentText = "0"] = value.toExponential().split("e");
  const exponent = Number(exponentText);
  if (exponent >= -4 && exponent < 16) return String(value);
  return `${mantissa}e${exponent < 0 ? "-" : "+"}${String(Math.abs(exponent)).padStart(2, "0")}`;
}

/** `repr(str)`: single quotes unless the text holds one and no double quote. */
function reprString(text: string): string {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let out = "";
  for (const char of text) {
    const short = SHORT_ESCAPES.get(char);
    const code = char.codePointAt(0) ?? 0;
    if (short !== undefined) out += short;
    else if (char === quote) out += `\\${char}`;
    else if (char === " " || !UNPRINTABLE.test(char)) out += char;
    else if (code < 0x100) out += `\\x${code.toString(16).padStart(2, "0")}`;
    else {
      out +=
        code < 0x10000
          ? `\\u${code.toString(16).padStart(4, "0")}`
          : `\\U${code.toString(16).padStart(8, "0")}`;
    }
  }
  return `${quote}${out}${quote}`;
}

/** `repr(value)` for a decoded JSON value. */
export function pyRepr(value: JsonValue | undefined): string {
  if (isString(value)) return reprString(value);
  if (Array.isArray(value)) return `[${value.map((item) => pyRepr(item)).join(", ")}]`;
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .map(([key, item]) => `${reprString(key)}: ${pyRepr(item)}`)
      .join(", ")}}`;
  }
  return pyStr(value);
}

/** `str(value)`, as an f-string prints it. */
export function pyStr(value: JsonValue | undefined): string {
  if (value === null || value === undefined) return "None";
  if (value === true || value === false) return value ? "True" : "False";
  if (isString(value)) return value;
  return isNumber(value) ? pyNumber(value) : pyRepr(value);
}

/**
 * `json.dumps(value)`: `", "` and `": "` between items on one line, or `indent` spaces a level, and
 * non-ASCII escaped as `ensure_ascii` does unless `ascii` is `"raw"` (`ensure_ascii=False`).
 */
export function pyDumps(
  value: JsonValue,
  options: { indent?: number; ascii?: "escape" | "raw" } = {},
): string {
  const text = dumpValue(value, options.indent, 0);
  if (options.ascii === "raw") return text;
  const unit = (code: number): string => `\\u${code.toString(16).padStart(4, "0")}`;
  return text.replaceAll(/[^\p{ASCII}]/gu, (char) => {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x10000) return unit(code);
    return unit(0xd800 + ((code - 0x10000) >> 10)) + unit(0xdc00 + ((code - 0x10000) & 0x3ff));
  });
}

function dumpValue(value: JsonValue, indent: number | undefined, depth: number): string {
  if (value === null || value === true || value === false || isString(value)) return JSON.stringify(value);
  if (isNumber(value)) {
    if (Number.isFinite(value)) return pyNumber(value);
    return Number.isNaN(value) ? "NaN" : value > 0 ? "Infinity" : "-Infinity";
  }
  const items = Array.isArray(value)
    ? value.map((item) => dumpValue(item, indent, depth + 1))
    : Object.entries(value).map(
        ([key, item]) => `${JSON.stringify(key)}: ${dumpValue(item, indent, depth + 1)}`,
      );
  const [open, close] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
  if (items.length === 0) return `${open}${close}`;
  if (indent === undefined) return `${open}${items.join(", ")}${close}`;
  const pad = " ".repeat(indent * (depth + 1));
  return `${open}\n${pad}${items.join(`,\n${pad}`)}\n${" ".repeat(indent * depth)}${close}`;
}

/** Path parts compared one by one, as `sorted()` orders `Path` objects. */
function byParts(left: string, right: string): number {
  const a = left.split("/");
  const b = right.split("/");
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const x = a[index] ?? "";
    const y = b[index] ?? "";
    if (x !== y) return x < y ? -1 : 1;
  }
  return a.length - b.length;
}

/**
 * The files under `root`, relative and `/`-separated, in `sorted(root.rglob("*"))` order, with
 * `skip` naming directory parts never entered (`__pycache__`). A link to a file counts, as
 * `is_file()` follows it; a link to a directory is not entered.
 */
export function walkFiles(root: string, skip: readonly string[] = []): string[] {
  const out: string[] = [];
  const visit = (rel: string): void => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      const child = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!skip.includes(entry.name)) visit(child);
      } else if (
        entry.isFile() ||
        statSync(join(root, child), { throwIfNoEntry: false })?.isFile() === true
      ) {
        out.push(child);
      }
    }
  };
  if (statSync(root, { throwIfNoEntry: false })?.isDirectory() === true) visit("");
  return out.toSorted(byParts);
}

/**
 * `fnmatch.fnmatch(name, pattern)` on POSIX: case-sensitive, `*` crosses `/`. Bracket classes are
 * left out, since no pattern Harness² declares for JobBench holds one.
 */
export function fnmatch(name: string, pattern: string): boolean {
  const source = Array.from(pattern)
    .map((char) => {
      if (char === "*") return ".*";
      return char === "?" ? "." : char.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
    })
    .join("");
  return new RegExp(`^(?:${source})$`, "su").test(name);
}

/** `SequenceMatcher(None, a, b).find_longest_match`, over `b2j` with autojunk's popular lines out. */
function longestMatch(
  lines: { a: readonly string[]; b: readonly string[]; b2j: ReadonlyMap<string, readonly number[]> },
  [alo, ahi, blo, bhi]: readonly [number, number, number, number],
): [number, number, number] {
  const { a, b, b2j } = lines;
  let [bestI, bestJ, bestSize] = [alo, blo, 0];
  let lengths = new Map<number, number>();
  for (let i = alo; i < ahi; i += 1) {
    const next = new Map<number, number>();
    for (const j of b2j.get(a[i] ?? "") ?? []) {
      if (j < blo) continue;
      if (j >= bhi) break;
      const size = (lengths.get(j - 1) ?? 0) + 1;
      next.set(j, size);
      if (size > bestSize) [bestI, bestJ, bestSize] = [i - size + 1, j - size + 1, size];
    }
    lengths = next;
  }
  while (bestI > alo && bestJ > blo && a[bestI - 1] === b[bestJ - 1]) {
    [bestI, bestJ, bestSize] = [bestI - 1, bestJ - 1, bestSize + 1];
  }
  while (bestI + bestSize < ahi && bestJ + bestSize < bhi && a[bestI + bestSize] === b[bestJ + bestSize]) {
    bestSize += 1;
  }
  return [bestI, bestJ, bestSize];
}

/** `get_matching_blocks()`: the longest matches found recursively, adjacent ones merged. */
function matchingBlocks(a: readonly string[], b: readonly string[]): [number, number, number][] {
  const b2j = new Map<string, number[]>();
  for (const [index, line] of b.entries()) b2j.set(line, [...(b2j.get(line) ?? []), index]);
  if (b.length >= 200) {
    const limit = Math.floor(b.length / 100) + 1;
    for (const [line, list] of b2j) if (list.length > limit) b2j.delete(line);
  }
  const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]];
  const found: [number, number, number][] = [];
  for (let range = queue.pop(); range !== undefined; range = queue.pop()) {
    const [alo, ahi, blo, bhi] = range;
    const [i, j, k] = longestMatch({ a, b, b2j }, range);
    if (k === 0) continue;
    found.push([i, j, k]);
    if (alo < i && blo < j) queue.push([alo, i, blo, j]);
    if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
  }
  const merged: [number, number, number][] = [];
  let [i1, j1, k1] = [0, 0, 0];
  for (const [i2, j2, k2] of found.toSorted((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2])) {
    if (i1 + k1 === i2 && j1 + k1 === j2) k1 += k2;
    else {
      if (k1 > 0) merged.push([i1, j1, k1]);
      [i1, j1, k1] = [i2, j2, k2];
    }
  }
  if (k1 > 0) merged.push([i1, j1, k1]);
  merged.push([a.length, b.length, 0]);
  return merged;
}

/** `get_opcodes()` cut into `get_grouped_opcodes(3)`'s hunks. */
function groupedOpcodes(a: readonly string[], b: readonly string[]): Opcode[][] {
  const codes: Opcode[] = [];
  let [i, j] = [0, 0];
  for (const [ai, bj, size] of matchingBlocks(a, b)) {
    const tag = GAP_TAG.get(`${String(i < ai)},${String(j < bj)}`);
    if (tag !== undefined) codes.push([tag, i, ai, j, bj]);
    [i, j] = [ai + size, bj + size];
    if (size > 0) codes.push(["equal", ai, i, bj, j]);
  }
  if (codes.length === 0) codes.push(["equal", 0, 1, 0, 1]);
  const first = codes[0];
  if (first?.[0] === "equal") {
    codes[0] = [
      "equal",
      Math.max(first[1], first[2] - CONTEXT),
      first[2],
      Math.max(first[3], first[4] - CONTEXT),
      first[4],
    ];
  }
  const last = codes.at(-1);
  if (last?.[0] === "equal") {
    codes[codes.length - 1] = [
      "equal",
      last[1],
      Math.min(last[2], last[1] + CONTEXT),
      last[3],
      Math.min(last[4], last[3] + CONTEXT),
    ];
  }
  const groups: Opcode[][] = [];
  let group: Opcode[] = [];
  for (const [tag, a1, a2, b1, b2] of codes) {
    let [from, to] = [a1, b1];
    if (tag === "equal" && a2 - a1 > 2 * CONTEXT) {
      group.push([tag, a1, Math.min(a2, a1 + CONTEXT), b1, Math.min(b2, b1 + CONTEXT)]);
      groups.push(group);
      group = [];
      [from, to] = [Math.max(a1, a2 - CONTEXT), Math.max(b1, b2 - CONTEXT)];
    }
    group.push([tag, from, a2, to, b2]);
  }
  if (group.length > 0 && !(group.length === 1 && group[0]?.[0] === "equal")) groups.push(group);
  return groups;
}

function unifiedRange(start: number, stop: number): string {
  const length = stop - start;
  if (length === 1) return String(start + 1);
  return `${length === 0 ? start : start + 1},${length}`;
}

/** `"".join(difflib.unified_diff(a, b, fromfile, tofile))` over `splitlines(keepends=True)` lists. */
export function unifiedDiff(
  a: readonly string[],
  b: readonly string[],
  names: { from: string; to: string },
): string {
  const groups = groupedOpcodes(a, b);
  if (groups.length === 0) return "";
  let out = `--- ${names.from}\n+++ ${names.to}\n`;
  for (const group of groups) {
    const [first, last] = [group[0], group.at(-1)];
    if (first === undefined || last === undefined) continue;
    out += `@@ -${unifiedRange(first[1], last[2])} +${unifiedRange(first[3], last[4])} @@\n`;
    for (const [tag, i1, i2, j1, j2] of group) {
      if (tag === "equal") {
        out += a
          .slice(i1, i2)
          .map((line) => ` ${line}`)
          .join("");
        continue;
      }
      if (tag !== "insert") {
        out += a
          .slice(i1, i2)
          .map((line) => `-${line}`)
          .join("");
      }
      if (tag !== "delete") {
        out += b
          .slice(j1, j2)
          .map((line) => `+${line}`)
          .join("");
      }
    }
  }
  return out;
}
