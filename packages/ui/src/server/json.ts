/*
 * Type checks shared by the evidence readers.
 *
 * Evidence read from disk is `unknown` until its type is checked, and every reader needs the same
 * checks. These lived privately inside `readers.ts` while it was the only reader; later readers
 * needed them too. Keeping one shared implementation prevents those readers from disagreeing
 * about what an absent field means.
 *
 * A wrong scalar type reads as absence. `number(null)` returns `null`, not `0`: a missing count
 * must not appear as a measured zero. Array helpers return an empty list for non-arrays and
 * omit entries that do not have the requested type.
 */

import { asRecord, isBoolean, isNumber, isString, type JsonObject } from "../../../../src/meta/json-shape.ts";

export type { JsonObject };

/** This walk had been written here a sixth time; `asRecord` in src/meta/json-shape.ts owns it. */
export const object = asRecord;

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

export function text(value: unknown): string | null {
  return isString(value) && value.trim() !== "" ? value : null;
}

export function bool(value: unknown): boolean | null {
  return isBoolean(value) ? value : null;
}

export function number(value: unknown): number | null {
  return isNumber(value) && Number.isFinite(value) ? value : null;
}

export function stringArray(value: unknown): string[] {
  return array(value).filter((item): item is string => isString(item));
}

export function objectArray(value: unknown): JsonObject[] {
  return array(value)
    .map(object)
    .filter((item): item is JsonObject => item !== null);
}
