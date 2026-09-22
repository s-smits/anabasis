/**
 * How many values fall under each name.
 *
 * Two reports build the same histogram — `harness_inspect` counts task families and grounding
 * kinds for the Builder, and the outcome scorecard counts tool calls per session for the
 * operator — and both had written the loop out. The second copy is the one that drifts: a
 * `Map` here and a record there, or a zero that becomes `undefined`, and the two reports stop
 * being comparable for no reason a reader can see.
 */
export function countBy<T>(values: readonly T[], key: (value: T) => string) {
  const out: Record<string, number> = {};
  for (const value of values) {
    const name = key(value);
    out[name] = (out[name] ?? 0) + 1;
  }
  return out;
}
