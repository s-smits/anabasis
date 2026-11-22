import type { ESTree } from "@oxlint/plugins";

/**
 * Whether a written type is `unknown`, or a union with an `unknown` member.
 *
 * The same three lines sit in `anti-slop/shared/function-parameters.ts`, in the tree copied from
 * upstream. Keeping a copy is what lets `no-unproven-unknown-parameter` stay off a tree that is
 * re-copied. A union with an `unknown` member in a written type is Oxlint's
 * `typescript/no-redundant-type-constituents`, in place of a rule of this plugin's own.
 */
export function containsUnknownType(type: ESTree.TSType): boolean {
  if (type.type === "TSUnknownKeyword") return true;
  if (type.type === "TSParenthesizedType") return containsUnknownType(type.typeAnnotation);
  return type.type === "TSUnionType" && type.types.some(containsUnknownType);
}
