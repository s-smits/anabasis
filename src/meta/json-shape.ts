/**
 * Shared primitive shape checks for values received without a known type.
 *
 * JSON, host payloads and generated-module returns need type checks before use. The earlier
 * readers repeated roughly six hundred checks across 119 files, making omitted checks hard
 * to distinguish from intentional choices. These predicates give callers a consistent way
 * to state the primitive type they need. Each helper retains the narrowing of its original
 * operation; callers remain responsible for any stronger requirements such as finite numbers
 * or complete record schemas.
 *
 * These are shape tests, not a parser. `isString(value)` says the value is a string; it says
 * nothing about whether that string is a task id, a slug or a digest. A reader that must refuse
 * damaged bytes still validates them itself — `readCompleted` in completed-json.ts is the example.
 *
 * This file is the owner `.oxlintrc.json` names for the primitive tests and the open types:
 * `typeof`, an open dictionary and a callable returning `unknown` are reported everywhere else and
 * admitted here, because here is where the lint rules send every other file. Each row of
 * `tools/oxlint/not-slop.tsv` that answered one of them said the same sentence about this file,
 * eight times. Domain-specific validation still belongs to the caller that knows the required
 * contract.
 */

/**
 * Values produced by parsing JSON. Use this type for parsed data whose application schema is
 * not yet known. It permits every JSON shape while telling callers that functions, symbols
 * and other non-JSON values are outside the input contract.
 *
 * It is not a schema. `JsonValue` says the bytes are JSON; it does not say they are a task, a
 * claim or a case record. A reader that needs one of those still validates it, and the shape
 * tests below are how it does that.
 *
 * Keep `unknown` for inputs not known to be JSON: caught errors may be any thrown value,
 * and host or generated-module returns may contain functions or other non-JSON values.
 * Those callers must establish the needed shape before using the result.
 *
 * Arrays are readonly. A parsed value whose schema is not yet known is evidence a reader
 * inspects, not a buffer it builds; a reader that needs another array builds a new one. The
 * keyword first went in without a type error only because `Array.isArray` narrowed every JSON
 * array to `any`; the overload below narrows it to this type, which showed seven sites that wrote
 * to one or handed it on as mutable. It also makes this type structurally identical to the
 * `JsonValue` that `@earendil-works/pi-ai` exports, so a value crosses the pi boundary in either
 * direction under one name. The alternative was importing pi's type into the pi-facing code,
 * which would have left two names for one shape in the same expression — `asRecord` narrows to
 * this one — and, if taken as far as re-exporting from here, would have put a provider SDK
 * underneath the verifier, claim and gate trees, where a version bump is not welcome.
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
     *  the signature TypeScript's own compiler and typescript-eslint give their `isArray`, as the
     *  built-in instead of a second function: a `JsonValue` narrows to `readonly JsonValue[]`,
     *  anything else to `readonly unknown[]`. */
    isArray(arg: unknown): arg is readonly unknown[];
  }
}

/** A JSON object: the shape `isRecord` proves. */
export type JsonObject = { [key: string]: JsonValue };

/**
 * An object read by key, each value unknown until the reader checks the one it needs.
 *
 * Three things here are that and nothing narrower. A generated module's namespace exports
 * functions such as `solve` and `evaluate`, which `JsonObject` cannot hold, so a reader checks the
 * export it needs with `isFunction` before calling it. A TypeBox schema's interface declares no
 * string index signature although its keywords are enumerable at runtime. And a lint rule walks an
 * ESTree node by visitor key, where a child is of every kind. An object-shape check alone
 * establishes none of those contracts.
 *
 * It is spelled `Record` on purpose: TypeScript lets an interface such as `TSchema` be asserted
 * to `Record<string, unknown>` in one step, and refuses the same assertion to the literal
 * `{ [key: string]: unknown }`. It was `ModuleNamespace` until 2026-09-22, when the TypeBox view
 * in draft-tool.ts and two node views in the lint plugins each declared their own copy of it.
 */
export type OpenRecord = Record<string, unknown>;

/**
 * Any callable, with no contract on what it takes or returns.
 *
 * A host or generated module returns whatever it returns; naming a real signature here would be
 * this file inventing a contract it cannot check. `never[]` parameters and the `void` result say
 * the same thing from both ends: a caller narrowing to this type must state the signature it
 * expects before it passes an argument or reads a result, rather than being handed one it may
 * call wrongly. Every function is assignable to it. It returned `unknown` until 2026-09-22, which
 * let a caller read the result without stating anything.
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
 * Whether the value is a non-null object, arrays included. Callers needing a record use
 * `isRecord`, which also excludes arrays.
 *
 * The null test belongs here because `typeof null` is `"object"`. This predicate was named
 * `isObjectTypeof` until 2026-09-20, returned `value is object | null`, and its comment asked
 * each caller to add `value !== null`. Seventeen of its twenty-nine callers did, in four
 * spellings — before it, after it, and either way round in a negation — and twelve did not.
 * One of the twelve was live: a null content part in `generated-tool-worker-child.ts` passed
 * `!isObjectTypeof(part)`, reached `part.type` and threw a TypeError where its function declares
 * `Error("generated tool result must contain text content")`, sending the controller after the
 * wrong owner. The other eleven survive on a guard further up their own caller or on a catch
 * that swallows the TypeError, which is a property of those callers and not of this predicate.
 * A check every caller has to repair is the check that is wrong.
 */
export function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/**
 * Check for a non-null, non-array object. For parsed JSON, this establishes a JSON object;
 * it does not recursively validate arbitrary host values. The same check previously appeared
 * in brief.ts, case-record.ts, solvability-submission.ts and public-artifact-schema.ts.
 * Sharing it prevents callers from accidentally admitting arrays.
 *
 * In falsifier-claude-001, the brief specialist returned valid JSON with an unexpected shape.
 * `validateBrief` accessed `.decisions.length` on undefined, and the TypeError became a
 * runtime non-result. Shape validation lets the caller report an invalid artifact to the
 * repair loop instead of crashing and misclassifying a product finding as an environment
 * failure. This object check is the first step; required fields still need validation.
 */
export function isRecord(value: unknown): value is JsonObject {
  return isObject(value) && !Array.isArray(value);
}

/**
 * The value as a JSON object, or `null` when it is anything else.
 *
 * Return the narrowed object to make nested reads straightforward, for example
 * `asRecord(asRecord(v)?.usage)`. This operation once appeared as four transport copies and as
 * `record` in verifier-port.ts; two of them carried unnecessary SAFETY casts, because the shared
 * predicate already narrows the value. Returning null for other shapes keeps optional nested reads
 * explicit without repeating that check at each level.
 */
export function asRecord(value: unknown): JsonObject | null {
  return isRecord(value) ? value : null;
}

/** Whether the value is callable. Used where a host or generated module hands back a slot that may
 *  be absent rather than a function. */
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
 * `function`, or `bigint or symbol` for the two primitives JSON has no name for. Callers use the
 * predicates above for branching and narrowing.
 *
 * It returned `typeof value` until 2026-09-22, which names null and an array "object". Three of
 * its four callers in `src` repaired that in place, each with its own `null`/`array` ternary in
 * front of it, and the fourth put `jsonKind` in front. The name now comes out right the first time.
 */
export function typeName(value: unknown): string {
  if (value === undefined) return "undefined";
  return jsonKind(value) ?? (isFunction(value) ? "function" : "bigint or symbol");
}
