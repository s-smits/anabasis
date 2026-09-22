/** Finite numeric comparison. Tolerances come from the public contract and use its units. */
export function numbersWithin(
  actual: number,
  expected: number,
  tolerance: { absolute?: number; relative?: number } = {},
): boolean {
  const { absolute = 0, relative = 0 } = tolerance;
  if (![actual, expected, absolute, relative].every(Number.isFinite) || absolute < 0 || relative < 0) {
    return false;
  }
  const scale = Math.max(Math.abs(actual), Math.abs(expected));
  return (
    Math.abs(actual - expected) <= absolute ||
    (relative > 0 && Math.abs(actual / scale - expected / scale) <= relative)
  );
}

/** A one-to-one match, including duplicates. Compatible rows may overlap: greedily taking the
 * first row loses valid matchings when a tolerance makes equality non-transitive. */
export function multisetMatches<T>(
  actual: readonly T[],
  expected: readonly T[],
  matches: (actual: T, expected: T) => boolean,
): boolean {
  if (actual.length !== expected.length) return false;
  const edges = expected.map((row) =>
    actual.flatMap((candidate, index) => (matches(candidate, row) ? [index] : [])),
  );
  const assigned = new Map<number, number>();
  // ponytail: augmenting paths are O(n³); use a specialised matcher if large row sets need it.
  const assign = (row: number, seen: Set<number>): boolean => {
    for (const index of edges[row] ?? []) {
      if (seen.has(index)) continue;
      seen.add(index);
      const previous = assigned.get(index);
      if (previous === undefined || assign(previous, seen)) {
        assigned.set(index, row);
        return true;
      }
    }
    return false;
  };
  return expected.every((_, row) => assign(row, new Set()));
}
