import { defineRule } from "@oxlint/plugins";

import {
  classifyWideningTarget,
  createTypeEnvironment,
  isCertainlyObjectType,
  type TypeEnvironment,
  type WideningTargetKind,
} from "../shared/dictionary-types.ts";
import { isString } from "#src/meta/json-shape.ts";

import { isNode, type KeyedNode, nodeFields } from "../shared/ast-node.ts";
import { resolveVariable } from "../shared/scope.ts";
import { hasVisibleTypeBinding, visibleTypeAlias } from "../shared/type-alias-resolution.ts";

import type { ESTree, SourceCode, Variable } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";

const functionBoundaryTypes = new Set([
  "ArrowFunctionExpression",
  "FunctionDeclaration",
  "FunctionExpression",
  "TSDeclareFunction",
  "TSEmptyBodyFunctionExpression",
]);

/** The expressions that state their own type by being written down. */
const selfEvidentExpressions = new Set([
  "ArrayExpression",
  "ArrowFunctionExpression",
  "ClassExpression",
  "FunctionExpression",
  "Literal",
  "NewExpression",
  "ObjectExpression",
  "TemplateLiteral",
]);

type LocalFunction = ESTree.ArrowFunctionExpression | ESTree.Function;

interface WidenedBinding {
  readonly widening: WideningTargetKind;
  readonly declaredAt: number;
  readonly boundary: ESTree.Node | null;
}

/** This repository's broad JSON types, by the name `src/meta/json-shape.ts` exports them under.
 *  A file imports them, so its own type environment cannot open them, yet each erases a shape as
 *  `unknown` or an open dictionary does. */
const importedWidenings = new Map<string, WideningTargetKind>([
  ["JsonValue", "unknown"],
  ["JsonObject", "open dictionary"],
]);

/** The parsers and printers a JSON round trip goes through, as plain or captured globals. */
const jsonParsers = new Set(["JSON.parse", "capturedJsonParse"]);
const jsonPrinters = new Set(["JSON.stringify", "capturedJsonStringify"]);

/** The reads that hand an element back with `undefined` beside it: an index, or a call that may
 *  find nothing. */
const elementReaders = new Set(["at", "find", "findLast", "get", "pop", "shift"]);

/** What the rule reads of one file: its own type declarations, and the name each imported
 *  binding has where it was exported. */
interface FileTypes {
  readonly environment: TypeEnvironment;
  readonly imports: ReadonlyMap<string, string>;
}

function importedNames(program: ESTree.Program): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type !== "ImportSpecifier") continue;
      const { imported } = specifier;
      names.set(specifier.local.name, imported.type === "Identifier" ? imported.name : imported.value);
    }
  }
  return names;
}

/** The exported name of an imported type this reference spells, through parentheses, `readonly`
 *  and `Readonly`; null where the file declares the name itself or did not import it. */
function importedTypeName(type: ESTree.TSType, types: FileTypes): string | null {
  let current = type;
  for (;;) {
    if (current.type === "TSParenthesizedType") current = current.typeAnnotation;
    else if (current.type === "TSTypeOperator" && current.operator === "readonly") {
      current = current.typeAnnotation;
    } else break;
  }
  if (current.type !== "TSTypeReference" || current.typeName.type !== "Identifier") return null;
  const local = current.typeName.name;
  const wrapped = current.typeArguments?.params[0];
  if (
    local === "Readonly" &&
    wrapped !== undefined &&
    !hasVisibleTypeBinding(local, current, types.environment.typeAliases)
  ) {
    return importedTypeName(wrapped, types);
  }
  const declaredHere =
    types.environment.interfaces.has(local) ||
    visibleTypeAlias(local, current, types.environment.typeAliases) !== null;
  return declaredHere ? null : (types.imports.get(local) ?? null);
}

/** What a written type erases: a widening the file's own declarations show, or one of the
 *  repository's broad JSON types imported from elsewhere. */
function wideningOf(type: ESTree.TSType, types: FileTypes): WideningTargetKind | null {
  const local = classifyWideningTarget(type, types.environment);
  if (local !== null) return local.kind;
  const imported = importedTypeName(type, types);
  return imported === null ? null : (importedWidenings.get(imported) ?? null);
}

/** The expression an assertion or parenthesis chain finally wraps. */
function unwrapExpression(expression: ESTree.Expression): ESTree.Expression {
  let current = expression;
  while (current.type === "ParenthesizedExpression") current = current.expression;
  return current;
}

