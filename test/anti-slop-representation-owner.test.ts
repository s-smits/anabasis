import { describe, it } from "bun:test";
import { lintRules } from "./helpers/lint-rule.ts";

/**
 * The representation owner, `src/meta/json-shape.ts`, is where `no-runtime-typeof` and
 * `no-unsafe-dictionary-type` admit one written shape each. Each fixture is staged at the owner's
 * path, where only the admitted shape passes, and at an ordinary source path, where every
 * occurrence reports.
 */

const OWNER = "src/meta/json-shape.ts";

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

describe("the representation owner exemptions", () => {
  it("reports only the marked lines in every fixture and scope", async () => {
    await lintRules("anti-slop", [
      ["no-runtime-typeof", PREDICATES, 6, OWNER],
      ["no-unsafe-dictionary-type", OPEN_RECORD, 3, OWNER],
      ["no-runtime-typeof", PREDICATES.replaceAll("// ADMITTED", "// REPORT"), 9, "src/solve/example.ts"],
      [
        "no-unsafe-dictionary-type",
        OPEN_RECORD.replaceAll("// ADMITTED", "// REPORT"),
        4,
        "src/solve/example.ts",
      ],
    ]);
  });
});
