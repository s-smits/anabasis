/**
 * Helpers for omitting optional object properties when their values are absent.
 *
 * `exactOptionalPropertyTypes` is on, so `{ model: undefined }` and `{}` differ: an optional
 * property declared without undefined must be omitted when it has no value. These helpers replace
 * `...(value === undefined ? {} : { model: value })` and name the condition for inclusion.
 *
 * Absence has three spellings and they are not interchangeable: `undefined` in process, `null` at
 * a JSON boundary, and falsy, which also drops `""`, `0` and `false`.
 */

/** What the three `keyIf*` functions return: an optional key that is never present as `undefined`. */
type Key<K extends string, V> = { [P in K]?: Exclude<V, null | undefined> };

/** The one assertion: TypeScript types a computed key as `{ [x: string]: V }`. */
function keyed<K extends string, V>(key: K, value: V) {
  // SAFETY: the object has exactly one key, of type `K`, holding `value`, which each caller has
  // already checked is present; TypeScript cannot relate a computed key to this mapped type.
  return { [key]: value } as Key<K, V>;
}

/** Omit the key when the value is `undefined`. */
export function keyIfDefined<K extends string, V>(key: K, value: V): Key<K, V> {
  return value === undefined ? {} : keyed(key, value);
}

/** Omit the key when the value is `null` or `undefined` — the JSON-boundary spelling. */
export function keyIfNotNull<K extends string, V>(key: K, value: V): Key<K, V> {
  return value === null || value === undefined ? {} : keyed(key, value);
}

/** Omit the key when the value is falsy, so `""`, `0` and `false` drop it as well. */
export function keyIfTruthy<K extends string, V>(key: K, value: V): Key<K, V> {
  return value ? keyed(key, value) : {};
}

/**
 * Include a group of keys only when a condition holds. The callback keeps the present case's work
 * (a lookup, a filesystem probe, a throwing resolver) from running in the absent case. Callers
 * pass a predicate they have just evaluated, so the boolean is data rather than a mode.
 */
export function keysIf<T extends object>(condition: boolean, keys: () => T): Partial<T> {
  return condition ? keys() : {};
}
