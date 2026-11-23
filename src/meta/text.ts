/**
 * The two string states a truthiness test folds together.
 */

const TOKEN_CHAR = /[A-Za-z0-9_-]/u;

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

/** `value` when it holds text, else `fallback`: the `value || fallback` that meant "blank is
 *  unset", written so the reader can see that is what it meant. */
export function textOr(value: string | null | undefined, fallback: string): string {
  return hasText(value) ? value : fallback;
}

/** True when `needle` appears in `haystack` bounded away from identifier characters (`[A-Za-z0-9_-]`). */
export function hasWholeToken(haystack: string, needle: string): boolean {
  if (needle === "") return false;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    if (!TOKEN_CHAR.test(haystack.charAt(at - 1)) && !TOKEN_CHAR.test(haystack.charAt(at + needle.length))) {
      return true;
    }
  }
  return false;
}
