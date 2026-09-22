/**
 * A name that says it keeps a path for records, installs or inputs the tree no longer writes.
 *
 * This repository keeps no backwards compatibility (operator decision 2026-09-21: "do not assume
 * backwards compat, just roll over it"). A declaration named `retainLegacyProduct`, a constant
 * `LEGACY_BATTERY_SUFFIXES`, a state `"legacy-root"` is the author saying so in the name: the
 * code exists to read or accept what an older version left behind, and it goes when the last
 * such record does. The bare word in a message — "legacy generated data files are unsupported" —
 * is prose and is not counted; nor is a comment line or a test, where an old row is the proof of
 * a refusal rather than a reader of one.
 *
 * Measured 2026-09-21 over the simplify record, one unit per file and name: 61 names in 30 files
 * at the parents of 239 simplify commits, 54 gone by the record head ee766c7e2 (0.89, 95% Wilson
 * lower bound 0.78), and 25 of the 30 files lost every one of them (0.83, bound 0.66). The rate
 * holds on the second half of the record, 28 of the 32 names first seen from 2026-09-09 (0.88),
 * while other rare names of the same files went at 0.30 over the same weeks and 0.49 over the
 * whole record. A simplify commit itself took 42 of 147 visits (0.29). The same reading of
 * `migrat` (8 of 9), `compat` (2 of 4), `old` (4 of 4, an edit tool's `old_string`) and
 * `previous` (15 of 17, three of 43 visits) was too small or too mixed to name a path.
 */
import type { TreeFinding } from "./tree-findings.ts";

/** A test, wherever it sits: a fixture holding an old row proves a refusal, it keeps no path. */
const TEST_PATH = /(?:^|\/)test\/|\.test\./u;

/** A TypeScript, JavaScript or Python comment line; a name spelled there is prose. */
const COMMENT_LINE = /^\s*(?:\/\/|\/?\*|#)/u;

const CODE = /\.(?:ts|tsx|mts|mjs|js|py)$/u;

/** One name: an identifier, a constant or a kebab-case member, as the record was measured. */
const NAME = /[A-Za-z_][\w-]*[A-Za-z0-9]/gu;

/** One row per production file, at the first line spelling `legacy` inside a longer name. */
export function compatibilityPaths(corpusFiles: ReadonlyMap<string, string>): TreeFinding[] {
  const rows: TreeFinding[] = [];
  for (const [path, text] of corpusFiles) {
    if (!CODE.test(path) || TEST_PATH.test(path)) continue;
    const names = new Set<string>();
    let first = 0;
    for (const [index, line] of text.split("\n").entries()) {
      if (COMMENT_LINE.test(line)) continue;
      const found = (line.match(NAME) ?? []).filter(
        (name) => /legacy/iu.test(name) && !/^legacy$/iu.test(name),
      );
      if (found.length > 0 && first === 0) first = index + 1;
      for (const name of found) names.add(name);
    }
    if (first === 0) continue;
    const spelled = [...names].map((name) => `\`${name}\``).join(", ");
    rows.push({ kind: "compatibility-path", path, line: first, detail: `names a legacy path: ${spelled}` });
  }
  return rows;
}
