/**
 * How many values fall under each name.
 *
 * `harness_inspect` builds three of these for one readiness answer — task families, grounding kinds
 * and hidden checks per check id — and the outcome scorecard three more over authoring evidence,
 * counting repeated finding hashes, calls by session stage and re-authored accepted sessions. Each
 * had written the loop out. A second hand-written copy is the one that drifts: a `Map` here and a
 * record there, and two counts in the same report stop being comparable for a reason no reader of
 * that report can see.
 */
export function countBy<T>(values: readonly T[], key: (value: T) => string) {
  const out: Record<string, number> = {};
  for (const value of values) {
    const name = key(value);
    out[name] = (out[name] ?? 0) + 1;
  }
  return out;
}
