/**
 * The two string states a truthiness test folds together.
 *
 * `if (name)` over a `string | undefined` is false when the name is absent and false when it is
 * `""`, and the line does not say which the author meant. Both spellings of nothing are real here:
 * an environment variable set to blank arrives as `""`, `searchParams.get("code")` returns `""` for
 * `?code=`, and a model can send `""` for a required tool argument. Where either means nothing,
 * that is the right condition and `hasText` is its name. Where only presence is in question — an
 * identifier, the *name* of an environment variable, a value reached through an optional chain —
 * `!== undefined` says so, and is not this function.
 *
 * `hasText(value)` is exactly `Boolean(value)` for a string, so exchanging one for the other
 * changes no behaviour. It narrows to `string`, so it also serves where the old condition guarded
 * a use.
 */

/** True when a string is present and holds something other than the empty string. */
export function hasText(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value !== "";
}

/** A count with its noun, singular at one: `plural(1, "check")` is "1 check". A sentence that
 *  names the counted thing in the plural whatever the count, or hedges it as "check(s)", reads
 *  wrongly at one, which is the size a model most often meets. */
export function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/** `value` when it holds text, else `fallback` — the `value || fallback` that meant "blank is
 *  unset", written so the reader can see that is what it meant. */
export function textOr(value: string | null | undefined, fallback: string): string {
  return hasText(value) ? value : fallback;
}
