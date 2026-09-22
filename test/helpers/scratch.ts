/**
 * The throwaway directory a test writes into, and the one registry that removes them.
 *
 * Five files had written this out themselves — two helpers and three test files — with the same
 * array, `mkdtempSync` and `rmSync` loop each time. One owner instead of five. A file pairs
 * `scratchDir` with one `afterAll(cleanupScratch)`, or `afterEach` when it counts directories.
 *
 * The roughly two hundred sites that still call `mkdtempSync` directly are not leaks and were left
 * alone: `tools/runtime/test-suite.ts` gives a run one `ana-test-suite-` root, points
 * `ANA_TEST_TMPDIR` at it, and removes it in `finally` and on every signal, so nothing outlives the
 * run either way. Cleaning here only decides whether a file's directories go at its end or at the
 * run's, which is not worth an import and an `afterAll` in a file that wants neither.
 *
 * `verification-runner-fixtures.ts` keeps its own root: it hands out numbered subdirectories of a
 * single directory created when the module loads, and a file that cleans per test would remove it
 * under the next one.
 */
import { mkdtempSync, rmSync } from "../../src/meta/filesystem.ts";
import { tmpdir } from "../../src/meta/os.ts";
import { join } from "../../src/meta/path.ts";

const scratch: string[] = [];

/** A directory under `parent`, registered for removal. `parent` is the host temp root unless the
 *  caller needs its scratch INSIDE the checkout, so a generated bundle resolves its `@ana/*`
 *  imports through the root node_modules; ten callers pass one, beside two dozen direct
 *  `mkdtempSync` roots. An in-checkout prefix starts with a dot, and that is what keeps it out of
 *  the corpus `tools/loc/source-policy.ts` walks for the export search and the whole-tree
 *  census. */
export function scratchDir(prefix: string, parent: string = tmpdir()): string {
  const dir = mkdtempSync(join(parent, prefix));
  scratch.push(dir);
  return dir;
}

export function cleanupScratch(): void {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
}
