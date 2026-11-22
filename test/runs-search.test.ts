// Search must recover old analyses without reading credentials or letting one peer hide the rest.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { searchLocal } from "../tools/runs/search.ts";

const root = mkdtempSync(join(tmpdir(), "ana-runs-search-test-"));
const spills: string[] = [];
const log = ".ana/d2/old/log.jsonl";
const note = "notes/analysis.md";
const query = { pattern: "needle", regex: false, ignoreCase: false };
const fixture = (path: string, text: string) => {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
  return target;
};
fixture(log, "before\nneedle in a log\nNEEDLE in capitals\nliteral a.b\n");
fixture(note, `needle in notes\r\n${"x".repeat(450)}needle${"z".repeat(500)}\nlast needle`);
fixture("data/runs/here/retired/log.jsonl", "archived needle\n");
for (const path of [
  "notes/.env",
  "notes/.env.local",
  "notes/.accounts/login",
  "notes/private.key",
  "notes/credentials.json",
  "notes/node_modules/a.txt",
  "notes/.git/config",
]) {
  fixture(path, "needle PRIVATE_SENTINEL\n");
}
symlinkSync(join(root, "notes/.env"), join(root, "notes/linked.txt"));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  for (const spill of spills) rmSync(dirname(spill), { recursive: true, force: true });
});

describe("searching logs and notes", () => {
  test("finds log and note lines while excluding credentials and links", async () => {
    const found = await searchLocal(query, [root]);
    expect(found.matches).toHaveLength(5);
    expect(found.matches.some((match) => match.path === join(root, log) && match.line === 2)).toBe(true);
    expect(found.matches.some((match) => match.path === join(root, note) && match.line === 3)).toBe(true);
    expect(JSON.stringify(found)).not.toContain("PRIVATE_SENTINEL");
    expect((await searchLocal({ ...query, ignoreCase: true }, [root])).matches).toHaveLength(6);
    expect((await searchLocal({ ...query, pattern: "a.b" }, [root])).matches).toHaveLength(1);
    expect((await searchLocal({ ...query, pattern: "a[.]b$", regex: true }, [root])).matches).toHaveLength(1);
  });
});
