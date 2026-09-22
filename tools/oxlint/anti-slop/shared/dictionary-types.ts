import type { ESTree } from "@oxlint/plugins";

import {
  createTypeAliasEnvironment,
  hasVisibleTypeBinding,
  typeReferenceName,
  visibleTypeAlias,
  type TypeAliasEnvironment as LexicalTypeAliasEnvironment,
} from "./type-alias-resolution.ts";

/**
 * What a written type denotes, for the three anti-slop rules that ask whether a type
 * still carries evidence.
 *
 * Every question here — is this value type an escape hatch, is this target an open
 * container, is this certainly an object — is the same walk over a written type:
 * unwrap the parentheses and `readonly`, substitute a bound type parameter, pass
 * through a transparent wrapper, recognise a built-in, follow the visible alias with
 * its arguments bound, and stop at a cycle. `resolveReference` is that walk, so the
 * classifiers below differ only in the leaves they care about.
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

type ResolvedType = {
  readonly type: ESTree.TSType;
  readonly substitutions: TypeAliasEnvironment;
};

type UnsafeDictionary = {
  readonly kind: "unsafe-dictionary";
  readonly unsafeValue: "any" | "empty-object" | "object" | "union" | "unknown";
};

export type WideningTargetKind =
  | "anonymous object"
  | "any"
  | "generic container"
  | "object"
  | "open dictionary"
  | "unknown";

export type WideningTarget = {
  readonly kind: WideningTargetKind;
};

/** The kind three of the producers below return and `generic` reads back. Written once so the
 *  four uses cannot drift from each other or from the union member above. */
const OPEN_DICTIONARY: WideningTargetKind = "open dictionary";

/**
 * The keywords that give everything away by themselves, whatever encloses them. They
 * are both a widening target and an unsafe value type, and they name themselves.
 */
const keywordEscapes = new Map<string, "any" | "object" | "unknown">([
  ["TSAnyKeyword", "any"],
  ["TSObjectKeyword", "object"],
  ["TSUnknownKeyword", "unknown"],
]);

export type TypeEnvironment = {
  readonly interfaces: ReadonlyMap<string, readonly ESTree.TSInterfaceDeclaration[]>;
  readonly typeAliases: LexicalTypeAliasEnvironment;
};

// --- the walk ------------------------------------------------------------------

/** Where the walk stands: the type in hand, and what has been followed to reach it. */
type Step = {
  readonly type: ESTree.TSType;
  readonly substitutions: TypeAliasEnvironment;
  readonly visited: ReadonlySet<string>;
  /** This step passed through a named alias rather than a wrapper or a parameter. */
  readonly aliasFollowed: boolean;
  /** ...and that alias declares type parameters, so the container is generic. */
  readonly aliasGeneric: boolean;
};

type Resolution =
  | { readonly kind: "step"; readonly step: Step }
  | { readonly kind: "builtin"; readonly name: string }
  | { readonly kind: "interface"; readonly declarations: readonly ESTree.TSInterfaceDeclaration[] }
  | { readonly kind: "opaque" };

const opaque: Resolution = { kind: "opaque" };

/** The key keywords that admit keys the author never wrote down. */
const broadKeyKeywords = new Set(["TSStringKeyword", "TSNumberKeyword", "TSSymbolKeyword"]);

/** The expressions whose written form already states what they denote. */
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

/** The written types that denote an object at runtime without following anything. */
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
  const nextResolving = new Set(resolving);
  nextResolving.add(name);
  return resolvedSubstitutionArgument(substitution, base, nextResolving);
}

/** Bind an alias's parameters to the arguments written at this use, or refuse. */
function aliasSubstitution(
  alias: ESTree.TSTypeAliasDeclaration,
  type: ESTree.TSTypeReference,
  base: TypeAliasEnvironment,
): TypeAliasEnvironment | null {
  const parameters = alias.typeParameters?.params ?? [];
  const arguments_ = type.typeArguments?.params ?? [];
  const next = new Map(base);
  for (const [index, parameter] of parameters.entries()) {
    const argument = arguments_[index] ?? parameter.default;
    if (argument === null) return null;
    next.set(parameter.name.name, resolvedSubstitutionArgument(argument, next));
  }
  return next;
}

/**
 * One step past a type reference: to the type it stands for, or to the reason the walk
 * stops there. A reference the walk cannot see through — an unapplied parameter, a
 * wrong-arity application, a name nothing in scope declares, a cycle — is `opaque`.
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
  const visited = new Set(from.visited);
  visited.add(name);
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

// --- is this key broad? ---------------------------------------------------------

/**
 * A mapped or `Record` key is broad when it admits keys the author never wrote down.
 * `"a" | "b"` and `keyof Money` pin a shape; `string` and `PropertyKey` do not.
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
    // A generic alias in key position says nothing about the key until it is applied,
    // and this walk has no application to apply.
    if (resolution.kind === "builtin") return resolution.name === "PropertyKey";
    if (resolution.kind !== "step" || resolution.step.aliasGeneric) return false;
    state = resolution.step;
  }
}

// --- is this value type an escape hatch? ----------------------------------------

function isNeverType(type: ESTree.TSType): boolean {
  return unwrapTransparentType(type).type === "TSNeverKeyword";
}

function isEffectivelyEmptyMember(member: ESTree.TSSignature): boolean {
  return (
    member.type === "TSPropertySignature" &&
    member.optional === true &&
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

// --- what value types does this dictionary hold? --------------------------------

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

/**
 * The value types a written type offers behind an open key. A mapped type counts only
 * when its key is broad: `{ [K in "id"]: unknown }` is the shape `{ id: unknown }`,
 * which this rule admits, and `{ [K in string]: unknown }` is a dictionary.
 */
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

// --- is this target broader than the value that flows into it? ------------------

/**
 * An unnamed shape is its own contract only where it is written: `{ currency: string }`
 * in an annotation replaces the owner type, while the same members behind an alias are
 * that alias's contract. So "anonymous object" is produced before the walk follows a
 * name, and never after.
 */
function typeLiteralWideningTarget(type: ESTree.TSTypeLiteral, named: boolean): WideningTarget | null {
  if (type.members.some((member) => member.type === "TSIndexSignature")) {
    return { kind: OPEN_DICTIONARY };
  }
  if (named) return null;
  return type.members.length > 0 ? { kind: "anonymous object" } : null;
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
  return named ? null : { kind: "anonymous object" };
}

/**
 * What a target type gives away, or `null` when it keeps the value's evidence. A
 * generic alias that resolves to an open container is reported as that container
 * rather than as the alias, since the alias is only a name for it.
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
      return generic(typeLiteralWideningTarget(unwrapped, named), firstAliasGeneric);
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

// --- does this expression state its own type? -----------------------------------

/**
 * Whether an object literal's own key set is knowable. A spread of anything but another such
 * literal, or a computed key that is not a literal, opens it: the literal then states no complete
 * shape, so a dictionary annotation over it discards nothing. `prepareEnvironment` returning
 * `{ HOME, PATH, ...slotEnvironment(condition) }` as `Record<string, string | undefined>` is the
 * truth about an environment map, not evidence thrown away.
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

// --- is this certainly an object? -----------------------------------------------

/**
 * True when `type` certainly denotes an object at runtime, following aliases, interfaces
 * and the transparent wrappers. `no-widen-then-assert` asks this to tell a narrowing
 * (`object` back to a real shape) from a change of kind (`object` to `string`), which is a
 * different defect and not this rule's.
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
