import { sha256 } from "./digest.ts";
import { isString, type JsonObject, type JsonValue } from "./json-shape.ts";

const freeze = Object.freeze.bind(Object);
const defineProperty = Object.defineProperty.bind(Object);

const nativeJsonParse = JSON.parse.bind(JSON);
export const capturedJsonParse: (text: string) => JsonValue = nativeJsonParse;
export const capturedJsonStringify: <T>(
  value: T,
  replacer?: null,
  space?: string | number,
) => undefined extends T ? string | undefined : string = JSON.stringify.bind(JSON);

export function decodedJsonText(value: JsonValue): JsonValue {
  if (!isString(value)) return value;
  try {
    return capturedJsonParse(value);
  } catch {
    return value;
  }
}

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- `T` is the caller's declared contract, narrowed once here for every reader of a log or a pack
export function parseJsonAs<T>(source: string | JsonObject): T {
  // SAFETY: `T` is the caller's declared contract for these JSON bytes or parsed object.
  return (isString(source) ? nativeJsonParse(source) : source) as T;
}

export function hashJsonBytes(value: unknown): string {
  return sha256(capturedJsonStringify(value) ?? "undefined");
}

export function lockJsonGlobals(): void {
  for (const value of [Array, Array.prototype, JSON, Object]) freeze(value);
  for (const name of ["Array", "JSON", "Object"] as const) {
    defineProperty(globalThis, name, { value: globalThis[name], writable: false, configurable: false });
  }
}
