/**
 * How many values fall under each name.
 *
 * A hand-written copy of the loop is the one that drifts: a `Map` here and a record there, and two
 * counts in the same report stop being comparable for a reason no reader of that report can see.
 */
export function countBy<T>(values: readonly T[], key: (value: T) => string) {
  const out: Record<string, number> = {};
  for (const value of values) {
    const name = key(value);
    out[name] = (out[name] ?? 0) + 1;
  }
  return out;
}

/** The middle value, or null when there is none. An even count averages its two middle values, so a
 *  list of six is not read at its fourth value. Each reader rounds the result its own way. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? 0) + upper) / 2;
}
