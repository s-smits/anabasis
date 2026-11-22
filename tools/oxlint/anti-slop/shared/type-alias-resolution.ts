import type { ESTree } from "@oxlint/plugins";

import { isNode, nodeFields } from "./ast-node.ts";
import { lexicalTypeParameterNames } from "./lexical-type-parameters.ts";

type VisitorKeys = Readonly<Record<string, readonly string[]>>;
type TypeScope = ESTree.Node;

interface TypeBinding {
  readonly alias: ESTree.TSTypeAliasDeclaration | null;
  readonly name: string;
  readonly scope: TypeScope;
}

type ResolvingAliases = ReadonlySet<ESTree.TSTypeAliasDeclaration>;

interface Substitution {
  readonly resolvingAliases: ResolvingAliases;
  readonly substitutions: Substitutions;
  readonly type: ESTree.TSType;
}

type Substitutions = ReadonlyMap<string, Substitution>;

export interface TypeAliasEnvironment {
  readonly aliases: readonly ESTree.TSTypeAliasDeclaration[];
  readonly bindingsByName: ReadonlyMap<string, readonly TypeBinding[]>;
  readonly visitorKeys: VisitorKeys;
}

type ResolvedTypeMatcher = (type: ESTree.TSType, matches: (child: ESTree.TSType) => boolean) => boolean;

const environmentsByProgram = new WeakMap<ESTree.Program, TypeAliasEnvironment>();

function enclosingTypeScope(node: ESTree.Node): TypeScope {
  // A named class expression binds its name only inside the expression.
  if (node.type === "ClassExpression") return node;
  let current: ESTree.Node | null = node.parent;
  while (current !== null) {
    if (
      current.type === "Program" ||
      current.type === "BlockStatement" ||
      current.type === "TSModuleBlock" ||
      current.type === "StaticBlock" ||
      current.type === "SwitchStatement"
    ) {
      return current;
    }
    current = current.parent;
  }
  return node;
}

function declaredTypeBinding(node: ESTree.Node): {
  readonly alias: ESTree.TSTypeAliasDeclaration | null;
  readonly name: string;
} | null {
  if (node.type === "TSTypeAliasDeclaration") {
    return { alias: node, name: node.id.name };
  }
  if (
    node.type === "TSInterfaceDeclaration" ||
    node.type === "TSEnumDeclaration" ||
    node.type === "ClassDeclaration" ||
    node.type === "ClassExpression"
  ) {
    return node.id === null ? null : { alias: null, name: node.id.name };
  }
  if (
    node.type === "ImportSpecifier" ||
    node.type === "ImportDefaultSpecifier" ||
    node.type === "ImportNamespaceSpecifier"
  ) {
    return { alias: null, name: node.local.name };
  }
  return null;
}

function collectTypeBindings(
  node: ESTree.Node,
  visitorKeys: VisitorKeys,
  bindingsByName: Map<string, TypeBinding[]>,
  aliases: ESTree.TSTypeAliasDeclaration[],
): void {
  const declared = declaredTypeBinding(node);
  if (declared !== null) {
    const bindings = bindingsByName.get(declared.name) ?? [];
    bindings.push({ ...declared, scope: enclosingTypeScope(node) });
    bindingsByName.set(declared.name, bindings);
    if (declared.alias !== null) aliases.push(declared.alias);
  }

  const fields = nodeFields(node);
  for (const key of visitorKeys[node.type] ?? []) {
    const value = fields[key];
    if (isNode(value)) {
      collectTypeBindings(value, visitorKeys, bindingsByName, aliases);
      continue;
    }
    if (!Array.isArray(value)) continue;
    for (const child of value) {
      if (isNode(child)) {
        collectTypeBindings(child, visitorKeys, bindingsByName, aliases);
      }
    }
  }
}

/**
 * Every type name a program declares, and the scope each declaration sits in.
 */
export function createTypeAliasEnvironment(
  program: ESTree.Program,
  visitorKeys: VisitorKeys,
): TypeAliasEnvironment {
  const cached = environmentsByProgram.get(program);
  if (cached !== undefined) return cached;
  const bindingsByName = new Map<string, TypeBinding[]>();
  const aliases: ESTree.TSTypeAliasDeclaration[] = [];
  collectTypeBindings(program, visitorKeys, bindingsByName, aliases);
  const environment = { aliases, bindingsByName, visitorKeys };
  environmentsByProgram.set(program, environment);
  return environment;
}

function ancestorDistance(ancestor: ESTree.Node, node: ESTree.Node): number | null {
  let current: ESTree.Node | null = node;
  let distance = 0;
  while (current !== null) {
    if (current === ancestor) return distance;
    current = current.parent;
    distance += 1;
  }
  return null;
}

