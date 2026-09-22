/**
 * Shared primitive shape checks for values received without a known type.
 *
 * These are shape tests, not a parser: `isString(value)` says the value is a string, not that it
 * is a task id or a digest. Callers still validate stronger requirements themselves, as
 * `readCompleted` in completed-json.ts does.
 *
 * `.oxlintrc.json` names this file as the one owner of `typeof` tests and the open types.
 */

/**
 * Values produced by parsing JSON whose application schema is not yet known. It is not a schema:
 * a reader that needs a task or a claim still validates it with the shape tests below.
 *
 * Keep `unknown` for inputs not known to be JSON, such as caught errors and host or
 * generated-module returns.
 *
 * Arrays are readonly: parsed data is evidence a reader inspects, not a buffer it builds. This
 * also makes the type structurally identical to `@earendil-works/pi-ai`'s `JsonValue`.
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
    /** Narrows a `JsonValue` to `readonly JsonValue[]` and anything else to `readonly unknown[]`,
     *  instead of the library's `any[]`. */
    isArray(arg: unknown): arg is readonly unknown[];
  }
}

/** A JSON object: the shape `isRecord` proves. */
export type JsonObject = { [key: string]: JsonValue };

/**
 * An object read by key, each value unknown until the reader checks the one it needs: a generated
 * module's namespace, a TypeBox schema, or an ESTree node.
 *
 * It is spelled `Record` because TypeScript allows asserting an interface such as `TSchema` to
 * `Record<string, unknown>` in one step, but not to `{ [key: string]: unknown }`.
 */
export type OpenRecord = Record<string, unknown>;

/**
 * Any callable, with no contract on what it takes or returns. `never[]` parameters and a `void`
 * result force a caller to state the signature it expects before calling it or reading a result.
 */
export type Callable = (...args: never[]) => void;

/** Whether the value is a JSON string. */
export function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** Whether the value has JavaScript's number type. NaN and infinities pass; a caller needing
 *  a finite number must check that separately. */
export function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

/** Whether the value is a JSON boolean. */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/**
 * Whether the value is a non-null object, arrays included; `isRecord` also excludes arrays.
 * The null test lives here because `typeof null` is `"object"`.
 */
export function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/**
 * Whether the value is a non-null, non-array object. For parsed JSON this establishes a JSON
 * object; it does not validate nested values or required fields.
 */
export function isRecord(value: unknown): value is JsonObject {
  return isObject(value) && !Array.isArray(value);
}

/**
 * The value as a JSON object, or `null` when it is anything else, for nested reads such as
 * `asRecord(asRecord(v)?.usage)`.
 */
export function asRecord(value: unknown): JsonObject | null {
  return isRecord(value) ? value : null;
}

/** Whether the value is callable. */
export function isFunction(value: unknown): value is Callable {
  return typeof value === "function";
}

/** Classify the outer value by JSON-like kind; this does not validate nested values or finiteness. */
export function jsonKind(
  value: unknown,
): "null" | "array" | "object" | "boolean" | "number" | "string" | null {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (isRecord(value)) return "object";
  if (isBoolean(value)) return "boolean";
  if (isNumber(value)) return "number";
  if (isString(value)) return "string";
  return null;
}

/**
 * Name the kind of an unexpected value in a diagnostic message: its JSON kind, or `undefined`,
 * `function`, or `bigint or symbol`. Callers branch with the predicates above.
 */
export function typeName(value: unknown): string {
  if (value === undefined) return "undefined";
  return jsonKind(value) ?? (isFunction(value) ? "function" : "bigint or symbol");
}
