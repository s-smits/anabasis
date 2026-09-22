import { describe, expect, it } from "bun:test";
import { expectedLines, reportedLines } from "./helpers/oxlint-rule-fixture.ts";

/**
 * `require-safety-comment-for-type-assertion` asks for the invariant immediately before the
 * assertion or its containing statement, and a parenthesis is not a place. `getCommentsBefore`
 * stops at one, so `/* SAFETY *\/ (x as T)` and `(/* SAFETY *\/ x as T)` used to read differently
 * — which mattered the day `biome format` moved the comment out of the parentheses at five sites
 * in one pass. Adjacency is the whole guarantee, so the fixture also holds a sentence the
 * assertion beside it may not borrow.
 */
const ADJACENCY = `
declare const value: unknown;
export const inside = (/* SAFETY: the caller checked it. */ value as string);
export const outside = /* SAFETY: the caller checked it. */ (value as string);
export const nested = /* SAFETY: the caller checked it. */ ((value as string));
// SAFETY: the caller checked it.
export const above = value as string;
export const bare = value as string; // REPORT no justification anywhere
export const borrowed = [/* SAFETY: this sentence is about the 1. */ 1, value as string]; // REPORT not adjacent
`;

describe("require-safety-comment-for-type-assertion", () => {
  it("reads the justification across the parentheses and no further", () => {
    const expected = expectedLines(ADJACENCY);
    expect(expected).toHaveLength(2);
    expect(reportedLines("anti-slop", "require-safety-comment-for-type-assertion", ADJACENCY)).toStrictEqual(
      expected,
    );
  });
});
