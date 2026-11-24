import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { countNonBlank } from "../tools/loc/nonblank-loc.ts";
import {
  AGENTS_MD_BYTE_CEILING,
  breaches,
  corpus,
  NEW_FILE_CEILING,
  NEW_FUNCTION_CEILING,
  production,
  sourceTextFindings,
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
    expect(sourceTextFindings("AGENTS.md", "a".repeat(AGENTS_MD_BYTE_CEILING))).toEqual([]);
    expect(
      sourceTextFindings("AGENTS.md", "a".repeat(AGENTS_MD_BYTE_CEILING + 1)).map((f) => f.check),
    ).toEqual(["file-size"]);
  });

  it("reads a root's own files and skips a nested checkout under it", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-corpus-"));
    try {
      mkdirSync(join(root, "skills"), { recursive: true });
      mkdirSync(join(root, "worktrees", "agent-a", "src"), { recursive: true });
      writeFileSync(join(root, "skills", "own.ts"), "export const own = 1;\n");
      writeFileSync(join(root, "worktrees", "agent-a", ".git"), "gitdir: elsewhere\n");
      writeFileSync(join(root, "worktrees", "agent-a", "src", "copy.ts"), "export const own = 1;\n");
      expect([...corpus([root], [".ts"]).keys()]).toEqual([join(root, "skills", "own.ts")]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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

  it("enforces helper-tree and security-layer boundaries", () => {
    expect(production("packages/ui/test/smoke.test.ts")).toBe(false);
    expect(production("vendor/foo/test/x.ts")).toBe(true);
    expect(production("packages/ui/src/main.ts")).toBe(true);
    expect(
      breaches(["packages/ui/test/smoke.test.ts", "packages/ui/src/main.ts"], () => ["test/helpers/a.ts"]),
    ).toEqual([{ file: "packages/ui/src/main.ts", imported: "test/helpers/a.ts", root: "test/" }]);
    const graph = new Map<string, readonly string[]>([
      ["src/kernel/check-child.ts", ["src/meta/path.ts", "src/kernel/contract.ts", "src/builder/tools.ts"]],
      ["src/meta/path.ts", ["src/meta/os.ts", "src/kernel/log.ts"]],
      ["src/kernel/log.ts", ["src/wall/policy.ts", "src/builder/tools.ts"]],
      ["src/wall/policy.ts", ["src/meta/os.ts", "src/campaign/decide.ts"]],
      ["src/campaign/round.ts", ["src/builder/tools.ts"]],
    ]);
    expect(breaches([...graph.keys()], (file) => graph.get(file) ?? [])).toEqual([
      { file: "src/kernel/check-child.ts", imported: "src/kernel/contract.ts", root: "offline-cell" },
      { file: "src/kernel/check-child.ts", imported: "src/builder/tools.ts", root: "offline-cell" },
      { file: "src/meta/path.ts", imported: "src/kernel/log.ts", root: "src/meta/" },
      { file: "src/kernel/log.ts", imported: "src/builder/tools.ts", root: "src/builder/" },
      { file: "src/wall/policy.ts", imported: "src/campaign/decide.ts", root: "src/campaign/" },
    ]);
  });
});