function assertionFrom(expression: ESTree.Expression): ESTree.TSAsExpression | ESTree.TSTypeAssertion | null {
  const unwrapped = unwrapExpression(expression);
  return unwrapped.type === "TSAsExpression" || unwrapped.type === "TSTypeAssertion" ? unwrapped : null;
}

/** The function this node sits in, or null at module level. Two nodes in different
 *  functions are not one flow: the value crossed a call boundary in between. */
function functionBoundary(node: ESTree.Node): ESTree.Node | null {
  let current = node.parent;
  while (current !== null && current.type !== "Program") {
    if (functionBoundaryTypes.has(current.type)) return current;
    current = current.parent;
  }
  return null;
}

function variableDeclarator(variable: Variable): ESTree.VariableDeclarator | null {
  for (const definition of variable.defs) {
    if (definition.type === "Variable" && definition.node.type === "VariableDeclarator") {
      return definition.node;
    }
  }
  return null;
}

/** A `const` with one initializing write, so the binding holds one value for its whole life. */
function isSingleAssignment(variable: Variable, declarator: ESTree.VariableDeclarator): boolean {
  return (
    declarator.parent.type === "VariableDeclaration" &&
    declarator.parent.kind === "const" &&
    declarator.init !== null &&
    !variable.references.some((reference) => reference.isWrite() && !reference.init)
  );
}

/** True when this expression syntactically establishes its own type. A literal, object,
 *  array, function or `new` does so without naming it; an annotation or an assertion names
 *  it, and only counts when the named type is not itself a widening. */
function hasKnownType(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
  types: FileTypes,
  boundary: ESTree.Node | null,
  visited: ReadonlySet<Variable>,
): boolean {
  const unwrapped = unwrapExpression(expression);

  const assertion = assertionFrom(unwrapped);
  if (assertion !== null) return wideningOf(assertion.typeAnnotation, types) === null;

  if (selfEvidentExpressions.has(unwrapped.type)) return true;
  if (unwrapped.type === "CallExpression") {
    const returnType = localCallee(sourceCode, unwrapped)?.returnType?.typeAnnotation;
    return returnType !== undefined && wideningOf(returnType, types) === null;
  }
  if (unwrapped.type !== "Identifier") return false;

  const variable = resolveVariable(sourceCode, unwrapped);
  if (variable === null || visited.has(variable)) return false;

  const annotated = variable.identifiers.find(
    (identifier) => identifier.typeAnnotation !== null && identifier.typeAnnotation !== undefined,
  );
  const annotation = annotated?.typeAnnotation?.typeAnnotation;
  if (annotation !== undefined && annotated !== undefined) {
    return functionBoundary(annotated) === boundary && wideningOf(annotation, types) === null;
  }

  const declarator = variableDeclarator(variable);
  if (declarator === null) return false;
  if (
    declarator.init === null ||
    !isSingleAssignment(variable, declarator) ||
    functionBoundary(declarator) !== boundary
  ) {
    return false;
  }
  return hasKnownType(sourceCode, declarator.init, types, boundary, new Set([...visited, variable]));
}

/** The function this file declares under a call's callee name, as a function declaration or a
 *  `const` holding a function expression; null for anything imported, computed or rebound. */
function localCallee(sourceCode: SourceCode, call: ESTree.CallExpression): LocalFunction | null {
  if (call.callee.type !== "Identifier") return null;
  const variable = resolveVariable(sourceCode, call.callee);
  const definition = variable?.defs.length === 1 ? variable.defs[0] : undefined;
  if (definition?.node.type === "FunctionDeclaration") return definition.node;
  if (definition?.node.type !== "VariableDeclarator" || variable === null) return null;
  const { init } = definition.node;
  if (init === null || !isSingleAssignment(variable, definition.node)) return null;
  const callee = unwrapExpression(init);
  return callee.type === "ArrowFunctionExpression" || callee.type === "FunctionExpression" ? callee : null;
}

/** Every value a function returns, or null where one return carries none. Nested functions are
 *  other flows and are not entered. */
function returnedValues(
  owner: LocalFunction,
  visitorKeys: SourceCode["visitorKeys"],
): ESTree.Expression[] | null {
  if (owner.body === null) return null;
  if (owner.body.type !== "BlockStatement") return [owner.body];
  const values: ESTree.Expression[] = [];
  let complete = true;
  const visit = (node: KeyedNode): void => {
    if (node.type === "ReturnStatement") {
      if (node.argument === null) complete = false;
      else values.push(node.argument);
      return;
    }
    if (functionBoundaryTypes.has(node.type)) return;
    for (const key of visitorKeys[node.type] ?? []) {
      const child = node[key];
      for (const each of Array.isArray(child) ? child : [child]) if (isNode(each)) visit(each);
    }
  };
  for (const statement of owner.body.body) visit(nodeFields(statement));
  return complete && values.length > 0 ? values : null;
}

