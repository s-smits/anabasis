/** Optional evidence fields: absent, or of the promised shape. The current and archived
 *  Builder execution shape checks share these so one field rule has one spelling. */
import { isBoolean, isNumber, isString } from "../../src/meta/json-shape.ts";

export function isNonNegativeInteger(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 0;
}

export function isPositiveInteger(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value > 0;
}

export function optionalString(value: unknown): boolean {
  return value === undefined || isString(value);
}

export function optionalNumber(value: unknown): boolean {
  return value === undefined || (isNumber(value) && Number.isFinite(value));
}

export function optionalCount(value: unknown): boolean {
  return value === undefined || isNonNegativeInteger(value);
}

export function optionalPositive(value: unknown): boolean {
  return value === undefined || isPositiveInteger(value);
}

export function optionalBoolean(value: unknown): boolean {
  return value === undefined || isBoolean(value);
}
