/**
 * Helpers for omitting optional object properties when their values are absent.
 *
 * `exactOptionalPropertyTypes` is on, so `{ model: undefined }` and `{}` are different values: an
 * optional property declared without undefined must be omitted when it has no value. Saying that in
 * place took 246 conditional spreads across 74 files, each repeating a form such as
 * `...(value === undefined ? {} : { model: value })`. These helpers name the condition for inclusion
 * directly and keep the computed-key construction, and the assertion it needs, in one place.
 *
 * Absence has three spellings and they are not interchangeable, which is why there are three
 * functions and not one. An argument or an in-process option is absent as `undefined`; a recorded
 * JSON boundary writes `null`, since JSON has no undefined, and the schema there decides what that
 * null means; a truthiness test also drops `""`, `0` and `false`, which at a boundary is the
 * difference between an omitted count and a count of zero. Each caller keeps the condition its own
 * conditional spread had, so adopting a helper changes no behaviour.
 */

/** What the three `keyIf*` functions return: an optional key that is never present as `undefined`. */
type Key<K extends string, V> = { [P in K]?: Exclude<V, null | undefined> };

/**
 * The one assertion. A computed key produces `{ [x: string]: V }`, which TypeScript cannot relate to
 * the mapped type above even though the two describe the same object.
 */
function keyed<K extends string, V>(key: K, value: V) {
  // SAFETY: the object is built here from `key` and `value` alone, so it has exactly one key, of
  // type `K`, holding exactly `value`, which each caller has already checked is present. Neither
  // inference nor `satisfies` connects a computed key to this mapped type. The assertion is kept
  // local so that any further one has to justify itself rather than lean on this file.
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
 * Include a group of keys only when a condition holds. The keys arrive in a callback so that work
 * belonging to the present case — a lookup, a filesystem probe, a throwing resolver — does not run
 * in the absent case, which is what the spread of a ternary gave for free.
 *
 * The boolean is the datum here, not a mode of the callee. All 49 call sites pass a predicate they
 * have just evaluated — `this.files.size > 0`, `existsSync(rustup)`, `readings.length > 0` — and the
 * only literal `true` in the tree is in this helper's own test. A two-word enum in its place would
 * make every one of them spell `? "include" : "omit"` around a condition they already hold.
 */
export function keysIf<T extends object>(condition: boolean, keys: () => T): Partial<T> {
  return condition ? keys() : {};
}