/** A call to this file's own function whose declared return type erases what every one of its
 *  returns states: `function opened(): JsonValue { return { project, budget }; }`. */
function wideningCall(
  sourceCode: SourceCode,
  call: ESTree.CallExpression,
  types: FileTypes,
): WideningTargetKind | null {
  const owner = localCallee(sourceCode, call);
  const returnType = owner?.returnType?.typeAnnotation;
  if (owner === null || owner.async || owner.generator || returnType === undefined) return null;
  const widening = wideningOf(returnType, types);
  const values = widening === null ? null : returnedValues(owner, sourceCode.visitorKeys);
  return values?.every((value) => hasKnownType(sourceCode, value, types, owner, new Set())) === true
    ? widening
    : null;
}

/** `JSON.parse(JSON.stringify(known))`: a copy whose printer was handed a known value and whose
 *  parser hands back `any`. */
function isJsonRoundTrip(
  sourceCode: SourceCode,
  call: ESTree.CallExpression,
  types: FileTypes,
  boundary: ESTree.Node | null,
): boolean {
  const printed = call.arguments[0];
  if (
    !jsonParsers.has(sourceCode.getText(call.callee)) ||
    call.arguments.length !== 1 ||
    printed === undefined
  ) {
    return false;
  }
  if (printed.type === "SpreadElement") return false;
  const inner = unwrapExpression(printed);
  const original = inner.type === "CallExpression" ? inner.arguments[0] : undefined;
  return (
    inner.type === "CallExpression" &&
    jsonPrinters.has(sourceCode.getText(inner.callee)) &&
    inner.arguments.length === 1 &&
    original !== undefined &&
    original.type !== "SpreadElement" &&
    hasKnownType(sourceCode, original, types, boundary, new Set())
  );
}

/** What an expression erases of a value its source states, by a call rather than an annotation:
 *  a call to a widening local function, or a JSON round trip. */
function erasingCall(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
  types: FileTypes,
  boundary: ESTree.Node | null,
): WideningTargetKind | null {
  const unwrapped = unwrapExpression(expression);
  if (unwrapped.type !== "CallExpression") return null;
  if (isJsonRoundTrip(sourceCode, unwrapped, types, boundary)) return "any";
  return wideningCall(sourceCode, unwrapped, types);
}

/** A const whose known value was explicitly given a broad type, by annotation, by an assertion on
 *  its initializer, or by the call that produced it. Returns null when the value was never known,
 *  or never widened. */
function widenedBinding(sourceCode: SourceCode, variable: Variable, types: FileTypes): WidenedBinding | null {
  const declarator = variableDeclarator(variable);
  if (declarator === null) return null;
  if (
    declarator.id.type !== "Identifier" ||
    declarator.init === null ||
    !isSingleAssignment(variable, declarator)
  ) {
    return null;
  }

  const boundary = functionBoundary(declarator);
  const declaredType = declarator.id.typeAnnotation?.typeAnnotation;
  if (declaredType === undefined) {
    const erased = erasingCall(sourceCode, declarator.init, types, boundary);
    if (erased !== null) return { widening: erased, declaredAt: declarator.end, boundary };
  }
  const initializerAssertion = assertionFrom(declarator.init);
  const widening =
    (declaredType === undefined ? null : wideningOf(declaredType, types)) ??
    (initializerAssertion === null ? null : wideningOf(initializerAssertion.typeAnnotation, types));
  if (widening === null) return null;

  const original =
    declaredType === undefined && initializerAssertion !== null
      ? unwrapExpression(initializerAssertion.expression)
      : declarator.init;
  return hasKnownType(sourceCode, original, types, boundary, new Set([variable]))
    ? { widening, declaredAt: declarator.end, boundary }
    : null;
}

/** Whether `node` sits inside `boundary`'s function, directly or in a function nested in it. A
 *  const holds one value for its whole life, so a closure that reads it reads the same flow. */
function isWithin(node: ESTree.Node, boundary: ESTree.Node | null): boolean {
  if (boundary === null) return true;
  for (let current = functionBoundary(node); current !== null; current = functionBoundary(current)) {
    if (current === boundary) return true;
  }
  return false;
}

/** Whether an assertion target is an object, as far as this file can tell. A type imported from
 *  elsewhere cannot be opened here; TypeScript refuses to assert an object-typed value to a type
 *  that cannot overlap it, so a compiled assertion from a dictionary to such a name narrows it. */
