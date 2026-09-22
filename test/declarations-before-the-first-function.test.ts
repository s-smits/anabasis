/**
 * The rule that puts every type, interface and module constant at the front, and the fixer that
 * is the reason the rule is worth having: this is a reordering pass, not a set of judgements.
 *
 * What the fixture pins is the safety test, because that is the whole of the rule. An erased
 * declaration moves unconditionally; a `const` moves only where hoisting it cannot be observed,
 * which bars an effect in the initialiser and a read of a name whose value depends on where the
 * read happens. Two behaviours below are easy to lose and neither shows up in the source of the
 * rule: a constant reading another constant that is itself still under the code moves on the
 * pass after that one does, so the sweep only settles because it runs to convergence; and the
 * comment above a declaration travels with it, which is the part a hand edit gets wrong.
 *
 * The safe-name set is where the rule was blind until 2026-09-20: it admitted an import and a
 * function declaration wherever they sat but not an `interface` or a `type` this file declares,
 * so `const BY_LATE = new Map<string, Late>()` was refused for reading a name that is erased and
 * cannot depend on position. Eight true sites tree-wide were hidden by that. `FROM_ENUM` is the
 * boundary: an enum is not erased, so a read of one below the code stays refused.
 */
import { describe, expect, it } from "bun:test";
import { expectedLines, fixedSource, reportedLines } from "./helpers/oxlint-rule-fixture.ts";

const RULE = "declarations-before-the-first-function";
const MIXED = `export function first(row: string): string {
  return row.trim();
}

interface Late { // REPORT erased, so its position is a reading decision and nothing else
  readonly one: string;
}
type Alias = string; // REPORT erased
/** The size a reader goes to the front of the file to find. */
const PLAIN = 3; // REPORT no effect in the initialiser and no position-dependent read
const BUILT = new Set(["a"]); // REPORT a pure constructor has no result but its value
const BY_LATE = new Map<string, Late>(); // REPORT reads a type this file declares, which is erased
const DERIVED = PLAIN + 1; // ADMITTED reads a const still under the code; movable once PLAIN moves
const CWD = process.cwd(); // ADMITTED a call in the initialiser
const HOME = process.env.HOME; // ADMITTED reads a global, whose value depends on where it is read
let counter = 1; // ADMITTED a module let is state, not a constant
const bump = (): number => counter + 1; // ADMITTED holds a function, not a value
enum Mode {
  One = 1,
}
const FROM_ENUM = Mode.One; // ADMITTED an enum has a runtime value, so where it is read matters

export function second(one: Late, two: Alias): number {
  const read = PLAIN + BUILT.size + BY_LATE.size + DERIVED + FROM_ENUM + bump();
  return read + CWD.length + (HOME ?? "").length + one.one.length + two.length;
}
`;

/**
 * Two statements on one line. The move carries the declaration's own line and the blank lines
 * under it, and "its own line" reached the next newline — which here is past a neighbour the
 * rule never decided could go. `LIMIT` is movable; `now` holds a call and is not.
 */
const SHARED_LINE = `export function first(row: string): string {
  return row.trim();
}

const LIMIT = 3; const now = Date.now(); // REPORT movable, beside one that is not
export const spent = (used: number): boolean => used > LIMIT && now > 0;
`;

/**
 * `const` fixes the binding and not what it holds. The rule reads a plain name of a file-declared
 * constant as safe, which it is, and used to read a part of one the same way, which it is not:
 * a statement between the front of the file and the declaration can write to that part, and the
 * hoisted constant then holds the value the object started with. Nothing fails; the number is
 * just different.
 */
const PARTS = `const CONFIG = { limit: 1 };

export function first(row: string): string {
  return row.trim();
}

CONFIG.limit = 2;
const SIZE = CONFIG.limit; // ADMITTED a part of a const this file declares, written to above
const COPY = CONFIG; // REPORT the binding itself cannot be reassigned, so reading it is safe
export const shown = String(SIZE) + String(COPY.limit);
`;

/**
 * The same write reached without a member expression. `new Set(VALUES)` has no effect, but it
 * copies what `VALUES` holds when it runs: two values below the write and one above it.
 */
const SNAPSHOT = `const VALUES = new Set([1]);
const LIMITS = { low: 1 };

export function first(): void {}

VALUES.add(2);
LIMITS.low = 2;
export const SNAPSHOT = new Set(VALUES); // ADMITTED copies a collection the code writes to
export const KEYS = Object.keys(LIMITS); // ADMITTED reads the contents through a pure builder
export const SPREAD = [...VALUES]; // ADMITTED a spread copies the contents too
export const ALIAS = VALUES; // REPORT the same object wherever it is read
`;

describe("ana/declarations-before-the-first-function", () => {
  it("moves what is erased or provably fixed, and leaves an effect, a global read and state alone", () => {
    const expected = expectedLines(MIXED);
    expect(expected).toHaveLength(5);
    expect(reportedLines("ana", RULE, MIXED)).toStrictEqual(expected);
  });

  it("reads a name as safe and a part of that same name as written to", () => {
    expect(reportedLines("ana", RULE, PARTS)).toStrictEqual(expectedLines(PARTS));
    const fixed = fixedSource("ana", RULE, PARTS);
    const code = fixed.indexOf("export function first");
    expect(fixed.indexOf("const COPY = CONFIG;")).toBeLessThan(code);
    expect(fixed.indexOf("const SIZE = CONFIG.limit;")).toBeGreaterThan(code);
  });

  it("leaves a copy of a collection below the writes it copies", () => {
    expect(reportedLines("ana", RULE, SNAPSHOT)).toStrictEqual(expectedLines(SNAPSHOT));
    const fixed = fixedSource("ana", RULE, SNAPSHOT);
    const write = fixed.indexOf("VALUES.add(2);");
    expect(fixed.indexOf("export const SNAPSHOT = new Set(VALUES);")).toBeGreaterThan(write);
    expect(fixed.indexOf("export const ALIAS = VALUES;")).toBeLessThan(write);
  });

  it("moves only its own statement when a second one shares the line", () => {
    expect(reportedLines("ana", RULE, SHARED_LINE)).toStrictEqual(expectedLines(SHARED_LINE));
    const fixed = fixedSource("ana", RULE, SHARED_LINE);
    const code = fixed.indexOf("export function first");
    expect(fixed.indexOf("const LIMIT = 3;")).toBeLessThan(code);
    expect(fixed.indexOf("const now = Date.now();")).toBeGreaterThan(code);
  });

  it("hoists to the front, carries the comment with the declaration, and settles the chain it unblocks", () => {
    const fixed = fixedSource("ana", RULE, MIXED);
    const code = fixed.indexOf("export function first");
    for (const moved of [
      "interface Late",
      "type Alias",
      "const PLAIN = 3;",
      "const BUILT",
      "const BY_LATE",
      "const DERIVED",
    ]) {
      expect(fixed.indexOf(moved)).toBeGreaterThan(-1);
      expect(fixed.indexOf(moved)).toBeLessThan(code);
    }
    for (const stayed of ["const CWD", "const HOME", "let counter", "const bump", "const FROM_ENUM"]) {
      expect(fixed.indexOf(stayed)).toBeGreaterThan(code);
    }
    expect(fixed).toContain(
      "/** The size a reader goes to the front of the file to find. */\nconst PLAIN = 3;",
    );
  });
});
