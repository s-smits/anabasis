import { resolveVariable } from "./scope.ts";

import type { ESTree, SourceCode } from "@oxlint/plugins";

function isGlobalReflect(sourceCode: SourceCode, expression: ESTree.Expression): boolean {
  if (expression.type !== "Identifier" || expression.name !== "Reflect") return false;
  if (sourceCode.isGlobalReference(expression)) return true;
  const variable = resolveVariable(sourceCode, expression);
  return variable === null || variable.defs.length === 0;
}

/**
 * Whether a callee names one method on the global `Reflect` — the test `no-reflect-get` and
 * `no-reflect-apply` share.
 *
 * `isGlobalReflect` accepts the name where the scope chain says it is a global reference, and
 * also where it resolves to a variable with no definition, because an ambient declaration binds
 * the name without giving it a definition node. A `Reflect` the file declares itself therefore
 * fails both tests and is somebody's own object. Computed access is read alongside plain access,
 * since `Reflect["get"](…)` is the same call; a computed key that is not a string literal names
 * nothing this function can decide and is refused rather than guessed at.
 */
export function isGlobalReflectMethodCall(
  sourceCode: SourceCode,
  callee: ESTree.Expression,
  methodName: string,
): boolean {
  if (!("property" in callee) || !("object" in callee) || !("computed" in callee)) return false;
  if (!isGlobalReflect(sourceCode, callee.object)) return false;
  const { property } = callee;
  return callee.computed
    ? property.type === "Literal" && property.value === methodName
    : property.type === "Identifier" && property.name === methodName;
}
