import type { ESTree } from "@oxlint/plugins";

import {
  createTypeAliasEnvironment,
  hasVisibleTypeBinding,
  typeReferenceName,
  visibleTypeAlias,
  type TypeAliasEnvironment as LexicalTypeAliasEnvironment,
} from "./type-alias-resolution.ts";

/**
 * What a written type denotes, for the three anti-slop rules that ask whether a type still carries
 * evidence.
 */

const BUILT_INS = new Set([
  "Record",
  "Readonly",
  "Partial",
  "Required",
  "Pick",
  "Omit",
  "PropertyKey",
  "NonNullable",
]);
const TRANSPARENT_WRAPPERS = new Set(["Readonly", "Partial", "Required", "NonNullable"]);

type TypeAliasEnvironment = ReadonlyMap<string, ESTree.TSType>;

interface ResolvedType {
  readonly type: ESTree.TSType;
  readonly substitutions: TypeAliasEnvironment;
}

interface UnsafeDictionary {
  readonly kind: "unsafe-dictionary";
  readonly unsafeValue: "any" | "empty-object" | "object" | "union" | "unknown";
}

export type WideningTargetKind =
  | "anonymous object"
  | "any"
  | "generic container"
  | "object"
  | "open dictionary"
  | "unknown";

export interface WideningTarget {
  readonly kind: WideningTargetKind;
}

const OPEN_DICTIONARY: WideningTargetKind = "open dictionary";

/**
 * Keywords that give everything away whatever encloses them: both a widening target and an unsafe
 * value type.
 */
const keywordEscapes = new Map<string, "any" | "object" | "unknown">([
  ["TSAnyKeyword", "any"],
  ["TSObjectKeyword", "object"],
  ["TSUnknownKeyword", "unknown"],
]);

export interface TypeEnvironment {
  readonly interfaces: ReadonlyMap<string, readonly ESTree.TSInterfaceDeclaration[]>;
  readonly typeAliases: LexicalTypeAliasEnvironment;
}

interface Step {
  readonly type: ESTree.TSType;
  readonly substitutions: TypeAliasEnvironment;
  readonly visited: ReadonlySet<string>;
  readonly aliasFollowed: boolean;
  readonly aliasGeneric: boolean;
}

type Resolution =
  | { readonly kind: "step"; readonly step: Step }
  | { readonly kind: "builtin"; readonly name: string }
  | { readonly kind: "interface"; readonly declarations: readonly ESTree.TSInterfaceDeclaration[] }
  | { readonly kind: "opaque" };

const opaque: Resolution = { kind: "opaque" };

const broadKeyKeywords = new Set(["TSStringKeyword", "TSNumberKeyword", "TSSymbolKeyword", "TSAnyKeyword"]);

const evidenceExpressions = new Set([
  "ArrayExpression",
  "ArrowFunctionExpression",
  "ClassExpression",
  "FunctionExpression",
  "Literal",
  "NewExpression",
  "ObjectExpression",
  "TemplateLiteral",
  "UnaryExpression",
]);

const certainObjectTypes = new Set([
  "TSArrayType",
  "TSConstructorType",
  "TSFunctionType",
  "TSMappedType",
  "TSObjectKeyword",
  "TSTupleType",
]);

export function createTypeEnvironment(
  program: ESTree.Program,
  visitorKeys: Readonly<Record<string, readonly string[]>>,
): TypeEnvironment {
  const interfaces = new Map<string, ESTree.TSInterfaceDeclaration[]>();
  for (const statement of program.body) {
    const declaration =
      statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration"
        ? (statement.declaration ?? null)
        : statement;
    if (declaration?.type !== "TSInterfaceDeclaration") continue;
    const declarations = interfaces.get(declaration.id.name) ?? [];
    declarations.push(declaration);
    interfaces.set(declaration.id.name, declarations);
  }
  return { interfaces, typeAliases: createTypeAliasEnvironment(program, visitorKeys) };
}

