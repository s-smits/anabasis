import { sha256 } from "./digest.ts";
import { isString, type JsonValue } from "./json-shape.ts";

const freeze = Object.freeze.bind(Object);
const defineProperty = Object.defineProperty.bind(Object);

/**
 * Native JSON references taken at load. No host process imports a generated module: a harness's
 * tools run in a walled process of their own (`CALLER`, `src/harness/open.ts`), and a check program
 * runs in the check child, which calls `lockJsonGlobals` below before its one generated import, so
 * there the ambient `JSON` is these same functions. The bindings carry the honest types below.
 */
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

/** A value a model sent as JSON, decoded where it arrived as JSON text: a tool's argument the
 *  provider passed as the string `"null"` where the same call elsewhere passed null (an Examiner's
 *  hidden values, 12 October: 19 of 19 tries checked). Text that is no JSON stays the string it is. */
export function decodedJsonText(value: JsonValue): JsonValue {
  if (!isString(value)) return value;
  try {
    return capturedJsonParse(value);
  } catch {
    return value;
  }
}

/**
 * Read JSON bytes as a declared contract.
 *
 * `JSON.parse` returns `any`, so every reader in the tree ended in `as T`. The type parameter says
 * the same thing in one place. It remains a declaration about whoever wrote those bytes and not a
 * check on them: this owner narrows `any` and can observe no mismatch. A reader that must refuse
 * damaged bytes validates them itself, as `read` in src/kernel/log.ts does when it refuses a line.
 */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- `T` is the caller's declared contract, narrowed once here for every reader of a log or a pack
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
export function lockJsonGlobals(): void {
  for (const value of [Array, Array.prototype, JSON, Object]) freeze(value);
  for (const name of ["Array", "JSON", "Object"] as const) {
    defineProperty(globalThis, name, { value: globalThis[name], writable: false, configurable: false });
  }
}
