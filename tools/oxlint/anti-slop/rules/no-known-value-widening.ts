import { defineRule } from "@oxlint/plugins";

import {
  classifyUnsafeDictionaryValue,
  classifyWideningTarget,
  createTypeEnvironment,
  isKnownEvidenceExpression,
  type TypeEnvironment,
  type WideningTarget,
} from "../shared/dictionary-types.ts";
import {
  containsUnknownType,
  functionParameterBindingName,
  functionParameterTypeAnnotation,
} from "../shared/function-parameters.ts";
import { resolveVariable } from "../shared/scope.ts";

import type { ESTree, SourceCode, Variable } from "@oxlint/plugins";

type FunctionExpression = ESTree.ArrowFunctionExpression | ESTree.Function;

function unwrapExpression(expression: ESTree.Expression): ESTree.Expression {
  let current = expression;
  while (
    current.type === "ParenthesizedExpression" ||
    current.type === "TSAsExpression" ||
    current.type === "TSSatisfiesExpression" ||
    current.type === "TSTypeAssertion" ||
    current.type === "TSNonNullExpression"
  ) {
    current = current.expression;
  }
  return current;
}

function variableDeclarator(variable: Variable): ESTree.VariableDeclarator | null {
  if (variable.defs.length !== 1) return null;
  const [definition] = variable.defs;
  return definition?.type === "Variable" && definition.node.type === "VariableDeclarator"
    ? definition.node
    : null;
}

function isStableConstVariable(variable: Variable, declarator: ESTree.VariableDeclarator): boolean {
  return (
    declarator.parent.type === "VariableDeclaration" &&
    declarator.parent.kind === "const" &&
    variable.references.every((reference) => reference.init || !reference.isWrite())
  );
}

function hasKnownEvidence(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
  visitedVariables = new Set<Variable>(),
): boolean {
  if (isKnownEvidenceExpression(expression)) return true;
  const unwrapped = unwrapExpression(expression);
  if (unwrapped.type !== "Identifier") return false;
  const variable = resolveVariable(sourceCode, unwrapped);
  if (variable === null || visitedVariables.has(variable)) return false;
  const declarator = variableDeclarator(variable);
  if (declarator === null) return false;
  if (declarator.init === null || !isStableConstVariable(variable, declarator)) return false;
  visitedVariables.add(variable);
  return hasKnownEvidence(sourceCode, declarator.init, visitedVariables);
}

function isFunctionExpression(node: ESTree.Node): node is FunctionExpression {
  return (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "TSDeclareFunction" ||
    node.type === "TSEmptyBodyFunctionExpression"
  );
}

function localFunctionForCall(sourceCode: SourceCode, callee: ESTree.Expression): FunctionExpression | null {
  const unwrapped = unwrapExpression(callee);
  if (isFunctionExpression(unwrapped)) return unwrapped;
  if (unwrapped.type !== "Identifier") return null;
  const variable = resolveVariable(sourceCode, unwrapped);
  if (variable?.defs.length !== 1) return null;
  const [definition] = variable.defs;
  if (definition === undefined) return null;
  if (definition.type === "FunctionName" && isFunctionExpression(definition.node)) {
    return definition.node;
  }
  if (definition.type !== "Variable" || definition.node.type !== "VariableDeclarator") {
    return null;
  }
  const initializer = definition.node.init;
  if (initializer === null) return null;
  const unwrappedInitializer = unwrapExpression(initializer);
  return isFunctionExpression(unwrappedInitializer) ? unwrappedInitializer : null;
}

function variableTypeAnnotation(sourceCode: SourceCode, variable: Variable): ESTree.TSTypeAnnotation | null {
  if (variable.defs.length !== 1) return null;
  const [definition] = variable.defs;
  if (definition === undefined) return null;
  if (
    definition.type === "Variable" &&
    definition.node.type === "VariableDeclarator" &&
    definition.node.id.type === "Identifier"
  ) {
    return definition.node.id.typeAnnotation ?? null;
  }
  if (definition.type !== "Parameter" || !isFunctionExpression(definition.node)) {
    return null;
  }
  const parameter = definition.node.params.find(
    (candidate) => functionParameterBindingName(candidate, sourceCode) === variable.name,
  );
  return parameter === undefined ? null : (functionParameterTypeAnnotation(parameter) ?? null);
}

function hasInformativeType(type: ESTree.TSType, environment: TypeEnvironment): boolean {
  return classifyUnsafeDictionaryValue(type, environment) === null;
}