function start(type: ESTree.TSType, substitutions: TypeAliasEnvironment = new Map()): Step {
  return {
    type,
    substitutions,
    visited: new Set(),
    aliasFollowed: false,
    aliasGeneric: false,
  };
}

function stepTo(from: Step, type: ESTree.TSType): Resolution {
  return { kind: "step", step: { ...from, type, aliasFollowed: false, aliasGeneric: false } };
}

function isUnappliedReferenceTo(type: ESTree.TSType, name: string): boolean {
  const unwrapped = unwrapTransparentType(type);
  return (
    unwrapped.type === "TSTypeReference" &&
    typeReferenceName(unwrapped) === name &&
    (unwrapped.typeArguments === null || unwrapped.typeArguments.params.length === 0)
  );
}

function unwrapTransparentType(type: ESTree.TSType): ESTree.TSType {
  let current = type;
  while (
    current.type === "TSParenthesizedType" ||
    (current.type === "TSTypeOperator" && current.operator === "readonly")
  ) {
    current = current.typeAnnotation;
  }
  return current;
}

function resolvedSubstitutionArgument(
  type: ESTree.TSType,
  base: TypeAliasEnvironment,
  resolving: ReadonlySet<string> = new Set(),
): ESTree.TSType {
  const unwrapped = unwrapTransparentType(type);
  if (unwrapped.type !== "TSTypeReference") return type;
  const name = typeReferenceName(unwrapped);
  if (name === null || resolving.has(name)) return type;
  const substitution = base.get(name);
  if (substitution === undefined) return type;
  const nextResolving = new Set([...resolving, name]);
  return resolvedSubstitutionArgument(substitution, base, nextResolving);
}

function aliasSubstitution(
  alias: ESTree.TSTypeAliasDeclaration,
  type: ESTree.TSTypeReference,
  base: TypeAliasEnvironment,
): TypeAliasEnvironment | null {
  const parameters = alias.typeParameters?.params ?? [];
  const typeArguments = type.typeArguments?.params ?? [];
  const next = new Map(base);
  for (const [index, parameter] of parameters.entries()) {
    const argument = typeArguments[index] ?? parameter.default;
    if (argument === null) return null;
    next.set(parameter.name.name, resolvedSubstitutionArgument(argument, next));
  }
  return next;
}

/**
 * One step past a type reference, or `opaque` where the walk cannot see through it: an unapplied
 * parameter, a missing argument, an undeclared name, a cycle.
 */
function resolveReference(
  reference: ESTree.TSTypeReference,
  environment: TypeEnvironment,
  from: Step,
): Resolution {
  const name = typeReferenceName(reference);
  if (name === null) return opaque;
  const substitution = from.substitutions.get(name);
  if (substitution !== undefined) {
    return isUnappliedReferenceTo(substitution, name) ? opaque : stepTo(from, substitution);
  }
  if (BUILT_INS.has(name) && !hasVisibleTypeBinding(name, reference, environment.typeAliases)) {
    if (!TRANSPARENT_WRAPPERS.has(name)) return { kind: "builtin", name };
    const wrapped = reference.typeArguments?.params[0];
    return wrapped === undefined ? opaque : stepTo(from, wrapped);
  }
  const declarations = environment.interfaces.get(name);
  if (declarations !== undefined) return { kind: "interface", declarations };
  const alias = visibleTypeAlias(name, reference, environment.typeAliases);
  if (alias === null || from.visited.has(name)) return opaque;
  const substitutions = aliasSubstitution(alias, reference, from.substitutions);
  if (substitutions === null) return opaque;
  const visited = new Set([...from.visited, name]);
  return {
    kind: "step",
    step: {
      type: alias.typeAnnotation,
      substitutions,
      visited,
      aliasFollowed: true,
      aliasGeneric: (alias.typeParameters?.params.length ?? 0) > 0,
    },
  };
}

