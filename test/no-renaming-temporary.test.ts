/**
 * The rule that reads a `const` holding another name, used once on the next line, and the fix
 * that puts the expression back at its one reader.
 *
 * The value is an identifier or a dotted path, so it is atomic and drops in wherever the name
 * stood without parentheses. What needs pinning is the other half: the read is located in the
 * statement below with comments and quoted strings blanked out, so a binding whose only other
 * mention is a word in a string keeps its report and loses its fix rather than having a string
 * literal edited. The declaration is removed on its own rather than as a span up to the next
 * statement, so a note written on its line survives it.
 */
import { describe, expect, it } from "bun:test";
import { expectedLines, fixedSource, reportedLines } from "./helpers/oxlint-rule-fixture.ts";

const RULE = "no-renaming-temporary";
const TEMPORARIES = `declare function toCase(one: string): string;
declare function compute(): number;
declare function describe(what: string): string;

export function mapped(bundle: { rows: string[] }): string[] {
  const rows = bundle.rows; // REPORT a dotted path under a second name
  return rows.map(toCase);
}

export function ownerOf(task: { owner: string }): string {
  const owner = task.owner; // REPORT the whole statement below is the read
  return owner;
}

export function noted(bundle: { rows: string[] }): string {
  const rows = bundle.rows; // REPORT read, but the only other mention is prose
  return describe("rows");
}

export function firstOf(rows: string[]): string {
  const first = rows[0]; // ADMITTED a computed member is work
  return first.trim();
}

export function counted(): number {
  const total = compute(); // ADMITTED a call is work
  return total + 1;
}

export function bumped(store: { seq: number }): number {
  const before = store.seq; // ADMITTED read two statements down, so it is a snapshot
  store.seq += 1;
  return before;
}

export function widened(bundle: { rows: string[] }): number {
  const rows: readonly string[] = bundle.rows; // ADMITTED the annotation is a narrowing the expression lacks
  return rows.length;
}
`;

/**
 * Five sites whose edit is not simply the substitution, each reported and each left alone.
 *
 * A template's words are prose in the way a `"…"` is, so `${…}` aside they are not reads — and a
 * brace written in those words is a character in a sentence, not the start of a substitution,
 * which is what `shared/masked.ts` read it as until 2026-09-20. A shorthand property is the key
 * as well as the value. A call on a binding of a dotted path calls an unbound function, where
 * the path itself would bind a receiver. And a declarator with a sibling is one name in a
 * statement holding two: the visitor decides the one, and removing the statement takes the
 * other with it.
 */
const AWKWARD = `declare function describe(what: string): string;

export function templated(bundle: { rows: string[] }): string {
  const rows = bundle.rows; // REPORT read, but the only other mention is a template's words
  return \`no rows at all\`;
}

export function shorthand(task: { owner: string }): { owner: string } {
  const owner = task.owner; // REPORT read, but it is a key as well as a value
  return { owner };
}

export function called(stream: { read: () => string }): string {
  const read = stream.read; // REPORT a dotted path, but the call below would gain a receiver
  return read();
}

export function braced(bundle: { items: string[] }): string {
  const items = bundle.items; // REPORT read, but the only other mention is inside a template
  return \`one { items two } three\`;
}

export function delta(state: { value: number }): number {
  const before = state.value; // REPORT read once, but after the increment that precedes it
  return state.value++ - before;
}

export function deferred(state: { value: number }): () => number {
  const saved = state.value; // REPORT read once, but inside a closure that runs later
  return () => saved;
}

export function paired(input: { value: string }): string {
  const one = input.value, keep = "x"; // REPORT a declarator with a sibling the removal takes
  return one + keep;
}
`;

describe("ana/no-renaming-temporary", () => {
  it("reads a rename with one adjacent use and passes over work, snapshots and annotations", () => {
    const expected = expectedLines(TEMPORARIES);
    expect(expected).toHaveLength(3);
    expect(reportedLines("ana", RULE, TEMPORARIES)).toStrictEqual(expected);
  });

  it("puts the expression back at its reader and keeps the note written beside it", () => {
    const fixed = fixedSource("ana", RULE, TEMPORARIES);
    expect(fixed).toContain("return bundle.rows.map(toCase);");
    expect(fixed).toContain("return task.owner;");
    expect(fixed).not.toContain("const rows = bundle.rows; // REPORT a dotted path");
    expect(fixed).toContain("// REPORT a dotted path under a second name");
  });

  it("reports a template word, a brace in one, a shorthand key, a bound call, a shared statement, a crossed update and a closure, and edits none", () => {
    expect(reportedLines("ana", RULE, AWKWARD)).toStrictEqual(expectedLines(AWKWARD));
    const fixed = fixedSource("ana", RULE, AWKWARD);
    expect(fixed).toContain("return `no rows at all`;");
    expect(fixed).toContain("return { owner };");
    expect(fixed).toContain("return read();");
    expect(fixed).toContain("const rows = bundle.rows;");
    expect(fixed).toContain("const owner = task.owner;");
    expect(fixed).toContain("const read = stream.read;");
    // A `{` in a template's words is not a substitution, so the words after it are still words.
    expect(fixed).toContain("const items = bundle.items;");
    expect(fixed).toContain("return `one { items two } three`;");
    // The edit removed the whole declaration, so `keep` left with the declarator beside it.
    expect(fixed).toContain('const one = input.value, keep = "x";');
    expect(fixed).toContain("return one + keep;");
    // The binding is the value before the statement changes it, or before the closure runs.
    expect(fixed).toContain("return state.value++ - before;");
    expect(fixed).toContain("return () => saved;");
  });

  it("stands down rather than editing the word inside a string", () => {
    const fixed = fixedSource("ana", RULE, TEMPORARIES);
    expect(fixed).toContain('return describe("rows");');
    expect(fixed).toContain("const rows = bundle.rows; // REPORT read, but the only other mention is prose");
  });
});
