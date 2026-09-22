/**
 * Names for the two string states a truthiness test folds together: absent and `""`. A blank
 * environment variable, `?code=` and a model's empty tool argument all arrive as `""`. Use
 * `hasText` where either means nothing, and `!== undefined` where only presence matters.
 */

/** True when a string is present and holds something other than the empty string. */
export function hasText(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value !== "";
}

/** `value` when it holds text, else `fallback`. */
export function textOr(value: string | null | undefined, fallback: string): string {
  return hasText(value) ? value : fallback;
}
