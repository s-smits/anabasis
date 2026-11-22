import type { ESTree, SourceCode } from "@oxlint/plugins";

type FunctionParameter = ESTree.ParamPattern;

/** Whether a type is `unknown`, or a union holding it: the one place `unknown` absorbs its
 *  neighbours. Containers and intersections are not followed. */
export function containsUnknownType(type: ESTree.TSType): boolean {
  if (type.type === "TSUnknownKeyword") return true;
  if (type.type === "TSParenthesizedType") return containsUnknownType(type.typeAnnotation);
  return type.type === "TSUnionType" && type.types.some(containsUnknownType);
}

/**
 * The type a parameter declares, found past the three things a parameter can be wrapped in: a
 * constructor's `private`/`public` parameter property, a rest element, and a default value.
 */
export function functionParameterTypeAnnotation(
  parameter: FunctionParameter,
): ESTree.TSTypeAnnotation | null | undefined {
  if (parameter.type === "TSParameterProperty") {
    return functionParameterTypeAnnotation(parameter.parameter);
  }
  if (parameter.type === "RestElement") {
    return parameter.typeAnnotation ?? functionParameterTypeAnnotation(parameter.argument);
  }
  if (parameter.type === "AssignmentPattern") {
    return parameter.typeAnnotation ?? functionParameterTypeAnnotation(parameter.left);
  }
  return parameter.typeAnnotation;
}

/**
 * What to call a parameter: its name where it has one, and otherwise the source text of the
 * pattern it was written as, with the annotation cut off.
 */
export function functionParameterBindingName(parameter: FunctionParameter, sourceCode: SourceCode): string {
  if (parameter.type === "TSParameterProperty") {
    return functionParameterBindingName(parameter.parameter, sourceCode);
  }
  if (parameter.type === "AssignmentPattern") {
    return functionParameterBindingName(parameter.left, sourceCode);
  }
  if (parameter.type === "RestElement") {
    return functionParameterBindingName(parameter.argument, sourceCode);
  }
  if (parameter.type === "Identifier") return parameter.name;

  const sourceText = sourceCode.getText(parameter);
  const annotationStart = parameter.typeAnnotation?.start;
  return annotationStart === undefined
    ? sourceText
    : sourceText.slice(0, annotationStart - parameter.start).trimEnd();
}
