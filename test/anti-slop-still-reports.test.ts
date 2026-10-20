import { describe, expect, it } from "bun:test";
import { expectedLines, reportedLines, reportedMessages } from "./helpers/oxlint-rule-fixture.ts";

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

const ACCUMULATOR_COPY = `
declare const rows: { id: string }[];
export const copied = rows.reduce((total, row) => Object.assign({}, total, row), {}); // REPORT copies
export const mutated = rows.reduce((total: Record<string, string>, row) => {
  total[row.id] = row.id;
  return total;
}, {});
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
  ["no-reduce-accumulator-copy", ACCUMULATOR_COPY],
  ["no-module-mocking", MODULE_MOCKING],
  ["no-runtime-typeof", RUNTIME_TYPEOF],
  ["no-unknown-type-aliases", UNKNOWN_ALIAS],
  ["no-conditional-empty-object-spread", EMPTY_OBJECT_SPREAD],
  ["no-chained-type-assertions", CHAINED_ASSERTIONS],
  ["no-shape-in-symbol-names", FORBIDDEN_TERM_IN_NAME],
  ["no-unknown-returns", UNKNOWN_RETURN],
];

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
 * An object-literal key holding a literal spells a field of a recorded format or a label in a
 * table of data, as the two ledger rows of 8 October and a count's label of 19 October did. A key
 * holding a computed value, or written in shorthand, is still the one place the name is chosen.
 */
const FORBIDDEN_TERM_DATA_KEYS = `
declare function buildTask(): number;
const rows = [{ name: "design", shape: "object {joints}" }]; // ADMITTED a recorded format's field
const counts = { shape: 2, unread: 1 }; // ADMITTED a label beside its count
const template = { shape: \`number\` }; // ADMITTED a template with nothing in it is a literal
const built = { taskShape: buildTask() }; // REPORT the key names a value this code computed
const shape = 1; // REPORT a binding
const short = { shape }; // REPORT the shorthand key is the binding again
export { built, counts, rows, short, template };
`;

describe("anti-slop rules that no other fixture exercises", () => {
  for (const [rule, fixture] of FIXTURES) {
    it(`${rule} still reports, and only where it should`, async () => {
      const expected = expectedLines(fixture);
      expect(expected).toHaveLength(1);
      expect(await reportedLines("anti-slop", rule, fixture)).toStrictEqual(expected);
    });
  }
});

describe("anti-slop/no-shape-in-symbol-names reads whole words", () => {
  it("reports the word in every spelling convention, and admits a longer word holding its letters", async () => {
    const expected = expectedLines(FORBIDDEN_TERM_WORDS);
    expect(expected).toHaveLength(5);
    expect(await reportedLines("anti-slop", "no-shape-in-symbol-names", FORBIDDEN_TERM_WORDS)).toStrictEqual(
      expected,
    );
  });

  it("admits an object-literal key holding a literal, and reports a key holding a computed value", async () => {
    const expected = expectedLines(FORBIDDEN_TERM_DATA_KEYS);
    expect(expected).toHaveLength(3);
    expect(
      await reportedLines("anti-slop", "no-shape-in-symbol-names", FORBIDDEN_TERM_DATA_KEYS),
    ).toStrictEqual(expected);
  });
});

describe("anti-slop/no-conditional-empty-object-spread names its owner", () => {
  it("sends the reader to the optional-key helpers, which ana/prefer-key-if-defined also asks for", async () => {
    const messages = await reportedMessages(
      "anti-slop",
      "no-conditional-empty-object-spread",
      EMPTY_OBJECT_SPREAD,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("keyIfDefined");
    expect(messages[0]).toContain("src/meta/optional-key.ts");
  });
});
