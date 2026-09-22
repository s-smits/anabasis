import { isOneOf } from "../../ana/shared/file-role.ts";

/**
 * The one module every other file reads a runtime representation through: `isString`,
 * `isObject`, `isFunction`, `OpenRecord` and their neighbours.
 *
 * A decoder has to test `typeof` somewhere, and a namespace or an AST node has to be viewed as an
 * open record somewhere. `no-runtime-typeof` and `no-unsafe-dictionary-type` keep reporting that
 * everywhere else and admit it here in one written shape each, so a second copy of `isString` in
 * another file is still reported, and so is any other `typeof` in this one. Until 2026-09-22 the
 * admission was a file-scope `off` in `.oxlintrc.json`, which admitted every line of the file.
 */
export const REPRESENTATION_OWNER = "src/meta/json-shape.ts";

/** Whether the file being linted is the representation owner. */
export function isRepresentationOwner(filename: string): boolean {
  return isOneOf(filename, [REPRESENTATION_OWNER]);
}