function isObjectTarget(type: ESTree.TSType, types: FileTypes): boolean {
  return isCertainlyObjectType(type, types.environment) || importedTypeName(type, types) !== null;
}

/** Does asserting to `assertedType` recreate a type the widening erased? Asserting one broad
 *  type to another narrows nothing. `unknown` and `any` erase everything, so any precise type
 *  narrows them; the object-shaped widenings only erase a shape, so `object` back to `string`
 *  changes the kind rather than narrowing it, a different defect and not this rule's. */
function recreatesErasedType(
  widening: WideningTargetKind,
  assertedType: ESTree.TSType,
  types: FileTypes,
): boolean {
  if (wideningOf(assertedType, types) !== null) return false;
  return widening === "any" || widening === "unknown" || isObjectTarget(assertedType, types);
}

/** An element read whose result may be absent: `xs[i]`, `xs.at(-1)`, `queue.shift()`,
 *  `rows.find(...)`, `byId.get(id)`. A computed key that is a string literal is a property read
 *  spelled with brackets, `values["solver-effort"]`, and is left out with `values.solver`. */
function isElementRead(expression: ESTree.Expression): boolean {
  if (expression.type === "MemberExpression") {
    return (
      expression.computed &&
      !expression.optional &&
      !(expression.property.type === "Literal" && isString(expression.property.value))
    );
  }
  if (expression.type !== "CallExpression" || expression.optional) return false;
  const { callee } = expression;
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    !callee.optional &&
    callee.property.type === "Identifier" &&
    elementReaders.has(callee.property.name)
  );
}

/** A target that keeps absence, or names nothing at all, removes no `undefined` from a read. */
function admitsAbsence(type: ESTree.TSType): boolean {
  if (type.type === "TSParenthesizedType") return admitsAbsence(type.typeAnnotation);
  if (type.type === "TSUnionType") return type.types.some(admitsAbsence);
  return (
    type.type === "TSUndefinedKeyword" ||
    type.type === "TSNullKeyword" ||
    type.type === "TSVoidKeyword" ||
    type.type === "TSNeverKeyword"
  );
}

/** Whether an identifier names the parameter of a `catch` clause. */
function isCaughtValue(sourceCode: SourceCode, identifier: ESTree.IdentifierReference): boolean {
  return resolveVariable(sourceCode, identifier)?.defs.some(({ type }) => type === "CatchClause") === true;
}

/**
 * A value the source already described, widened, and a later assertion that puts the description
 * back: `const raw: unknown = { id };` then `raw as Row`.
 *
 * Both halves compile and each one alone looks defensible, which is why the pair survives review.
 * Read together they are a round trip through nothing: the type was known at the declaration, the
 * widening erased it, and the assertion re-states it from memory rather than from evidence. If
 * the value changed in between, the assertion is a guess; if it did not, the widening bought
 * nothing and cost the compiler its knowledge of every use in between.
 *
 * A value is widened by a `const`'s annotation or its initializer's assertion, by a call to a
 * function of this file whose declared return type erases what each of its returns states, or by
 * a JSON round trip of a known value. What erases is `unknown`, `any`, `object` or an open
 * dictionary, and this repository's `JsonValue` and `JsonObject`, which a file imports and its
 * own type environment therefore cannot open. A call to a function of this file whose declared
 * return type is precise states a known value, as a literal does.
 *
 * The flow has to be one flow before any of that is readable. The assertion must come after the
 * declaration in the source, since an assertion above it is about some earlier value. It must sit
 * in the declaration's function or a function nested in it, and the binding must be a `const`
 * that is never written again, so what it holds at the assertion is what the declaration put
 * there. A call widened by its callee is read where it is asserted, `opened() as Opened`.
 *
 * `recreatesErasedType` is what separates a narrowing from a change of subject. Asserting one
 * broad type to another narrows nothing and is not reported. `any` and `unknown` erase
 * everything, so any precise type narrows them back. The object-shaped widenings erase only a
 * shape, so the assertion has to name something that is an object: one this file declares, or a
 * name imported from elsewhere, to which TypeScript would not let a dictionary be asserted unless
 * the two overlap. `object` asserted to `string` is a different defect, and not this rule's.
 * `x as unknown as T` is `no-chained-type-assertions`' and is not read here.
 *
 * Two assertions recreate a type the code could have carried without any widening of its own. An
 * element read, `xs[i]`, `.at()`, `.shift()`, `.pop()`, `.find()`, `.findLast()` or `.get()`,
 * returns its element's type beside `undefined`, which `noUncheckedIndexedAccess` puts there on
 * purpose; asserting it away to a precise type discards that evidence, where a check, a fallback
 * or an iteration keeps the element's own type. A target that keeps `undefined` or `null`, or is
 * itself broad, removes nothing and is left alone, and a string-literal key is a property read.
 * And a caught value is `unknown`, so an assertion on it is a guess that `instanceof` or a record
 * test would make a fact.
 *
 * Read in the census of 8 November and left out, each as the honest boundary: `JSON.parse(...)`,
 * a dynamic `import()` or a host's document asserted to its shape (foreign input, which a parser
 * owns); `Object.fromEntries`, `Object.keys` and a computed key asserted to a typed record (the
 * library's signatures cannot carry the key type); a property read asserted to a literal union,
 * such as a command-line flag (a parser that this file cannot see owns it); a partial object
 * literal asserted to a foreign interface (a test double, or a library that reads two fields of
 * it); and `x as JsonObject` (a broad target narrows nothing this rule can recreate).
 *
 * There is no fix: the repair is to drop the widening, but which of the two annotations states
 * the true type is not readable from the flow alone.
 */
