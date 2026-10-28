import { describe, expect, it } from "bun:test";
import { countNonBlank } from "../tools/loc/nonblank-loc.ts";
import {
  NEW_FILE_CEILING,
  NEW_FUNCTION_CEILING,
  sourceTextFindings,
  unusedExports,
} from "../tools/loc/source-policy.ts";
import { scanTokens } from "../tools/loc/token-facts.ts";

const checks = (text: string): string[] =>
  sourceTextFindings("src/example.ts", text).map((finding) => finding.check);

describe("source policy", () => {
  it("refuses an authored file and function above the configured limits", () => {
    expect(checks(Array.from({ length: NEW_FILE_CEILING + 1 }, () => "const x = 1;").join("\n"))).toContain(
      "file-size",
    );
    const longFunction = [
      "function tooLong() {",
      ...Array.from({ length: NEW_FUNCTION_CEILING }, () => "  void 0;"),
      "}",
    ].join("\n");
    expect(checks(longFunction)).toContain("function-size");
  });

  it("names an export no other file spells, and yields where the name cannot be attributed", () => {
    const declaring = new Map([
      ["src/a.ts", "export type Read = 1;\nexport type Never = 2;\nexport function twice() {}\n"],
      ["src/b.ts", "export function twice() {}\n"],
    ]);
    for (const [readers, name] of [
      [new Map([["test/a.test.ts", "const x: Read = 1;\n"]]), "Never"],
      [new Map([["scripts/x.mjs", "// Never mind\n"]]), "Read"],
    ] as const) {
      const findings = unusedExports(declaring, readers);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ check: "unused-export", path: "src/a.ts" });
      expect(findings[0]?.detail.match(/`([^`]+)`/u)?.[1]).toBe(name);
    }
    // A file's own read does not make its export a public interface.
    expect(
      unusedExports(new Map([["src/a.ts", "export type Read = 1;\nconst y: Read = 1;\n"]]), new Map()),
    ).toHaveLength(1);
  });

  it("reads string literals and calls past comments and a regex holding `#`, and counts nonblank lines", () => {
    const facts = scanTokens(
      '// "held" in a comment\ntype T = "artifact" | "clarification";\nfunction go() { accept(bytes); }\nconst s = `tpl-word`;\n',
    );
    expect(facts.literals.has("held")).toBe(false);
    expect(facts.literals.has("clarification")).toBe(true);
    expect(facts.literals.has("tpl-word")).toBe(true);
    expect(facts.calls.has("accept")).toBe(true);
    expect(facts.calls.has("go")).toBe(false);
    // A bare `#` inside a regex literal held the scanner in place; the scan must end, and the
    // code after the literal is still read.
    const hashed = scanTokens('const c = /##/;\nfunction after() { seen("late"); }\n');
    expect(hashed.calls.has("seen")).toBe(true);
    expect(hashed.literals.has("late")).toBe(true);
    expect(countNonBlank("a\n\n  \nb\n")).toBe(2);
  });
});
