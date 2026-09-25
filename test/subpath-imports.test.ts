/**
 * `anti-slop/prefer-subpath-import`, the root manifest's `#src/*` and `#tools/*` aliases, and the
 * four readers that have to agree on them: the rule that asks for them, the fixers that write
 * imports, and the two tree scans that read a specifier as a use of the module it names.
 */
import { describe, expect, it } from "bun:test";
import manifest from "../package.json" with { type: "json" };
import { resolve } from "../src/meta/path.ts";
import { importSpecifier } from "../tools/oxlint/ana/shared/import-fix.ts";
import { subpathAlias } from "../tools/oxlint/anti-slop/shared/subpath-alias.ts";
import { identitiesWithoutOwner } from "../tools/oxlint/tree-identity.ts";
import { unreadModules } from "../tools/oxlint/tree-module.ts";
import { spawnTextSync } from "./helpers/bun-spawn-sync.ts";
import { expectedLines, fixedSource, reportedLines } from "./helpers/oxlint-rule-fixture.ts";

const RULE = "prefer-subpath-import";
const SKILL_SCRIPT = ".claude/skills/launch-run/scripts/fixture.ts";
const REPO = resolve(import.meta.dirname, "..");

/** A package root declaring this repository's own aliases, so the fixture reads what the tree reads. */
const ROOT = { files: new Map([["package.json", JSON.stringify({ imports: manifest.imports })]]) };

const CLIMBING = `import { a } from "../../../../src/meta/path.ts"; // REPORT four levels into src
import { b } from "../../../../tools/oxlint/tree-module.ts"; // REPORT four levels into tools
export { c } from "../../../../src/meta/os.ts"; // REPORT a re-export climbs the same way
export * from "../../../../src/meta/text.ts"; // REPORT and so does a star re-export
type D = typeof import("../../../../src/run/source-identity.ts"); // REPORT a type import too
const e = await import("../../../../src/meta/assert.ts"); // REPORT and a dynamic one
import { f } from "../../lib/common.ts"; // ADMITTED two levels up is a neighbour
import { g } from "../../../other/scripts/x.ts"; // ADMITTED no alias names .claude
import { h } from "#src/meta/path.ts"; // ADMITTED already the alias
import { i } from "../../../../../escape.ts"; // ADMITTED climbs out of the package
export const used = [a, b, e, f, g, h, i] as D[];
`;

describe("prefer-subpath-import", () => {
  it("reports an import climbing three or more levels into an aliased tree", () => {
    expect(reportedLines("anti-slop", RULE, CLIMBING, SKILL_SCRIPT, ROOT)).toStrictEqual(
      expectedLines(CLIMBING),
    );
  });

  it("reports nothing where no manifest declares an alias", () => {
    expect(reportedLines("anti-slop", RULE, CLIMBING, SKILL_SCRIPT)).toStrictEqual([]);
  });

  it("reads the nearest manifest, so a nested package is judged by its own imports", () => {
    const nested = `import { a } from "../../../server/api.ts"; // REPORT the package's own alias
import { b } from "../../../../../../src/meta/path.ts"; // ADMITTED the root's alias stops at this package
export const c = [a, b];
`;
    const files = new Map([
      ...ROOT.files,
      ["packages/ui/package.json", JSON.stringify({ imports: { "#ui/*": "./src/*" } })],
    ]);
    const at = "packages/ui/src/a/b/c/x.ts";
    expect(reportedLines("anti-slop", RULE, nested, at, { files })).toStrictEqual(expectedLines(nested));
    expect(fixedSource("anti-slop", RULE, nested, at, { files })).toContain('from "#ui/server/api.ts"');
  });

  it("leaves a relativeOnly tree at its relative spelling at any depth", () => {
    const deep = 'import { a } from "../../../../tools/oxlint/tree-module.ts";\nexport const b = a;\n';
    const at = "src/a/b/c/x.ts";
    expect(reportedLines("anti-slop", RULE, deep, at, ROOT)).toStrictEqual([1]);
    const options = [{ relativeOnly: ["src"] }];
    expect(reportedLines("anti-slop", RULE, deep, at, { ...ROOT, options })).toStrictEqual([]);
  });

  it("rewrites the specifier to the alias in the quote the line already used", () => {
    const before = [
      "import { a } from '../../../../src/meta/path.ts';",
      'const b = await import("../../../../tools/oxlint/tree-module.ts");',
      "export const c = [a, b];",
      "",
    ].join("\n");
    expect(fixedSource("anti-slop", RULE, before, SKILL_SCRIPT, ROOT)).toBe(
      [
        "import { a } from '#src/meta/path.ts';",
        'const b = await import("#tools/oxlint/tree-module.ts");',
        "export const c = [a, b];",
        "",
      ].join("\n"),
    );
  });

  it("has the fixers that write an import write the alias under this repository's own options", () => {
    const at = (path: string): string => `${REPO}/${path}`;
    expect(importSpecifier(at(SKILL_SCRIPT), "src/meta/os.ts")).toBe("#src/meta/os.ts");
    expect(importSpecifier(at("tools/oxlint/strict-boolean-fix.ts"), "src/meta/os.ts")).toBe(
      "../../src/meta/os.ts",
    );
    expect(importSpecifier(at("src/a/b/c/x.ts"), "src/meta/os.ts")).toBe("../../../meta/os.ts");
    expect(importSpecifier(at("vendor/pi-built/a/b/x.ts"), "src/meta/os.ts")).toBe(
      "../../../../src/meta/os.ts",
    );
  });
});

describe("the root manifest's subpath aliases", () => {
  it("map each `#name/*` onto one `./dir/*` tree, the one shape every reader here reads", () => {
    const entries = Object.entries(manifest.imports);
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, target] of entries) {
      expect(key).toMatch(/^#[^*]+\/\*$/u);
      expect(target).toMatch(/^\.\/[^*]+\/\*$/u);
    }
  });

  it("leave every nested package at its relative spelling, since an alias resolves in the nearest", () => {
    const nested = spawnTextSync("git", ["ls-files", "*package.json"], { cwd: REPO })
      .stdout.split("\n")
      .filter((path) => path.endsWith("/package.json"));
    expect(nested.length).toBeGreaterThan(0);
    for (const path of nested) {
      const inside = `${REPO}/${path.slice(0, -"package.json".length)}a/b/c/x.ts`;
      const toRoot = "../".repeat(path.split("/").length + 2);
      expect([path, subpathAlias(inside, `${toRoot}src/meta/os.ts`)]).toStrictEqual([path, null]);
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
      new Map([
        ["a/probe.ts", probe],
        ["b/probe.ts", probe],
      ]),
    );
    expect(rows.map((row) => row.detail)).toStrictEqual([]);
  });

  it("reads an alias onto a differently named tree the same way, and a bare pair as an identity", () => {
    const probe = (specifier: string): string =>
      [
        `const { cli } = await target<typeof import("${specifier}")>(`,
        '  ".claude/skills/main/cli-owner.ts",',
        ");",
        "",
      ].join("\n");
    const rows = (specifier: string) =>
      identitiesWithoutOwner(
        new Map([
          ["a/probe.ts", probe(specifier)],
          ["b/probe.ts", probe(specifier)],
        ]),
      ).map((row) => row.detail);
    expect(rows("#skills/main/cli-owner.ts")).toStrictEqual([]);
    expect(rows("#skills/main/other.ts")).not.toStrictEqual([]);
  });
});
