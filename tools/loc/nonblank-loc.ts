// Single authoritative definition of non-blank line counting across gates and reports: a line
// counts if it contains at least one non-whitespace character. `tools/loc/source-policy.ts`
// applies this count to every walked file under `src`, `tools`, and `vendor`.

export function countNonBlank(text: string): number {
  let n = 0;
  for (const line of text.split("\n")) if (line.trim() !== "") n += 1;
  return n;
}
