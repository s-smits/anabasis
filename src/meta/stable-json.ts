import { sha256 } from "./digest.ts";
import { capturedJsonStringify as stringify } from "./json-runtime.ts";
import { isBoolean, isNumber, isObject, isString, type JsonValue } from "./json-shape.ts";

const objectPrototype = Object.prototype;
const { isArray } = Array;
const objectKeys = Object.keys;
const prototypeOf = Object.getPrototypeOf;

export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function encodeSorted(value: unknown, undefinedValues: "omit" | "keep"): string {
  if (isArray(value)) {
    return `[${Array.from(value, (item) => encodeSorted(item, undefinedValues)).join(",")}]`;
  }
  if (isObject(value)) {
    const record = /* SAFETY: reached only when `isObject(value)`. */ value as Record<string, JsonValue>;
    const parts: string[] = [];
    for (const key of objectKeys(record).toSorted(compareCodeUnits)) {
      const child = record[key];
      if (undefinedValues === "keep" || child !== undefined) {
        parts.push(`${stringify(key)}:${encodeSorted(child, undefinedValues)}`);
      }
    }
    return `{${parts.join(",")}}`;
  }
  return stringify(value) ?? (undefinedValues === "keep" ? "undefined" : "null");
}

export function canonicalJson(value: unknown): string {
  return encodeSorted(value, "keep");
}

function isPlainFiniteJson(
  value: unknown,
  undefinedValues: "allowed" | "rejected",
  seen = new Set<object>(),
): boolean {
  if (value === undefined) return undefinedValues === "allowed";
  if (value === null || isString(value) || isBoolean(value)) return true;
  if (isNumber(value)) return Number.isFinite(value);
  if (!isObject(value) || seen.has(value)) return false;
  seen.add(value);
  const record = /* SAFETY: reached only when `isObject(value)`. */ value as Record<string, JsonValue>;
  const valid = isArray(value)
    ? Array.from(value).every((item) => isPlainFiniteJson(item, undefinedValues, seen))
    : prototypeOf(value) === objectPrototype &&
      objectKeys(record).every((key) => isPlainFiniteJson(record[key], undefinedValues, seen));
  seen.delete(value);
  return valid;
}

export function stableJson(value: unknown): string {
  if (!isPlainFiniteJson(value, "allowed")) throw new Error("value is not stable finite JSON");
  return encodeSorted(value, "omit");
}

export function sameJsonValue(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

export function hashJsonValue(value: unknown): string {
  return sha256(stableJson(value));
}

export function requireJsonValue(value: unknown): JsonValue {
  if (!isPlainFiniteJson(value, "rejected")) throw new Error("value is not plain finite JSON");
  return /* SAFETY: isPlainFiniteJson just admitted the complete finite JSON closure. */ value as JsonValue;
}
