/** Per-key duplicate and pair checks, kept beside the join to keep its module within the size limit. */
import type { DuplicateKeyGroup, FieldAgreement, JoinedPair } from "./relational-join.ts";

/** Keys that more than one entity claims. */
export function duplicateKeyGroups<T>(groups: ReadonlyMap<string, T[]>): DuplicateKeyGroup<T>[] {
  const duplicates: DuplicateKeyGroup<T>[] = [];
  for (const [key, entities] of groups) {
    if (entities.length > 1) duplicates.push({ key, entities });
  }
  return duplicates;
}

/** A clean pair needs exactly one entity on each side; an ambiguous key is already recorded as a
 *  duplicate and must not be verified as agreement. Null when the key is not a clean pair.
 *  Explicit element checks also satisfy noUncheckedIndexedAccess. */
export function joinedPair<L, R>(
  key: string,
  leftEntities: readonly L[],
  rightEntities: readonly R[],
  agreements: readonly FieldAgreement<L, R>[],
): JoinedPair<L, R> | null {
  const left = leftEntities[0];
  const right = rightEntities[0];
  if (leftEntities.length !== 1 || rightEntities.length !== 1 || left === undefined || right === undefined) {
    return null;
  }
  const pair: JoinedPair<L, R> = { key, left, right, disagreements: [] };
  for (const agreement of agreements) {
    const message = agreement.check(left, right);
    if (message != null) pair.disagreements.push({ field: agreement.field, message });
  }
  return pair;
}
