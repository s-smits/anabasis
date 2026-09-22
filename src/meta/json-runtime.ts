import { sha256 } from "./digest.ts";
import { types } from "node:util";
import type { JsonValue } from "./json-shape.ts";

const freeze = Object.freeze.bind(Object);
const defineProperty = Object.defineProperty.bind(Object);

/** Native JSON and clone references captured before generated modules can replace shared globals. */
const nativeJsonParse = JSON.parse.bind(JSON);
/** Typed `JsonValue` rather than `any`: parsing proves the result is JSON and nothing more. */
export const capturedJsonParse: (text: string) => JsonValue = nativeJsonParse;
/** `JSON.stringify` returns `undefined` for `undefined`, a function or a symbol, although
 *  `lib.es5.d.ts` declares `string`; this type states the real return. */
export const capturedJsonStringify: <T>(
  value: T,
  replacer?: null,
  space?: string | number,
) => undefined extends T ? string | undefined : string = JSON.stringify.bind(JSON);
export const capturedStructuredClone = globalThis.structuredClone;
/** Detect a generated proxy without invoking its traps at a JSON transport boundary. */
export const capturedIsProxy = types.isProxy;

/**
 * Read JSON bytes as a declared contract. `T` is a declaration about the writer, not a check: a
 * reader that must refuse damaged bytes validates them itself, as `readCompleted` does. The
 * captured parser is used so a generated module that replaces `JSON` cannot change the result.
 */
export function parseJsonAs<T>(text: string): T {
  // SAFETY: `T` is the caller's declared contract; this only narrows JSON.parse's `any`.
  return nativeJsonParse(text) as T;
}

/** SHA-256 of native compact JSON bytes; object insertion order is part of the identity. The
 *  parameter is `unknown` because callers hash shapes that are not provably `JsonValue`, such as a
 *  TypeBox schema keyed by symbols. */
export function hashJsonBytes(value: unknown): string {
  return sha256(capturedJsonStringify(value) ?? "undefined");
}

/** Lock the JSON object graph inside a generated-code child before its first generated import. */
export function lockJsonGlobals(freezeObjectPrototype = false): void {
  const values: unknown[] = [Array, Array.prototype, JSON, Object];
  if (freezeObjectPrototype) values.push(Object.prototype);
  for (const value of values) freeze(value);
  for (const name of ["Array", "JSON", "Object"] as const) {
    defineProperty(globalThis, name, { value: globalThis[name], writable: false, configurable: false });
  }
}