/**
 * A key is broad when it admits keys the author never wrote: `string` and `PropertyKey`, not `"a" |
 * "b"` or `keyof Money`.
 */
function isBroadMappedKey(
  type: ESTree.TSType | null,
  environment: TypeEnvironment,
  substitutions: TypeAliasEnvironment,
): boolean {
  if (type === null) return false;
  let state = start(type, substitutions);
  for (;;) {
    const unwrapped = unwrapTransparentType(state.type);
    if (broadKeyKeywords.has(unwrapped.type)) return true;
    if (unwrapped.type === "TSUnionType") {
      return unwrapped.types.some((member) => isBroadMappedKey(member, environment, state.substitutions));
    }
    if (unwrapped.type !== "TSTypeReference") return false;
    const resolution = resolveReference(unwrapped, environment, state);
    if (resolution.kind === "builtin") return resolution.name === "PropertyKey";
    if (resolution.kind !== "step") return false;
    state = resolution.step;
  }
}

function isNeverType(type: ESTree.TSType): boolean {
  return unwrapTransparentType(type).type === "TSNeverKeyword";
}

function isEffectivelyEmptyMember(member: ESTree.TSSignature): boolean {
  return (
    member.type === "TSPropertySignature" &&
    member.optional &&
    member.typeAnnotation !== null &&
    isNeverType(member.typeAnnotation.typeAnnotation)
  );
}

function isEffectivelyEmptyInterface(declarations: readonly ESTree.TSInterfaceDeclaration[]): boolean {
  if (declarations.length !== 1) return false;
  const [type] = declarations;
  return (
    type?.extends.length === 0 &&
    (type.body.body.length === 0 || type.body.body.every(isEffectivelyEmptyMember))
  );
}

function unsafeDirectValue(
  type: ESTree.TSType,
  environment: TypeEnvironment,
  substitutions: TypeAliasEnvironment,
): UnsafeDictionary["unsafeValue"] | null {
  let state = start(type, substitutions);
  for (;;) {
    const unwrapped = unwrapTransparentType(state.type);
    const keyword = keywordEscapes.get(unwrapped.type);
    if (keyword !== undefined) return keyword;
    if (unwrapped.type === "TSTypeLiteral") {
      const empty = unwrapped.members.length === 0 || unwrapped.members.every(isEffectivelyEmptyMember);
      return empty ? "empty-object" : null;
    }
    const nested = (member: ESTree.TSType) => unsafeDirectValue(member, environment, state.substitutions);
    if (unwrapped.type === "TSUnionType") {
      return unwrapped.types.some((member) => nested(member) !== null) ? "union" : null;
    }
    if (unwrapped.type === "TSIntersectionType") {
      // `any` absorbs an intersection; otherwise every member has to be unsafe for it to be.
      const members = unwrapped.types.map(nested);
      if (members.includes("any")) return "any";
      return members.every((member) => member !== null) ? (members[0] ?? null) : null;
    }
    if (unwrapped.type !== "TSTypeReference") return null;
    const resolution = resolveReference(unwrapped, environment, state);
    if (resolution.kind === "interface") {
      return isEffectivelyEmptyInterface(resolution.declarations) ? "empty-object" : null;
    }
    if (resolution.kind !== "step") return null;
    state = resolution.step;
  }
}

function indexSignatureValues(
  type: ESTree.TSTypeLiteral,
  substitutions: TypeAliasEnvironment,
): readonly ResolvedType[] {
  return type.members.flatMap((member): readonly ResolvedType[] =>
    member.type === "TSIndexSignature" ? [{ type: member.typeAnnotation.typeAnnotation, substitutions }] : [],
  );
}

