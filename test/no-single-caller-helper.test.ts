/**
 * The rule that asks for a short helper with a single caller to be put back at that call site.
 *
 * Ten exemptions carry the rule, because each one was a false positive
 * first: a second caller makes it shared, an export makes it an interface, and a recursive
 * function counts its own call, so it reaches two references before a caller has been found. A
 * predicate read as one term of a chain of three or more keeps its name too, because its nineteen
 * same-shaped peers in that chain are how the caller is written; a chain of two has no peers, so
 * `x() || "unset"` is a helper in a fallback and is reported. A name read as a value rather
 * than called keeps it as well, because the report asks for lines to be put at a call site and
 * there is none. Two more say the call site has no legal spelling of the body at all: a `try`
 * cannot be an expression, and a body that returns before its last statement is not lines to
 * move but a restructuring, because a `return` belongs to the function that declares it and the
 * same line at a call site returns from the caller. The exception is the call that is itself the
 * caller's `return`, where the escapes land exactly as written.
 * The two scope exemptions were measured the same way: a `.tsx` component rendered once from
 * one parent is not a helper, and a test's fixture builder is not one either. A third, over
 * `tools/oxlint/anti-slop`, went on 2026-09-20 with the pin it claimed, which never existed; the
 * last case here holds that tree to the same rule as `src` so the exemption cannot come back by
 * accident.
 *
 * There is no fixer on purpose. Substituting the arguments into a one-`return` body is
 * mechanical, and the result is the same density under a longer expression; where the lines go
 * and what the local is called are the reader's decisions, which is the whole point of the rule.
 */
import { describe, it } from "bun:test";
import { lintRules } from "./helpers/lint-rule.ts";

const HELPERS = `
function once(value: string) { // REPORT one statement reached from one place
  return value.trim();
}
const arrow = (value: string) => value.length; // REPORT an expression body is already one term
function pair(value: string) { // REPORT two statements still read at the call site
  const trimmed = value.trim();
  return trimmed.length;
}
function shared(value: string) { // ADMITTED two callers make it shared
  return value.trim();
}
export function exported(value: string) { // ADMITTED an export is an interface
  return value.trim();
}
function long(value: string) { // ADMITTED three statements is a body of its own
  const trimmed = value.trim();
  const upper = trimmed.toUpperCase();
  return upper.length;
}
function wide(value: string) { // ADMITTED one statement, but six lines of it
  return (
    value.length > 0 &&
    value.trim() === value &&
    value.toUpperCase() !== value
  );
}
function validBackend(value: string) { // ADMITTED one term of a three-term chain its peers share
  return value === "codex";
}
function validName(value: string) { // ADMITTED the same, beside its peer
  return value.length > 0;
}
export function acceptable(value: string) {
  return validBackend(value) && validName(value) && value !== "";
}
function lonelyTerm(value: string) { // REPORT two operands are not peers, so no vocabulary is kept
  return value.trim();
}
export function fallback(value: string) {
  return lonelyTerm(value) || "unset";
}
function recursive(depth: number): number { // ADMITTED its own call is the second reference
  return depth === 0 ? 0 : recursive(depth - 1);
}
function tabled(value: string) { // ADMITTED read as a value, so there is no call to inline into
  return value.trim();
}
const TABLE = [tabled];
function isPresent(value: string | null): value is string { // ADMITTED the name is where the narrowing is declared
  return value !== null;
}
const asserted = (value: string | null): asserts value is string => { // ADMITTED an assertion narrows too
  if (value === null) throw new Error("absent");
};
function inner(value: string) { // ADMITTED three statements, and the nested one is not module scope
  function step(text: string) {
    return text.trim();
  }
  const first = step(value);
  return first.length + step(value).length;
}
export function caller(value: string) {
  asserted(value);
  return [once(value), arrow(value), pair(value), shared(value), shared(value), long(value), wide(value), recursive(2), inner(value), isPresent(value), TABLE.length];
}
`.trimStart();

describe("ana/no-single-caller-helper", () => {
  it("reports only the marked lines in every fixture and scope", async () => {
    await lintRules("ana", [
      ["no-single-caller-helper", HELPERS, 4, "src/example.ts"],
      ["no-single-caller-helper", HELPERS, 4, "tools/oxlint/anti-slop/rules/example.ts"],
      ["no-single-caller-helper", HELPERS, 0, "test/example.test.ts"],
      ["no-single-caller-helper", HELPERS, 0, "packages/ui/src/view.tsx"],
    ]);
  });
});
