/**
 * Shared primitive shape checks and open types (`JsonValue`, `JsonObject`, `OpenRecord`, `Callable`)
 * for untyped JSON, host payloads, and generated-module returns.
 */

/**
 * Values produced by parsing JSON (`readonly` arrays so `JsonValue` is structurally compatible with
 * `@earendil-works/pi-ai` and `Array.isArray` narrows without `any`). Keep `unknown` for non-JSON
 * inputs such as caught errors or module exports that may contain functions.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { [key: string]: JsonValue };

declare global {
  interface ArrayConstructor {
    /** Narrow `Array.isArray` to `readonly unknown[]` (and `JsonValue` to `readonly JsonValue[]`) rather than `any[]`. */
    // oxlint-disable-next-line typescript/method-signature-style -- an overload merged into the library's `ArrayConstructor`, which a property would redeclare
    isArray(arg: unknown): arg is readonly unknown[];
  }
}

/** A JSON object: the shape `isRecord` proves. */
export type JsonObject = Record<string, JsonValue>;

/** An object read by string key (`Record<string, unknown>`), used for check module namespaces, TypeBox schemas, and ESTree nodes where values may include functions or arbitrary AST children. */
export type OpenRecord = Record<string, unknown>;

/** Any callable (`(...args: never[]) => void`), requiring callers to narrow the signature before passing arguments or reading a return value. */
export type Callable = (...args: never[]) => void;

/** Whether the value is a JSON string. */
export function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** Whether the value has JavaScript's number type (callers needing finiteness must check `Number.isFinite`). */
export function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

/** Whether the value is a JSON boolean. */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/** Whether the value is a non-null object (arrays included; use `isRecord` to exclude arrays). */
export function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/** Whether the value is a non-null, non-array object (`JsonObject` for parsed JSON). */
export function isRecord(value: unknown): value is JsonObject {
  return isObject(value) && !Array.isArray(value);
}

/** Return `value` as a `JsonObject`, or `null` when it is any other shape (enabling chained reads like `asRecord(asRecord(v)?.usage)`). */
export function asRecord(value: unknown): JsonObject | null {
  return isRecord(value) ? value : null;
}

/** Whether the value is callable (`Callable`). */
export function isFunction(value: unknown): value is Callable {
  return typeof value === "function";
}

/** Classify the outer value by JSON-like kind; this does not validate nested values or finiteness. */
function jsonKind(value: unknown): "null" | "array" | "object" | "boolean" | "number" | "string" | null {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (isRecord(value)) return "object";
  if (isBoolean(value)) return "boolean";
  if (isNumber(value)) return "number";
  if (isString(value)) return "string";
  return null;
}

/** Human-readable kind of an unexpected value for diagnostic messages (`null` and `array` distinguished from `object`). */
export function typeName(value: unknown): string {
  if (value === undefined) return "undefined";
  return jsonKind(value) ?? (isFunction(value) ? "function" : "bigint or symbol");
}
