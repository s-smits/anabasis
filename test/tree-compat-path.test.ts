/**
 * `tree/compatibility-path` (`tools/oxlint/tree-findings.ts`): a name that keeps a path for what
 * an older version left behind, reported in the repository's own source, and read as written in a
 * test and in a vendored upstream, where pi's own legacy readers stood answered until 19 October.
 */
import { describe, expect, it } from "bun:test";
import { compatibilityPaths } from "../tools/oxlint/tree-findings.ts";

const LEGACY = [
  "export function read(path: string): string {",
  "  return isLegacyRoot(path) ? path : '';",
  "}",
].join("\n");

const reported = (path: string): string[] =>
  compatibilityPaths(new Map([[path, LEGACY]])).map((row) => `${row.path}:${row.line}`);

describe("a compatibility path", () => {
  it("is reported where the repository's own source names one", () => {
    expect(reported("src/kernel/read.ts")).toEqual(["src/kernel/read.ts:2"]);
  });

  it("is not reported in a vendored upstream or a test", () => {
    expect(reported("vendor/pi-claude-bridge/compact-summary.ts")).toEqual([]);
    expect(reported("test/read.test.ts")).toEqual([]);
  });
});
