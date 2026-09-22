/**
 * The rule that asks an array a question instead of counting the answers, and the half of it the
 * fixer is allowed to touch.
 *
 * `.some()` stops at the first match, so the rewrite changes how many times the predicate runs.
 * That is only observable when the predicate has an effect, which `shared/predicate-effect.ts`
 * answers — and it answers the rewriting side more strictly than the reporting one. The cases
 * below that keep their source are the ones the fixer cannot prove: a predicate passed by name,
 * whose body is not here; one that mutates a collection outliving the walk or writes to
 * something; and one holding a call of any kind, whose effects are in another file. All are
 * still reported, because the reading cost the rule is about is there either way.
 */
import { describe, expect, it } from "bun:test";
import { expectedLines, fixedSource, reportedLines } from "./helpers/oxlint-rule-fixture.ts";

const RULE = "prefer-some-over-filter-length";
const COUNTS = `export function anyFailed(rows: { verified: boolean }[]) {
  return rows.filter((row) => !row.verified).length > 0; // REPORT any, with the predicate written out
}
export function noneFailed(rows: { verified: boolean }[]) {
  return rows.filter((row) => !row.verified).length === 0; // REPORT none, which is the negation
}
export function anyNamed(rows: string[], wanted: (one: string) => boolean) {
  return rows.filter(wanted).length > 0; // REPORT read, but a named predicate is not rewritten
}

export function anyOpen(rows: { settled: boolean }[]) {
  return rows /* nothing has settled these */.filter((row) => !row.settled).length > 0; // REPORT a sentence the rebuild would drop
}
export function anyNew(rows: string[], seen: Set<string>) {
  return rows.filter((row) => !seen.has(row) && seen.add(row)).length > 0; // REPORT read, and the mutation keeps it
}
export function anyFallback(rows: string[] | undefined, fallback: string[]) {
  return (rows ?? fallback).filter((row) => row !== "").length > 0; // REPORT and the subject keeps its parentheses
}
export function anyCounted(rows: { verified: boolean }[], seen: { n: number }) {
  return rows.filter((row) => { seen.n += 1; return !row.verified; }).length > 0; // REPORT read, and the assignment keeps it
}
export function anyShifted(rows: number[], seen: { n: number }) {
  return rows.filter((row) => { seen.n >>= 1; return row > 0; }).length > 0; // REPORT read, and a shift-assign is a write
}
export function anyCleared(rows: { cached?: boolean }[]) {
  return rows.filter((row) => delete row.cached).length > 0; // REPORT read, and a delete is a write
}
export function anyVisited(rows: string[], recordVisit: (one: string) => boolean) {
  return rows.filter((row) => recordVisit(row)).length > 0; // REPORT read, and a call cannot be proved free of effects
}
export function manyFailed(rows: string[]) {
  return rows.filter((row) => row !== "").length > 1; // ADMITTED compared against something other than zero
}
export function allFailed(rows: string[]) {
  return rows.filter((row) => row !== "").length === rows.length; // ADMITTED the length compared is the array's own
}
export function anyAtAll(rows: string[]) {
  return rows.length > 0; // ADMITTED no filter in front of it
}
`;

describe("ana/prefer-some-over-filter-length", () => {
  it("reads both spellings of zero and nothing else", () => {
    const expected = expectedLines(COUNTS);
    expect(expected).toHaveLength(10);
    expect(reportedLines("ana", RULE, COUNTS)).toStrictEqual(expected);
  });

  it("rewrites only a predicate it can read and prove has no effect", () => {
    const fixed = fixedSource("ana", RULE, COUNTS);
    expect(fixed).toContain("return rows.some((row) => !row.verified);");
    expect(fixed).toContain("return !rows.some((row) => !row.verified);");
    expect(fixed).toContain('return (rows ?? fallback).some((row) => row !== "");');
    expect(fixed).toContain("return rows.filter(wanted).length > 0;");
    // The predicate travels as its own text, so only what sits outside it is at risk; here that
    // is the line beside the `.filter`, and the whole rewrite steps back rather than drop it.
    expect(fixed).toContain(
      "return rows /* nothing has settled these */.filter((row) => !row.settled).length > 0;",
    );
    expect(fixed).not.toContain("rows.some((row) => !row.settled)");
    expect(fixed).toContain("return rows.filter((row) => !seen.has(row) && seen.add(row)).length > 0;");
    expect(fixed).toContain('return rows.filter((row) => row !== "").length > 1;');
    // `.some` stops at the first match, so the counter would end up lower than the line wrote.
    expect(fixed).toContain("seen.n += 1; return !row.verified; }).length > 0;");
    expect(fixed).toContain("seen.n >>= 1; return row > 0; }).length > 0;");
    // `.some` would clear the first row's cache and leave the rest.
    expect(fixed).toContain("return rows.filter((row) => delete row.cached).length > 0;");
    // No mutating method and no assignment, and still one fewer call after the rewrite. What
    // `recordVisit` does is in another file, so the rewrite cannot be proved and is not offered.
    expect(fixed).toContain("return rows.filter((row) => recordVisit(row)).length > 0;");
  });
});
