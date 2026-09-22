/**
 * The rule that reads a `let` the next `if` decides, and the one of its two shapes it rewrites.
 *
 * With both arms written out there is nothing to choose: the condition and both values are on
 * the page, so the rewrite is the same program. With a default there is — `c ? b : a` and
 * `a ?? b` part company the moment the default is falsy — so that shape keeps its two
 * statements and its report. What is pinned below is that split, the annotation travelling with
 * the binding so the arms stay contextually typed, and the two shapes the rule passes over
 * because they are not decisions at all. The two statements are edited separately rather than
 * as one span, so a comment on either survives.
 */
import { describe, expect, it } from "bun:test";
import { expectedLines, fixedSource, reportedLines } from "./helpers/oxlint-rule-fixture.ts";

const RULE = "prefer-const-conditional";
const DECIDED = `declare function seatbelt(reads: string[]): string;
declare const LINUX: string;

export function profileFor(platform: string, reads: string[]): string {
  let profile: string; // REPORT both arms, so the condition is the whole decision
  if (platform === "linux") {
    profile = LINUX;
  } else {
    profile = seatbelt(reads);
  }
  return profile;
}

export function widthOf(options: { width?: number }): number {
  let width = 80; // REPORT a default and one arm, which is a report and no more
  if (options.width !== undefined) width = options.width;
  return width;
}

export function handlerFor(wanted: boolean): (one: string) => void {
  let handler: (one: string) => void; // REPORT the annotation has to travel with it
  if (wanted) handler = (one) => console.log(one);
  else handler = () => undefined;
  return handler;
}

export function statusOf(accepted: boolean, failed: boolean): string {
  let status = "pending"; // ADMITTED a later statement writes it again, so it is a cascade
  if (accepted) status = "accepted";
  if (failed) status = "failed";
  return status;
}

export function trimmed(text: string, cap: number): string {
  let head = text.slice(0, cap); // ADMITTED the arm reads the name, so it refines rather than decides
  if (head.endsWith("\\uD800")) head = head.slice(0, -1);
  return head;
}
`;

const COMMENTED = `export function held(platform: string): string {
  let profile: string; // REPORT the decision is still two arms
  // Linux has no Seatbelt, and this note is why.
  if (platform === "linux") {
    profile = "linux";
  } else {
    profile = "seatbelt";
  }
  return profile;
}

export function timeout(kind: string): number {
  let seconds: number; // REPORT the arms carry a sentence the ternary has no place for
  if (kind === "census") {
    // 30 minutes, which is the census wall this file was written against.
    seconds = 1800;
  } else {
    seconds = 600;
  }
  return seconds;
}
`;

/**
 * Two shapes the rewrite has to get right rather than merely accept.
 *
 * `mode`'s test is itself a conditional, and `?:` is right-associative, so dropping its text
 * unparenthesised into the first position of another conditional silently reassociates.
 * `seen`'s test reads the name being declared, which is legal beside a `let` with no value and a
 * temporal dead zone error once the test moves into that name's own initialiser.
 */
const TRICKY = `export function pick(a: boolean, b: boolean, c: boolean): string {
  let mode: string; // REPORT the test is a conditional and needs its parentheses
  if (a ? b : c) {
    mode = "p";
  } else {
    mode = "q";
  }
  return mode;
}

export function reuse(other: string | undefined): string {
  let seen: string | undefined;
  if (seen === undefined) {
    seen = other;
  } else {
    seen = "kept";
  }
  return seen ?? "";
}
`;

describe("ana/prefer-const-conditional", () => {
  it("reads both shapes and passes over a cascade and a refinement", () => {
    const expected = expectedLines(DECIDED);
    expect(expected).toHaveLength(3);
    expect(reportedLines("ana", RULE, DECIDED)).toStrictEqual(expected);
  });

  it("rewrites the two-arm shape, annotation and all, and leaves the default to its author", () => {
    const fixed = fixedSource("ana", RULE, DECIDED);
    expect(fixed).toContain('const profile: string = platform === "linux" ? LINUX : seatbelt(reads);');
    expect(fixed).toContain(
      "const handler: (one: string) => void = wanted ? (one) => console.log(one) : () => undefined;",
    );
    expect(fixed).toContain("let width = 80;");
    expect(fixed).toContain("if (options.width !== undefined) width = options.width;");
  });

  it("parenthesises a conditional test and passes over a test reading the name", () => {
    expect(reportedLines("ana", RULE, TRICKY)).toStrictEqual(expectedLines(TRICKY));
    const fixed = fixedSource("ana", RULE, TRICKY);
    expect(fixed).toContain('const mode: string = (a ? b : c) ? "p" : "q";');
    expect(fixed).toContain("let seen: string | undefined;");
  });

  it("keeps a comment written between the two statements, and the one on the declaration", () => {
    const fixed = fixedSource("ana", RULE, COMMENTED);
    expect(fixed).toContain("// Linux has no Seatbelt, and this note is why.");
    expect(fixed).toContain("// REPORT the decision is still two arms");
    expect(fixed).toContain('const profile: string = platform === "linux" ? "linux" : "seatbelt";');
  });

  it("leaves the two statements standing where an arm carries a sentence of its own", () => {
    const fixed = fixedSource("ana", RULE, COMMENTED);
    expect(fixed).toContain("// 30 minutes, which is the census wall this file was written against.");
    expect(fixed).toContain("let seconds: number;");
    expect(fixed).not.toContain('kind === "census" ? 1800 : 600');
  });
});
