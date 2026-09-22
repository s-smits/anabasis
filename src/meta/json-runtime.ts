import { sha256 } from "./digest.ts";
import { types } from "node:util";
import type { JsonValue } from "./json-shape.ts";

const freeze = Object.freeze.bind(Object);
const defineProperty = Object.defineProperty.bind(Object);

/** Native JSON and clone references captured before generated modules can replace shared globals. */
const nativeJsonParse = JSON.parse.bind(JSON);
/**
 * Typed `JsonValue` rather than the native `any`. Parsing bytes proves the result is JSON and
 * nothing more, so this is the one place in the tree that states the fact instead of handing every
 * reader an `any` to re-widen. A reader that needs a declared contract uses `parseJsonAs` below.
 */
export const capturedJsonParse: (text: string) => JsonValue = nativeJsonParse;
/**
 * `JSON.stringify` answers `undefined` for `undefined`, a function and a symbol, which
 * `lib.es5.d.ts` does not say: it declares `string`. Stating the real return here keeps the
 * callers' `?? "…"` fallbacks honest instead of leaving them looking like dead guards.
 */
export const capturedJsonStringify: <T>(
  value: T,
  replacer?: null,
  space?: string | number,
) => undefined extends T ? string | undefined : string = JSON.stringify.bind(JSON);
export const capturedStructuredClone = globalThis.structuredClone;
/** Detect a generated proxy without invoking its traps at a JSON transport boundary. */
export const capturedIsProxy = types.isProxy;

/**
 * Read JSON bytes as a declared contract.
 *
 * `JSON.parse` returns `any`, so every reader in the tree ended in `as T` — 148 of them. The type
 * parameter says the same thing in one place. It is a declaration about the writer of those bytes,
 * not a check on them: this owner narrows `any` and cannot observe a mismatch. A reader that must
 * refuse damaged bytes validates them itself; `readCompleted` in completed-json.ts is the example,
 * and it rejects a wrong `schema` field before returning.
 *
 * The captured binding is used rather than the ambient one, so a generated module that replaces
 * `JSON` after load does not change what the controller reads.
 */
export function parseJsonAs<T>(text: string): T {
  // SAFETY: `T` is the caller's declaration of the contract these bytes were written under. The
  // assertion narrows the `any` that JSON.parse returns and asserts nothing else.
  return nativeJsonParse(text) as T;
}

/** SHA-256 of native compact JSON bytes. Object insertion order is deliberately part of this identity.
 *  Callers hash shapes this module cannot prove: a vendor TypeBox schema keyed by symbols, a provider
 *  message list. Declaring `JsonValue` would put a runtime proof on a live digest path and throw on
 *  exactly those values, so the identity stays over whatever the captured stringify wrote. */
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
