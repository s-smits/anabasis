// One owner for line counting, so that "nonblank" names the same line in every gate and every
// report that uses the word: one carrying something other than whitespace.
// `tools/loc/source-policy.ts` measures every file it walks under `src`, `tools` and `vendor`
// against the authored ceiling and excludes none of them. Until 15 October this file also sorted a
// Builder-authored bundle's paths into six classes for `bundleRecord` in `tools/outcome/metrics.ts`,
// which did not come over from v1; only a test read them.

export function countNonBlank(text: string): number {
  let n = 0;
  for (const line of text.split("\n")) if (line.trim() !== "") n += 1;
  return n;
}
