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

describe("ana/declarations-before-the-first-function", () => {
  it("moves what is erased or provably fixed, and leaves an effect, a global read and state alone", async () => {
    const expected = expectedLines(MIXED);
    expect(expected).toHaveLength(5);
    expect(await reportedLines("ana", RULE, MIXED)).toStrictEqual(expected);
  });

  it("hoists to the front, carries the comment with the declaration, and settles the chain it unblocks", async () => {
    const fixed = await fixedSource("ana", RULE, MIXED);
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
