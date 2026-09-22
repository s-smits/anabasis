/**
 * The rule that asks for a short helper with a single caller to be put back at that call site.
 *
 * How short depends on where that call stands, and the third fixture below is the pair: the same
 * three-statement body is reported where the call is a statement and kept where it is an
 * argument, a concise arrow's body or a `for` header, because those have to hold the whole body
 * as one term. `long` and `wide` in the first fixture are the expression side of the same pair.
 *
 * Ten exemptions carry the rule and are pinned here, because each one was a false positive
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
 * caller's `return`, where the escapes land exactly as written, and the fourth fixture is that
 * pair: one body, admitted where it would have to be unpicked and reported where it would not.
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
import { describe, expect, it } from "bun:test";
import { expectedLines, reportedLines } from "./helpers/oxlint-rule-fixture.ts";

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

/**
 * The three kinds of call site. A statement takes statements, one under the other, so three of
 * them and a seven-line span still read as the caller's own work; an expression holds the body as
 * one term and keeps the lower pair; and a `return`'s own value is the statement site that also
 * takes a body which escapes. The `using` body is refused at all three, because `using` disposes
 * at the end of the block that declares it and the caller's block is a longer one.
 *
 * `mixed`, `escaped` and `held` are one body under three call sites. It is not a guard chain — it
 * opens with a declaration — which is what the first version of this refusal looked for, and it
 * relocates no better for that.
 */
const SITES = `
declare function openHandle(path: string): { read(): string };
function stood(value: string) { // REPORT three statements landing where a statement stands
  const trimmed = value.trim();
  const upper = trimmed.toUpperCase();
  return upper.length;
}
function returned(value: string) { // REPORT a return's value is a statement's worth of room
  const trimmed = value.trim();
  const upper = trimmed.toUpperCase();
  return upper.length;
}
function widely(value: string) { // REPORT one statement over six lines, standing on its own
  return (
    value.length > 0 &&
    value.trim() === value &&
    value.toUpperCase() !== value
  );
}
function argued(value: string) { // ADMITTED the same three statements, handed to a call
  const trimmed = value.trim();
  const upper = trimmed.toUpperCase();
  return upper.length;
}
function mapped(value: string) { // ADMITTED a concise arrow body holds no statements
  const trimmed = value.trim();
  const upper = trimmed.toUpperCase();
  return upper.length;
}
function borrowed(path: string) { // ADMITTED a using declaration closes at the end of the block holding it
  using handle = openHandle(path);
  return handle.read();
}
function looped(value: string) { // ADMITTED a for header is no place to put lines
  const trimmed = value.trim();
  const upper = trimmed.toUpperCase();
  return upper.length;
}
function caught(path: string) { // ADMITTED the language has no try expression
  try {
    return openHandle(path).read();
  } catch {
    return "";
  }
}
function decided(value: string) { // ADMITTED a decision chain has no spelling this ruleset accepts
  if (value === "") return "empty";
  if (value.trim() === value) return "tight";
  return "loose";
}
function mixed(value: string) { // ADMITTED it leaves before its last statement, and no chain does that
  const trimmed = value.trim();
  if (trimmed === "") return "empty";
  return trimmed;
}
async function held(value: string) { // ADMITTED an awaited value is not what the escapes return
  const trimmed = value.trim();
  if (trimmed === "") return "empty";
  return trimmed;
}
function escaped(value: string) { // REPORT the same body, where the call is the caller's return
  const trimmed = value.trim();
  if (trimmed === "") return "empty";
  return trimmed;
}
export function sites(value: string, rows: string[]) {
  const first = stood(value);
  const second = String(argued(value));
  const third = rows.map((row) => mapped(row));
  const fourth = widely(value);
  const fifth = borrowed(value);
  const sixth = caught(value);
  const seventh = decided(value);
  const eighth = mixed(value);
  for (let index = looped(value).length; index > 0; index -= 1) third.push(String(index));
  return [first, second, third, fourth, fifth, sixth, seventh, eighth];
}
export function tail(value: string) {
  return returned(value);
}
export function escapingTail(value: string) {
  return escaped(value);
}
export async function awaitedTail(value: string) {
  return await held(value);
}
`.trimStart();