function hasKnownCallArgumentEvidence(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
  environment: TypeEnvironment,
  visitedVariables = new Set<Variable>(),
): boolean {
  if (expression.type === "ParenthesizedExpression" || expression.type === "TSNonNullExpression") {
    return hasKnownCallArgumentEvidence(sourceCode, expression.expression, environment, visitedVariables);
  }
  if (expression.type === "TSAsExpression" || expression.type === "TSTypeAssertion") {
    return hasInformativeType(expression.typeAnnotation, environment);
  }
  if (expression.type === "TSSatisfiesExpression") {
    return hasKnownCallArgumentEvidence(sourceCode, expression.expression, environment, visitedVariables);
  }
  if (expression.type === "CallExpression") {
    const owner = localFunctionForCall(sourceCode, expression.callee);
    const returnType = owner?.returnType?.typeAnnotation;
    return returnType !== undefined && hasInformativeType(returnType, environment);
  }
  if (expression.type !== "Identifier") return isKnownEvidenceExpression(expression);
  const variable = resolveVariable(sourceCode, expression);
  if (variable === null || visitedVariables.has(variable)) return false;
  const annotation = variableTypeAnnotation(sourceCode, variable);
  if (annotation !== null) {
    return hasInformativeType(annotation.typeAnnotation, environment);
  }
  const declarator = variableDeclarator(variable);
  if (declarator === null) return false;
  if (declarator.init === null || !isStableConstVariable(variable, declarator)) return false;
  visitedVariables.add(variable);
  return hasKnownCallArgumentEvidence(sourceCode, declarator.init, environment, visitedVariables);
}

function typePredicateSubjectIndex(sourceCode: SourceCode, owner: FunctionExpression): number | null {
  const predicate = owner.returnType?.typeAnnotation;
  if (predicate?.type !== "TSTypePredicate" || predicate.parameterName.type !== "Identifier") {
    return null;
  }
  const predicateParameterName = predicate.parameterName.name;
  const index = owner.params.findIndex(
    (parameter) => functionParameterBindingName(parameter, sourceCode) === predicateParameterName,
  );
  return index === -1 ? null : index;
}

function annotationTarget(
  annotation: ESTree.TSTypeAnnotation | null | undefined,
  environment: TypeEnvironment,
): WideningTarget | null {
  return annotation === null || annotation === undefined
    ? null
    : classifyWideningTarget(annotation.typeAnnotation, environment);
}

