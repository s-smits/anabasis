import type { ESTree } from "@oxlint/plugins";
import { isBoolean } from "#src/meta/json-shape.ts";
import { literalValue } from "./statements.ts";

/**
 * Which annotations and parameters hold a flag, for `ana/no-positional-boolean-parameter` and
 * `implicit-state-opinionated`'s `max-boolean-fields` and `prefer-state-union`. Foxglove's
 * `no-boolean-parameters` (`THIRD_PARTY_NOTICES.md`) asks the type checker; a plugin rule cannot,
 * so this reads the written annotation and the default instead.
 */
const EMPTY = new Set(["TSUndefinedKeyword", "TSNullKeyword", "TSVoidKeyword"]);

const flagPart = (type: ESTree.TSType): boolean =>
  type.type === "TSBooleanKeyword" ||
  (type.type === "TSLiteralType" && isBoolean(literalValue(type.literal)));

export function isFlagType(type: ESTree.TSType | undefined): boolean {
  if (type === undefined) {
    return false;
  }
  if (type.type !== "TSUnionType") {
    return flagPart(type);
  }
  const rest = type.types.filter((member) => !EMPTY.has(member.type));
  return rest.length > 0 && rest.every(flagPart);
}

export function flagBinding(parameter: ESTree.Node): ESTree.BindingIdentifier | null {
  const target = parameter.type === "AssignmentPattern" ? parameter.left : parameter;
  if (target.type !== "Identifier") {
    return null;
  }
  const defaulted = parameter.type === "AssignmentPattern" && isBoolean(literalValue(parameter.right));
  return defaulted || isFlagType(target.typeAnnotation?.typeAnnotation) ? target : null;
}
