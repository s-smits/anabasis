import type { ESTree } from "@oxlint/plugins";

import { isNode, nodeFields } from "./ast-node.ts";
import { lexicalTypeParameterNames } from "./lexical-type-parameters.ts";

type VisitorKeys = Readonly<Record<string, readonly string[]>>;
type TypeScope = ESTree.Node;

type TypeBinding = {
  readonly alias: ESTree.TSTypeAliasDeclaration | null;
  readonly name: string;
  readonly scope: TypeScope;
};

type Substitution = {
  readonly substitutions: Substitutions;
  readonly type: ESTree.TSType;
};

type Substitutions = ReadonlyMap<string, Substitution>;

export type TypeAliasEnvironment = {
  readonly aliases: readonly ESTree.TSTypeAliasDeclaration[];
  readonly bindingsByName: ReadonlyMap<string, readonly TypeBinding[]>;
  readonly visitorKeys: VisitorKeys;
};

type ResolvedTypeMatcher = (type: ESTree.TSType, matches: (child: ESTree.TSType) => boolean) => boolean;

const environmentsByProgram = new WeakMap<ESTree.Program, TypeAliasEnvironment>();

function enclosingTypeScope(node: ESTree.Node): TypeScope {
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
 *
 * A lint plugin sees syntax and never the checker, so "what does this annotation mean" can only
 * be answered from the file's own declarations. That is what this collects: the aliases, so a
 * name can be followed to the type it stands for, and the interfaces, enums, classes and imports
 * beside them, so a name that is declared but not followable is still known to be taken. Both
 * halves matter — the second is how `hasVisibleTypeBinding` tells a local `Record` from the
 * built-in one.
 *
 * The result is cached per `Program` in a `WeakMap`, because several rules ask for it on the same
 * file in one run and the walk is over the whole tree.
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
 *
 * Null in three cases, and each is a refusal rather than a miss. A name a type parameter is
 * binding is that parameter's, whatever the module declares. A name nothing declares is a
 * built-in or an ambient, which this environment cannot see into. And a name whose nearest
 * declarations tie — two bindings at the same scope distance — stands for no single thing here,
 * so resolving it would pick one of them by collection order.
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
 * Whether the name is taken where it is used — which is how a rule tells a local `Record` or
 * `Array` from the built-in of the same name.
 *
 * Any binding counts and it need not be followable: an interface, an enum, a class or an import
 * shadows the built-in exactly as an alias does, and a type parameter in scope shadows it too. All
 * the asking rule needs to know is that the name is somebody else's here, so the built-in's
 * meaning cannot be assumed.
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

/** The identifier a type reference names, or null where it is qualified — `A.B` names no
 *  single binding this environment can look up. Three modules ask it. */
export function typeReferenceName(type: ESTree.TSTypeReference): string | null {
  return type.typeName.type === "Identifier" ? type.typeName.name : null;
}

function aliasSubstitutions(
  alias: ESTree.TSTypeAliasDeclaration,
  reference: ESTree.TSTypeReference,
  base: Substitutions,
): Substitutions | null {
  const parameters = alias.typeParameters?.params ?? [];
  const arguments_ = reference.typeArguments?.params ?? [];
  const next = new Map(base);
  for (const [index, parameter] of parameters.entries()) {
    const explicitArgument = arguments_[index];
    const argument = explicitArgument ?? parameter.default;
    if (argument === null) return null;
    const argumentSubstitutions = explicitArgument === undefined ? next : base;
    next.set(parameter.name.name, {
      type: argument,
      substitutions: new Map(argumentSubstitutions),
    });
  }
  return next;
}

/**
 * Run a matcher over a written type with its aliases followed and their type parameters bound to
 * the arguments each use supplies.
 *
 * The matcher decides the leaves and the walk decides everything else, which is why the three
 * rules that use it — `no-unknown-returns`, `no-unknown-type-aliases`, `no-object-parameters` —
 * differ only in what they recognise once they get there. Each one is handed the resolved type
 * and a `matches` callback, so it can recurse into a union or an array without knowing anything
 * about substitutions.
 *
 * `resolvingAliases` is what stops a self-referential alias from recurring forever, and
 * `aliasSubstitutions` refuses outright when a parameter has neither an argument at this use nor
 * a default: an alias applied with the wrong arity does not denote anything, and guessing at it
 * would resolve a name to a type nobody wrote.
 */
export function resolvedTypeMatches(
  type: ESTree.TSType,
  environment: TypeAliasEnvironment,
  matcher: ResolvedTypeMatcher,
): boolean {
  const evaluate = (
    current: ESTree.TSType,
    substitutions: Substitutions,
    resolvingAliases: ReadonlySet<ESTree.TSTypeAliasDeclaration>,
  ): boolean => {
    if (current.type === "TSTypeReference") {
      const name = typeReferenceName(current);
      if (name !== null) {
        const substitution = substitutions.get(name);
        if (substitution !== undefined && (current.typeArguments?.params.length ?? 0) === 0) {
          return evaluate(substitution.type, substitution.substitutions, resolvingAliases);
        }
        const alias = visibleTypeAlias(name, current, environment);
        if (alias !== null && !resolvingAliases.has(alias)) {
          const nextSubstitutions = aliasSubstitutions(alias, current, substitutions);
          if (nextSubstitutions !== null) {
            const nextResolving = new Set(resolvingAliases);
            nextResolving.add(alias);
            return evaluate(alias.typeAnnotation, nextSubstitutions, nextResolving);
          }
        }
      }
    }
    return matcher(current, (child) => evaluate(child, substitutions, resolvingAliases));
  };

  return evaluate(type, new Map(), new Set());
}
