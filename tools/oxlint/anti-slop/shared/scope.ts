import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

/**
 * The binding an identifier refers to, found by walking lexical scopes outward from where it is
 * written.
 *
 * `getScope` hands back the innermost scope, which holds a name only if that scope declares it, so
 * a reference to something declared further out needs the walk. Null means nothing in the file
 * declares the name at all, and the rules that ask read it that way: `Reflect` and `vi` with no
 * binding in sight are the ambient globals, which is exactly when `no-reflect-get` and
 * `no-module-mocking` have something to say. Resolving by scope rather than by spelling is also
 * what lets a local `Reflect` shadow the global and be left alone.
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
