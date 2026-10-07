import type { ESTree } from "@oxlint/plugins";

/**
 * Whether a written type is `unknown`, or a union with an `unknown` member.
 *
 * A union is the one place where `unknown` takes the other members with it: `unknown | Row` is
 * `unknown`, so the `Row` beside it tells a reader something the type does not say. An
 * intersection goes the other way — `unknown & Row` is `Row`, and nothing was given away — and a
 * container keeps its `unknown` where it can still be read, which is why `Promise<unknown>` and
 * `Record<string, unknown>` are `no-unknown-returns` and `no-unsafe-dictionary-type` rather than
 * this. So the walk goes into a union and through parentheses and stops everywhere else.
 *
 * It reads syntax and follows no aliases, so a `type P = unknown` written into a union is not seen
 * here at all. `no-unknown-type-aliases` reports that declaration where it stands, which is the
 * earlier place and the one where the repair belongs.
 *
 * The same three lines sit in `anti-slop/shared/function-parameters.ts`, in the tree copied from
 * upstream. Keeping a copy is what lets the two rules that ask — `no-unknown-union` and
 * `unproven-unknown-parameter` — stay off a tree that is re-copied.
 */
export function containsUnknownType(type: ESTree.TSType): boolean {
  if (type.type === "TSUnknownKeyword") return true;
  if (type.type === "TSParenthesizedType") return containsUnknownType(type.typeAnnotation);
  return type.type === "TSUnionType" && type.types.some(containsUnknownType);
}