function enclosingFunction(node: ESTree.Node): FunctionExpression | null {
  let current: ESTree.Node | null = node.parent;
  while (current !== null && current.type !== "Program") {
    if (
      current.type === "ArrowFunctionExpression" ||
      current.type === "FunctionDeclaration" ||
      current.type === "FunctionExpression"
    ) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

function sourceKeyName(sourceCode: SourceCode, key: ESTree.PropertyKey): string {
  if (key.type === "Identifier" || key.type === "PrivateIdentifier") return key.name;
  if (key.type === "Literal") return String(key.value);
  return sourceCode.getText(key);
}

function functionName(sourceCode: SourceCode, owner: FunctionExpression | null): string {
  if (owner === null) return "anonymous function";
  if (owner.id !== null) return owner.id.name;
  const { parent } = owner;
  if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier") {
    return parent.id.name;
  }
  if (parent.type === "MethodDefinition") return sourceKeyName(sourceCode, parent.key);
  return "anonymous function";
}

function isEmptyObjectExpression(expression: ESTree.Expression): boolean {
  const unwrapped = unwrapExpression(expression);
  return unwrapped.type === "ObjectExpression" && unwrapped.properties.length === 0;
}

function hasParentAssertion(node: ESTree.Node): boolean {
  return node.parent?.type === "TSAsExpression" || node.parent?.type === "TSTypeAssertion";
}

/**
 * A value whose type the source already states, written into an annotation that throws that
 * statement away: `const row: object = { id, name }`, a function returning a literal under a
 * `Record<string, unknown>` return type, an argument asserted to `any`.
 *
 * The annotation looks like extra care and is the opposite of it. Inference had the exact type of
 * the literal on the line below, and the written type replaces it with a container — so every
 * reader of that binding, and every caller of that function, now has to narrow a value that was
 * never in doubt. The repair is usually to delete the annotation, which is why the message offers
 * `satisfies`: it checks the value against the broad type without replacing what the value knows.
 *
 * Two things both have to hold before anything is reported, and each is a gate that keeps this
 * from firing on ordinary code. `hasKnownEvidence` asks whether the expression states its own
 * type — a literal, an array, an object literal whose keys are all written down, a `new`, a
 * function or a template — or is a `const` never written after its declaration whose initialiser
 * does, followed recursively. Anything else is not established evidence, so nothing is lost.
 * `classifyWideningTarget` then asks whether the destination actually gives something away, and
 * it answers with one of six kinds: `any`, `object` and `unknown` name themselves, and an open
 * dictionary, an anonymous object literal or a generic container are the three that hide it
 * behind a shape.
 *
 * An empty object literal flowing into an open dictionary or a generic container is admitted,
 * because an accumulator declared empty and filled later is the start of the evidence rather than
 * the loss of it. An assertion sitting directly inside another assertion is passed over, so a
 * chain is reported once at the outside and `no-chained-type-assertions` owns the chain itself.
 *
 * Six sites carry a written destination the flow can be read against — a declarator, a property,
 * an accessor, an assignment back to an annotated binding, a `return` or concise arrow body
 * against the function's declared return, and a standalone assertion. The seventh is different:
 * a call to a locally visible type predicate whose subject parameter is annotated `unknown`. The
 * predicate exists to establish something about a value, so handing it one whose type is already
 * informative widens on the way in and narrows back on the way out, and the round trip is the
 * finding.
 *
 * There is no fix: the repair is the narrower type the evidence supports, which is the annotation
 * the site declined to write.
 */
export const noKnownValueWideningRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow syntactically established values from flowing into explicitly broad or anonymous target types that discard useful evidence.",
    },
    messages: {
      widening:
        "The explicit {{target}} type on {{subject}} discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.",
    },
  },
  createOnce(context) {
    let environment: TypeEnvironment | null = null;

    const reportFlow = (
      expression: ESTree.Expression,
      destination: WideningTarget | null,
      subject: string,
    ) => {
      if (destination === null) return;
      // An accumulator started empty: the two kinds that are filled in later, so the empty
      // literal is the beginning of the evidence rather than the loss of it.
      const accumulator = destination.kind === "open dictionary" || destination.kind === "generic container";
      if (accumulator && isEmptyObjectExpression(expression)) {
        return;
      }
      if (!hasKnownEvidence(context.sourceCode, expression)) return;
      context.report({
        node: expression,
        messageId: "widening",
        data: { subject, target: destination.kind },
      });
    };

    const targetFromAnnotation = (annotation: ESTree.TSTypeAnnotation | null | undefined) =>
      environment === null ? null : annotationTarget(annotation, environment);

    return {
      Program(node) {
        environment = createTypeEnvironment(node, context.sourceCode.visitorKeys);
      },
      VariableDeclarator(node) {
        if (node.init === null || node.id.type !== "Identifier") return;
        reportFlow(node.init, targetFromAnnotation(node.id.typeAnnotation), `binding \`${node.id.name}\``);
      },
      PropertyDefinition(node) {
        if (node.value === null) return;
        reportFlow(
          node.value,
          targetFromAnnotation(node.typeAnnotation),
          `property \`${sourceKeyName(context.sourceCode, node.key)}\``,
        );
      },
      AccessorProperty(node) {
        if (node.value === null) return;
        reportFlow(
          node.value,
          targetFromAnnotation(node.typeAnnotation),
          `property \`${sourceKeyName(context.sourceCode, node.key)}\``,
        );
      },
      AssignmentExpression(node) {
        if (node.operator !== "=" || node.left.type !== "Identifier") return;
        const variable = resolveVariable(context.sourceCode, node.left);
        if (variable === null) return;
        const declarator = variableDeclarator(variable);
        if (declarator?.id.type !== "Identifier") return;
        reportFlow(
          node.right,
          targetFromAnnotation(declarator.id.typeAnnotation),
          `binding \`${declarator.id.name}\``,
        );
      },
      CallExpression(node) {
        if (environment === null) return;
        const owner = localFunctionForCall(context.sourceCode, node.callee);
        if (owner === null) return;
        const parameterIndex = typePredicateSubjectIndex(context.sourceCode, owner);
        if (parameterIndex === null) return;
        const parameter = owner.params[parameterIndex];
        const argument = node.arguments[parameterIndex];
        if (parameter === undefined || argument === undefined || argument.type === "SpreadElement") {
          return;
        }
        const parameterAnnotation = functionParameterTypeAnnotation(parameter);
        if (
          parameterAnnotation === null ||
          parameterAnnotation === undefined ||
          !containsUnknownType(parameterAnnotation.typeAnnotation)
        ) {
          return;
        }
        if (!hasKnownCallArgumentEvidence(context.sourceCode, argument, environment)) {
          return;
        }
        context.report({
          node: argument,
          messageId: "widening",
          data: {
            subject: `argument for parameter \`${functionParameterBindingName(parameter, context.sourceCode)}\` of \`${functionName(context.sourceCode, owner)}\``,
            target: "unknown",
          },
        });
      },
      ReturnStatement(node) {
        if (node.argument === null) return;
        const owner = enclosingFunction(node);
        reportFlow(
          node.argument,
          targetFromAnnotation(owner?.returnType),
          `return value of \`${functionName(context.sourceCode, owner)}\``,
        );
      },
      ArrowFunctionExpression(node) {
        if (node.body.type === "BlockStatement") return;
        reportFlow(
          node.body,
          targetFromAnnotation(node.returnType),
          `return value of \`${functionName(context.sourceCode, node)}\``,
        );
      },
      TSAsExpression(node) {
        if (environment === null || hasParentAssertion(node)) return;
        reportFlow(node.expression, classifyWideningTarget(node.typeAnnotation, environment), "assertion");
      },
      TSTypeAssertion(node) {
        if (environment === null || hasParentAssertion(node)) return;
        reportFlow(node.expression, classifyWideningTarget(node.typeAnnotation, environment), "assertion");
      },
    };
  },
});
