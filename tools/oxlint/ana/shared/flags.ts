import type { ESTree } from "@oxlint/plugins";
import { isBoolean } from "#src/meta/json-shape.ts";
import { literalValue } from "./statements.ts";

/**
 * Which annotations and parameters hold a flag, for `ana/no-positional-boolean-parameter`,
 * `implicit-state/excessive-bools` and `implicit-state-opinionated/flag-count`. The reading of a union and a default follows Foxglove's
 * `no-boolean-parameters` (`THIRD_PARTY_NOTICES.md`), which asks the type checker for a type whose
 * parts are boolean beside `undefined`, `null` or `void`; a plugin rule never asks the checker, so
 * this reads the written annotation and the default instead.
 */
const EMPTY = new Set(["TSUndefinedKeyword", "TSNullKeyword", "TSVoidKeyword"]);

/** Whether a type is `boolean`, `true` or `false`. */
const flagPart = (type: ESTree.TSType): boolean =>
  type.type === "TSBooleanKeyword" ||
  (type.type === "TSLiteralType" && isBoolean(literalValue(type.literal)));

/** Whether an annotation is a flag, alone or beside `undefined`, `null` or `void`. */
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

/** The name a parameter binds where it holds a flag: annotated as one, or defaulted to a boolean. */
export function flagBinding(parameter: ESTree.Node): ESTree.BindingIdentifier | null {
  const target = parameter.type === "AssignmentPattern" ? parameter.left : parameter;
  if (target.type !== "Identifier") {
    return null;
  }
  const defaulted = parameter.type === "AssignmentPattern" && isBoolean(literalValue(parameter.right));
  return defaulted || isFlagType(target.typeAnnotation?.typeAnnotation) ? target : null;
}
