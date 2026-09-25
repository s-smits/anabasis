/**
 * The per-commit test selection reads a real import graph from a real Git tree, so the fixture is
 * one: a chain of modules at known distances from two tests, and a data file one test reads by name.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";

import { afterAll, describe, expect, it } from "bun:test";

import { distances, readGraph } from "../tools/runtime/affected-tests.ts";
import { execTextSync } from "./helpers/bun-spawn-sync.ts";

const files = {
  "src/deep.ts": "export const deep = 1;\n",
  "src/middle.ts": 'import { deep } from "./deep.ts";\nexport const middle = deep;\n',
  "src/top.ts": 'import { middle } from "./middle.ts";\nexport const top = middle;\n',
  "test/near.test.ts": 'import { top } from "../src/top.ts";\nexport const near = top;\n',
  "test/far.test.ts": 'import { near } from "./near.test.ts";\nexport const far = near;\n',
  "test/reads-data.test.ts": 'export const path = "fixtures/data.json";\n',
  "fixtures/data.json": "{}\n",
};

const fixture = mkdtempSync(join(tmpdir(), "ana-affected-tests-"));
afterAll(() => rmSync(fixture, { recursive: true, force: true }));
for (const [path, text] of Object.entries(files)) {
  mkdirSync(join(fixture, path, ".."), { recursive: true });
  writeFileSync(join(fixture, path), text);
}
execTextSync("git", ["init", "-q"], { cwd: fixture });
execTextSync("git", ["add", "-A"], { cwd: fixture });

describe("affected test selection", () => {
  const graph = readGraph(fixture);

  it("counts the imports between each test and a changed module, and reaches no test the chain misses", () => {
    expect(Object.fromEntries(distances(graph, ["src/deep.ts"]))).toEqual({
      "test/near.test.ts": 3,
      "test/far.test.ts": 4,
    });
    expect(Object.fromEntries(distances(graph, ["src/top.ts"]))).toEqual({
      "test/near.test.ts": 1,
      "test/far.test.ts": 2,
    });
  });

  it("reaches a file no module imports through the tests that name it", () => {
    expect(Object.fromEntries(distances(graph, ["fixtures/data.json"]))).toEqual({
      "test/reads-data.test.ts": 1,
    });
  });

  it("selects a changed test itself at distance zero", () => {
    expect(distances(graph, ["test/far.test.ts"]).get("test/far.test.ts")).toBe(0);
  });

  it("selects no test the commit deleted, since its tree holds nothing to run", () => {
    expect(Object.fromEntries(distances(graph, ["test/removed.test.ts"]))).toEqual({});
  });

  // The gate calls the script with `--base` alone, so the default is the depth every earlier commit
  // in a push is tested at.
  it("selects by default only the tests that import a changed file directly", () => {
    const git = (...args: string[]): string => execTextSync("git", args, { cwd: fixture });
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    git("commit", "-qm", "base");
    writeFileSync(join(fixture, "src/top.ts"), `${files["src/top.ts"]}export const again = top;\n`);
    git("commit", "-qam", "change top");
    const env = Object.fromEntries(Object.entries(Bun.env).filter(([name]) => name !== "ANA_AFFECTED_DEPTH"));
    const script = join(import.meta.dir, "../tools/runtime/affected-tests.ts");
    expect(execTextSync("bun", [script, "--base", "HEAD^1"], { cwd: fixture, env })).toBe(
      "test/near.test.ts\n",
    );
  });
});
