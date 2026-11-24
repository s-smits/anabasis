/**
 * The `#src/*` and `#tools/*` aliases, read the same way by the fixers that write an import and by
 * the two tree scans that read a specifier as a use of the module it names.
 */
import { describe, expect, it } from "bun:test";
import { resolve } from "../src/meta/path.ts";
import { importSpecifier } from "../tools/oxlint/ana/shared/import-fix.ts";
import { parsedSources } from "../tools/oxlint/tree-ast.ts";
import { identitiesWithoutOwner } from "../tools/oxlint/tree-identity.ts";
import { unreadModules } from "../tools/oxlint/tree-findings.ts";

const SKILL_SCRIPT = ".claude/skills/launch-run/scripts/fixture.ts";
const REPO = resolve(import.meta.dirname, "..");

describe("the fixers that write an import", () => {
  it("has the fixers that write an import write the alias under this repository's own options", () => {
    for (const [path, specifier] of [
      [SKILL_SCRIPT, "#src/meta/os.ts"],
      ["tools/oxlint/not-slop.ts", "../../src/meta/os.ts"],
      ["src/a/b/c/x.ts", "../../../meta/os.ts"],
      ["vendor/pi-built/a/b/x.ts", "../../../../src/meta/os.ts"],
    ] as const) {
      expect(importSpecifier(`${REPO}/${path}`, "src/meta/os.ts")).toBe(specifier);
    }
  });
});

describe("the tree scans read an alias as the module it names", () => {
  it("counts an `#src` import as a reader, so the module is not an orphan", () => {
    const rows = unreadModules(
      new Map([
        ["src/meta/owner.ts", "export const x = 1;\n"],
        [SKILL_SCRIPT, 'import { x } from "#src/meta/owner.ts";\nconsole.log(x);\n'],
      ]),
    );
    expect(rows.filter((row) => row.path === "src/meta/owner.ts")).toStrictEqual([]);
  });

  it("reads a path paired with its aliased import as the module's spelling, not an identity", () => {
    const probe = [
      'const { SOURCE_IDENTITY } = await target<typeof import("#src/run/source-identity.ts")>(',
      '  "src/run/source-identity.ts",',
      ");",
      "",
    ].join("\n");
    const rows = identitiesWithoutOwner(
      parsedSources(
        new Map([
          ["a/probe.ts", probe],
          ["b/probe.ts", probe],
        ]),
      ),
    );
    expect(rows.map((row) => row.detail)).toStrictEqual([]);
  });

  it("reads a name quoted inside a backtick span as prose, and the same name bare as an identity", () => {
    for (const [line, identity] of [
      ["const help = 'such as `type T = \"sandbox-level/v1\"` in a type';", false],
      ['const help = `such as type T = "sandbox-level/v1" in a type`;', false],
      ['const level = "sandbox-level/v1";', true],
      ['const level = `at ${"sandbox-level/v1"}`;', true],
      ['const tick = "`", level = "sandbox-level/v1";', true],
    ] as const) {
      expect(
        identitiesWithoutOwner(
          parsedSources(
            new Map([
              ["a/probe.ts", line],
              ["b/probe.ts", line],
            ]),
          ),
        ).length > 0,
        line,
      ).toBe(identity);
    }
  });
});
