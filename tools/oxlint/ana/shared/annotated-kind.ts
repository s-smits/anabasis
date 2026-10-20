import type { ESTree } from "@oxlint/plugins";

/**
 * What a binding's own annotation says it holds, read without types: `string`, or the name of the
 * type reference it is annotated with (`ReadonlySet`, `MapIterator`), or null for anything else.
 *
 * Two fixers write an array method on a receiver the rule only sees by name: `prefer-find-over-loop`
 * writes `find`, which a `Set`, a `Map`, an `Iterable` or a `string` does not have, and
 * `prefer-includes-over-some-equals` writes `includes`, which an iterator does not have though it
 * has `some`. A plugin rule sees no types, so each reads the annotation the author wrote on the
 * parameter or the declaration, where there is one (20 October: a `ReadonlySet<string>` parameter
 * walked by a loop was fixed into a call that did not compile).
 */
export function annotatedKind(node: ESTree.BindingIdentifier): string | null {
  const type = node.typeAnnotation?.typeAnnotation;
  if (type === undefined) return null;
  if (type.type === "TSStringKeyword") return "string";
  if (type.type !== "TSTypeReference" || type.typeName.type !== "Identifier") return null;
  return type.typeName.name;
}
