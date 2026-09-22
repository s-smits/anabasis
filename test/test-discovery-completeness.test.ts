/**
 * Every committed test file sits where a gate step runs it.
 *
 * Bun discovers a `*.test` or `*.spec` file in any of the eight JavaScript and TypeScript
 * suffixes — `.mjs`, `.cjs`, `.mts` and `.cts` included, measured on 1.4.2 with one file per
 * suffix and eight passes. What it never does is descend into a directory whose name begins with
 * a dot, and a positional path is a filter over the files it already found rather than a root to
 * add: `bun test .claude`, and naming the file itself, both match nothing and say so in the same
 * words as a typo. So a suite under `.claude/skills/**` is invisible to the runner.
 *
 * Until 2026-09-20 the repository answered that with eleven files in `test/` that did nothing but
 * re-import twenty-four hidden suites, and this guard checked that each hidden suite had one.
 * Two costs. A wrapper is a second place to remember, held together by nothing but this test. And
 * a wrapper is one file to Bun's scheduler: `test/claude-system-path-runners.test.js` re-imported
 * eight process-spawning suites and was the slowest file in the whole suite at 54.1 s against
 * 18.7 s for the next one, which on a slowest-first schedule is the floor for the entire run;
 * split, its longest member takes 33.4 s and the other seven go wherever there is room. The
 * suites now live in `test/` under their own names, and the wrappers are gone.
 *
 * What is left is one rule with one owner. The roots below are every place a gate step actually
 * runs, so a suite written anywhere else is named here rather than sitting green and unread.
 *
 * The subject is the candidate tree: tracked files that still exist plus untracked, non-ignored
 * ones. Reading that set through Git includes a suite added before staging while excluding the
 * ignored scratch directories a filesystem walk would enter — and it reaches into dot-directories,
 * which the corpus walk in `tools/loc/source-policy.ts` deliberately does not.
 */
import { existsSync, readFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";

import { describe, expect, it } from "bun:test";

const repoRoot = join(import.meta.dir, "..");

/** The roots a gate step runs, and the step that runs each. */
const DISCOVERED_ROOTS = [
  "test/", // `bun run test`, which is the gate's last step
  "packages/ui/test/", // `bun run ui:gate`, which prepares that package's own node_modules first
  "starters/", // the Built Harness's own template suite, which `bunfig.toml` ignores here
];

/** A suite by name, in any suffix Bun runs, plus the `.bun-tests` spelling the wrappers used to
 *  need so that Bun would not try to discover a file only they imported. */
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

/** The suites among `paths` that no gate step would run. Exported for the two cases below, which
 *  state the rule on named paths rather than on whatever this checkout happens to contain. */
export function undiscovered(paths: readonly string[]): string[] {
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

  it("says nothing about the three roots a step names, or about ordinary source", () => {
    expect(
      undiscovered([
        "test/attribute.test.ts",
        "test/campaign-status.test.mjs",
        "test/helpers/scratch.ts",
        "packages/ui/test/poll.test.ts",
        "starters/pi-built-harness/correctness-model/evaluator.test.ts",
        "src/run/full-run.ts",
        "notes/a-test-of-patience.md",
      ]),
    ).toEqual([]);
  });

  it("finds none in this repository", () => {
    expect(undiscovered(candidateFiles())).toEqual([]);
  });

  it("keeps every in-repo scratch directory inside the one ignored family", () => {
    // A fixture whose modules must resolve against this repository's `node_modules` cannot use
    // the system temp directory, so it makes its scratch inside the checkout. `.gitignore` is
    // the only thing keeping that scratch away from the two readers who walk the tree — the case
    // above, which lists untracked files, and oxlint, which honours the same file. It used to
    // carry one pattern per fixture prefix and the list drifted: of the thirty-two live prefixes
    // eighteen had no entry, `.ana-candidate-*` failed a push while a sibling worker held one,
    // and `.gate-end-to-end-*` was committed by accident. One pattern covers the family, which
    // leaves a prefix outside it invisible to the pattern. That fails here, at the fixture.
    //
    // A `mkdtemp` under the system temp directory or the user's home sits outside the repository
    // and outside the rule; those three bases are named. A fourth fails closed, which asks for
    // the family or for this list to grow, and never for silence. A prefix may end at its
    // closing quote or at a `${`, since one fixture interpolates its own name into the template.
    // `scratchDir` from `test/helpers/scratch.ts` is the other producer: its prefix comes first
    // and only a call naming a parent can land inside the checkout.
    const outsideRepo = /tmpdir\(|homedir\(|env\.HOME/;
    const offenders: string[] = [];
    for (const path of candidateFiles().filter((p) => p.startsWith("test/") && p.endsWith(".ts"))) {
      const source = readFileSync(join(repoRoot, path), "utf8");
      const calls = [
        ...source.matchAll(/mkdtempSync\(([^;]*?)["'`](\.[a-z][A-Za-z0-9._-]*)(?:["'`]|\$\{)/g),
        ...source
          .matchAll(/scratchDir\(["'`](\.[a-z][A-Za-z0-9._-]*)(?:["'`]|\$\{)[^,)]*,([^)]*)\)/g)
          .map(([match, prefix = "", parent = ""]) => [match, parent, prefix]),
      ];
      for (const [, args = "", prefix = ""] of calls) {
        if (outsideRepo.test(args) || prefix === ".scratch") continue;
        if (!prefix.startsWith(".ana-scratch-")) offenders.push(`${path} makes ${prefix}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
