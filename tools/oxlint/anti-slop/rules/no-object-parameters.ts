import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

import {
  functionParameterBindingName,
  functionParameterTypeAnnotation,
} from "../shared/function-parameters.ts";
import {
  createTypeAliasEnvironment,
  resolvedTypeMatches,
  type TypeAliasEnvironment,
} from "../shared/type-alias-resolution.ts";
type ParameterOwner =
  | ESTree.ArrowFunctionExpression
  | ESTree.Function
  | ESTree.TSCallSignatureDeclaration
  | ESTree.TSConstructSignatureDeclaration
  | ESTree.TSConstructorType
  | ESTree.TSFunctionType
  | ESTree.TSMethodSignature;

/**
 * The type one member of a type literal declares, or null where it declares none.
 *
 * A method signature is left out on purpose: its parameters are the *caller's* contract with a
 * callback, not this function's contract with its caller, and a callback taking `object` is the
 * callback author's finding.
 */
function memberType(member: ESTree.TSSignature): ESTree.TSType | null {
  if (member.type !== "TSPropertySignature" && member.type !== "TSIndexSignature") return null;
  return member.typeAnnotation?.typeAnnotation ?? null;
}

/**
 * A function parameter whose declared type is `object`, wherever in the annotation the word ends
 * up.
 *
 * `object` says the value is not a primitive and stops there. A parameter declared that way
 * accepts anything any caller has, so the signature rejects nothing, and the narrowing the
 * function needs before it can read a field happens inside it instead — and then again inside the
 * next function it passes the value to. A parameter is where a type earns the most, because it is
 * the one declaration both sides read.
 *
 * A parameter hides the broad type as easily as it spells it, so the search reads through an
 * alias into an array, a tuple, a `readonly` operator, a type literal's property and index
 * members, a type reference's arguments, an intersection and a union. `object[]`, `readonly
 * object[]`, `{ rows: object[] }` and `Map<string, object>` each leave a caller with the same
 * unparsed value `object` would; only `WeakMap` and `WeakSet` are exempt, because there the broad
 * type is the language's own key constraint.
 *
 * Only a written annotation is read, because a plugin rule never asks the checker, so an
 * unannotated parameter is invisible here however wide its inferred type comes out. The ten
 * visitor kinds cover declarations and contracts alike — the arrow, the function, the method
 * signature, the call and construct signatures, the bare `TSFunctionType` — so an interface asking
 * for `object` is reported where it is written rather than at each implementation of it.
 *
 * There is no fix: the repair is an owner-provided type parsed at its boundary, so the edit is a
 * new contract in another file and every call site.
 */
export const noObjectParametersRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow object function parameters; inputs must use an owner-provided type and be parsed at their boundary.",
    },
    messages: {
      objectParameter:
        "Parameter `{{parameter}}` uses the broad `object` type. Accept a named owner type; parse external input at its boundary before calling this function.",
    },
  },
  createOnce(context) {
    let environment: TypeAliasEnvironment | null = null;

    const resolvesToObject = (type: ESTree.TSType): boolean =>
      environment !== null &&
      resolvedTypeMatches(type, environment, (resolved, matches) => {
        if (resolved.type === "TSObjectKeyword") return true;
        if (resolved.type === "TSParenthesizedType") {
          return matches(resolved.typeAnnotation);
        }
        if (resolved.type === "TSArrayType") return matches(resolved.elementType);
        if (resolved.type === "TSTypeOperator") {
          return resolved.typeAnnotation !== undefined && matches(resolved.typeAnnotation);
        }
        if (resolved.type === "TSTupleType") {
          // A tuple member carries its type past the `?` or `...` it may be spelled with.
          return resolved.elementTypes.some((element) =>
            matches(
              element.type === "TSOptionalType" || element.type === "TSRestType"
                ? element.typeAnnotation
                : element,
            ),
          );
        }
        if (resolved.type === "TSTypeLiteral") {
          return resolved.members.some((member) => {
            const declared = memberType(member);
            return declared !== null && matches(declared);
          });
        }
        if (resolved.type === "TSTypeReference") {
          // A weak collection is where `object` is the language's own constraint rather than
          // an unread input. `WeakMap<object, object>` in `task-access-trace.ts` maps a traced
          // value to its proxy; a key there has to be an object, and `WeakMap<Parsed, Proxy>`
          // would narrow what the table may hold rather than say anything truer about it. So
          // the broad type is the correct one and naming an owner type is the wrong repair.
          const owner = resolved.typeName;
          if (owner.type === "Identifier" && (owner.name === "WeakMap" || owner.name === "WeakSet")) {
            return false;
          }
          return (resolved.typeArguments?.params ?? []).some(matches);
        }
        if (resolved.type === "TSIntersectionType") return resolved.types.some(matches);
        return resolved.type === "TSUnionType" && resolved.types.some(matches);
      });

    const checkParameters = (node: ParameterOwner) => {
      for (const parameter of node.params) {
        const annotation = functionParameterTypeAnnotation(parameter);
        if (annotation === null || annotation === undefined) continue;
        if (!resolvesToObject(annotation.typeAnnotation)) continue;
        context.report({
          node: annotation.typeAnnotation,
          messageId: "objectParameter",
          data: { parameter: functionParameterBindingName(parameter, context.sourceCode) },
        });
      }
    };

    return {
      Program(node) {
        environment = createTypeAliasEnvironment(node, context.sourceCode.visitorKeys);
      },
      ArrowFunctionExpression: checkParameters,
      FunctionDeclaration: checkParameters,
      FunctionExpression: checkParameters,
      TSCallSignatureDeclaration: checkParameters,
      TSConstructSignatureDeclaration: checkParameters,
      TSConstructorType: checkParameters,
      TSDeclareFunction: checkParameters,
      TSEmptyBodyFunctionExpression: checkParameters,
      TSFunctionType: checkParameters,
      TSMethodSignature: checkParameters,
    };
  },
});
