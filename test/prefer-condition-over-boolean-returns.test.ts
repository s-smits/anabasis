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
import { fixedSource } from "./helpers/oxlint-rule-fixture.ts";

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

describe("ana/prefer-condition-over-boolean-returns", () => {
  it("returns the condition where it stands as written, and leaves the negation to its author", async () => {
    const fixed = await fixedSource("ana", RULE, BRANCHES);
    expect(fixed).toContain(
      "return row.pass && row.seen; // REPORT true then false is the condition itself\n}",
    );
    expect(fixed).toContain("  return row.pass; // REPORT an else keeps both returns inside the if\n}");
    expect(fixed).not.toContain("return true;\n  return false;");
    expect(fixed).toContain(
      BRANCHES.slice(
        BRANCHES.indexOf("export function stacked"),
        BRANCHES.indexOf("export function verified"),
      ),
    );
    expect(fixed).toContain(BRANCHES.slice(BRANCHES.indexOf("export function missing")));
  });
});
