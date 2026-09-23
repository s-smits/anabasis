/**
 * Shared primitive shape checks for values received without a known type.
 *
 * JSON, host payloads and generated-module returns all have to be type-checked before use. Left to
 * each reader that is hundreds of hand-written checks across the tree, and a missing one is then
 * impossible to tell apart from a deliberate one. These predicates give every caller one way to
 * say which primitive type it needs.
 *
 * They are shape tests and not a parser. `isString(value)` says the value is a string; it says
 * nothing about whether that string is a task id, a slug or a digest, so a reader that must refuse
 * damaged bytes still validates them itself, as `readCompleted` in completed-json.ts does.
 *
 * This file is the owner the lint plugins name for the primitive tests and the open types:
 * `no-runtime-typeof` and `no-unsafe-dictionary-type` report a `typeof` test, an open dictionary
 * and a callable everywhere else and admit them here in one written shape each, because here is
 * where those rules send every other file. A second copy of `isString` somewhere else is still
 * reported, and so is any other `typeof` in this file — the admission names the two shapes rather
 * than turning the rule off for the file, which would admit every line of it.
 */

/**
 * Values produced by parsing JSON, for parsed data whose application schema is not yet known. It
 * permits every JSON shape while telling a caller that functions, symbols and other non-JSON
 * values are outside the input contract.
 *
 * It is not a schema. `JsonValue` says the bytes are JSON; it does not say they are a task, a
 * claim or a case record, and a reader that needs one of those still validates it with the shape
 * tests below.
 *
 * Keep `unknown` for inputs that are not known to be JSON at all, because a caught error may be
 * any thrown value and a host or generated-module return may contain functions; those callers have
 * to establish the shape they need before using the result.
 *
 * Arrays are readonly because a parsed value whose schema is not yet known is evidence a reader
 * inspects rather than a buffer it builds, and a reader that needs another array builds a new one.
 * Writing to one compiles until the `Array.isArray` overload below is in place, since the library
 * signature hands every element on as `any`. It also makes this type structurally identical to the
 * `JsonValue` that `@earendil-works/pi-ai` exports, so a value crosses the pi boundary in either
 * direction under one name. Importing pi's type into the pi-facing code instead leaves two names
 * for one shape inside the same expression, since `asRecord` narrows to this one, and re-exporting
 * it from here would put a provider SDK underneath the verifier, claim and gate trees, where a
 * version bump is not welcome.
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
    /** The library's `arg is any[]` hands every element on as `any`, and narrows a readonly array
     *  only by intersecting it with `any[]` (microsoft/TypeScript#17002, open since 2017). This is
     *  the signature TypeScript's own compiler and typescript-eslint give their `isArray`, written
     *  as the built-in rather than as a second function so nothing has to be taught to prefer it:
     *  a `JsonValue` narrows to `readonly JsonValue[]` and anything else to `readonly unknown[]`. */
    isArray(arg: unknown): arg is readonly unknown[];
  }
}

/** A JSON object: the shape `isRecord` proves. */
export type JsonObject = { [key: string]: JsonValue };

/**
 * An object read by key, each value unknown until the reader checks the one it needs.
 *
 * Three things in this codebase are exactly that and nothing narrower. A generated module's
 * namespace exports functions such as `solve` and `evaluate`, which `JsonObject` cannot hold, so a
 * reader checks the export it needs with `isFunction` before calling it. A TypeBox schema's
 * interface declares no string index signature although its keywords are enumerable at runtime.
 * And a lint rule walks an ESTree node by visitor key, where a child may be of any kind. An
 * object-shape check establishes none of those contracts by itself.
 *
 * It is spelled `Record` on purpose: TypeScript lets an interface such as `TSchema` be asserted to
 * `Record<string, unknown>` in one step and refuses the same assertion to the literal
 * `{ [key: string]: unknown }`. Named for the module namespace alone it reads as belonging to one
 * caller, and the TypeBox view in draft-tool.ts and the node views in the lint plugins each
 * declare a copy of their own instead.
 */
export type OpenRecord = Record<string, unknown>;

/**
 * Any callable, with no contract on what it takes or returns.
 *
 * A host or generated module returns whatever it returns, so naming a real signature here would be
 * this file inventing a contract it cannot check. The `never[]` parameters and the `void` result
 * say the same thing from both ends: a caller narrowing to this type has to state the signature it
 * expects before it passes an argument or reads a result, rather than being handed one it may call
 * wrongly. Every function is assignable to it. An `unknown` result would let a caller read what
 * came back without stating anything at all.
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
 * Whether the value is a non-null object, arrays included; a caller that needs a record uses
 * `isRecord`, which also excludes arrays.
 *
 * The null test belongs here rather than at each call site because `typeof null` is `"object"`.
 * A predicate returning `value is object | null` and asking every caller to add `value !== null`
 * gets that back in several spellings — before the call, after it, either way round inside a
 * negation — and from some callers not at all. A miss is live: a null content part passing
 * `!isObject(part)` in generated-tool-worker-child.ts reaches `part.type` and throws a TypeError
 * from a function that declares "generated tool result must contain text content", which sends the
 * controller after the wrong owner. A check every caller has to repair is the check that is wrong.
 */
export function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/**
 * Whether the value is a non-null, non-array object. For parsed JSON this establishes a JSON
 * object; it does not validate nested values or required fields, and it does not recursively
 * validate an arbitrary host value.
 *
 * Sharing it is what stops a caller admitting an array by accident. Without the check, a model
 * returning valid JSON of an unexpected shape has `validateBrief` read `.decisions.length` on
 * undefined, and the TypeError becomes a runtime non-result — a product finding misclassified as
 * an environment failure. A shape check lets the caller report an invalid artifact to the repair
 * loop instead of crashing. It is only the first step: required fields still need validating.
 */
export function isRecord(value: unknown): value is JsonObject {
  return isObject(value) && !Array.isArray(value);
}

/**
 * The value as a JSON object, or `null` when it is anything else.
 *
 * Returning the narrowed object rather than a boolean is what makes a nested read readable:
 * `asRecord(asRecord(v)?.usage)`. A caller writing its own copy tends to reach for a SAFETY cast
 * it does not need, since this predicate already narrows the value. Returning null for every other
 * shape keeps an optional nested read explicit without repeating the check at each level.
 */
export function asRecord(value: unknown): JsonObject | null {
  return isRecord(value) ? value : null;
}

/** Whether the value is callable, used where a host or generated module hands back a slot that
 *  may be absent rather than a function. */
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
 * `function`, or `bigint or symbol` for the two primitives JSON has no name for. Branching and
 * narrowing belong to the predicates above; this one only produces a word for a message.
 *
 * Returning `typeof value` instead names both null and an array "object", which every caller then
 * corrects in front of the call with a ternary of its own. The name comes out right here so that
 * none of them has to.
 */
export function typeName(value: unknown): string {
  if (value === undefined) return "undefined";
  return jsonKind(value) ?? (isFunction(value) ? "function" : "bigint or symbol");
}
