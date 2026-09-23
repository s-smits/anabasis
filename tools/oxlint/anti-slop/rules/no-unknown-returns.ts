import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

import {
  createTypeAliasEnvironment,
  resolvedTypeMatches,
  type TypeAliasEnvironment,
} from "../shared/type-alias-resolution.ts";

type FunctionWithReturnType =
  | ESTree.ArrowFunctionExpression
  | ESTree.Function
  | ESTree.TSCallSignatureDeclaration
  | ESTree.TSConstructSignatureDeclaration
  | ESTree.TSConstructorType
  | ESTree.TSFunctionType
  | ESTree.TSMethodSignature;

/**
 * A function whose written return type is `unknown`, so every caller receives a value it has to
 * narrow before it can do anything with it.
 *
 * `unknown` on the way out is the parse that did not happen, and the work it defers does not go
 * away: it lands at every call site instead of once at the boundary, and each of those sites
 * narrows on its own reading of what the value probably is. A return type is a promise to the
 * caller, and this one promises that nothing was learned.
 *
 * Only a written annotation is read, because a plugin rule walks syntax and never asks the
 * checker, so a function whose return type is inferred is invisible here however wide the
 * inference comes out. Inside an annotation the rule does look through what an author writes
 * around the type rather than instead of it: parentheses, a union with any `unknown` member, a
 * `Promise<unknown>` or `PromiseLike<unknown>`, and a local `type` alias standing for any of
 * those, resolved through `shared/type-alias-resolution.ts`. Naming `unknown` `Payload` one line
 * above therefore buys the annotation nothing. A generic `<T>` does get through, and on purpose:
 * `visibleTypeAlias` refuses to resolve a name a type parameter is binding, so a module-scope
 * `type T = unknown` cannot make every `<T>` in the file read as the top type.
 *
 * Declarations and contracts are read alike — the arrow, the function, the method signature, the
 * call and construct signatures, the bare `TSFunctionType` — so an interface promising `unknown`
 * is caught where it is written rather than at whichever implementation happens to spell it.
 *
 * There is no fix: the repair is the return type, which is the work the `unknown` avoided.
 */
export const noUnknownReturnsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow functions whose explicit return contract is unknown or Promise<unknown>.",
    },
    messages: {
      unknownReturn:
        "This function exposes `unknown` to its caller. Parse the value at its boundary and return a named domain type.",
    },
  },
  createOnce(context) {
    let environment: TypeAliasEnvironment | null = null;

    const resolvesToUnknown = (type: ESTree.TSType): boolean =>
      environment !== null &&
      resolvedTypeMatches(type, environment, (resolved, matches) => {
        if (resolved.type === "TSUnknownKeyword") return true;
        if (resolved.type === "TSParenthesizedType") {
          return matches(resolved.typeAnnotation);
        }
        if (resolved.type === "TSUnionType") return resolved.types.some(matches);
        if (
          resolved.type !== "TSTypeReference" ||
          resolved.typeName.type !== "Identifier" ||
          (resolved.typeName.name !== "Promise" && resolved.typeName.name !== "PromiseLike")
        ) {
          return false;
        }
        const value = resolved.typeArguments?.params[0];
        return value !== undefined && matches(value);
      });

    const checkReturnType = (node: FunctionWithReturnType) => {
      const annotation = node.returnType;
      if (annotation === null || annotation === undefined) return;
      if (!resolvesToUnknown(annotation.typeAnnotation)) return;
      context.report({ node: annotation.typeAnnotation, messageId: "unknownReturn" });
    };

    return {
      Program(node) {
        environment = createTypeAliasEnvironment(node, context.sourceCode.visitorKeys);
      },
      ArrowFunctionExpression: checkReturnType,
      FunctionDeclaration: checkReturnType,
      FunctionExpression: checkReturnType,
      TSCallSignatureDeclaration: checkReturnType,
      TSConstructSignatureDeclaration: checkReturnType,
      TSConstructorType: checkReturnType,
      TSDeclareFunction: checkReturnType,
      TSEmptyBodyFunctionExpression: checkReturnType,
      TSFunctionType: checkReturnType,
      TSMethodSignature: checkReturnType,
    };
  },
});