export const noWidenThenAssertRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow assertions that recreate a type the code had: a known value widened and asserted back, an element read asserted present, or a caught value asserted to a type.",
      examples: [
        {
          before: "const raw: unknown = { task, solves: 4 };\nconst start = raw as ComparisonStart;",
          after: "const start: ComparisonStart = { task, solves: 4 };",
        },
        {
          before: "const row: any = { id, outcome };\nappend(row as SolveRow);",
          after: "const row = { id, outcome } satisfies SolveRow;\nappend(row);",
        },
        {
          before:
            'import type { JsonValue } from "#src/meta/json-shape.ts";\nfunction opened(): JsonValue {\n  return { project, budget };\n}\nconst record = opened() as Opened;',
          after: "export function opened(): Opened {\n  return { project, budget };\n}",
        },
        {
          before: "const bottom = pulls[0] as Pull;",
          after: "const bottom = pulls[0] ?? named;",
        },
      ] satisfies RuleExample[],
    },
    messages: {
      widenThenAssert:
        '"{{name}}" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.',
      assertedPresent:
        "An assertion removes the `undefined` this read may return. Check it (`if (x === undefined)`, `?? fallback`) or iterate, so the element keeps its own type.",
      assertedThrown:
        "A caught value is unknown, and an assertion guesses its type. Narrow it instead: `error instanceof Error`, or `isRecord(error)` and its fields.",
    },
  },
  createOnce(context) {
    let types: FileTypes | null = null;

    const checkAssertion = (node: ESTree.TSAsExpression | ESTree.TSTypeAssertion) => {
      if (types === null) return;
      const subject = unwrapExpression(node.expression);
      const boundary = functionBoundary(node);
      if (
        isElementRead(subject) &&
        wideningOf(node.typeAnnotation, types) === null &&
        !admitsAbsence(node.typeAnnotation)
      ) {
        context.report({ node, messageId: "assertedPresent" });
        return;
      }
      if (
        subject.type === "Identifier" &&
        isCaughtValue(context.sourceCode, subject) &&
        wideningOf(node.typeAnnotation, types) === null
      ) {
        context.report({ node, messageId: "assertedThrown" });
        return;
      }
      if (subject.type === "CallExpression") {
        const erased = erasingCall(context.sourceCode, subject, types, boundary);
        if (erased !== null && recreatesErasedType(erased, node.typeAnnotation, types)) {
          context.report({
            node,
            messageId: "widenThenAssert",
            data: { name: context.sourceCode.getText(subject.callee) },
          });
        }
        return;
      }
      if (subject.type !== "Identifier") return;

      const variable = resolveVariable(context.sourceCode, subject);
      if (variable === null) return;
      const binding = widenedBinding(context.sourceCode, variable, types);
      if (
        binding === null ||
        // An assertion textually before the widening is a different flow.
        node.start <= binding.declaredAt ||
        !isWithin(node, binding.boundary) ||
        !recreatesErasedType(binding.widening, node.typeAnnotation, types)
      ) {
        return;
      }

      context.report({ node, messageId: "widenThenAssert", data: { name: subject.name } });
    };

    return {
      Program(node) {
        types = {
          environment: createTypeEnvironment(node, context.sourceCode.visitorKeys),
          imports: importedNames(node),
        };
      },
      TSAsExpression: checkAssertion,
      TSTypeAssertion: checkAssertion,
    };
  },
});
