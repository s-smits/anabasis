/**
 * The rule that returns the condition instead of spelling it out over two statements, and the
 * one order of the two it fixes.
 *
 * `true` then `false` is the condition as written, so the rewrite lifts the test out and returns
 * it. `false` then `true` needs a `!`, and where the parentheses go around a condition mixing
 * `&&` with `||` is a reading decision — so it is reported and its source kept. The two shapes
 * the rule refuses outright are also pinned: a return that is not a literal pair may be `null`,
 * and the last of a run of guards is not the whole condition.
 *
 * The rewrite reaches past the second return, so it swallows whatever sits between the two — in
 * this tree, usually the sentence saying why the guard is there. Every fixture line here carries
 * one, which is why the loss went unnoticed: the output compiled and the assertions, written
 * from that output, expected the comment to be gone.
 */
import { describe, expect, it } from "bun:test";
import { expectedLines, fixedSource, reportedLines } from "./helpers/oxlint-rule-fixture.ts";

const RULE = "prefer-condition-over-boolean-returns";
const BRANCHES = `interface Row {
  readonly pass: boolean;
  readonly seen: boolean;
}

export function stacked(row: Row): boolean {
  if (row.pass) return true; // REPORT two comments in the range, so neither can be carried alone
  // the second one, which would have to be stacked above the answer
  return false;
}

export function verified(row: Row): boolean {
  if (row.pass && row.seen) return true; // REPORT true then false is the condition itself
  return false;
}

export function blocked(row: Row): boolean {
  if (row.pass) { // REPORT an else keeps both returns inside the if
    return true;
  } else {
    return false;
  }
}

export function missing(row: Row): boolean {
  if (row.pass) return false; // REPORT read, but where the ! goes is the author's to place
  return true;
}

export function relayed(row: Row): boolean {
  if (row.pass) return row.seen; // ADMITTED not a literal pair, so the first return may be anything
  return false;
}

export function guarded(row: Row): boolean {
  if (row.pass) return true; // ADMITTED what follows is another guard, not the other answer
  if (row.seen) return true; // ADMITTED the last of a run of guards is not the whole condition
  return false;
}
`;

/**
 * The same shape with nothing to say the answer stays a boolean.
 *
 * `named` has no declared return type and its test is a member rather than a comparison, so
 * `return row.name;` answers `string | undefined` and the function's inferred type widens with
 * it. Nothing fails to compile — a caller writing `=== true` simply starts reading false. The
 * second half is the witness the spelling supplies on its own: `compared` has no declared type
 * either and needs none, because `!==` answers a boolean whatever it is given.
 */
const INFERRED = `export function named(row: { readonly name?: string }) {
  if (row.name) return true; // REPORT read, but the rewrite would answer a string
  return false;
}

export function compared(row: { readonly name?: string }) {
  if (row.name !== undefined) return true; // REPORT a comparison is a boolean by its spelling
  return false;
}
`;

describe("ana/prefer-condition-over-boolean-returns", () => {
  it("reads both orders and refuses a non-literal return and the tail of a run of guards", () => {
    const expected = expectedLines(BRANCHES);
    expect(expected).toHaveLength(4);
    expect(reportedLines("ana", RULE, BRANCHES)).toStrictEqual(expected);
  });

  it("returns the condition where it stands as written, and leaves the negation to its author", () => {
    const fixed = fixedSource("ana", RULE, BRANCHES);
    expect(fixed).toContain(
      "return row.pass && row.seen; // REPORT true then false is the condition itself\n}",
    );
    expect(fixed).toContain("  return row.pass; // REPORT an else keeps both returns inside the if\n}");
    expect(fixed).not.toContain("return true;\n  return false;");
    expect(fixed).toContain("if (row.pass) return false;");
    expect(fixed).toContain("if (row.pass) return row.seen;");
  });

  it("rewrites an inferred return only where the test is a boolean by its spelling", () => {
    expect(reportedLines("ana", RULE, INFERRED)).toStrictEqual(expectedLines(INFERRED));
    const fixed = fixedSource("ana", RULE, INFERRED);
    expect(fixed).toContain("if (row.name) return true;");
    expect(fixed).toContain("return row.name !== undefined;");
  });

  it("carries the guard's comment onto the answer, and leaves a pair of them where they stand", () => {
    const fixed = fixedSource("ana", RULE, BRANCHES);
    // Two comments would have to be stacked above the answer and indented to it, which is a
    // layout decision; the report stands and the source keeps both.
    expect(fixed).toContain("if (row.pass) return true; // REPORT two comments in the range");
    expect(fixed).toContain("// the second one, which would have to be stacked above the answer");
    // Nothing the fixture wrote is missing from what it rewrote.
    for (const line of BRANCHES.split("\n").filter(
      (one) => one.trim().startsWith("//") || one.includes(" // "),
    )) {
      expect(fixed).toContain(line.slice(line.indexOf("//")));
    }
  });
});
