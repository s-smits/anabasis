/**
 * Every committed test file sits where a gate step runs it. Bun discovers `*.test` and `*.spec`
 * files in all eight JavaScript and TypeScript suffixes, but never descends into a dot-directory,
 * and a positional path filters what it found rather than adding a root, so a suite under
 * `.claude/skills/**` would be invisible yet green. The roots below are every place a gate step
 * runs. The subject is the candidate tree, tracked files that exist plus untracked non-ignored
 * ones, read through Git so it reaches dot-directories, which the corpus walk in
 * `tools/loc/source-policy.ts` does not.
 */
import { existsSync, readFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";

import { describe, expect, it } from "bun:test";

const repoRoot = join(import.meta.dir, "..");

const DISCOVERED_ROOTS = [
  "test/", // `bun run test`, which is the gate's last step
  "packages/ui/test/", // `bun run ui:gate`, which prepares that package's own node_modules first
];

/** A suite by name in any suffix Bun runs, plus the `.bun-tests` spelling of the retired wrappers. */
const SUITE = /(?:\.(?:test|spec)|\.bun-tests)\.(?:m|c)?[jt]sx?$/;

function candidateFiles(): string[] {
  const listed = Bun.spawnSync({
    cmd: ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (!listed.success) throw new Error(`git ls-files failed: ${listed.stderr.toString().slice(0, 200)}`);
  return listed.stdout
    .toString()
    .split("\0")
    .filter((path) => path !== "" && existsSync(join(repoRoot, path)));
}

/** The suites among `paths` that no gate step would run. The first two cases state the rule on named
 *  paths, not on this checkout's contents. */
function undiscovered(paths: readonly string[]): string[] {
  return paths.filter((path) => SUITE.test(path) && !DISCOVERED_ROOTS.some((root) => path.startsWith(root)));
}

describe("repository test discovery", () => {
  it("names a suite outside every root a gate step runs", () => {
    const written = [
      ".claude/skills/system-path-simulation/scripts/hidden.test.mjs",
      ".claude/skills/whole-run-investigation/scripts/quieter.bun-tests.mjs",
      "src/three/beside-its-source.test.ts",
      "tools/four/beside-its-source.spec.tsx",
      "vendor/five/worker.test.cts",
    ];
    expect(undiscovered(written)).toEqual(written);
  });

  it("says nothing about the root the gate runs, or about ordinary source", () => {
    expect(
      undiscovered([
        "test/attribute.test.ts",
        "test/campaign-status.test.mjs",
        "test/helpers/scratch.ts",
        "src/run/full-run.ts",
        "notes/a-test-of-patience.md",
      ]),
    ).toEqual([]);
  });

  it("finds none in this repository", () => {
    expect(undiscovered(candidateFiles())).toEqual([]);
  });

  it("keeps every in-repo scratch directory inside the one ignored family", () => {
    // A fixture whose modules must resolve against this repository's `node_modules` makes its scratch
    // inside the checkout, and `.gitignore` alone keeps it from this test and oxlint. One pattern
    // covers the family, so a prefix outside it fails here, at the fixture. A `mkdtemp` under the
    // system temp directory or the home sits outside the rule, and those bases are named; a fourth
    // fails closed. A prefix may end at its closing quote or at a `${`.
    const outsideRepo = /tmpdir\(|homedir\(|env\.HOME/;
    const offenders: string[] = [];
    for (const path of candidateFiles().filter((p) => p.startsWith("test/") && p.endsWith(".ts"))) {
      const source = readFileSync(join(repoRoot, path), "utf8");
      const calls = source.matchAll(/mkdtempSync\(([^;]*?)["'`](\.[a-z][A-Za-z0-9._-]*)(?:["'`]|\$\{)/g);
      for (const [, args = "", prefix = ""] of calls) {
        if (outsideRepo.test(args) || prefix === ".scratch") continue;
        if (!prefix.startsWith(".ana-scratch-")) offenders.push(`${path} makes ${prefix}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
