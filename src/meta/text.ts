const TOKEN_CHAR = /[A-Za-z0-9_-]/u;

export function hasText(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value !== "";
}

export function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

export function textOr(value: string | null | undefined, fallback: string): string {
  return hasText(value) ? value : fallback;
}

export function hasWholeToken(haystack: string, needle: string): boolean {
  if (needle === "") return false;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    if (!TOKEN_CHAR.test(haystack.charAt(at - 1)) && !TOKEN_CHAR.test(haystack.charAt(at + needle.length))) {
      return true;
    }
  }
  return false;
}
