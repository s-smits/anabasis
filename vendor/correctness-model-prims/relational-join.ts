/**
 * Match submitted entities to declared entities by an exact key, then compare the fields of
 * each unambiguous pair. This helper contains the shared matching logic; the domain check
 * supplies the entity sets, keys and field comparisons.
 *
 * This pattern kept being re-implemented per domain, and the re-implementations kept regressing into the
 * same incorrect acceptances: a substring/`includes` key match that accepts a lookalike; a bare
 * name-presence or existence check that accepts an entity nobody declared (a "ghost" endpoint, an
 * artifact endpoint fed from a source that is not an authoritative declared set); a duplicate owner that a
 * set-membership check silently collapses; a count check that a single reused entity satisfies. Prose in a
 * kickoff brief did not reliably prevent these mistakes. This helper gives callers an exact-key
 * comparison, reports duplicate keys explicitly, and requires the caller to state
 * which entity set is authoritative.
 *
 * The helper enforces these matching rules:
 *   - Keys are matched by exact normalized-string equality through a Map. There is no two-argument fuzzy
 *     comparator and no substring contract. `normalizeKey` is a per-key, single-argument function applied
 *     symmetrically to both sides. Two keys join only when they normalize to the same string.
 *     The caller still owns normalization: it must not collapse distinct domain ids into the
 *     same key. Without such a collapse, `"a"` and `"a_b"` remain distinct.
 *   - Duplicate keys on either side are explicit output (`duplicateKeysLeft` / `duplicateKeysRight`) and
 *     a key with more than one entity on a side never forms a clean matched pair, so an ambiguous or
 *     collapsed owner cannot be silently verified as agreement.
 *   - The caller must name the authoritative side (`authoritative`, no default). That side
 *     lists the required entities; its unmatched entities are
 *     missing-required violations. The non-authoritative side's unmatched entities are surfaced as
 *     `unmatchedRight` / `unmatchedLeft` (present-but-undeclared) — the ghost / floating class — so the
 *     caller can decide whether an undeclared entity is allowed.
 *
 * The helper does no I/O and imports no domain code. It reads only the supplied entity sets and
 * callbacks, reporting which entities correspond and where they disagree. Its `ok` requires all
 * four summary conditions below; the domain check decides whether to use that result or an
 * explicitly chosen subset, and owns the check id.
 */

import { duplicateKeyGroups, joinedPair } from "./relational-join-pairs.ts";

/** A per-pair field check: given a matched (left, right) pair, return a disagreement message when the pair
 *  disagrees on this field, or `null` when they agree. This is where the caller compares the actual values
 *  behind the shared key (both sides name the same entity — do they agree on the value it should map to?).
 *  The message is evidence text — keep the answer key and the fix out of it. */
export interface FieldAgreement<L, R> {
  /** Stable id naming the relation being checked; becomes the disagreement's `field`. */
  field: string;
  check: (left: L, right: R) => string | null;
}

export interface RelationalJoinSpec<L, R> {
  /** One entity set to join. Paired with `authoritative` to say whether this side is the source of truth. */
  left: readonly L[];
  /** The other entity set to join. */
  right: readonly R[];
  /** Exact key for a left entity. Return `null`/`undefined` to exclude an entity that cannot produce a
   *  key — it is reported in `unkeyedLeft`, never silently dropped. */
  leftKey: (entity: L) => string | null | undefined;
  /** Exact key for a right entity. */
  rightKey: (entity: R) => string | null | undefined;
  /** Which side declares what must be present. `"left"` means every left entity must have exactly one
   *  exact right counterpart; `"right"` is the mirror. Required — the caller has to decide, because the
   *  authority is what makes "unmatched" mean "missing" on one side and "undeclared" on the other. */
  authoritative: "left" | "right";
  /** Optional per-pair field-agreement checks, run on every clean matched pair. */
  agreements?: readonly FieldAgreement<L, R>[];
  /** Normalize a key before comparison with the same function on both sides. It may lowercase or
   *  resolve aliases, but must preserve distinctions required by the domain. The returned strings
   *  are compared exactly. Default: identity. */
  normalizeKey?: (key: string) => string;
}

export interface FieldDisagreement {
  field: string;
  message: string;
}

export interface JoinedPair<L, R> {
  key: string;
  left: L;
  right: R;
  /** Field-agreement disagreements for this pair; empty when the pair agrees on every field. */
  disagreements: FieldDisagreement[];
}

export interface KeyedEntity<T> {
  key: string;
  entity: T;
}

export interface DuplicateKeyGroup<T> {
  key: string;
  entities: T[];
}

