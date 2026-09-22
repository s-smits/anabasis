/**
 * Helpers for omitting optional object properties when their values are absent.
 *
 * `exactOptionalPropertyTypes` is on, so `{ model: undefined }` and `{}` are different values: an
 * optional property declared without undefined must be omitted when it has no value. Previously,
 * 246 conditional spreads across 74 files repeated forms such as
 * `...(value === undefined ? {} : { model: value })`. These helpers name the condition for
 * inclusion directly and keep the computed-property construction in one place, while preserving
 * the distinction between an omitted key and a present key.
 *
 * Absence has three spellings and they are not interchangeable. A function argument or an
 * in-process option is absent as `undefined`; a recorded JSON boundary writes `null`, because JSON
 * has no undefined; the particular schema defines what null means. A truthiness test also
 * drops `""`, `0` and `false`. Each caller keeps the condition its
 * conditional spread had, so no behaviour changes inside a lint fix.
 */

/** What the three `keyIf*` functions return: an optional key that is never present as `undefined`. */
type Key<K extends string, V> = { [P in K]?: Exclude<V, null | undefined> };

/**
 * The one assertion. A computed key produces `{ [x: string]: V }`, which TypeScript cannot relate
 * to the mapped type even though the two describe the same object.
 */
function keyed<K extends string, V>(key: K, value: V) {
  // SAFETY: the object is built here from `key` and `value` alone, so it has exactly one key, of
  // type `K`, holding exactly `value`, which each caller has already checked is present.
  // TypeScript infers `{ [x: string]: V }` for a computed key and cannot connect it to this
  // mapped type through inference or `satisfies`. Keep the assertion local so any further
  // assertion must explain its own justification.
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
 * Include a group of keys only when a condition holds. The keys are built by a callback so that
 * work in the present case — a lookup, a filesystem probe, a throwing resolver — does not run in
 * the absent case, which is what the spread of a ternary gave for free.
 *
 * The boolean is the datum here, not a mode of the callee. Every one of the forty-odd calls passes
 * a predicate it has just evaluated — `this.files.size > 0`, `existsSync(rustup)`,
 * `output === "verdict"` — so no call site reads as `keysIf(…, true)`, and two state words would
 * make each of them spell `? "include" : "omit"` instead.
 */
export function keysIf<T extends object>(condition: boolean, keys: () => T): Partial<T> {
  return condition ? keys() : {};
}
