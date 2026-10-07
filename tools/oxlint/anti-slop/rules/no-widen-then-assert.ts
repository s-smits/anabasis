import { defineRule } from "@oxlint/plugins";

import {
  classifyWideningTarget,
  createTypeEnvironment,
  isCertainlyObjectType,
  type TypeEnvironment,
  type WideningTargetKind,
} from "../shared/dictionary-types.ts";
import { resolveVariable } from "../shared/scope.ts";

import type { ESTree, SourceCode, Variable } from "@oxlint/plugins";

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

type WidenedBinding = {
  readonly widening: WideningTargetKind;
  readonly declaredAt: number;
  readonly boundary: ESTree.Node | null;
};

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
  environment: TypeEnvironment,
  boundary: ESTree.Node | null,
  visited: ReadonlySet<Variable>,
): boolean {
  const unwrapped = unwrapExpression(expression);

  const assertion = assertionFrom(unwrapped);
  if (assertion !== null) {
    return classifyWideningTarget(assertion.typeAnnotation, environment) === null;
  }

  if (selfEvidentExpressions.has(unwrapped.type)) return true;
  if (unwrapped.type !== "Identifier") return false;

  const variable = resolveVariable(sourceCode, unwrapped);
  if (variable === null || visited.has(variable)) return false;

  const annotated = variable.identifiers.find(
    (identifier) => identifier.typeAnnotation !== null && identifier.typeAnnotation !== undefined,
  );
  const annotation = annotated?.typeAnnotation?.typeAnnotation;
  if (annotation !== undefined && annotated !== undefined) {
    return (
      functionBoundary(annotated) === boundary && classifyWideningTarget(annotation, environment) === null
    );
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
  return hasKnownType(sourceCode, declarator.init, environment, boundary, new Set([...visited, variable]));
}

/** A const whose known value was explicitly given a broad type, by annotation or by an
 *  assertion on its initializer. Returns null when the value was never known, or never widened. */
function widenedBinding(
  sourceCode: SourceCode,
  variable: Variable,
  environment: TypeEnvironment,
): WidenedBinding | null {
  const declarator = variableDeclarator(variable);
  if (declarator === null) return null;
  if (
    declarator.id.type !== "Identifier" ||
    declarator.init === null ||
    !isSingleAssignment(variable, declarator)
  ) {
    return null;
  }

  const declaredType = declarator.id.typeAnnotation?.typeAnnotation;
  const initializerAssertion = assertionFrom(declarator.init);
  const widening =
    (declaredType === undefined ? null : classifyWideningTarget(declaredType, environment)) ??
    (initializerAssertion === null
      ? null
      : classifyWideningTarget(initializerAssertion.typeAnnotation, environment));
  if (widening === null) return null;

  const boundary = functionBoundary(declarator);
  const original =
    declaredType === undefined && initializerAssertion !== null
      ? unwrapExpression(initializerAssertion.expression)
      : declarator.init;
  return hasKnownType(sourceCode, original, environment, boundary, new Set([variable]))
    ? { widening: widening.kind, declaredAt: declarator.end, boundary }
    : null;
}

/** Does asserting to `assertedType` recreate a type the widening erased? Asserting one broad
 *  type to another narrows nothing. `unknown` and `any` erase everything, so any precise type
 *  narrows them; the object-shaped widenings only erase a shape, so `object` back to `string`
 *  changes the kind rather than narrowing it — a different defect, and not this rule's. */
function recreatesErasedType(
  widening: WideningTargetKind,
  assertedType: ESTree.TSType,
  environment: TypeEnvironment,
): boolean {
  if (classifyWideningTarget(assertedType, environment) !== null) return false;
  return widening === "any" || widening === "unknown" || isCertainlyObjectType(assertedType, environment);
}

/**
 * A `const` that widens a value the source already described, and a later assertion on that same
 * binding that puts the description back: `const raw: unknown = { id };` then `raw as Row`.
 *
 * Both halves compile and each one alone looks defensible, which is why the pair survives review.
 * Read together they are a round trip through nothing: the type was known at the declaration, the
 * annotation erased it, and the assertion re-states it from memory rather than from evidence. If
 * the value changed in between, the assertion is a guess; if it did not, the widening bought
 * nothing and cost the compiler its knowledge of every use in between.
 *
 * The flow has to be one flow before any of that is readable, so three conditions bound it. The
 * assertion must come after the declaration in the source, since an assertion above it is about
 * some earlier value. It must sit in the same function, because a value crossing a call boundary
 * is no longer this binding's flow. And the binding must be a `const` that is never written
 * again, so what it holds at the assertion is what the declaration put there.
 *
 * `recreatesErasedType` is what separates a narrowing from a change of subject. Asserting one
 * broad type to another narrows nothing and is not reported. `any` and `unknown` erase
 * everything, so any precise type narrows them back. The object-shaped widenings erase only a
 * shape, so the assertion has to name something that is certainly an object — `object` asserted
 * to `string` is a different defect, and not this rule's.
 *
 * There is no fix: the repair is to drop the widening, but which of the two annotations states
 * the true type is not readable from the flow alone.
 */
export const noWidenThenAssertRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow local const flows that explicitly widen a known value before asserting the widened binding to a narrower type.",
    },
    messages: {
      widenThenAssert:
        'Binding "{{name}}" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.',
    },
  },
  createOnce(context) {
    let environment: TypeEnvironment | null = null;

    const checkAssertion = (node: ESTree.TSAsExpression | ESTree.TSTypeAssertion) => {
      if (environment === null) return;
      const subject = unwrapExpression(node.expression);
      if (subject.type !== "Identifier") return;

      const variable = resolveVariable(context.sourceCode, subject);
      if (variable === null) return;
      const binding = widenedBinding(context.sourceCode, variable, environment);
      if (
        binding === null ||
        // An assertion textually before the widening is a different flow.
        node.start <= binding.declaredAt ||
        functionBoundary(node) !== binding.boundary ||
        !recreatesErasedType(binding.widening, node.typeAnnotation, environment)
      ) {
        return;
      }

      context.report({ node, messageId: "widenThenAssert", data: { name: subject.name } });
    };

    return {
      Program(node) {
        environment = createTypeEnvironment(node, context.sourceCode.visitorKeys);
      },
      TSAsExpression: checkAssertion,
      TSTypeAssertion: checkAssertion,
    };
  },
});
