/**
 * The rule that refuses the broad `object` type on a function's inputs.
 *
 * A parameter hides that type as easily as it spells it. `rows: object[]`, `pair: [string,
 * object]`, `input: { rows: object[] }` and `rows: Map<string, object>` each hand the callee the
 * same unparsed value `input: object` would, and before 2026-09-20 the rule read through an alias
 * and a union and stopped there — so the four spellings above passed a gate that refused the
 * first one. The fixture states each position once, so a reader can see which shapes the search
 * enters and, from the admitted half, exactly where it stops.
 *
 * It stops at a function type. A callback's parameters are the callback author's contract with
 * whoever calls it, not this function's contract with its caller, and the rule already visits
 * every function type and method signature on its own — so the report belongs at the callback,
 * where the repair is, rather than twice.
 *
 * It also stops at `WeakMap` and `WeakSet`, where `object` is the language's own key constraint
 * rather than an input nobody parsed.
 *
 * There is no fixer: the repair is an owner-provided type parsed at its boundary, which is a new
 * contract in another file and at every call site.
 */
import { describe, expect, it } from "bun:test";
import { expectedLines, reportedLines, reportedMessages } from "./helpers/oxlint-rule-fixture.ts";

const PARAMETERS = `
type Bag = object;
type Rows = object[];
type Money = { currency: string; minor: number };

export function bare(input: object): number { // REPORT the spelling the rule always refused
  return Object.keys(input).length;
}
export function aliased(input: Bag): number { // REPORT a local alias for it
  return Object.keys(input).length;
}
export function arrayOf(rows: object[]): number { // REPORT an array of them is still unparsed
  return rows.length;
}
export function aliasedArray(rows: Rows): number { // REPORT the alias in array position
  return rows.length;
}
export function readonlyArrayOf(rows: readonly object[]): number { // REPORT readonly changes who may write, not what is known
  return rows.length;
}
export function tupleOf(pair: [string, object]): number { // REPORT a fixed position is still one of them
  return pair.length;
}
export function optionalTupleOf(pair: [string, object?]): number { // REPORT the optional spelling of the same position
  return pair.length;
}
export function restTupleOf(pair: [string, ...object[]]): number { // REPORT the rest spelling of the same position
  return pair.length;
}
export function recordOf(rows: Record<string, object>): number { // REPORT a type argument carries it in
  return Object.keys(rows).length;
}
export function mapOf(rows: Map<string, object>): number { // REPORT any owner type's argument, not just Record
  return rows.size;
}
export function literalMember(input: { rows: object[] }): number { // REPORT a property of an anonymous shape
  return input.rows.length;
}
export function indexMember(input: { [key: string]: object }): number { // REPORT an index signature's value type
  return Object.keys(input).length;
}
export function destructured({ rows }: { rows: object[] }): number { // REPORT destructuring hides nothing
  return rows.length;
}
export function intersected(input: Money & object): string { // REPORT one arm of an intersection is enough
  return input.currency;
}
export function unioned(input: object | null): number { // REPORT one arm of a union is enough
  return input === null ? 0 : 1;
}
export function promised(input: Promise<object>): Promise<object> { // REPORT awaiting it changes nothing
  return input;
}

export function weakKeyed(table: WeakMap<object, string>): number { // ADMITTED the key type is the language's constraint
  return table === null ? 0 : 1;
}
export function weakSeen(seen: WeakSet<object>): number { // ADMITTED the same constraint, one type argument
  return seen === null ? 0 : 1;
}
export function named(input: Money): string { // ADMITTED an owner type
  return input.currency;
}
export function namedArray(rows: Money[]): number { // ADMITTED an array of an owner type
  return rows.length;
}
export function constrained<T extends object>(value: T): T { // ADMITTED the caller names the type, and the constraint is not the input
  return value;
}
export function methodMember(input: {
  run(value: object): void; // REPORT the callback's own parameter, reported at the callback
}): void {
  input.run({});
}
export function functionMember(input: {
  run: (value: object) => void; // REPORT the same, written as a property
}): void {
  input.run({});
}
`.trimStart();

describe("anti-slop/no-object-parameters", () => {
  it("reads through the shapes a parameter can hide the broad type in, and stops where the repair is elsewhere", () => {
    const expected = expectedLines(PARAMETERS);
    expect(expected).toHaveLength(18);
    expect(reportedLines("anti-slop", "no-object-parameters", PARAMETERS)).toStrictEqual(expected);
  });

  it("names the parameter, so the message says which input to give an owner type", () => {
    const messages = reportedMessages(
      "anti-slop",
      "no-object-parameters",
      "export function counted(rows: Map<string, object>): number { return rows.size; }",
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("`rows`");
  });
});
