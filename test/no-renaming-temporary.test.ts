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
import { fixedSource } from "./helpers/oxlint-rule-fixture.ts";

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

describe("ana/no-renaming-temporary", () => {
  it("puts the expression back at its reader, keeps the note written beside it, and leaves a word inside a string", async () => {
    const fixed = await fixedSource("ana", RULE, TEMPORARIES);
    expect(fixed).toContain("return bundle.rows.map(toCase);");
    expect(fixed).toContain("return task.owner;");
    expect(fixed).not.toContain("const rows = bundle.rows; // REPORT a dotted path");
    expect(fixed).toContain("// REPORT a dotted path under a second name");
    expect(fixed).toContain('return describe("rows");');
    expect(fixed).toContain("const rows = bundle.rows; // REPORT read, but the only other mention is prose");
  });
});
