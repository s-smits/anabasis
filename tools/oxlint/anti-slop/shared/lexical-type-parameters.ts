import type { ESTree } from "@oxlint/plugins";
import { isNode, nodeFields } from "./ast-node.ts";

type VisitorKeys = Readonly<Record<string, readonly string[]>>;

function collectInferTypeParameterNames(
  node: ESTree.Node,
  visitorKeys: VisitorKeys,
  names: Set<string>,
): void {
  if (node.type === "TSInferType") names.add(node.typeParameter.name.name);
  const record = nodeFields(node);
  for (const key of visitorKeys[node.type] ?? []) {
    const value = record[key];
    if (isNode(value)) {
      collectInferTypeParameterNames(value, visitorKeys, names);
      continue;
    }
    if (!Array.isArray(value)) continue;
    for (const child of value) {
      if (isNode(child)) collectInferTypeParameterNames(child, visitorKeys, names);
    }
  }
}

/**
 * Every type name that is bound by something enclosing this node rather than declared in the file.
 *
 * Alias resolution is the caller, and this is the list of names it must not resolve. A module that
 * declares `type T = unknown` and also writes a generic `<T>` somewhere below has two different
 * `T`s, and following the alias inside the generic would report the function's own type parameter
 * as the top type. Refusing every name on this list costs the rules nothing, because a type
 * parameter stands for whatever a caller supplies and says nothing about the annotation either
 * way.
 *
 * Three ways a name gets bound, and each one is scoped to where TypeScript actually scopes it. A
 * `typeParameters` list binds its names throughout the node that declares them. A mapped type's
 * key is in scope in its `as` clause and its value type but not in the constraint it iterates, so
 * the walk checks which child it arrived from. And `infer` names from a conditional type's
 * `extends` clause are in scope in the true branch alone, which is why they are collected only
 * when the walk came up through it.
 */
export function lexicalTypeParameterNames(node: ESTree.Node, visitorKeys: VisitorKeys): ReadonlySet<string> {
  const names = new Set<string>();
  let descendant: ESTree.Node = node;
  let current: ESTree.Node | null = node;
  while (current.type !== "Program") {
    if ("typeParameters" in current) {
      for (const parameter of current.typeParameters?.params ?? []) {
        names.add(parameter.name.name);
      }
    }
    if (
      current.type === "TSMappedType" &&
      (descendant === current.nameType || descendant === current.typeAnnotation)
    ) {
      names.add(current.key.name);
    }
    if (current.type === "TSConditionalType" && descendant === current.trueType) {
      collectInferTypeParameterNames(current.extendsType, visitorKeys, names);
    }
    descendant = current;
    current = current.parent;
  }
  return names;
}
