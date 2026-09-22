// One owner for line counting. Every gate that says "nonblank" means this function, with the six
// exclusion classes applied.

/** generated · evidence · docs · tests · vendored · dependencies */
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
