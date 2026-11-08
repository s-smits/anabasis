import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

import {
  createTypeAliasEnvironment,
  hasVisibleTypeBinding,
  resolvedTypeMatches,
  type TypeAliasEnvironment,
  typeReferenceName,
} from "../shared/type-alias-resolution.ts";
import { lexicalTypeParameterNames } from "../shared/lexical-type-parameters.ts";
import type { RuleExample } from "../../rule-examples.ts";

type DeclaredType = ESTree.TSInterfaceDeclaration | ESTree.TSTypeAliasDeclaration;

/** What a walk over the types an export hands out does at each property and each named type. */
interface Outward {
  /** Judges a property; true walks on into its type. */
  readonly property: (member: ESTree.TSPropertySignature) => boolean;
  readonly reference: (reference: ESTree.TSTypeReference) => void;
}

/**
 * The built-in containers that hand their reader a value, and which type argument that value is:
 * an array's element, a promise's result, a map's value. A `Set<unknown>` is left out on purpose:
 * it is asked only whether it holds a value nothing has parsed yet (`CUT.has(data.ended)`).
 */
const CONTAINER_SLOTS: ReadonlyMap<string, number> = new Map([
  ["Array", 0],
  ["ReadonlyArray", 0],
  ["Promise", 0],
  ["PromiseLike", 0],
  ["Map", 1],
  ["ReadonlyMap", 1],
  ["WeakMap", 1],
]);

/** The members a declaration writes in its own body: an interface's, or a type literal an alias names. */
function ownMembers(declared: DeclaredType): readonly ESTree.TSSignature[] {
  if (declared.type === "TSInterfaceDeclaration") return declared.body.body;
  return declared.typeAnnotation.type === "TSTypeLiteral" ? declared.typeAnnotation.members : [];
}

/** The written name of a member's key, or null where it is computed. */
function memberName(member: ESTree.TSPropertySignature): string | null {
  if (member.computed) return null;
  if (member.key.type === "Identifier") return member.key.name;
  return member.key.type === "Literal" ? String(member.key.value) : null;
}

/** A tuple member's type, past the label, `?` or `...` it may be spelled with. */
function tupleElement(element: ESTree.TSTupleElement): ESTree.TSType {
  const written = element.type === "TSNamedTupleMember" ? element.elementType : element;
  return written.type === "TSOptionalType" || written.type === "TSRestType"
    ? written.typeAnnotation
    : written;
}

/** Whether another module can name it: `export`, or a default export. */
function isExported(node: ESTree.Node): boolean {
  return node.parent?.type === "ExportNamedDeclaration" || node.parent?.type === "ExportDefaultDeclaration";
}

/** The interfaces and aliases a module declares at its top level without exporting them. */
function moduleLocalTypes(program: ESTree.Program): Map<string, readonly DeclaredType[]> {
  const locals = new Map<string, DeclaredType[]>();
  for (const statement of program.body) {
    if (statement.type !== "TSInterfaceDeclaration" && statement.type !== "TSTypeAliasDeclaration") continue;
    locals.set(statement.id.name, [...(locals.get(statement.id.name) ?? []), statement]);
  }
  return locals;
}

/** Walk every type a value of this type hands its reader: all of it but a function's parameters. */
function walkOutward(type: ESTree.TSType, on: Outward): void {
  if (type.type === "TSTypeReference") {
    on.reference(type);
    for (const argument of type.typeArguments?.params ?? []) walkOutward(argument, on);
  } else if (type.type === "TSUnionType" || type.type === "TSIntersectionType") {
    for (const member of type.types) walkOutward(member, on);
  } else if (type.type === "TSArrayType") {
    walkOutward(type.elementType, on);
  } else if (type.type === "TSTypeOperator" || type.type === "TSParenthesizedType") {
    walkOutward(type.typeAnnotation, on);
  } else if (type.type === "TSTupleType") {
    for (const element of type.elementTypes) walkOutward(tupleElement(element), on);
  } else if (type.type === "TSTypeLiteral") {
    walkMembers(type.members, on);
  } else if (type.type === "TSFunctionType") {
    walkOutward(type.returnType.typeAnnotation, on);
  }
}

