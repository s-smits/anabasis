/** Whether two numbers agree within a tolerance taken from the public contract, in that contract's
 *  own units. Anything non-finite on either side, and a negative tolerance, returns false rather
 *  than throwing, so a NaN that reached an artifact fails its own check instead of taking the
 *  verifier down with it. With both tolerances left at their zero default this is exact equality.
 *  The relative branch divides both sides by the larger magnitude before comparing, so one
 *  `relative` figure means the same proportion at 1e3 as at 1e-3. */
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

/** Whether every expected row can be paired with a distinct actual row, which is a perfect
 * matching rather than a scan, and so admits duplicate rows on both sides. Taking the first
 * compatible row greedily would be wrong here because a tolerance makes `matches` non-transitive:
 * two expected rows can both be compatible with one actual row while a different assignment pairs
 * every row up, so the search augments through the rows it has already assigned instead of
 * committing to its first choice. */
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
