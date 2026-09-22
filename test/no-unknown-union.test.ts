/**
 * The rule that refuses a union one of whose members is `unknown`.
 *
 * `unknown | null` reads as though it offered a choice, and it does not: `unknown` already
 * includes null, so the union states exactly what plain `unknown` states while looking like a
 * narrower contract. The rule exists so that an `unknown` in the source is a real validation
 * boundary rather than a type that drifted there.
 *
 * `containsUnknownType` decides both this rule and `unproven-unknown-parameter`, so the shapes it
 * looks through — parentheses, nesting — and the ones it stops at — intersections, containers,
 * type parameters — are pinned here for both.
 */
import { describe, expect, it } from "bun:test";
import { expectedLines, reportedLines } from "./helpers/oxlint-rule-fixture.ts";

const POSITIONS = `
export type NullableRaw = unknown | null; // REPORT null adds no alternative
export type OptionalRaw = undefined | (unknown); // REPORT reversed and parenthesized
export const initialized: unknown | string = "value"; // REPORT field is still unknown
export interface RawField { value: unknown | null } // REPORT property contract
export function defaulted(value: unknown | undefined = undefined) {} // REPORT optional raw input
export type Callback = (value: unknown | null) => void; // REPORT function parameter
export type CallbackResult = () => unknown | string; // REPORT return contract
export type RawContainer = Array<unknown | null>; // REPORT union inside a container
export type Raw = unknown; // ADMITTED real unparsed boundary
export type Nullable = string | null; // ADMITTED useful absence distinction
export type List = unknown[] | null; // ADMITTED array itself is known
export type AsyncValue = Promise<unknown> | null; // ADMITTED promise itself is known
export type RecordValue = { payload: unknown } | null; // ADMITTED object itself is known
export type Intersection = (unknown & { id: string }) | null; // ADMITTED intersection retains the contract
export type Opaque<T> = T | null; // ADMITTED no guessed generic instantiation
`.trimStart();

/** What the shared resolver looks through, and where it stops. */
const DECLARATIONS = `
export type DoubleParenthesized = ((unknown)) | null; // REPORT parentheses are not a contract
export type Constrained<T extends unknown | null> = T; // REPORT a constraint is a contract too
export type Tuple = [unknown | null, string]; // REPORT a tuple member is not a container
export type Deep = { field: { inner: unknown | string } }; // REPORT nesting does not dilute it
export type UnknownTuple = [unknown, string] | null; // ADMITTED the tuple itself is known
export type Fn = ((value: unknown) => void) | null; // ADMITTED the function type itself is known
export type Keyed = Record<string, unknown> | null; // ADMITTED the record itself is known
export type Literals = "a" | "b" | null; // ADMITTED an ordinary union
`.trimStart();

describe("ana/no-unknown-union", () => {
  const reports = (fixture: string): number[] => reportedLines("ana", "no-unknown-union", fixture);

  it("rejects absorbed union members in every position while keeping meaningful nullable contracts", () => {
    const expected = expectedLines(POSITIONS);
    expect(expected).toHaveLength(8);
    expect(reports(POSITIONS)).toStrictEqual(expected);
  });

  it("looks through parentheses and nesting, and stops at a container or an intersection", () => {
    const expected = expectedLines(DECLARATIONS);
    expect(expected).toHaveLength(4);
    expect(reports(DECLARATIONS)).toStrictEqual(expected);
  });
});
