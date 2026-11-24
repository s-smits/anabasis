export function countBy<T>(values: readonly T[], key: (value: T) => string) {
  const out: Record<string, number> = {};
  for (const value of values) {
    const name = key(value);
    out[name] = (out[name] ?? 0) + 1;
  }
  return out;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? 0) + upper) / 2;
}

export const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