function builtinValues(
  name: string,
  reference: ESTree.TSTypeReference,
  state: Step,
): readonly ResolvedType[] {
  if (name === "Record") {
    const value = reference.typeArguments?.params[1];
    return value === undefined ? [] : [{ type: value, substitutions: state.substitutions }];
  }
  if (name !== "Pick" && name !== "Omit") return [];
  const source = reference.typeArguments?.params[0];
  return source === undefined ? [] : [{ type: source, substitutions: state.substitutions }];
}

/** A mapped type counts only with a broad key: `{ [K in "id"]: unknown }` is the shape `{ id: unknown }`. */
function dictionaryValueTypes(
  type: ESTree.TSType,
  environment: TypeEnvironment,
  substitutions: TypeAliasEnvironment,
): readonly ResolvedType[] {
  let state = start(type, substitutions);
  for (;;) {
    const unwrapped = unwrapTransparentType(state.type);
    if (unwrapped.type === "TSTypeLiteral") {
      return indexSignatureValues(unwrapped, state.substitutions);
    }
    if (unwrapped.type === "TSMappedType") {
      return unwrapped.typeAnnotation === null ||
        !isBroadMappedKey(unwrapped.constraint, environment, state.substitutions)
        ? []
        : [{ type: unwrapped.typeAnnotation, substitutions: state.substitutions }];
    }
    if (unwrapped.type !== "TSTypeReference") return [];
    const resolution = resolveReference(unwrapped, environment, state);
    if (resolution.kind === "builtin") {
      const values = builtinValues(resolution.name, unwrapped, state);
      // `Pick` and `Omit` hand back their source type, which still has to be opened.
      return resolution.name === "Record"
        ? values
        : values.flatMap((value) => dictionaryValueTypes(value.type, environment, value.substitutions));
    }
    if (resolution.kind !== "step") return [];
    state = resolution.step;
  }
}

export function classifyUnsafeDictionaryValue(
  valueType: ESTree.TSType,
  environment: TypeEnvironment,
): UnsafeDictionary | null {
  const unsafeValue = unsafeDirectValue(valueType, environment, new Map());
  return unsafeValue === null ? null : { kind: "unsafe-dictionary", unsafeValue };
}

export function classifyUnsafeDictionary(
  type: ESTree.TSType,
  environment: TypeEnvironment,
): UnsafeDictionary | null {
  for (const valueType of dictionaryValueTypes(type, environment, new Map())) {
    const unsafeValue = unsafeDirectValue(valueType.type, environment, valueType.substitutions);
    if (unsafeValue !== null) return { kind: "unsafe-dictionary", unsafeValue };
  }
  return null;
}

/**
 * An unnamed shape gives evidence away only through a member that is itself a widening target.
 * "anonymous object" is produced before the walk follows a name, never after: the same members
 * behind an alias are that alias's contract.
 */
function memberEscapes(type: ESTree.TSTypeLiteral, environment: TypeEnvironment): boolean {
  return type.members.some((member) => {
    if (member.type !== "TSPropertySignature") return false;
    const annotation = member.typeAnnotation?.typeAnnotation;
    return annotation !== undefined && classifyWideningTarget(annotation, environment) !== null;
  });
}

function typeLiteralWideningTarget(
  type: ESTree.TSTypeLiteral,
  environment: TypeEnvironment,
  named: boolean,
): WideningTarget | null {
  if (type.members.some((member) => member.type === "TSIndexSignature")) {
    return { kind: OPEN_DICTIONARY };
  }
  if (named) return null;
  return memberEscapes(type, environment) ? { kind: "anonymous object" } : null;
}

function mappedWideningTarget(
  type: ESTree.TSMappedType,
  environment: TypeEnvironment,
  state: Step,
  named: boolean,
): WideningTarget | null {
  if (isBroadMappedKey(type.constraint, environment, state.substitutions)) {
    return { kind: OPEN_DICTIONARY };
  }
  if (named) return null;
  const value = type.typeAnnotation;
  return value !== null && value !== undefined && classifyWideningTarget(value, environment) !== null
    ? { kind: "anonymous object" }
    : null;
}

