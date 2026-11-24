import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

/**
 * The binding an identifier refers to, found by walking lexical scopes outward from where it is
 * written.
 */
export function resolveVariable(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
): Variable | null {
  let scope: Scope | null = sourceCode.getScope(identifier);
  while (scope !== null) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined) return variable;
    scope = scope.upper;
  }
  return null;
}
