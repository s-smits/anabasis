import { describe, expect, it } from "bun:test";
import { expectedLines, reportedLines } from "./helpers/oxlint-rule-fixture.ts";

/**
 * The eleven `anti-slop` rules no other fixture makes report.
 *
 * `test/oxlint-rule-contract.test.ts` reads every rule's declaration and none of their behaviour,
 * so a rule that has quietly stopped matching — an AST field renamed under it, a node type an
 * oxlint upgrade no longer hands it — passes that test, reports nothing, and leaves a gate that
 * reads exactly like a clean tree. Every one of these eleven is `error` in `.oxlintrc.json` and
 * fails a push here, so whether they still report is a fact about this repository's gate.
 *
 * It said eight, and was wrong by three. `no-chained-type-assertions`, `no-shape-in-symbol-names`
 * and `no-unknown-returns` had no behavioural test anywhere in this tree — the last three of the
 * sixteen — and the reason they were missed is the premise this file used to state in its own
 * doc: that `tools/oxlint/anti-slop` was pinned upstream verbatim, so its rules were somebody
 * else's to test. Nothing in the tree ever supported that. Retired 2026-09-20 with the
 * `.oxlintrc.json` block and the `isVendoredVerbatim` predicate that rested on it.
 *
 * Each fixture is the smallest pair that separates the two failures. The `// REPORT` line fails a
 * rule that has gone quiet; the line beside it fails a rule that has started reporting everything,
 * and each one is the nearest admitted case rather than an unrelated line — a lazy iterator
 * pipeline beside the eager one, an existence probe beside the narrowing `typeof`, one assertion
 * beside two.
 */

const FILTER_MAP = `
declare const widen: (value: number) => number;
export const eager = [1, 2, 3].filter((value) => value > 1).map(widen); // REPORT two passes
export const lazy = [1, 2, 3].values().filter((value) => value > 1).map(widen).toArray();
`;

const ACCUMULATOR_COPY = `
declare const rows: { id: string }[];
export const copied = rows.reduce((total, row) => Object.assign({}, total, row), {}); // REPORT copies
export const mutated = rows.reduce((total: Record<string, string>, row) => {
  total[row.id] = row.id;
  return total;
}, {});
`;

const REFLECT_APPLY = `
declare const handler: (value: number) => number;
export const reflected = Reflect.apply(handler, null, [1]); // REPORT untyped dispatch
export const called = handler(1);
`;

const REFLECT_GET = `
declare const source: { value: number };
export const reflected = Reflect.get(source, "value"); // REPORT untyped read
export const read = source.value;
`;

// `vi` is left undeclared on purpose: the rule reads it as a global reference, and declaring it
// here would give the binding a definition that is not an import and silence the rule.
const MODULE_MOCKING = `
vi.mock("./service.ts"); // REPORT module mock
export const stub = vi.fn();
`;

const RUNTIME_TYPEOF = `
declare const value: unknown;
export const narrowed = typeof value === "string"; // REPORT narrows a representation
export const present = typeof value === "undefined";
`;

const UNKNOWN_ALIAS = `
export type Payload = unknown; // REPORT hides unknown
export type Parsed = { value: string };
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

const FIXTURES: [string, string][] = [
  ["no-array-filter-map", FILTER_MAP],
  ["no-reduce-accumulator-copy", ACCUMULATOR_COPY],
  ["no-reflect-apply", REFLECT_APPLY],
  ["no-reflect-get", REFLECT_GET],
  ["no-module-mocking", MODULE_MOCKING],
  ["no-runtime-typeof", RUNTIME_TYPEOF],
  ["no-unknown-type-aliases", UNKNOWN_ALIAS],
  ["no-conditional-empty-object-spread", EMPTY_OBJECT_SPREAD],
  ["no-chained-type-assertions", CHAINED_ASSERTIONS],
  ["no-shape-in-symbol-names", FORBIDDEN_TERM_IN_NAME],
  ["no-unknown-returns", UNKNOWN_RETURN],
];

/**
 * `no-reflect-get` admits one shape: a Proxy `get` trap handing on its own three parameters, which
 * it must do so that getters see the proxy as `this`. A receiver passed anywhere else, or a trap
 * passing something other than its own receiver, is the untyped read the rule exists to report.
 */
const REFLECT_GET_TRAP = `
declare const source: { value: number };
export const traced = new Proxy(source, {
  get(target, property, receiver) {
    return Reflect.get(target, property, receiver); // ADMITTED the trap forwards its receiver
  },
});
export const arrow = new Proxy(source, {
  get: (target, property, receiver) => Reflect.get(target, property, receiver), // ADMITTED the same trap as an arrow
});
export const outside = Reflect.get(source, "value", source); // REPORT a receiver outside any trap
export const swapped = new Proxy(source, {
  get(target, property, receiver) {
    return Reflect.get(target, property, target); // REPORT the trap passes its target as the receiver
  },
});
export const other = new Proxy(source, {
  has(target, property) {
    return Reflect.get(target, property, target) !== undefined; // REPORT not a get trap
  },
});
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

describe("anti-slop rules that no other fixture exercises", () => {
  for (const [rule, fixture] of FIXTURES) {
    it(`${rule} still reports, and only where it should`, () => {
      const expected = expectedLines(fixture);
      expect(expected).toHaveLength(1);
      expect(reportedLines("anti-slop", rule, fixture)).toStrictEqual(expected);
    });
  }
});

describe("anti-slop/no-reflect-get and a Proxy get trap", () => {
  it("admits a get trap forwarding its own parameters, and reports every other receiver", () => {
    const expected = expectedLines(REFLECT_GET_TRAP);
    expect(expected).toHaveLength(3);
    expect(reportedLines("anti-slop", "no-reflect-get", REFLECT_GET_TRAP)).toStrictEqual(expected);
  });
});

describe("anti-slop/no-shape-in-symbol-names reads whole words", () => {
  it("reports the word in every spelling convention, and admits a longer word holding its letters", () => {
    const expected = expectedLines(FORBIDDEN_TERM_WORDS);
    expect(expected).toHaveLength(5);
    expect(reportedLines("anti-slop", "no-shape-in-symbol-names", FORBIDDEN_TERM_WORDS)).toStrictEqual(
      expected,
    );
  });
});
