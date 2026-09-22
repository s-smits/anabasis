/**
 * The rule that keeps the host runtime surface behind `src/meta`.
 *
 * Two halves are pinned here. The scope, because the three exemptions are most of the rule — the
 * owner reaches the builtin by definition, a test that asserts what the product wrote to disk must
 * read the real file system, and a skill script under `.claude` runs outside every wall the
 * controller imposes, so its import is a door into nothing.
 *
 * And the fixer's table, because that is where it can be wrong. It moves the seven builtins exactly
 * one module under `src/meta` wraps and nothing else: `node:util` has two owners there, `node:crypto`
 * has none, and a shape whose repair is a decision — a type import, a namespace import, a re-export —
 * keeps its report and gets no edit. The fixture holds one of each so the admitted half is as
 * visible as the moved half.
 */
import { describe, expect, it } from "bun:test";
import { expectedLines, fixedSource, reportedLines } from "./helpers/oxlint-rule-fixture.ts";

const IMPORTS = `
import { readFileSync } from "node:fs"; // REPORT a second door to the file system
import { createHash } from "node:crypto"; // REPORT hashing is a runtime capability too
export { spawnSync } from "node:child_process"; // REPORT a re-export is a door as well
import { join } from "./meta/path.ts"; // ADMITTED the owner's own module
export { readFileSync as read } from "./meta/filesystem.ts"; // ADMITTED re-exported from the owner
import { z } from "zod"; // ADMITTED a package, not a host capability
export type { Stats } from "./meta/filesystem.ts"; // ADMITTED a type carries no capability
export const used = [readFileSync, createHash, join, z];
`.trimStart();

/** Every shape the fixer decides about, in one file, so one run states the whole table. */
const MOVABLE = `
import { basename, dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { parseEnv } from "node:util";
import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import * as os from "node:os";
import { join } from "../meta/path.ts";
export { isBuiltin } from "node:module";
export const used = [basename, dirname, mkdir, parseEnv, createHash, os, join];
`.trimStart();

/**
 * The one place `OWNER` is true of the module and false of the name.
 *
 * `filesystem.ts` re-exports the sync surface of `node:fs` and four promise-returning names from
 * `node:fs/promises` beside it, so moving `rm` off `node:fs` swaps a function taking a callback
 * for one returning a promise. `readFileSync` from the same module moves as it always did.
 */
const DUAL = `
import { rm } from "node:fs";
import { readFileSync } from "node:fs";
export const used = [rm, readFileSync];
`.trimStart();

describe("ana/require-meta-runtime-import", () => {
  const reports = (at: string): number[] => reportedLines("ana", "require-meta-runtime-import", IMPORTS, at);

  it("reports a direct builtin import and a direct builtin re-export", () => {
    const expected = expectedLines(IMPORTS);
    expect(expected).toHaveLength(3);
    expect(reports("src/example.ts")).toStrictEqual(expected);
  });

  it("exempts the owner of the surface, every test file and operator tooling", () => {
    expect(reports("src/meta/filesystem.ts")).toStrictEqual([]);
    expect(reports("test/example.test.ts")).toStrictEqual([]);
    expect(reports("test/helpers/example.ts")).toStrictEqual([]);
    expect(reports(".claude/skills/launch-run/scripts/launch.ts")).toStrictEqual([]);
    expect(reports(".claude/skills/zip-run/scripts/zip-run.mjs")).toStrictEqual([]);
  });

  it("finds the tooling root in an absolute path, which is what the linter passes", () => {
    const expected = expectedLines(IMPORTS);
    expect(reports("/checkout/.claude/skills/zip-run/scripts/zip-run.mjs")).toStrictEqual([]);
    expect(reports("/checkout/src/run/full-run.ts")).toStrictEqual(expected);
    expect(reports("/checkout/.claude/worktrees/x/src/run/full-run.ts")).toStrictEqual(expected);
  });

  it("joins the import the file already makes, and writes a new one at this file's own depth", () => {
    expect(fixedSource("ana", "require-meta-runtime-import", MOVABLE, "src/run/example.ts")).toBe(
      [
        'import { mkdir } from "../meta/filesystem.ts";',
        'import { parseEnv } from "node:util";',
        'import { createHash } from "node:crypto";',
        'import type { Stats } from "node:fs";',
        'import * as os from "node:os";',
        'import { join, basename, dirname } from "../meta/path.ts";',
        'export { isBuiltin } from "node:module";',
        "export const used = [basename, dirname, mkdir, parseEnv, createHash, os, join];",
        "",
      ].join("\n"),
    );
  });

  it("leaves the four names the owner takes from the promises module, and moves the rest", () => {
    const after = fixedSource("ana", "require-meta-runtime-import", DUAL, "src/run/example.ts");
    expect(after).toContain('import { rm } from "node:fs";');
    expect(after).toContain('import { readFileSync } from "../meta/filesystem.ts";');
    expect(reportedLines("ana", "require-meta-runtime-import", after, "src/run/example.ts")).toHaveLength(1);
  });

  it("still reports every builtin it will not move, so the finding outlives the fix", () => {
    const after = fixedSource("ana", "require-meta-runtime-import", MOVABLE, "src/run/example.ts");
    expect(reportedLines("ana", "require-meta-runtime-import", after, "src/run/example.ts")).toHaveLength(5);
  });
});
