// One owner for line counting, so that "nonblank" names the same line in every gate and every
// report that uses the word: one carrying something other than whitespace. Which files to count is
// a separate question and a separate function, because the two callers want different answers.
// `tools/loc/source-policy.ts` measures every file it walks under `src`, `tools` and `vendor`
// against the authored ceiling and excludes none of them, while `bundleRecord` in
// `tools/outcome/metrics.ts` sizes a Builder-authored bundle and asks `excludedAs` first, because
// a bundle carries its own installed dependencies and recorded evidence.

/** The six classes of path that are somebody else's lines: written by a generator, recorded as
 *  evidence, prose rather than code, a test, pinned from upstream, or installed. `bundleRecord`
 *  counts the files each class takes and reports those counts beside the authored total, so a
 *  bundle that measures small says which class it is small because of. */
const EXCLUSIONS: ReadonlyArray<{ kind: string; re: RegExp }> = [
  { kind: "generated", re: /(^|\/)generated\// },
  { kind: "evidence", re: /(^|\/)(evidence|runs)\/|\.jsonl$/ },
  { kind: "docs", re: /\.(md|mdx|txt)$/ },
  { kind: "tests", re: /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[cm]?tsx?$/ },
  { kind: "vendored", re: /(^|\/)(vendor|vendored|third_party)\/|\.venv\/|\.uv-cache\// },
  { kind: "dependencies", re: /(^|\/)node_modules\// },
];

export function excludedAs(path: string): string | null {
  for (const { kind, re } of EXCLUSIONS) if (re.test(path)) return kind;
  return null;
}

export function countNonBlank(text: string): number {
  let n = 0;
  for (const line of text.split("\n")) if (line.trim() !== "") n += 1;
  return n;
}
