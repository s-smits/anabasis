// The harness-query script spends Built turns once it gets past its arguments, so the only part a
// test may drive is the refusal in front of that: a misspelled option, or a directory that is not
// a Built Harness bundle, has to stop before any bundle is derived.
import { join } from "../src/meta/path.ts";
import { expect, test } from "bun:test";
import { spawnTextSync } from "./helpers/bun-spawn-sync.ts";

const script = join(import.meta.dir, "../.claude/skills/harness-query/scripts/harness-query.mts");

function run(args: string[]) {
  return spawnTextSync(Bun.argv[0] ?? "bun", ["--no-env-file", script, ...args], { timeout: 60_000 });
}

test("a misspelled or missing option refuses with exit 2", () => {
  const misspelled = run(["--harnes", "domains/x", "--list"]);
  expect(misspelled.status).toBe(2);
  expect(misspelled.stderr).toBe('harness-query: unknown option "--harnes"\n');
  const missing = run(["--list"]);
  expect(missing.status).toBe(2);
  expect(missing.stderr).toBe("harness-query: --harness is required\n");
  const turns = run(["--harness", "/nonexistent", "--max-built-turns", "many"]);
  expect(turns.status).toBe(2);
  expect(turns.stderr).toContain("--max-built-turns must be an integer");
});

test("a directory that is not a Built Harness bundle refuses with exit 1", () => {
  const result = run(["--harness", "/nonexistent-harness-query-bundle", "--list"]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("not a Built Harness bundle");
});
