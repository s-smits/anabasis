/**
 * The gate's test collector walks the working tree, and a tree that has hosted a run carries a
 * controller-owned copy of the starter seed suite in every campaign workspace. On the live tree of
 * 2026-08-21 that made `evaluator.test.ts` and `harness.test.ts` collect three times each — once
 * from starters/ and once from each of two campaign workspaces — so a push re-ran a running
 * Builder's own output inside the repository gate.
 *
 * The exclusion lives once in bunfig.toml under [test].pathIgnorePatterns, not repeated as flags
 * on the `test` script. This file proves that mechanism by running the collector over the same
 * fixture with and without a bunfig carrying the patterns. The seed suites keep their own owner
 * in test/starter-seeds.test.ts, which copies them into a workspace and runs them there.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";

import { afterAll, describe, expect, it } from "bun:test";

import { tmpdir } from "../src/meta/os.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const IGNORED_ROOTS = ["campaigns", "domains", "starters"] as const;

const passing = 'import { expect, it } from "bun:test";\nit("case", () => expect(1).toBe(1));\n';
/** The shipped bunfig must carry every test root owned by another gate as a discovery exclusion. */
const bunfigIgnorePatterns = (): string[] => {
  const raw = readFileSync(join(REPO_ROOT, "bunfig.toml"), "utf8");
  const match = raw.match(/pathIgnorePatterns\s*=\s*\[([^\]]*)\]/);
  if (!match) return [];
  const body = match[1] ?? "";
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
};

const fixtureRoot = mkdtempSync(join(tmpdir(), "gate-collection-"));
afterAll(() => rmSync(fixtureRoot, { recursive: true, force: true }));

for (const [dir, file] of [
  ["test", "kept.test.ts"],
  ["campaigns/slug/epoch/workspace/correctness-model", "harness.test.ts"],
  ["domains/slug/correctness-model", "harness.test.ts"],
  ["starters/pi-built-harness/correctness-model", "harness.test.ts"],
] as const) {
  mkdirSync(join(fixtureRoot, dir), { recursive: true });
  writeFileSync(join(fixtureRoot, dir, file), passing);
}

const collectedFiles = async (withBunfig: boolean): Promise<number> => {
  if (withBunfig) {
    const patterns = IGNORED_ROOTS.map((root) => `"**/${root}/**"`).join(", ");
    writeFileSync(join(fixtureRoot, "bunfig.toml"), `[test]\npathIgnorePatterns = [${patterns}]\n`, "utf8");
  }
  const run = Bun.spawn([Bun.argv[0]!, "test"], {
    cwd: fixtureRoot,
    env: { PATH: Bun.env.PATH ?? "", HOME: Bun.env.HOME ?? "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = `${await new Response(run.stdout).text()}${await new Response(run.stderr).text()}`;
  await run.exited;
  const ran = output.match(/across (\d+) files?/);
  return ran ? Number(ran[1]) : 0;
};

describe("the repository gate collects each test once", () => {
  it("names every generated root the collector would otherwise walk", () => {
    expect(bunfigIgnorePatterns()).toEqual(IGNORED_ROOTS.map((root) => `**/${root}/**`));
  });

  it("collects only the repository suite, and collects all four without the bunfig exclusions", async () => {
    expect(await collectedFiles(true)).toBe(1);
    // The mutation: drop the bunfig and the same fixture hands the root gate three more files,
    // the generated suites owned by the controller.
    rmSync(join(fixtureRoot, "bunfig.toml"), { force: true });
    expect(await collectedFiles(false)).toBe(4);
  });
});