/**
 * The two ceilings the rule yields to. `tools/loc/source-policy.ts` refuses a function over 115
 * nonblank lines and `tools/loc/complexity-policy.ts` refuses one at 22 branches, so a caller
 * already there has no spelling that absorbs a helper: reporting it would ask for a file that
 * cannot pass the gate. Six sites in this tree are of that kind, across `src/backends`,
 * `src/builder`, `src/solve`, `src/truth`, `src/author` and `vendor/pi-claude-bridge`.
 *
 * The last pair is the same argument for a caller with room for one of them. Reporting both is
 * what the rule did to `settle` in `src/builder/verifier-workshop.ts`, whose two helpers each
 * fitted the three branches it had left and together needed four.
 */
const FILLER = Array.from({ length: 112 }, (_, index) => "  const line" + index + " = value.length;").join(
  "\n",
);
const BRANCHES = Array.from(
  { length: 21 },
  (_, index) => '  if (value === "v' + index + '") return value;',
).join("\n");
const NEARLY = Array.from(
  { length: 18 },
  (_, index) => '  if (value === "n' + index + '") return value;',
).join("\n");

const CEILINGS = [
  "function atLineCeiling(value: string) { // ADMITTED its caller already measures 115 of 115 lines",
  "  return value.trim();",
  "}",
  "function atBranchCeiling(value: string) { // ADMITTED its caller already measures 21 of 21 branches",
  "  return value.trim();",
  "}",
  "function roomToSpare(value: string) { // REPORT the same helper, from a caller with room for it",
  "  return value.trim();",
  "}",
  "export function small(value: string) {",
  "  return roomToSpare(value);",
  "}",
  "export function big(value: string) {",
  FILLER,
  "  return atLineCeiling(value);",
  "}",
  "export function branchy(value: string) {",
  BRANCHES,
  "  return atBranchCeiling(value);",
  "}",
  "function firstSpend(value: string) { // REPORT one branch, and the caller has room for one",
  '  return value === "" ? "empty" : value;',
  "}",
  "function secondSpend(value: string) { // ADMITTED the helper above spent the branch both needed",
  '  return value.length > 0 ? "some" : "none";',
  "}",
  // The default value is the nineteenth branch: `eslint(complexity)` counts one, so this rule
  // has to as well or it reports a helper the gate then refuses.
  'export function nearly(value: string, fallback: string = "x") {',
  NEARLY,
  "  return firstSpend(value) + secondSpend(value) + fallback;",
  "}",
  "",
].join("\n");

describe("ana/no-single-caller-helper", () => {
  const reports = (at: string): number[] => reportedLines("ana", "no-single-caller-helper", HELPERS, at);

  it("reports a short module-scope helper with one caller and keeps the ones that earn a name", () => {
    const expected = expectedLines(HELPERS);
    expect(expected).toHaveLength(4);
    expect(reports("src/example.ts")).toStrictEqual(expected);
  });

  it("yields where the caller is at a ceiling, or has spent its room on an earlier helper", () => {
    const expected = expectedLines(CEILINGS);
    expect(expected).toHaveLength(2);
    expect(reportedLines("ana", "no-single-caller-helper", CEILINGS, "src/ceilings.ts")).toStrictEqual(
      expected,
    );
  });

  it("takes three statements where the call is a statement, and two where it is a term", () => {
    const expected = expectedLines(SITES);
    expect(expected).toHaveLength(4);
    expect(reportedLines("ana", "no-single-caller-helper", SITES, "src/sites.ts")).toStrictEqual(expected);
  });

  it("stays out of tests and components, and holds the plugin tree to the same rule as src", () => {
    expect(reports("test/example.test.ts")).toStrictEqual([]);
    expect(reports("packages/ui/src/view.tsx")).toStrictEqual([]);
    expect(reports("tools/oxlint/anti-slop/rules/example.ts")).toStrictEqual(expectedLines(HELPERS));
  });
});