function nearestTypeBindings(
  name: string,
  use: ESTree.Node,
  environment: TypeAliasEnvironment,
): readonly TypeBinding[] {
  const candidates = environment.bindingsByName.get(name) ?? [];
  let nearestDistance = Number.POSITIVE_INFINITY;
  let nearest: TypeBinding[] = [];
  for (const candidate of candidates) {
    const distance = ancestorDistance(candidate.scope, use);
    if (distance === null || distance > nearestDistance) continue;
    if (distance === nearestDistance) {
      nearest.push(candidate);
      continue;
    }
    nearestDistance = distance;
    nearest = [candidate];
  }
  return nearest;
}

/**
 * The alias this name stands for where it is used, or null where following it would be a guess.
 */
export function visibleTypeAlias(
  name: string,
  use: ESTree.Node,
  environment: TypeAliasEnvironment,
): ESTree.TSTypeAliasDeclaration | null {
  if (lexicalTypeParameterNames(use, environment.visitorKeys).has(name)) return null;
  const bindings = nearestTypeBindings(name, use, environment);
  return bindings.length === 1 ? (bindings[0]?.alias ?? null) : null;
}

/**
 * Whether the name is taken where it is used, which is how a rule tells a local `Record` or
 * `Array` from the built-in of the same name.
 */
export function hasVisibleTypeBinding(
  name: string,
  use: ESTree.Node,
  environment: TypeAliasEnvironment,
): boolean {
  return (
    lexicalTypeParameterNames(use, environment.visitorKeys).has(name) ||
    nearestTypeBindings(name, use, environment).length > 0
  );
}

/** The identifier a type reference names, or null where it is qualified: `A.B` names no
 *  single binding this environment can look up. Three modules ask it. */
export function typeReferenceName(type: ESTree.TSTypeReference): string | null {
  return type.typeName.type === "Identifier" ? type.typeName.name : null;
}

function aliasSubstitutions(
  alias: ESTree.TSTypeAliasDeclaration,
  reference: ESTree.TSTypeReference,
  base: Substitutions,
  baseResolving: ResolvingAliases,
  aliasResolving: ResolvingAliases,
): Substitutions | null {
  const parameters = alias.typeParameters?.params ?? [];
  const typeArguments = reference.typeArguments?.params ?? [];
  // The alias's body sees its own parameters only: an outer binding of the same name must not leak in.
  const next = new Map<string, Substitution>();
  for (const [index, parameter] of parameters.entries()) {
    const explicitArgument = typeArguments[index];
    const argument = explicitArgument ?? parameter.default;
    if (argument === null) return null;
    // Explicit arguments were written at the reference; defaults inside the alias.
    const isDefault = explicitArgument === undefined;
    next.set(parameter.name.name, {
      type: argument,
      substitutions: new Map(isDefault ? next : base),
      resolvingAliases: isDefault ? aliasResolving : baseResolving,
    });
  }
  return next;
}

/**
 * Run a matcher over a written type with its aliases followed and their type parameters bound to
 * the arguments each use supplies.
 */
export function resolvedTypeMatches(
  type: ESTree.TSType,
  environment: TypeAliasEnvironment,
  matcher: ResolvedTypeMatcher,
): boolean {
  const evaluate = (
    current: ESTree.TSType,
    substitutions: Substitutions,
    resolvingAliases: ResolvingAliases,
  ): boolean => {
    if (current.type === "TSTypeReference") {
      const name = typeReferenceName(current);
      if (name !== null) {
        const substitution = substitutions.get(name);
        if (substitution !== undefined && (current.typeArguments?.params.length ?? 0) === 0) {
          // Resume in the argument's own context, so a finite instantiation of an alias that is
          // still being expanded (`Maybe<Maybe<unknown>>`) is not mistaken for recursion.
          return evaluate(substitution.type, substitution.substitutions, substitution.resolvingAliases);
        }
        const alias = visibleTypeAlias(name, current, environment);
        if (alias !== null && !resolvingAliases.has(alias)) {
          const nextResolving = new Set([...resolvingAliases, alias]);
          const nextSubstitutions = aliasSubstitutions(
            alias,
            current,
            substitutions,
            resolvingAliases,
            nextResolving,
          );
          if (nextSubstitutions !== null) {
            return evaluate(alias.typeAnnotation, nextSubstitutions, nextResolving);
          }
        }
      }
    }
    return matcher(current, (child) => evaluate(child, substitutions, resolvingAliases));
  };

  return evaluate(type, new Map(), new Set());
}
