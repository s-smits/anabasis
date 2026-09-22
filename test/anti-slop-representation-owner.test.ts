import { describe, expect, it } from "bun:test";
import { expectedLines, reportedLines, reportedMessages } from "./helpers/oxlint-rule-fixture.ts";

/**
 * The representation owner, `src/meta/json-shape.ts`, is where `no-runtime-typeof` and
 * `no-unsafe-dictionary-type` admit one written shape each. Each fixture is staged twice: at the
 * owner's path, where only the admitted shape passes, and at an ordinary source path, where the
 * same text is reported line for line. The second staging is the one that matters most: a copy of
 * `isString` in another file is the slop the owner exists to prevent.
 */

const OWNER = "src/meta/json-shape.ts";
const ELSEWHERE = "src/solve/example.ts";

const PREDICATES = `
export type Callable = (...args: never[]) => void;
type Label = string;
export function isString(value: unknown): value is string {
  return typeof value === "string"; // ADMITTED the predicate names what the answer establishes
}
export function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null; // ADMITTED null excluded
}
export function isFunction(value: unknown): value is Callable {
  return typeof value === "function"; // ADMITTED an alias of a function type
}
export function isLoose(value: unknown): value is object {
  return typeof value === "object"; // REPORT null passes as an object
}
export function isMislabelled(value: unknown): value is number {
  return typeof value === "string"; // REPORT the predicate names another type
}
export function isLabelFunction(value: unknown): value is Label {
  return typeof value === "function"; // REPORT the alias is not a function type
}
export function isPrefixed(value: unknown, prefix: string): value is string {
  return typeof value === "string"; // REPORT a second parameter the test never reads
}
export function kindOf(value: unknown): string {
  return typeof value; // REPORT not a predicate
}
export function isStringOrEmpty(value: unknown): value is string {
  if (value === null) return false;
  return typeof value === "string"; // REPORT not the whole body
}
`;

const OPEN_RECORD = `
export type OpenRecord = Record<string, unknown>; // ADMITTED the owner's one open view
type Hidden = Record<string, unknown>; // REPORT not exported
export type AnyRecord = Record<string, any>; // REPORT any is not the open view
export type Rows = { rows: Record<string, unknown> }; // REPORT a member, not the alias itself
`;

describe("anti-slop/no-runtime-typeof in the representation owner", () => {
  it("admits the owner's whole-body primitive predicates and nothing else there", () => {
    const expected = expectedLines(PREDICATES);
    expect(expected).toHaveLength(6);
    expect(reportedLines("anti-slop", "no-runtime-typeof", PREDICATES, OWNER)).toStrictEqual(expected);
  });

  it("reports the same predicates anywhere else, and names the owner", () => {
    const everyTypeof = PREDICATES.split("\n").flatMap((line, index) =>
      line.includes("typeof") ? [index + 1] : [],
    );
    expect(everyTypeof).toHaveLength(9);
    expect(reportedLines("anti-slop", "no-runtime-typeof", PREDICATES, ELSEWHERE)).toStrictEqual(everyTypeof);
    expect(reportedMessages("anti-slop", "no-runtime-typeof", PREDICATES, ELSEWHERE)[0]).toContain(OWNER);
  });
});

describe("anti-slop/no-unsafe-dictionary-type in the representation owner", () => {
  it("admits the exported open record alias and nothing else there", () => {
    const expected = expectedLines(OPEN_RECORD);
    expect(expected).toHaveLength(3);
    expect(reportedLines("anti-slop", "no-unsafe-dictionary-type", OPEN_RECORD, OWNER)).toStrictEqual(
      expected,
    );
  });

  it("reports the same alias anywhere else", () => {
    expect(reportedLines("anti-slop", "no-unsafe-dictionary-type", OPEN_RECORD, ELSEWHERE)).toStrictEqual([
      2, 3, 4, 5,
    ]);
  });
});
