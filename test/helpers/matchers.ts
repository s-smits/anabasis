/**
 * Bun types its asymmetric matchers (`expect.any`, `expect.stringContaining`, ...) as `any`, which
 * the type-aware lint reports at each use; each returns `never` so the cast is written once, here.
 * `present` replaces a `!` on a lookup the test has just arranged.
 */
import { expect } from "bun:test";

export function present<T>(value: T | null | undefined, what = "a value the test arranged"): T {
  if (value === null || value === undefined) throw new Error(`expected ${what} to be present`);
  return value;
}

export function containing(text: string): never {
  // SAFETY: an asymmetric matcher is compared by `toEqual` and never read as a value.
  return expect.stringContaining(text) as never;
}

export function matching(pattern: RegExp | string): never {
  // SAFETY: an asymmetric matcher is compared by `toEqual` and never read as a value.
  return expect.stringMatching(pattern) as never;
}

export function anyOf(constructor: NumberConstructor | StringConstructor | BooleanConstructor): never {
  // SAFETY: an asymmetric matcher is compared by `toEqual` and never read as a value.
  return expect.any(constructor) as never;
}

export function objectWith(fields: Parameters<typeof expect.objectContaining>[0]): never {
  // SAFETY: an asymmetric matcher is compared by `toEqual` and never read as a value.
  return expect.objectContaining(fields) as never;
}

export function arrayWith(items: readonly unknown[]): never {
  // SAFETY: an asymmetric matcher is compared by `toEqual` and never read as a value.
  return expect.arrayContaining([...items]) as never;
}

export function nearly(value: number, digits: number): never {
  // SAFETY: an asymmetric matcher is compared by `toEqual` and never read as a value.
  return expect.closeTo(value, digits) as never;
}

export function copies<T>(count: number, value: T): T[] {
  return Array.from({ length: count }, () => value);
}
