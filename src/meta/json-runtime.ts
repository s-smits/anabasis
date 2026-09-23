import { sha256 } from "./digest.ts";
import { types } from "node:util";
import type { JsonValue } from "./json-shape.ts";

const freeze = Object.freeze.bind(Object);
const defineProperty = Object.defineProperty.bind(Object);

/** Native JSON and clone references captured before generated modules can replace shared globals. */
const nativeJsonParse = JSON.parse.bind(JSON);
/**
 * Typed `JsonValue` rather than the native `any`. Parsing bytes proves the result is JSON and
 * nothing more, so this is the one place in the tree that states that fact instead of handing every
 * reader an `any` to re-widen. A reader that needs a declared contract uses `parseJsonAs` below.
 */
export const capturedJsonParse: (text: string) => JsonValue = nativeJsonParse;
/**
 * `JSON.stringify` answers `undefined` for `undefined`, a function and a symbol, which
 * `lib.es5.d.ts` does not say: it declares `string`. Stating the real return here is what keeps the
 * callers' `?? "…"` fallbacks honest, instead of leaving them looking like dead guards that a later
 * reader removes.
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
 * parameter says the same thing in one place. It remains a declaration about whoever wrote those
 * bytes and not a check on them: this owner narrows `any` and can observe no mismatch. A reader
 * that must refuse damaged bytes validates them itself, as `readCompleted` in completed-json.ts
 * does when it throws on a record whose `schema` field is not the one asked for.
 *
 * The captured binding is used rather than the ambient one, so a generated module that replaces
 * `JSON` after load does not change what the controller reads.
 */
export function parseJsonAs<T>(text: string): T {
  // SAFETY: `T` is the caller's declaration of the contract these bytes were written under. The
  // assertion narrows the `any` that JSON.parse returns and asserts nothing else.
  return nativeJsonParse(text) as T;
}

/** SHA-256 of native compact JSON bytes. Object insertion order is deliberately part of this
 *  identity. The parameter is `unknown` because callers hash shapes this module cannot prove are
 *  JSON — a vendored TypeBox schema keyed by symbols, a provider message list — and declaring
 *  `JsonValue` would put a runtime proof on a live digest path that throws on exactly those values.
 *  The identity is therefore over whatever the captured stringify wrote. */
export function hashJsonBytes(value: unknown): string {
  return sha256(capturedJsonStringify(value) ?? "undefined");
}

/** Lock the JSON object graph inside a generated-code child, before its first generated import. The
 *  captured bindings above protect this module's own calls; generated code reads the globals
 *  themselves, so a replaced `JSON.stringify` or an added `Array.prototype.toJSON` would still
 *  change the bytes the transport writes. Freezing has to happen before the import, because
 *  afterwards the module it was meant to bound is already running. */
export function lockJsonGlobals(freezeObjectPrototype = false): void {
  const values: unknown[] = [Array, Array.prototype, JSON, Object];
  if (freezeObjectPrototype) values.push(Object.prototype);
  for (const value of values) freeze(value);
  for (const name of ["Array", "JSON", "Object"] as const) {
    defineProperty(globalThis, name, { value: globalThis[name], writable: false, configurable: false });
  }
}