/**
 * What a target type gives away, or `null` when it keeps the value's evidence. A generic alias over
 * an open container reports as that container.
 */
export function classifyWideningTarget(
  type: ESTree.TSType,
  environment: TypeEnvironment,
): WideningTarget | null {
  let state = start(type);
  let firstAliasGeneric: boolean | null = null;
  for (;;) {
    const named = firstAliasGeneric !== null;
    const unwrapped = unwrapTransparentType(state.type);
    const keyword = keywordEscapes.get(unwrapped.type);
    if (keyword !== undefined) return { kind: keyword };
    if (unwrapped.type === "TSTypeLiteral") {
      return generic(typeLiteralWideningTarget(unwrapped, environment, named), firstAliasGeneric);
    }
    if (unwrapped.type === "TSMappedType") {
      return generic(mappedWideningTarget(unwrapped, environment, state, named), firstAliasGeneric);
    }
    if (unwrapped.type !== "TSTypeReference") return null;
    const resolution = resolveReference(unwrapped, environment, state);
    if (resolution.kind === "builtin") {
      // `Record<K, V>` with no key argument at all is the broadest reading of it.
      const key = unwrapped.typeArguments?.params[0] ?? null;
      const open =
        resolution.name === "Record" &&
        (key === null || isBroadMappedKey(key, environment, state.substitutions));
      return open ? generic({ kind: OPEN_DICTIONARY }, firstAliasGeneric) : null;
    }
    if (resolution.kind !== "step") return null;
    state = resolution.step;
    if (state.aliasFollowed) firstAliasGeneric ??= state.aliasGeneric;
  }
}

/** A generic alias hands back a container, not the shape one application of it has. */
function generic(target: WideningTarget | null, firstAliasGeneric: boolean | null): WideningTarget | null {
  if (firstAliasGeneric !== true) return target;
  return target?.kind === OPEN_DICTIONARY ? { kind: "generic container" } : null;
}

/**
 * A spread of anything but another such literal, or a computed non-literal key, leaves the key set
 * unknown, so a dictionary annotation over it discards nothing.
 */
function hasKnownKeys(expression: ESTree.ObjectExpression): boolean {
  return expression.properties.every((property) =>
    property.type === "SpreadElement"
      ? property.argument.type === "ObjectExpression" && hasKnownKeys(property.argument)
      : !property.computed || property.key.type === "Literal",
  );
}

export function isKnownEvidenceExpression(expression: ESTree.Expression): boolean {
  let current = expression;
  while (
    current.type === "ParenthesizedExpression" ||
    current.type === "TSAsExpression" ||
    current.type === "TSTypeAssertion" ||
    current.type === "TSNonNullExpression" ||
    current.type === "TSSatisfiesExpression"
  ) {
    current = current.expression;
  }
  if (current.type === "ObjectExpression") return hasKnownKeys(current);
  return evidenceExpressions.has(current.type);
}

/**
 * `no-widen-then-assert` asks this to tell a narrowing (`object` back to a real shape) from a
 * change of kind (`object` to `string`).
 */
export function isCertainlyObjectType(type: ESTree.TSType, environment: TypeEnvironment): boolean {
  let state = start(type);
  for (;;) {
    const unwrapped = unwrapTransparentType(state.type);
    if (certainObjectTypes.has(unwrapped.type)) return true;
    if (unwrapped.type === "TSTypeLiteral") return unwrapped.members.length > 0;
    if (unwrapped.type === "TSIntersectionType") {
      return unwrapped.types.every((member) => isCertainlyObjectType(member, environment));
    }
    if (unwrapped.type !== "TSTypeReference") return false;
    const resolution = resolveReference(unwrapped, environment, state);
    if (resolution.kind === "interface") return true;
    if (resolution.kind === "builtin") return resolution.name === "Record";
    if (resolution.kind !== "step") return false;
    state = resolution.step;
  }
}
