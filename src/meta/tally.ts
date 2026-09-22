/** How many values fall under each name; one histogram so separate reports stay comparable. */
export function countBy<T>(values: readonly T[], key: (value: T) => string) {
  const out: Record<string, number> = {};
  for (const value of values) {
    const name = key(value);
    out[name] = (out[name] ?? 0) + 1;
  }
  return out;
}
