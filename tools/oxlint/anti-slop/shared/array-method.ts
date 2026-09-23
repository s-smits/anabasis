import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";
import { isString } from "#src/meta/json-shape.ts";

/**
 * Past the wrappers that change what the compiler thinks but not which value or method the
 * expression names: parentheses, an optional chain, `as`, `<T>`, `!` and `satisfies`.
 *
 * A rule asking "is this `.filter` running on an array" has to see through all six, because an
 * author writes them for the type checker and they leave the runtime expression alone.
 */
export function unwrapArrayExpression(wrapped: ESTree.Node): ESTree.Node {
  let node = wrapped;
  while (
    node.type === "ParenthesizedExpression" ||
    node.type === "ChainExpression" ||
    node.type === "TSAsExpression" ||
    node.type === "TSTypeAssertion" ||
    node.type === "TSNonNullExpression" ||
    node.type === "TSSatisfiesExpression"
  ) {
    node = node.expression;
  }
  return node;
}

/** Resolve a local binding by scope, not by identifier spelling. */
export function resolveArrayBinding(sourceCode: SourceCode, wrapped: ESTree.Node): Variable | null {
  const node = unwrapArrayExpression(wrapped);
  if (node.type !== "Identifier") return null;
  let scope: Scope | null = sourceCode.getScope(node);
  while (scope !== null) {
    const variable = scope.set.get(node.name);
    if (variable !== undefined) return variable;
    scope = scope.upper;
  }
  return null;
}

/**
 * The method a member expression names, with the object it is called on, or null where the name
 * is not written down.
 *
 * `rows["filter"]` names the same method as `rows.filter`, so a computed string literal is read
 * too. A computed key that is anything else — a variable, a call, a template — names a method
 * only at runtime, and a lint rule that guessed at it would report on whatever the guess happened
 * to be, so it returns null instead.
 */
export function arrayMethodTarget(
  wrapped: ESTree.Node,
): { readonly name: string; readonly object: ESTree.Node } | null {
  const node = unwrapArrayExpression(wrapped);
  if (node.type !== "MemberExpression") return null;
  const { property } = node;
  if (!node.computed && property.type === "Identifier") {
    return { name: property.name, object: node.object };
  }
  if (node.computed && property.type === "Literal" && isString(property.value)) {
    return { name: property.value, object: node.object };
  }
  return null;
}

function isArrayAnnotation(type: ESTree.TSType): boolean {
  if (type.type === "TSArrayType" || type.type === "TSTupleType") return true;
  if (type.type === "TSParenthesizedType") return isArrayAnnotation(type.typeAnnotation);
  if (type.type === "TSTypeOperator" && type.operator === "readonly") {
    return isArrayAnnotation(type.typeAnnotation);
  }
  return (
    type.type === "TSTypeReference" &&
    type.typeName.type === "Identifier" &&
    (type.typeName.name === "Array" || type.typeName.name === "ReadonlyArray")
  );
}

/**
 * Whether this expression is certainly an array, decided from the file alone.
 *
 * Two rules ask before they report, `no-array-filter-map` and `no-reduce-accumulator-copy`, and
 * both are about the cost of materialising an array that did not need to exist — so a receiver
 * whose kind cannot be established has to come out false. A lazy iterator pipeline is the case
 * that matters: `.values().filter(...).map(...)` reads like the shape `no-array-filter-map`
 * catches and does one pass with no intermediate array, so answering "not known to be an array"
 * is what keeps that rule off it.
 *
 * What counts as certain is an array literal, a call of one of the eight array-producing methods
 * on something already certain, or a binding the file can settle: annotated as an array, a tuple,
 * a `readonly` of either, or `Array`/`ReadonlyArray`, or else a `const` whose initialiser is
 * itself certain. A binding written to after its declaration stops the walk, because what it
 * holds at the call is no longer this file's to say, and `visited` stops a circular definition
 * from recurring forever.
 */
export function isKnownArrayExpression(
  sourceCode: SourceCode,
  wrapped: ESTree.Node,
  visited = new Set<Variable>(),
): boolean {
  const node = unwrapArrayExpression(wrapped);
  if (node.type === "ArrayExpression") return true;
  if (node.type === "CallExpression") {
    const method = arrayMethodTarget(node.callee);
    return (
      method !== null &&
      ["map", "filter", "flatMap", "slice", "concat", "toSorted", "toReversed", "toSpliced"].includes(
        method.name,
      ) &&
      isKnownArrayExpression(sourceCode, method.object, visited)
    );
  }
  if (node.type !== "Identifier") return false;
  const variable = resolveArrayBinding(sourceCode, node);
  if (variable === null || visited.has(variable)) return false;
  visited.add(variable);
  if (variable.references.some((reference) => reference.isWrite() && !reference.init)) return false;
  for (const identifier of variable.identifiers) {
    const annotation = identifier.typeAnnotation?.typeAnnotation;
    if (annotation !== undefined) return isArrayAnnotation(annotation);
  }
  for (const definition of variable.defs) {
    if (
      definition.type === "Variable" &&
      definition.node.type === "VariableDeclarator" &&
      definition.node.id.type === "Identifier" &&
      definition.node.init !== null &&
      definition.node.parent.type === "VariableDeclaration" &&
      definition.node.parent.kind === "const"
    ) {
      return isKnownArrayExpression(sourceCode, definition.node.init, visited);
    }
  }
  return false;
}
