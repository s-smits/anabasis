import { describe, it } from "bun:test";
import { lintRules } from "./helpers/lint-rule.ts";

/**
 * The `anti-slop` rules no other fixture makes report.
 *
 * `test/oxlint-rule-contract.test.ts` reads every rule's declaration and none of their behaviour,
 * so a rule that has quietly stopped matching — an AST field renamed under it, a node type an
 * oxlint upgrade no longer hands it — passes that test, reports nothing, and leaves a gate that
 * reads exactly like a clean tree. Every one of these is `error` in `.oxlintrc.json` and
 * fails a push here, so whether they still report is a fact about this repository's gate.
 *
 * Each fixture is the smallest pair that separates the two failures. The `// REPORT` line fails a
 * rule that has gone quiet; the line beside it fails a rule that has started reporting everything,
 * and each one is the nearest admitted case rather than an unrelated line: an existence probe
 * beside the narrowing `typeof`, one assertion beside two.
 */

// `vi` is left undeclared on purpose: the rule reads it as a global reference, and declaring it
// here would give the binding a definition that is not an import and silence the rule.
/** This repository's own spelling: `mock.module` from `bun:test`, and a `module` on anything else. */
const RUNTIME_TYPEOF = `
declare const value: unknown;
export const narrowed = typeof value === "string"; // REPORT narrows a representation
export const present = typeof value === "undefined";
`;

const EMPTY_OBJECT_SPREAD = `
declare const flag: boolean;
declare const base: { id: string };
export const row = { ...base, ...(flag ? { extra: 1 } : {}) }; // REPORT omission by spread
export const plain = { ...base, extra: flag ? 1 : 0 };
`;

const CHAINED_ASSERTIONS = `
declare const value: unknown;
export const chained = value as { id: string } as { id: string; extra: number }; // REPORT two hops
export const single = value as { id: string };
`;

const FORBIDDEN_TERM_IN_NAME = `
export const shapeOfRow = 1; // REPORT names a shape
export const rowLayout = 1;
`;

const UNKNOWN_RETURN = `
export function raw(): unknown { // REPORT unknown contract
  return 1;
}
export function parsed(): { id: string } {
  return { id: "a" };
}
`;

/**
 * `no-shape-in-symbol-names` reads the word, not the letters. A name whose words include
 * "shape", "shapes" or "shaped" in any case or spelling convention is reported; a word that only
 * contains the letters, as `reshaped` and `misshapen` do, is admitted.
 */
const FORBIDDEN_TERM_WORDS = `
declare const rows: number[];
export const reshaped = rows.map((row) => [row]); // ADMITTED a verb built on the word
export const misshapen = 1; // ADMITTED another word holding the letters
export const taskShape = 1; // REPORT camelCase word
export const JSONShape = 1; // REPORT after a capital run
export const SHAPE_KEYS = 1; // REPORT constant case
export const jsonShaped = 1; // REPORT the participle
export const rowShapes = 1; // REPORT the plural
`;

/**
 * A qualified type name and a JSX member name are borrowed the way a property read is: the name
 * belongs to the namespace that declared it. The local declaration of the same word still reports.
 */
const BORROWED_NAMESPACE_MEMBER = `
import type * as z from "zod";
export type Fields = z.ZodRawShape; // ADMITTED the namespace declared the name
export type ZodShape = z.ZodType; // REPORT a name chosen here
`;

const BORROWED_JSX_MEMBER = `
import * as Library from "library";
export const view = <Library.ShapeView />; // ADMITTED the library declared the name
export const ShapeBox = () => <div />; // REPORT a name chosen here
`;

describe("the remaining anti-slop rule boundaries", () => {
  it("reports only the marked lines in every fixture and scope", async () => {
    await lintRules("anti-slop", [
      ["no-runtime-typeof", RUNTIME_TYPEOF, 1],
      ["no-conditional-empty-object-spread", EMPTY_OBJECT_SPREAD, 1],
      ["no-chained-type-assertions", CHAINED_ASSERTIONS, 1],
      ["no-shape-in-symbol-names", FORBIDDEN_TERM_IN_NAME, 1],
      ["no-unknown-returns", UNKNOWN_RETURN, 1],
      ["no-shape-in-symbol-names", FORBIDDEN_TERM_WORDS, 5],
      ["no-shape-in-symbol-names", BORROWED_NAMESPACE_MEMBER, 1],
      ["no-shape-in-symbol-names", BORROWED_JSX_MEMBER, 1, "fixture.tsx"],
    ]);
  });
});
