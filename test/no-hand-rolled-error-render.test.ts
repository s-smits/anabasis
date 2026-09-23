/**
 * The rule that sends a caught value to `errorMessage` or `asError` in
 * `src/meta/runtime-values.ts` instead of spelling the ternary again, and its fixer.
 *
 * Both shapes are pinned, and so is every way of not being them: the subject has to be the same
 * text in all three places, the rendering call has to be `String` or `errorMessage`, and a
 * ternary that reads one value and renders another is left alone. That last case is why the rule
 * compares source text rather than matching identifiers by name — `outer.error` and
 * `inner.error` are different subjects and only one of them is the caught value.
 *
 * The fix is pinned the same way, and only over a bare identifier; a call or a member is reported
 * and left, since the rewrite would read it once where the original read it up to three times.
 * Four sites over two owners produce one import carrying both names, because the import edit
 * rides on every diagnostic rather than the first, and the second name arrives on the pass after
 * the first one landed. A rewrite that left the name undefined would be worse than the report, so
 * the expression and the import land together or not at all.
 */
import { describe, expect, it } from "bun:test";
import { expectedLines, fixedSource, reportedLines } from "./helpers/oxlint-rule-fixture.ts";

const RULE = "no-hand-rolled-error-render";
const INSIDE = "src/example.ts";
const CAUGHT = `
export function text(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause); // REPORT errorMessage owns this
}
export function member(result: { error: unknown }): string {
  return result.error instanceof Error ? result.error.message : String(result.error); // REPORT a dotted subject is one too
}
export function called(load: () => unknown): string {
  return load() instanceof Error ? load().message : String(load()); // REPORT a call is one too, but runs again per mention
}
export function rebuilt(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause)); // REPORT asError owns this
}
export function halfMigrated(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(errorMessage(cause)); // REPORT the same, with the owner inside it
}
export function mismatched(outer: { error: unknown }, inner: { error: unknown }): string {
  return outer.error instanceof Error ? outer.error.message : String(inner.error); // ADMITTED it renders a different value
}
export function named(cause: unknown): string {
  return cause instanceof Error ? cause.name : "unknown"; // ADMITTED the name is not the message
}
export function inspected(cause: unknown): string {
  return cause instanceof Error ? cause.message : JSON.stringify(cause); // ADMITTED a different rendering entirely
}
export function typed(cause: unknown): boolean {
  return cause instanceof Error; // ADMITTED the test alone is a question, not a rendering
}
`.trimStart();

describe("ana/no-hand-rolled-error-render", () => {
  const reports = (at: string): number[] => reportedLines("ana", RULE, CAUGHT, at);

  it("reports both owned shapes and leaves every near miss alone", () => {
    const expected = expectedLines(CAUGHT);
    expect(expected).toHaveLength(5);
    expect(reports(INSIDE)).toStrictEqual(expected);
  });

  it("stays out of the owner, the browser bundle and the Builder-visible starter", () => {
    expect(reports("src/meta/runtime-values.ts")).toStrictEqual([]);
    expect(reports("packages/ui/src/live.ts")).toStrictEqual([]);
    expect(reports("starters/pi-built-harness/agent/tools.ts")).toStrictEqual([]);
  });

  it("calls the owner and brings both names in through one import", () => {
    const fixed = fixedSource("ana", RULE, CAUGHT, INSIDE);
    expect(fixed).toContain("return errorMessage(cause);");
    // Only a plain name moves: the owner reads its subject once, and a getter or a call read
    // once may answer differently from the same one read three times.
    expect(fixed).toContain(
      "return result.error instanceof Error ? result.error.message : String(result.error);",
    );
    expect(fixed).toContain("return load() instanceof Error ? load().message : String(load());");
    expect(fixed).toContain("return asError(cause);");
    expect(fixed.match(/runtime-values\.ts/gu)).toHaveLength(1);
    expect(fixed).toContain("errorMessage");
    expect(fixed).toContain("asError");
    expect(fixed).toContain(
      "return outer.error instanceof Error ? outer.error.message : String(inner.error);",
    );
  });
});
