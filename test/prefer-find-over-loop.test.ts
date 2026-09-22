/**
 * The rule that reads a written-out search, and the fix that puts the array method back.
 *
 * Which method a site wants is read off the `return`, not guessed, so the rewrite is decided.
 * What is not decided by the loop alone is what the method yields on no match — `undefined`,
 * `false`, `true` — and that is why the fix reads the statement below and stands down where it
 * says anything else. The exception is the loop that returns nothing: it is a guard, exact on
 * its own, and it has its own message because calling it `rows.some(…)` named a replacement
 * that would have returned a boolean from a void function.
 */
import { describe, expect, it } from "bun:test";
import {
  expectedLines,
  fixedSource,
  reportedLines,
  reportedMessages,
} from "./helpers/oxlint-rule-fixture.ts";

const RULE = "prefer-find-over-loop";
const SEARCHES = `interface Row {
  readonly id: string;
  readonly name: string;
  readonly verified: boolean;
  readonly settled: boolean;
}
declare function note(what: string): void;
declare function settle(row: Row): Promise<boolean>;

export function rowFor(rows: Row[], id: string): Row | undefined {
  for (const row of rows) if (row.id === id) return row; // REPORT find, with undefined written below it
  return undefined;
}

export function firstFailing(rows: Row[]) {
  for (const row of rows) if (!row.verified) return row; // REPORT find, ending the body
}

export function rowIn(rows: Row[] | undefined, fallback: Row[], id: string): Row | undefined {
  for (const row of rows ?? fallback) if (row.id === id) return row; // REPORT find, with the subject parenthesised
  return undefined;
}

export function anyFailing(rows: Row[]): boolean {
  for (const row of rows) if (!row.verified) return true; // REPORT some, with false written below it
  return false;
}

export function allSettled(rows: Row[]): boolean {
  for (const row of rows) if (!row.settled) return false; // REPORT every, which drops the author's !
  return true;
}

export function allNamed(rows: Row[]): boolean {
  for (const row of rows) if (row.name === "") return false; // REPORT every, the sense reversed around the test
  return true;
}

export function skipSettled(rows: Row[]): void {
  for (const row of rows) if (row.settled) return; // REPORT a guard, which needs nothing below it
  note("none settled");
}

export function rowOrFirst(rows: Row[], id: string): Row | undefined {
  for (const row of rows) if (row.id === id) return row; // REPORT read, but the line below is not undefined
  return rows[0];
}

export function firstOpen(rows: Row[]): Row | undefined {
  for (const row of rows) { // REPORT the body's own sentence has no place inside an arrow
    // a row is open until something settles it, and that is why this reads !settled
    if (!row.settled) return row;
  }
  return undefined;
}

const OWNERS = new Set(["brief", "tests"]);

export function ownedBy(wanted: string): boolean {
  for (const owner of OWNERS) if (owner === wanted) return true; // ADMITTED a Set has no find
  return false;
}

export async function anySettled(rows: Row[]): Promise<boolean> {
  for (const row of rows) if (await settle(row)) return true; // ADMITTED find takes no async predicate
  return false;
}

export function complaintFor(rows: Row[], id: string): string | undefined {
  for (const row of rows) if (row.id === id) return \`\${row.name} is already here\`; // ADMITTED it builds the answer
  return undefined;
}

export function verdictFor(rows: Row[], id: string): boolean {
  for (const row of rows) {
    if (row.id === id) return true;
    else return false; // ADMITTED an else is a second thing the method has no room for
  }
  return false;
}
`;

/**
 * A subject that binds looser than the member access the fix writes on it. `primary ?? fallback`
 * walks both arrays; `primary ?? fallback.find(p)` searches only the second and type-checks,
 * because both sides are `Row[]`.
 */
const LOOSE = `interface Row {
  readonly id: string;
}

export function rowFor(primary: Row[] | undefined, fallback: Row[], id: string): Row | undefined {
  for (const row of primary ?? fallback) if (row.id === id) return row; // REPORT the subject needs its parentheses
  return undefined;
}
`;

describe("ana/prefer-find-over-loop", () => {
  it("reads a search and passes over a Set, an await, a built answer and an else", () => {
    const expected = expectedLines(SEARCHES);
    expect(expected).toHaveLength(9);
    expect(reportedLines("ana", RULE, SEARCHES)).toStrictEqual(expected);
  });

  it("names the guard as a guard rather than as an answer", () => {
    const guards = reportedMessages("ana", RULE, SEARCHES).filter((one) => one.includes("if ("));
    expect(guards).toHaveLength(1);
    expect(guards[0]).toContain("`if (rows.some(…)) return;`");
  });

  it("puts the method where the loop stood, once the line below agrees with it", () => {
    const fixed = fixedSource("ana", RULE, SEARCHES);
    expect(fixed).toContain("return rows.find((row) => row.id === id);");
    expect(fixed).toContain("return rows.find((row) => !row.verified);");
    expect(fixed).toContain("return (rows ?? fallback).find((row) => row.id === id);");
    expect(fixed).toContain("return rows.some((row) => !row.verified);");
    expect(fixed).toContain("return rows.every((row) => row.settled);");
    expect(fixed).toContain('return rows.every((row) => !(row.name === ""));');
    expect(fixed).toContain("if (rows.some((row) => row.settled)) return;");
    expect(fixed).toContain('note("none settled");');
  });

  it("parenthesises a subject that binds looser than the call it writes", () => {
    expect(reportedLines("ana", RULE, LOOSE)).toStrictEqual(expectedLines(LOOSE));
    expect(fixedSource("ana", RULE, LOOSE)).toContain(
      "return (primary ?? fallback).find((row) => row.id === id);",
    );
  });

  it("leaves the loop standing where its body carries a sentence the arrow cannot hold", () => {
    const fixed = fixedSource("ana", RULE, SEARCHES);
    expect(fixed).toContain(
      "// a row is open until something settles it, and that is why this reads !settled",
    );
    expect(fixed).not.toContain("rows.find((row) => !row.settled)");
  });

  it("keeps the loop where the rewrite would change what no match returns", () => {
    const fixed = fixedSource("ana", RULE, SEARCHES);
    expect(fixed).toContain(
      "for (const row of rows) if (row.id === id) return row; // REPORT read, but the line",
    );
    expect(fixed).toContain("return rows[0];");
  });
});
