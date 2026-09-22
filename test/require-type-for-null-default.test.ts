/**
 * The rule that asks an unchecked JavaScript file to say what a binding defaulted to `null` or
 * `undefined` actually admits.
 *
 * `tsconfig.json` includes `.ts` and `.mts` and nothing else, so these files are outside the
 * typecheck program altogether and a default is the only type information in them. The type-aware
 * lint pass still reads them, and it reads `fallback = null` as the type with one value: a caller
 * passing a string passes something the parameter does not admit, and every condition over it has
 * one answer. Three `.mjs` sites took a `RegExp` on a parameter defaulted to `null` and their
 * branch was unreachable for the whole of the checker's reading, which is what the strict-boolean
 * pass found in September 2026. One `@param` restored each.
 *
 * Both declarations are admitted, because the object case has two honest spellings: a `@type` over
 * the literal, and a cast on the one value. The cast is what scales — `select-best-runs.mjs`
 * builds a record of twelve properties of which five are `null`, and annotating the object means
 * restating the seven the author never had to write down.
 */
import { describe, expect, it } from "bun:test";
import { expectedLines, reportedLines } from "./helpers/oxlint-rule-fixture.ts";

const FIXTURE = `
export function reported(value, fallback = null) { // REPORT the only type it carries is \`null\`
  return value ?? fallback;
}
export function undefinedToo(value, fallback = undefined) { // REPORT one value is one value
  return value ?? fallback;
}
/** @param {string | null} [fallback] */
export function declared(value, fallback = null) { // ADMITTED a @param says what it admits
  return value ?? fallback;
}
export function destructured({ terminal = null } = {}) { // REPORT a pattern default declares nothing
  return terminal;
}
/** @param {{ terminal?: string | null }} [options] */
export function documentedPattern({ terminal = null } = {}) { // ADMITTED the type tag names it
  return terminal;
}
export function typedDefault(value, fallback = "") { // ADMITTED a default that carries its own type
  return value ?? fallback;
}
export const arrow = (value, act = null) => [value, act]; // REPORT an arrow declares no more
export function accumulate(argv) {
  const values = { campaign: null, json: false }; // REPORT assigned a string the checker cannot see
  for (const arg of argv) values.campaign = arg;
  return values;
}
export function castProperty(argv) {
  const values = { campaign: /** @type {string | null} */ (null), json: false }; // ADMITTED a cast
  for (const arg of argv) values.campaign = arg;
  return values;
}
/** @type {{ campaign: string | null }} */
export function annotatedObject(argv) {
  /** @type {{ campaign: string | null, json: boolean }} */
  const values = { campaign: null, json: false }; // ADMITTED the literal is annotated
  for (const arg of argv) values.campaign = arg;
  return values;
}
export function keptNull() {
  const record = { campaign: null, json: false }; // ADMITTED nothing assigns it, so \`null\` is its type
  return record;
}
`.trimStart();

describe("ana/require-type-for-null-default", () => {
  it("reports an undeclared null default and admits either declaration of it", () => {
    const expected = expectedLines(FIXTURE);
    expect(expected).toHaveLength(5);
    expect(
      reportedLines("ana", "require-type-for-null-default", FIXTURE, "scripts/example.mjs"),
    ).toStrictEqual(expected);
  });

  it("says nothing about a file that can annotate", () => {
    expect(reportedLines("ana", "require-type-for-null-default", FIXTURE, "src/example.ts")).toStrictEqual(
      [],
    );
  });
});
