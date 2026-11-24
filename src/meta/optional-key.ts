// oxlint-disable-next-line typescript/consistent-indexed-object-style -- `keyIfDefined` and `keyIfNotNull` typecheck against this mapped form and not against `Partial<Record<K, ...>>`
type Key<K extends string, V> = { [P in K]?: Exclude<V, null | undefined> };

function keyed<K extends string, V>(key: K, value: V) {
  // SAFETY: `{ [key]: value }` holds only key `K` with a caller-verified present `value`.
  return { [key]: value } as Key<K, V>;
}

export function keyIfDefined<K extends string, V>(key: K, value: V): Key<K, V> {
  return value === undefined ? {} : keyed(key, value);
}

export function keyIfNotNull<K extends string, V>(key: K, value: V): Key<K, V> {
  return value === null || value === undefined ? {} : keyed(key, value);
}

export function keysIf<T extends object>(condition: boolean, keys: () => T): Partial<T> {
  return condition ? keys() : {};
}
