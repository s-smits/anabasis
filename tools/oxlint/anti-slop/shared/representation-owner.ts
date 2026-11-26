import { isOneOf } from "../../ana/shared/file-role.ts";

/**
 * The one module every other file reads a runtime representation through: `isString`, `isObject`,
 * `OpenRecord` and their neighbours. `no-runtime-typeof` and `no-unsafe-dictionary-type` admit it
 * here in one written shape each, so a second `isString` elsewhere, or any other `typeof` here, is
 * still reported, where a file-scope `off` would admit every line.
 */
export const REPRESENTATION_OWNER = "src/meta/json-shape.ts";

export function isRepresentationOwner(filename: string): boolean {
  return isOneOf(filename, [REPRESENTATION_OWNER]);
}