function walkMembers(members: readonly ESTree.TSSignature[], on: Outward): void {
  for (const member of members) {
    if (member.type === "TSPropertySignature") {
      const type = member.typeAnnotation?.typeAnnotation;
      if (on.property(member) && type !== undefined) walkOutward(type, on);
    } else if (member.type === "TSMethodSignature" || member.type === "TSCallSignatureDeclaration") {
      const returned = member.returnType?.typeAnnotation;
      if (returned !== undefined) walkOutward(returned, on);
    } else if (member.type === "TSIndexSignature") {
      walkOutward(member.typeAnnotation.typeAnnotation, on);
    }
  }
}

function walkDeclared(declared: DeclaredType, on: Outward): void {
  if (declared.type === "TSInterfaceDeclaration") walkMembers(declared.body.body, on);
  else walkOutward(declared.typeAnnotation, on);
}

/** A class member another module can read: not `private`, `protected` or `#private`. */
function isPublic(element: ESTree.PropertyDefinition | ESTree.MethodDefinition): boolean {
  return (
    element.key.type !== "PrivateIdentifier" &&
    element.accessibility !== "private" &&
    element.accessibility !== "protected"
  );
}

/**
 * A named type that stands where `unknown` or `any` is, directly or through other aliases.
 *
 * The other `unknown` rules — `no-unknown-returns`, `unproven-unknown-parameter`,
 * `no-unsafe-dictionary-type` — all read a written annotation, and a name is the one move that
 * takes the word out of the annotation without taking the top type out of the program. `type
 * Payload = unknown` reads at every use as though someone had decided something. This rule is
 * what stops the rest of the set being answered by a rename. It reports five places:
 *
 * - an alias whose type resolves to `unknown` or `any`, or to a container handing one out: an
 *   array, readonly array or tuple element (`type Rows = unknown[]`), a `Promise` or `PromiseLike`
 *   result, or a `Map`, `ReadonlyMap` or `WeakMap` value; alone or as a member of a union;
 * - a property of an exported interface, or of the type literal an exported alias names, whose type
 *   resolves the same way, nested type literals included (`export interface Request { artifact:
 *   unknown }`);
 * - a public field of an exported class, typed the same way;
 * - a property of a module-local interface or alias that an export hands out: named in an exported
 *   function's or public method's return type, an exported variable's annotation, or an exported
 *   type's or another such local's members (`resolveJsonPath` returning its local result type);
 * - a type parameter default of an exported interface or alias that resolves the same way
 *   (`export interface Evidence<D = unknown>`), which every bare use of the name inherits.
 *
 * The resolution follows aliases through aliases, through parentheses, and into any member of a
 * union, so `type A = B`, `type B = unknown | Other` is reported at `A` as well as at `B`. It
 * stops where the name is not the alias it looks like: `visibleTypeAlias` walks out to the
 * nearest scope that declares the name, refuses to resolve one a type parameter is binding, and
 * refuses again when two declarations of the name tie at the same distance, because there is then
 * no single thing the name stands for. A member check reads the declaration's own body only: a reference
 * to another generic type (`Tree<unknown>`) is that type's business and is not opened.
 *
 * Members are judged only on exported types, and that is how foreign input is told apart. A
 * module-local interface whose fields stay `unknown` until a predicate reads them (the hook input
 * of `tools/wri/lane-guard.ts`) has every reader in the same file, beside the parse; an exported
 * one is a contract read in other modules, where nothing shows whether anything parsed it, and
 * there the reader guesses (two `as JsonValue` assertions read `EvaluationRequest` before its
 * members were given their type). A local type an export only takes in, as a parameter, stays a
 * boundary: the hook's stdin, a provider's payload and parsed JSON arrive `unknown` and are read
 * where they arrive. A `Set<unknown>` and a map's key are only asked whether they hold a value, so
 * neither hides one. A `cause` member is exempt, as the message says.
 *
 * Narrowed out as other rules' or out of reach: `Record<K, unknown>` with any key, and a
 * `[key: string]: unknown` index signature, are `no-unsafe-dictionary-type`'s, which judges the
 * value whatever the key; `ReturnType<typeof f>` and `Parameters<F>` resolve only in the checker,
 * and where `F` is written as a function type its return is `no-unknown-returns`'.
 *
 * A function type returning `unknown` (`type Read = () => unknown`) is `no-unknown-returns`'s, and
 * an `unknown` parameter in one is an input, so neither is judged here.
 *
 * `unknown` itself is not banned, only the name hiding it. The message says where it stays legal:
 * at a parsing boundary, where the value genuinely has not been read yet, and on a `cause` field.
 * Both of those are written `unknown` at the site, which is the point — the reader sees the top
 * type where it is.
 *
 * There is no fix: the repair is the type the name was avoiding, and a name exists because
 * someone did not want to write it.
 */
export const noUnknownTypeAliasesRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow named types that resolve to unknown or any: an alias, an exported type's member or class field, a local type an export hands out, or an exported type parameter default.",
      examples: [
        {
          before: "type Payload = unknown;",
          after: "type Payload = SolveStarted | SolveFinished;",
        },
        {
          before: "type Answer = AnswerFile | unknown;",
          after: "type Answer = AnswerFile | null;",
        },
        {
          before: "export interface Request {\n  artifact: unknown;\n}",
          after: "export interface Request {\n  artifact: JsonValue;\n}",
        },
      ] satisfies RuleExample[],
    },
    messages: {
      unknownAlias:
        "Type alias `{{alias}}` hides `unknown`. Keep `unknown` explicit at the parsing boundary or on an allowed `cause` field; otherwise use the parsed owner type.",
      unknownMember:
        "Member `{{member}}` of the exported type `{{declared}}` hides `unknown`, and every module that reads it has to guess. Give it the type it holds, or parse it where it arrives and keep the type local.",
      unknownLeak:
        "Member `{{member}}` hides `unknown`, and `{{via}}` hands this module-local type to other modules, which have to guess. Give it the type it holds, or keep the value inside this module.",
      unknownDefault:
        "Type parameter `{{parameter}}` of the exported type `{{declared}}` defaults to `unknown`, so every bare use of `{{declared}}` hides it. Default it to the type it holds, or write the argument at each use.",
    },
  },
  createOnce(context) {
    let environment: TypeAliasEnvironment | null = null;
    let locals = new Map<string, readonly DeclaredType[]>();
    const reached = new Set<DeclaredType>();

    const hidesUnknown = (type: ESTree.TSType): boolean =>
      environment !== null &&
      resolvedTypeMatches(type, environment, (resolved, matches) => {
        if (resolved.type === "TSUnknownKeyword" || resolved.type === "TSAnyKeyword") return true;
        if (resolved.type === "TSParenthesizedType") return matches(resolved.typeAnnotation);
        if (resolved.type === "TSUnionType") return resolved.types.some(matches);
        if (resolved.type === "TSArrayType") return matches(resolved.elementType);
        if (resolved.type === "TSTypeOperator") {
          return resolved.operator === "readonly" && matches(resolved.typeAnnotation);
        }
        if (resolved.type === "TSTupleType") {
          return resolved.elementTypes.some((element) => matches(tupleElement(element)));
        }
        if (resolved.type !== "TSTypeReference" || environment === null) return false;
        const name = typeReferenceName(resolved);
        const slot = name === null ? undefined : CONTAINER_SLOTS.get(name);
        const held = slot === undefined ? undefined : resolved.typeArguments?.params[slot];
        return (
          name !== null &&
          held !== undefined &&
          !hasVisibleTypeBinding(name, resolved, environment) &&
          matches(held)
        );
      });

    const checkMembers = (declared: DeclaredType, members: readonly ESTree.TSSignature[]): void => {
      for (const member of members) {
        if (member.type !== "TSPropertySignature" || member.typeAnnotation === null) continue;
        const name = memberName(member);
        if (name === "cause") continue;
        const type = member.typeAnnotation.typeAnnotation;
        if (hidesUnknown(type)) {
          context.report({
            node: member.key,
            messageId: "unknownMember",
            data: { member: name ?? "[computed]", declared: declared.id.name },
          });
        } else if (type.type === "TSTypeLiteral") {
          checkMembers(declared, type.members);
        }
      }
    };

    // A module-local type named where an export hands a value out is read in other modules too:
    // its members are judged as an exported type's are, and so are the local types it names.
    const leakedThrough = (via: string): Outward => {
      const outward: Outward = {
        property: (member) => {
          const name = memberName(member);
          const type = member.typeAnnotation?.typeAnnotation;
          if (name === "cause" || type === undefined || !hidesUnknown(type)) return true;
          context.report({
            node: member.key,
            messageId: "unknownLeak",
            data: { member: name ?? "[computed]", via },
          });
          return false;
        },
        reference: (reference) => {
          const name = typeReferenceName(reference);
          const declared = name === null ? undefined : locals.get(name);
          if (name === null || declared === undefined) return;
          if (lexicalTypeParameterNames(reference, context.sourceCode.visitorKeys).has(name)) return;
          for (const local of declared) {
            if (reached.has(local)) continue;
            reached.add(local);
            walkDeclared(local, outward);
          }
        },
      };
      return outward;
    };
    const exportedOutward = (via: string): Outward => ({
      property: () => true,
      reference: leakedThrough(via).reference,
    });

    const checkExported = (declared: DeclaredType): void => {
      if (!isExported(declared)) return;
      for (const parameter of declared.typeParameters?.params ?? []) {
        if (parameter.default === null || !hidesUnknown(parameter.default)) continue;
        context.report({
          node: parameter,
          messageId: "unknownDefault",
          data: { parameter: parameter.name.name, declared: declared.id.name },
        });
      }
      checkMembers(declared, ownMembers(declared));
      walkDeclared(declared, exportedOutward(declared.id.name));
    };

    const checkFunction = (node: ESTree.Function | ESTree.ArrowFunctionExpression, via: string): void => {
      const returned = node.returnType?.typeAnnotation;
      if (returned !== undefined) walkOutward(returned, exportedOutward(via));
    };

    const checkClass = (node: ESTree.Class): void => {
      if (node.id === null || !isExported(node)) return;
      const via = node.id.name;
      for (const element of node.body.body) {
        if (element.type === "MethodDefinition") {
          if (isPublic(element)) checkFunction(element.value, via);
          continue;
        }
        if (element.type !== "PropertyDefinition" && element.type !== "TSAbstractPropertyDefinition") {
          continue;
        }
        const type = element.typeAnnotation?.typeAnnotation;
        if (!isPublic(element) || type === undefined || element.key.type !== "Identifier") continue;
        if (element.key.name === "cause") continue;
        if (hidesUnknown(type)) {
          context.report({
            node: element.key,
            messageId: "unknownMember",
            data: { member: element.key.name, declared: via },
          });
        } else {
          walkOutward(type, exportedOutward(via));
        }
      }
    };

    return {
      Program(node) {
        environment = createTypeAliasEnvironment(node, context.sourceCode.visitorKeys);
        locals = moduleLocalTypes(node);
        reached.clear();
      },
      TSInterfaceDeclaration: checkExported,
      TSTypeAliasDeclaration(node) {
        if (hidesUnknown(node.typeAnnotation)) {
          context.report({
            node: node.id,
            messageId: "unknownAlias",
            data: { alias: node.id.name },
          });
        }
        checkExported(node);
      },
      ClassDeclaration: checkClass,
      FunctionDeclaration(node) {
        if (isExported(node)) checkFunction(node, node.id?.name ?? "default");
      },
      VariableDeclarator(node) {
        const declaration = node.parent;
        if (declaration.type !== "VariableDeclaration" || !isExported(declaration)) return;
        if (node.id.type !== "Identifier") return;
        const via = node.id.name;
        const annotated = node.id.typeAnnotation?.typeAnnotation;
        if (annotated !== undefined) walkOutward(annotated, exportedOutward(via));
        const init = node.init;
        if (init?.type === "ArrowFunctionExpression" || init?.type === "FunctionExpression") {
          checkFunction(init, via);
        }
      },
    };
  },
});
