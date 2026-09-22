/**
 * The rule that asks an array directly instead of wrapping the comparison in a closure.
 *
 * What is pinned here is mostly what it refuses to report, because the first version reported
 * every equality closure and most of its thirteen sites were the TypeScript narrowing idiom:
 * `KINDS.some((known) => known === value)` with `value: string` against a readonly tuple, where
 * `includes` demands the element type and the closure does not. A plugin rule sees no types, so
 * a literal operand is the only case it can settle — and a literal it can settle completely,
 * which is why every report carries its fix.
 */
import { describe, expect, it } from "bun:test";
import { expectedLines, fixedSource, reportedLines } from "./helpers/oxlint-rule-fixture.ts";

const CLOSURES = `
export function hasEmpty(segments: string[]) {
  return segments.some((segment) => segment === ""); // REPORT a string literal
}
export function hasSet(flags: boolean[]) {
  return flags.some((flag) => flag === true); // REPORT a boolean literal
}
export function reversed(segments: string[]) {
  return segments.some((segment) => "done" === segment); // REPORT either side may hold the parameter
}

export function legacyOwner(owners: string[]): boolean {
  return owners.some((owner) => owner === /* the 2026-08 spelling */ "brief"); // REPORT a sentence inside the closure
}
export function hasKind(kinds: string[], kind: string) {
  return kinds.some((known) => known === kind); // ADMITTED no types here, so the element type is unknown
}
export function hasZero(values: number[]) {
  return values.some((value) => value === 0); // ADMITTED nothing proves the operand is not NaN
}
export function hasMissing(ids: Array<string | null>) {
  return ids.some((id) => id === null); // ADMITTED a literal Array<string>.includes still refuses
}
export function selfComparing(values: string[]) {
  return values.some((value) => value === value.trim()); // ADMITTED compares the element with itself
}
export function indexed(values: string[]) {
  return values.some((value, index) => value === values[index]); // ADMITTED not the single-parameter shape
}
export function ordered(values: string[]) {
  return values.some((value) => value.length > 0); // ADMITTED not an equality
}
`.trimStart();

describe("ana/prefer-includes-over-some-equals", () => {
  it("reports a string or boolean literal from either side and nothing whose type it cannot settle", () => {
    const expected = expectedLines(CLOSURES);
    expect(expected).toHaveLength(4);
    expect(reportedLines("ana", "prefer-includes-over-some-equals", CLOSURES)).toStrictEqual(expected);
  });

  it("fixes every site it reports, and leaves the source of the others untouched", () => {
    const fixed = fixedSource("ana", "prefer-includes-over-some-equals", CLOSURES);
    expect(fixed).toContain('return segments.includes("");');
    expect(fixed).toContain("return flags.includes(true);");
    expect(fixed).toContain('return segments.includes("done");');
    expect(fixed).toContain("return kinds.some((known) => known === kind);");
    expect(fixed).toContain("return values.some((value) => value === 0);");
    expect(fixed).toContain("return ids.some((id) => id === null);");
  });

  it("leaves the closure standing where the literal cannot carry what is written inside it", () => {
    const fixed = fixedSource("ana", "prefer-includes-over-some-equals", CLOSURES);
    expect(fixed).toContain('return owners.some((owner) => owner === /* the 2026-08 spelling */ "brief");');
    expect(fixed).not.toContain("owners.includes");
  });
});