export interface RelationalJoinVerdict<L, R> {
  authoritative: "left" | "right";
  /** Keys present exactly once on each side; the only pairs on which field agreement is asserted. */
  matched: JoinedPair<L, R>[];
  /** The subset of `matched` that disagreed on at least one field (same objects as in `matched`). */
  disagreements: JoinedPair<L, R>[];
  /** Left entities whose key had no right counterpart. Missing-required when `authoritative === "left"`;
   *  present-but-undeclared when `authoritative === "right"`. */
  unmatchedLeft: KeyedEntity<L>[];
  /** Right entities whose key had no left counterpart. The mirror of `unmatchedLeft`. */
  unmatchedRight: KeyedEntity<R>[];
  /** Left entities that produced no key and so could not be joined. */
  unkeyedLeft: L[];
  /** Right entities that produced no key and so could not be joined. */
  unkeyedRight: R[];
  /** Keys carrying more than one left entity — an ambiguous owner that forms no clean matched pair. */
  duplicateKeysLeft: DuplicateKeyGroup<L>[];
  /** Keys carrying more than one right entity. */
  duplicateKeysRight: DuplicateKeyGroup<R>[];
  /** No unmatched, unkeyed or duplicate-key entity on the authoritative side. Counterpart
   *  duplicates are covered separately by noDuplicateKeys. */
  authoritativeFullyMatched: boolean;
  /** No matched pair disagreed on any field. */
  allPairsAgree: boolean;
  /** The non-authoritative side introduced no entity the authoritative side does not declare (no
   *  unmatched and no unkeyed entity there) — the guard the caller folds in to reject ghost / floating
   *  entities when the domain forbids undeclared ones. */
  noUndeclared: boolean;
  /** Neither side carried a duplicate key. */
  noDuplicateKeys: boolean;
  /** All four booleans above. Including noUndeclared and noDuplicateKeys prevents undeclared
   *  entities and ambiguous keys from passing; earlier generated checks omitted those conditions.
   *  A domain that permits extra entities must choose the relevant conditions explicitly and
   *  explain that choice. Keep noDuplicateKeys when each required entity needs one counterpart;
   *  authoritativeFullyMatched alone does not reject duplicates on the other side. */
  ok: boolean;
}

function group<T>(
  entities: readonly T[],
  key: (entity: T) => string | null | undefined,
  normalize: (key: string) => string,
) {
  const groups = new Map<string, T[]>();
  const unkeyed: T[] = [];
  for (const entity of entities) {
    const raw = key(entity);
    if (raw == null) {
      unkeyed.push(entity);
      continue;
    }
    const normalized = normalize(raw);
    const existing = groups.get(normalized);
    if (existing) existing.push(entity);
    else groups.set(normalized, [entity]);
  }
  return { groups, unkeyed };
}

/** Join two entity sets by exact key and report where they correspond, diverge, and disagree. Pure. */
export function relationalJoin<L, R>(spec: RelationalJoinSpec<L, R>): RelationalJoinVerdict<L, R> {
  const normalize = spec.normalizeKey ?? ((k: string) => k);
  const agreements = spec.agreements ?? [];

  const { groups: leftGroups, unkeyed: unkeyedLeft } = group(spec.left, spec.leftKey, normalize);
  const { groups: rightGroups, unkeyed: unkeyedRight } = group(spec.right, spec.rightKey, normalize);

  const matched: JoinedPair<L, R>[] = [];
  const disagreements: JoinedPair<L, R>[] = [];
  const unmatchedLeft: KeyedEntity<L>[] = [];
  const unmatchedRight: KeyedEntity<R>[] = [];
  const duplicateKeysLeft = duplicateKeyGroups(leftGroups);
  const duplicateKeysRight = duplicateKeyGroups(rightGroups);

  for (const [key, leftEntities] of leftGroups) {
    const rightEntities = rightGroups.get(key);
    if (!rightEntities) {
      for (const entity of leftEntities) unmatchedLeft.push({ key, entity });
      continue;
    }
    const pair = joinedPair(key, leftEntities, rightEntities, agreements);
    if (pair === null) continue;
    matched.push(pair);
    if (pair.disagreements.length > 0) disagreements.push(pair);
  }
  for (const [key, rightEntities] of rightGroups) {
    if (!leftGroups.has(key)) {
      for (const entity of rightEntities) unmatchedRight.push({ key, entity });
    }
  }

  const leftComplete = unmatchedLeft.length === 0 && unkeyedLeft.length === 0;
  const rightComplete = unmatchedRight.length === 0 && unkeyedRight.length === 0;
  const authoritativeFullyMatched =
    spec.authoritative === "left"
      ? leftComplete && duplicateKeysLeft.length === 0
      : rightComplete && duplicateKeysRight.length === 0;
  const allPairsAgree = disagreements.length === 0;
  const noUndeclared = spec.authoritative === "left" ? rightComplete : leftComplete;
  const noDuplicateKeys = duplicateKeysLeft.length === 0 && duplicateKeysRight.length === 0;

  return {
    authoritative: spec.authoritative,
    matched,
    disagreements,
    unmatchedLeft,
    unmatchedRight,
    unkeyedLeft,
    unkeyedRight,
    duplicateKeysLeft,
    duplicateKeysRight,
    authoritativeFullyMatched,
    allPairsAgree,
    noUndeclared,
    noDuplicateKeys,
    ok: authoritativeFullyMatched && allPairsAgree && noUndeclared && noDuplicateKeys,
  };
}
