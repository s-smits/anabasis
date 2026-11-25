// The one definition of a non-blank line across gates and reports: a line with at least one
// non-whitespace character.

export function countNonBlank(text: string): number {
  let n = 0;
  for (const line of text.split("\n")) if (line.trim() !== "") n += 1;
  return n;
}
