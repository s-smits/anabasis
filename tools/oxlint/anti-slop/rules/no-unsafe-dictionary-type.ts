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
 * Disallow object-dictionary contracts whose direct value type is an unsafe escape hatch.
 *
 * The representation owner's open view is the one exception (`isOwnedOpenRecord`).
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
