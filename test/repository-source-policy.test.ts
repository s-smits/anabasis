import { describe, expect, it } from "bun:test";
import { countNonBlank, excludedAs } from "../tools/loc/nonblank-loc.ts";
import {
  NEW_FILE_CEILING,
  NEW_FUNCTION_CEILING,
  sourceTextFindings,
  staleCopyLimits,
  unusedExports,
} from "../tools/loc/source-policy.ts";
import { scanTokens } from "../tools/loc/token-facts.ts";

const checks = (text: string, copiedLimit?: number): string[] =>
  sourceTextFindings("src/example.ts", text, copiedLimit).map((finding) => finding.check);

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
    const detail = unusedExports(declaring, new Map([["test/a.test.ts", "const x: Read = 1;\n"]]));
    expect(detail.map((finding) => finding.detail)).toEqual([
      "`Never` is exported and no other file names it; drop the `export`",
    ]);
    expect(detail[0]?.path).toBe("src/a.ts");
    // `twice` is declared in two files, so a mention cannot be attributed to either and neither is
    // reported. A name its own file reads is still unread from outside.
    const own = unusedExports(
      new Map([["src/a.ts", "export type Read = 1;\nconst y: Read = 1;\n"]]),
      new Map(),
    );
    expect(own).toHaveLength(1);
    // The search fails open: a name spelled in a comment or a string elsewhere counts as read.
    const comment = unusedExports(declaring, new Map([["scripts/x.mjs", "// Never mind\n"]]));
    expect(comment.map((finding) => finding.detail)).toEqual([
      "`Read` is exported and no other file names it; drop the `export`",
    ]);
  });

  // `walkFiles` reads every file under `src`, `tools` and `vendor`, and on 2026-09-20 the only
  // Markdown it found there were the two oxlint ledgers, one of them over the ceiling. The number
  // measures what the formatter does to authored code, so it was asking for a decision record to
  // be split at 800 lines for a reason belonging to neither half. A named copied-file ceiling is a
  // decision rather than an accident of the walk, so that one still binds.
  it("leaves prose to its own judgement, unless a ceiling names the file", () => {
    const long = Array.from({ length: NEW_FILE_CEILING + 1 }, () => "a line of prose.").join("\n");
    expect(sourceTextFindings("tools/oxlint/BASELINE.md", long).map((f) => f.check)).toEqual([]);
    expect(sourceTextFindings("tools/oxlint/BASELINE.md", long, 800).map((f) => f.check)).toEqual([
      "file-size",
    ]);
    expect(sourceTextFindings("src/example.ts", long).map((f) => f.check)).toContain("file-size");
  });

  it("limits copied files to their declared initial size", () => {
    expect(checks("one\ntwo\nthree", 2)).toContain("file-size");
    expect(checks("one\ntwo", 2)).not.toContain("file-size");
  });

  // A copied-file ceiling also turns the function check off for its file, so an entry left behind
  // after the file came inside both limits is a silent exemption rather than a dormant number.
  // That is why the map is swept: it held 93 entries on 2026-09-19 and 10 of them bound anything,
  // and it is down to 6 today.
  it("refuses a copied-file ceiling once its file is gone or inside both authored limits", () => {
    const stillOver = Array.from({ length: NEW_FILE_CEILING + 1 }, () => "const x = 1;").join("\n");
    const kept = "src/builder/tools.ts";
    const probe = (text: string | null) => staleCopyLimits((path) => (path === kept ? text : stillOver));

    expect(probe(null)).toEqual([
      {
        check: "stale-copy-limit",
        path: kept,
        detail: "copied-file ceiling names a file that no longer exists",
      },
    ]);
    const shrunk = probe("const x = 1;\n");
    expect(shrunk.map((finding) => finding.path)).toEqual([kept]);
    expect(shrunk[0]?.detail).toContain("exempts nothing");
    expect(probe(stillOver)).toEqual([]);

    // Four of the six entries left declare a ceiling below the 800-line file limit, so the only
    // thing they can be exempting is a long function. That is what makes the next case the
    // interesting one: the staleness reading is taken against the authored limits rather than
    // against the entry's own number, so a file whose function is over the ceiling still has a
    // load-bearing entry even though its size sits well inside 800.
    const longFunction = [
      "function tooLong() {",
      ...Array.from({ length: NEW_FUNCTION_CEILING }, () => "  void 0;"),
      "}",
    ].join("\n");
    expect(probe(longFunction)).toEqual([]);
  });

  it("refuses a removed literal or producer call while ignoring comments", () => {
    const active = sourceTextFindings(
      "src/example.ts",
      'const kind = "response-intent";\ncallHarnessVerb();\n',
    );
    expect(active.map((finding) => finding.check)).toEqual(["literal-cut", "call-cut"]);
    expect(sourceTextFindings("src/example.ts", "// response-intent; callHarnessVerb();\n")).toEqual([]);
  });

  it("provides token and nonblank facts to the direct hostile tests and analysis tools", () => {
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
    expect(excludedAs("tools/ui/generated/x.ts")).toBe("generated");
    expect(excludedAs("domains/bridge-truss/.venv/lib/numpy.py")).toBe("vendored");
    expect(excludedAs("packages/kernel/test/claim.test.ts")).toBe("tests");
    expect(excludedAs("packages/kernel/src/claim.ts")).toBeNull();
  });
});
