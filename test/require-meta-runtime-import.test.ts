/**
 * The rule that keeps the host runtime surface behind `src/meta`.
 *
 * What is pinned here beside the report is the fixer's table, because that is where it can be
 * wrong. It moves the seven builtins exactly
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

describe("ana/require-meta-runtime-import", () => {
  const reports = (at: string): Promise<number[]> =>
    reportedLines("ana", "require-meta-runtime-import", IMPORTS, at);

  it("reports a direct builtin import and a direct builtin re-export", async () => {
    const expected = expectedLines(IMPORTS);
    expect(expected).toHaveLength(3);
    expect(await reports("src/example.ts")).toStrictEqual(expected);
  });

  it("joins the import the file already makes, and writes a new one at this file's own depth", async () => {
    expect(await fixedSource("ana", "require-meta-runtime-import", MOVABLE, "src/run/example.ts")).toBe(
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
});
