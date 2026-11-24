export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { [key: string]: JsonValue };

declare global {
  interface ArrayConstructor {
    // oxlint-disable-next-line typescript/method-signature-style -- an overload merged into the library's `ArrayConstructor`, which a property would redeclare
    isArray(arg: unknown): arg is readonly unknown[];
  }
}

export type JsonObject = Record<string, JsonValue>;

export type OpenRecord = Record<string, unknown>;

export type Callable = (...args: never[]) => void;

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

export function isRecord(value: unknown): value is JsonObject {
  return isObject(value) && !Array.isArray(value);
}

export function asRecord(value: unknown): JsonObject | null {
  return isRecord(value) ? value : null;
}

export function isFunction(value: unknown): value is Callable {
  return typeof value === "function";
}

function jsonKind(value: unknown): "null" | "array" | "object" | "boolean" | "number" | "string" | null {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (isRecord(value)) return "object";
  if (isBoolean(value)) return "boolean";
  if (isNumber(value)) return "number";
  if (isString(value)) return "string";
  return null;
}

export function typeName(value: unknown): string {
  if (value === undefined) return "undefined";
  return jsonKind(value) ?? (isFunction(value) ? "function" : "bigint or symbol");
}
