/**
 * The rule that sends JSON and `structuredClone` through the bindings `src/meta/json-runtime.ts`
 * captured at load, and the fixer that renames the call and imports the binding.
 *
 * Two things are pinned here that a reading of the rule does not settle. The first is its scope:
 * the controller's own process is `src` and `vendor`, and a dev-time reporter under `tools/`
 * loads no generated module, so the global it reaches cannot have been replaced. The second is
 * that three calls in one file produce one import, which is the whole reason the import edit
 * rides on every diagnostic rather than the first: oxlint drops a fix overlapping one it has
 * already applied, so a single carrier would be lost exactly when it was the one dropped.
 */
import { describe, expect, it } from "bun:test";
import { expectedLines, fixedSource, reportedLines } from "./helpers/oxlint-rule-fixture.ts";

const RULE = "require-captured-json-runtime";
const INSIDE = "src/example.ts";
const CALLS = `import { join } from "./meta/path.ts";

export function decode(raw: string): unknown {
  return JSON.parse(raw); // REPORT the ambient JSON.parse
}

export function encode(value: unknown): string {
  return JSON.stringify(value); // REPORT the ambient JSON.stringify
}

export function copy(value: unknown): unknown {
  return structuredClone(value); // REPORT the ambient structuredClone
}

export function decodeWith(raw: string, parse: (one: string) => unknown): unknown {
  return parse(raw); // ADMITTED a parameter, not the ambient global
}

export function under(root: string): string {
  return join(root, "one"); // ADMITTED an imported call
}

export function spelled(): string {
  return "JSON.parse"; // ADMITTED the name in a string is not a call
}
`;

describe("ana/require-captured-json-runtime", () => {
  it("reports each ambient global and nothing that merely names one", () => {
    const expected = expectedLines(CALLS);
    expect(expected).toHaveLength(3);
    expect(reportedLines("ana", RULE, CALLS, INSIDE)).toStrictEqual(expected);
  });

  it("speaks to the process that loads generated modules, and never to the file that captured them", () => {
    expect(reportedLines("ana", RULE, CALLS, "vendor/pi-claude-bridge/example.ts")).toHaveLength(3);
    expect(reportedLines("ana", RULE, CALLS, "tools/example.ts")).toStrictEqual([]);
    expect(reportedLines("ana", RULE, CALLS, "src/meta/json-runtime.ts")).toStrictEqual([]);
  });

  it("renames all three calls and imports them through one statement", () => {
    const fixed = fixedSource("ana", RULE, CALLS, INSIDE);
    expect(fixed).toContain("return capturedJsonParse(raw);");
    expect(fixed).toContain("return capturedJsonStringify(value);");
    expect(fixed).toContain("return capturedStructuredClone(value);");
    expect(fixed.match(/json-runtime\.ts/gu)).toHaveLength(1);
    expect(fixed).toContain("return parse(raw);");
    expect(fixed).toContain('return "JSON.parse";');
  });
});
