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
 * Declarations that follow one another are one finding: the report lands on the first and the
 * fix moves the run whole, so one function written above twelve declarations is one error instead
 * of twelve. `Lone`, which code separates from the run, is a finding of its own.
 *
 * The safe-name set is where the rule was blind until 2026-09-20: it admitted an import and a
 * function declaration wherever they sat but not an `interface` or a `type` this file declares,
 * so `const BY_LATE = new Map<string, Late>()` was refused for reading a name that is erased and
 * cannot depend on position. Eight true sites tree-wide were hidden by that. `FROM_ENUM` is the
 * boundary: an enum is not erased, so a read of one below the code stays refused.
 */
import { describe, expect, it } from "bun:test";
import { fixedSource } from "./helpers/oxlint-rule-fixture.ts";
import { lintRules } from "./helpers/lint-rule.ts";

const RULE = "require-declarations-first";
const MIXED = `export function first(row: string): string {
  return row.trim();
}

interface Late { // REPORT erased, so its position is a reading decision; the four below it are its run
  readonly one: string;
}
type Alias = string; // IN THE RUN erased
/** The size a reader goes to the front of the file to find. */
const PLAIN = 3; // IN THE RUN no effect in the initialiser and no position-dependent read
const BUILT = new Set(["a"]); // IN THE RUN a pure constructor has no result but its value
const BY_LATE = new Map<string, Late>(); // IN THE RUN reads a type this file declares, which is erased
const DERIVED = PLAIN + 1; // ADMITTED reads a const still under the code; movable once PLAIN moves
const CWD = process.cwd(); // ADMITTED a call in the initialiser
const HOME = process.env.HOME; // ADMITTED reads a global, whose value depends on where it is read
let counter = 1; // ADMITTED a module let is state, not a constant
const bump = (): number => counter + 1; // ADMITTED holds a function, not a value
enum Mode {
  One = 1,
}
const FROM_ENUM = Mode.One; // ADMITTED an enum has a runtime value, so where it is read matters
type Lone = number; // REPORT what stays put above it ends the run, so this is a finding of its own

export function second(one: Late, two: Alias): number {
  const read: Lone = PLAIN + BUILT.size + BY_LATE.size + DERIVED + FROM_ENUM + bump();
  return read + CWD.length + (HOME ?? "").length + one.one.length + two.length;
}
`;

const SNAPSHOT = `const VALUES = new Set([1]); // ADMITTED already above the code
export function first(): void {}
VALUES.add(2);
export const SNAPSHOT = new Set(VALUES); // ADMITTED copies the contents after the write
`;

describe("ana/require-declarations-first", () => {
  it("moves what is erased or provably fixed, and leaves an effect, a global read and state alone", async () => {
    await lintRules("ana", [
      [RULE, MIXED, 2],
      [RULE, SNAPSHOT, 0],
    ]);
  });

  it("keeps a collection snapshot below the write it copies", async () => {
    expect(await fixedSource("ana", RULE, SNAPSHOT)).toBe(SNAPSHOT);
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
      "type Lone",
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
    // The run arrives in the order it was written, with nothing of the code between its members.
    const run = fixed.slice(fixed.indexOf("interface Late"), fixed.indexOf("const BY_LATE"));
    expect(run).toContain("type Alias");
    expect(run).not.toContain("function");
  });
});
