/**
 * The one predicate behind every path-segment admission check in the tree.
 *
 * Project ids, run ids and observation ids are used verbatim in controller-owned paths, so the
 * charset deliberately excludes separators and leading dots; the explicit `..` guard then rejects
 * the traversal-shaped names that the admitted character set would otherwise let through.
 */
export function isSafePathSegment(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) && !value.includes("..");
}
