/**
 * The rule that reports a predicate building state while it answers.
 *
 * Its mutation test now lives in `shared/predicate-effect.ts`, because
 * `ana/prefer-some-over-filter-length` needs the same answer before it may rewrite a
 * `.filter().length` into a `.some()`. What is pinned here is the reach of that shared test from
 * this side: six names, a receiver required, and the three walks that are outside the rule on
 * purpose.
 */
import { describe, expect, it } from "bun:test";
import { expectedLines, reportedLines } from "./helpers/oxlint-rule-fixture.ts";

const RULE = "no-side-effect-in-predicate";
const WALKS = `export function add(one: string): boolean {
  return one !== "";
}

export function firstSeen(rows: { id: string }[], seen: Set<string>) {
  return rows.filter((row) => !seen.has(row.id) && seen.add(row.id)); // REPORT add outlives the walk
}

export function logged(rows: string[], log: string[]) {
  return rows.find((row) => {
    log.push(row); // REPORT push, from a block body
    return row !== "";
  });
}

export function asked(rows: string[], seen: Set<string>) {
  return rows.filter((row) => seen.has(row)); // ADMITTED has only reads
}

export function recorded(rows: string[], seen: Set<string>) {
  return rows.map((row) => {
    seen.add(row); // ADMITTED map is outside the rule on purpose
    return row;
  });
}

export function free(rows: string[]) {
  return rows.filter((row) => add(row)); // ADMITTED a free function says nothing about a receiver
}
`;

describe("ana/no-side-effect-in-predicate", () => {
  it("reports a mutation with a receiver inside a predicate, and nothing else", () => {
    // The rule reports the method name, so a block body's report sits on the walk, not the
    // mutation: the expectation is the two walks, read off the markers by line.
    expect(expectedLines(WALKS)).toHaveLength(2);
    expect(reportedLines("ana", RULE, WALKS)).toStrictEqual([6, 10]);
  });
});
