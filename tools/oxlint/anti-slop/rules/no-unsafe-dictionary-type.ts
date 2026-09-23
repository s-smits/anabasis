import { defineRule } from "@oxlint/plugins";

import {
  classifyUnsafeDictionary,
  classifyUnsafeDictionaryValue,
  createTypeEnvironment,
  type TypeEnvironment,
} from "../shared/dictionary-types.ts";
import { isRepresentationOwner } from "../shared/representation-owner.ts";
import { typeReferenceName, visibleTypeAlias } from "../shared/type-alias-resolution.ts";

import type { ESTree } from "@oxlint/plugins";

const typeNodeKinds: ReadonlySet<string> = new Set([
  "JSDocNonNullableType",
  "JSDocNullableType",
  "JSDocUnknownType",
  "TSAnyKeyword",
  "TSArrayType",
  "TSBigIntKeyword",
  "TSBooleanKeyword",
  "TSConditionalType",
  "TSConstructorType",
  "TSFunctionType",
  "TSImportType",
  "TSIndexedAccessType",
  "TSInferType",
  "TSIntersectionType",
  "TSIntrinsicKeyword",
  "TSLiteralType",
  "TSMappedType",
  "TSNamedTupleMember",
  "TSNeverKeyword",
  "TSNullKeyword",
  "TSNumberKeyword",
  "TSObjectKeyword",
  "TSParenthesizedType",
  "TSStringKeyword",
  "TSSymbolKeyword",
  "TSTemplateLiteralType",
  "TSThisType",
  "TSTupleType",
  "TSTypeLiteral",
  "TSTypeOperator",
  "TSTypePredicate",
  "TSTypeQuery",
  "TSTypeReference",
  "TSUndefinedKeyword",
  "TSUnionType",
  "TSUnknownKeyword",
  "TSVoidKeyword",
]);

function isTypeNode(node: ESTree.Node): node is ESTree.TSType {
  return typeNodeKinds.has(node.type);
}

function isInsideTypeAliasDeclaration(node: ESTree.Node): boolean {
  let current: ESTree.Node | null = node.parent;
  while (current !== null && current.type !== "Program") {
    if (current.type === "TSTypeAliasDeclaration") return true;
    current = current.parent;
  }
  return false;
}

function isPlainAliasConsumerUse(node: ESTree.TSType, environment: TypeEnvironment): boolean {
  if (node.type !== "TSTypeReference" || (node.typeArguments?.params.length ?? 0) > 0) return false;
  const name = typeReferenceName(node);
  return (
    name !== null &&
    visibleTypeAlias(name, node, environment.typeAliases) !== null &&
    !isInsideTypeAliasDeclaration(node)
  );
}

function isInsideTypeParameterConstraint(node: ESTree.TSType): boolean {
  let child: ESTree.Node = node;
  let parent: ESTree.Node | null = child.parent;
  while (parent.type !== "Program") {
    if (parent.type === "TSTypeParameter" && parent.constraint === child) return true;
    child = parent;
    parent = child.parent;
  }
  return false;
}

function shouldReportType(node: ESTree.TSType, environment: TypeEnvironment): boolean {
  if (isInsideTypeParameterConstraint(node)) return false;
  if (isPlainAliasConsumerUse(node, environment)) return false;
  if (classifyUnsafeDictionary(node, environment) === null) return false;
  let current: ESTree.Node | null = node.parent;
  while (current.type !== "Program") {
    if (isTypeNode(current) && classifyUnsafeDictionary(current, environment) !== null) {
      return false;
    }
    current = current.parent;
  }
  return true;
}

/**
 * The representation owner's one open view: `export type OpenRecord = Record<string, unknown>;`.
 *
 * A module namespace, a TypeBox schema and an ESTree node are each read by key with every value
 * unknown until the reader checks it, and the owner names that view once for all of them. Only the
 * exported alias written exactly so is admitted: the same spelling in another file, an unexported
 * copy in the owner, or `any` or `object` as the value type is still reported.
 */
function isOwnedOpenRecord(node: ESTree.TSType, filename: string): boolean {
  if (node.type !== "TSTypeReference" || typeReferenceName(node) !== "Record") return false;
  const alias = node.parent;
  if (alias.type !== "TSTypeAliasDeclaration" || alias.parent.type !== "ExportNamedDeclaration") return false;
  const [key, value, ...rest] = node.typeArguments?.params ?? [];
  return (
    rest.length === 0 &&
    key?.type === "TSStringKeyword" &&
    value?.type === "TSUnknownKeyword" &&
    isRepresentationOwner(filename)
  );
}

/**
 * A dictionary type whose values are an escape hatch: `Record<string, unknown>`,
 * `{ [key: string]: any }`, a mapped type over a broad key with an `object` or `{}` value, or an
 * alias or union that resolves to one of those.
 *
 * The key being open is not the problem — a table of things keyed by name is a normal thing to
 * want. The problem is that the value type then says nothing either, so the contract describes a
 * bag rather than a table, and every reader has to decide for itself what it expects to find. A
 * value type is the one part of a dictionary that can still be named, and this rule is what keeps
 * it named.
 *
 * Four exemptions, each because the broad type is the honest one there. A type parameter's
 * constraint may be an open dictionary, since a constraint is a bound on what callers may supply
 * rather than a promise about what this code holds. A plain reference to a visible alias, used
 * outside any alias declaration, is left to the declaration that owns it, so the finding lands
 * once at the alias rather than at all of its uses. A type nested inside another type that is
 * already reported is skipped, so one dictionary is one finding rather than one per layer. And
 * the representation owner declares the one open view this repository shares, under
 * `isOwnedOpenRecord` below, which admits nothing but that exact exported alias in that exact
 * file.
 *
 * There is no fix: the repair is the value type, and the escape hatch is there because it was not
 * yet decided.
 */
export const noUnsafeDictionaryTypeRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow object-dictionary contracts whose direct value type is unknown, any, object, {}, or a union/alias containing one of those escape hatches.",
    },
    messages: {
      unsafeDictionary:
        "This dictionary's {{value}} value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.",
    },
  },
  createOnce(context) {
    let environment: TypeEnvironment | null = null;
    const report = (node: ESTree.Node, value: string) => {
      context.report({ node, messageId: "unsafeDictionary", data: { value } });
    };
    const reportIfUnsafe = (node: ESTree.TSType) => {
      if (environment === null || !shouldReportType(node, environment)) return;
      if (isOwnedOpenRecord(node, context.filename)) return;
      const unsafe = classifyUnsafeDictionary(node, environment);
      if (unsafe === null) return;
      report(node, unsafe.unsafeValue);
    };

    return {
      Program(node) {
        environment = createTypeEnvironment(node, context.sourceCode.visitorKeys);
      },
      TSTypeReference: reportIfUnsafe,
      TSTypeLiteral: reportIfUnsafe,
      TSMappedType: reportIfUnsafe,
      TSIndexSignature(node) {
        if (environment === null || node.parent.type === "TSTypeLiteral") {
          return;
        }
        const unsafe = classifyUnsafeDictionaryValue(node.typeAnnotation.typeAnnotation, environment);
        if (unsafe !== null) report(node, unsafe.unsafeValue);
      },
    };
  },
});
