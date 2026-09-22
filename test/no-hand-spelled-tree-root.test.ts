/**
 * The rule that sends the campaign and product trees to their owner, and the fixer that moves the
 * joined arguments into the owner's call.
 *
 * The fixer stops in three places and each is pinned below, because a path fix that guesses is
 * worse than none: a segment with further segments after it names a location *inside* the tree
 * that the owner cannot spell, and the campaign root and the per-campaign directory are different
 * owners chosen by whether a slug follows.
 */
import { describe, expect, it } from "bun:test";
import { expectedLines, fixedSource, reportedLines } from "./helpers/oxlint-rule-fixture.ts";

const PATHS = `
import { join } from "./meta/path.ts";
export function root(repoRoot: string) {
  return join(repoRoot, "campaigns"); // REPORT the campaign root has an owner
}
export function campaign(repoRoot: string, slug: string) {
  return join(repoRoot, "campaigns", slug); // REPORT the per-campaign directory has its own owner
}
export function product(repoRoot: string, slug: string) {
  return join(repoRoot, "domains", slug); // REPORT the default product tree has an owner
}
export function inside(repoRoot: string, slug: string) {
  return join(repoRoot, "campaigns", slug, "opening.json"); // REPORT reported, not fixed: the owner cannot carry the tail
}
export function relative(slug: string) {
  return join("campaigns", slug, "case-record.jsonl"); // ADMITTED index 0 is the string's own first segment
}
export function elsewhere(repoRoot: string) {
  return join(repoRoot, "analysis"); // ADMITTED not an owned tree
}
`.trimStart();

describe("ana/no-hand-spelled-tree-root", () => {
  const reports = (at: string): number[] => reportedLines("ana", "no-hand-spelled-tree-root", PATHS, at);

  it("reports a segment joined onto a root and admits one that starts a relative string", () => {
    const expected = expectedLines(PATHS);
    expect(expected).toHaveLength(4);
    expect(reports("src/example.ts")).toStrictEqual(expected);
  });

  it("speaks to the controller only, and never to the two files that own the answer", () => {
    expect(reports("tools/report/example.ts")).toStrictEqual([]);
    expect(reports("src/meta/campaign-root.ts")).toStrictEqual([]);
    expect(reports("src/run/product-versions.ts")).toStrictEqual([]);
  });

  it("picks the owner from whether a slug follows, and leaves the one with a tail to the author", () => {
    const fixed = fixedSource("ana", "no-hand-spelled-tree-root", PATHS, "src/example.ts");
    expect(fixed).toContain("return campaignRoot(repoRoot);");
    expect(fixed).toContain("return campaignDir(repoRoot, slug);");
    expect(fixed).toContain("return defaultProductDir(repoRoot, slug);");
    expect(fixed).toContain('return join(repoRoot, "campaigns", slug, "opening.json");');
    expect(fixed).toContain('return join("campaigns", slug, "case-record.jsonl");');
    const owners = fixed.split("\n").filter((line) => line.includes("campaign-root.ts"));
    expect(owners).toHaveLength(1);
    for (const name of ["campaignRoot", "campaignDir", "defaultProductDir"]) {
      expect(owners[0]).toContain(name);
    }
  });
});
