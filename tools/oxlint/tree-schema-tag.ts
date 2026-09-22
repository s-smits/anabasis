/**
 * A versioned tag spelled after the tree moved past it.
 *
 * This repository names every record it writes with a tag such as `case-trace/v3` or
 * `campaign-opening/v2`, and bumps the number when the shape changes. A file still spelling
 * `case-trace/v1` once `v3` exists is one of two things: a reader of rows nobody writes any more —
 * the `v1 || v2` acceptance, the migration branch, the array of every schema the archive ever held —
 * or a reader that was never told the writer moved. Both are found here; which one it is the row
 * cannot say, so it names the latest spelling and where it lives and leaves the reading to a person.
 *
 * Measured 2026-09-21 over the simplify record: 51 sites at the parents of 239 simplify commits,
 * 37 gone by the record head (0.73, or 0.51 with the file still there), 13 removed by a simplify
 * commit itself, and 13 of the 27 sites whose file a simplify commit ever touched went with that
 * commit (0.48). Per visit it is 11 of 60 (0.18): a readable set is touched many times and survives
 * each one. Exempting a site whose own line also spells the latest drops the simplify-removed count
 * from 13 to 6, because `v1 || v2` collapsing to `v2` is exactly the move, so nothing is exempted.
 * At 25fb05f74 the scan also found two readers the writer left behind: `rebuild-advice/v1` in
 * current-readers.mjs against the `v2` written since f5dfb86a1, and `outcome-snapshot-status/v1`
 * in select-best-runs.mjs against the `v2` trace-review.mjs writes.
 */
import type { TreeFinding } from "./tree-findings.ts";

/** `"name/vN"` in code's two quotes; a backtick around a tag is prose naming it, not a spelling. */
const SCHEMA_TAG = /["']([a-z][a-z0-9-]*)\/v(\d+)["']/gu;

/** A test, wherever it sits: a fixture holding an old row is the migration's proof, not a reader. */
const TEST_PATH = /(?:^|\/)test\/|\.test\./u;

/** A TypeScript, JavaScript or Python comment line; a tag named there is prose. */
const COMMENT_LINE = /^\s*(?:\/\/|\/?\*|#)/u;

interface TagSpelling {
  path: string;
  line: number;
  name: string;
  version: number;
}

/** Every tag one file spells outside its comments. */
function tagSpellings(path: string, text: string): TagSpelling[] {
  const found: TagSpelling[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (COMMENT_LINE.test(line)) continue;
    for (const match of line.matchAll(SCHEMA_TAG)) {
      found.push({ path, line: index + 1, name: match[1] ?? "", version: Number(match[2]) });
    }
  }
  return found;
}

/** One row per file and tag name still spelling a version below the tree's highest. */
export function supersededSchemaTags(corpusFiles: ReadonlyMap<string, string>): TreeFinding[] {
  const spellings: TagSpelling[] = [];
  for (const [path, text] of corpusFiles) {
    if (!TEST_PATH.test(path)) spellings.push(...tagSpellings(path, text));
  }
  const latest = new Map<string, TagSpelling>();
  for (const one of spellings) {
    const top = latest.get(one.name);
    if (top === undefined || one.version > top.version) latest.set(one.name, one);
  }
  const stale = new Map<string, { top: TagSpelling; olds: TagSpelling[] }>();
  for (const one of spellings) {
    const top = latest.get(one.name);
    if (top === undefined || one.version >= top.version) continue;
    const key = `${one.path}\u0000${one.name}`;
    const group = stale.get(key) ?? { top, olds: [] };
    group.olds.push(one);
    stale.set(key, group);
  }
  return [...stale.values()].map(({ top, olds }) => {
    const first = olds.reduce((low, one) => (one.line < low.line ? one : low));
    const versions = [...new Set(olds.map((one) => one.version))].sort((a, b) => a - b);
    const spelled = versions.map((version) => `\`${top.name}/v${version}\``).join(", ");
    return {
      kind: "superseded-schema-tag",
      path: first.path,
      line: first.line,
      detail: `${spelled} still spelled here after \`${top.name}/v${top.version}\` in ${top.path}:${top.line}`,
    };
  });
}
