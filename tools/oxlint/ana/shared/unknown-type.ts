import type { ESTree } from "@oxlint/plugins";

/**
 * The same lines sit in `anti-slop/shared/function-parameters.ts`, in the tree copied from
 * upstream; keeping a copy lets `no-unproven-unknown-parameter` stay off a tree that is re-copied.
 */
export function containsUnknownType(type: ESTree.TSType): boolean {
  if (type.type === "TSUnknownKeyword") return true;
  if (type.type === "TSParenthesizedType") return containsUnknownType(type.typeAnnotation);
  return type.type === "TSUnionType" && type.types.some(containsUnknownType);
}
