/**
 * The few places a test lets a value of unproven type through. Bun types its asymmetric matchers
 * (`expect.any`, `expect.stringContaining`, ...) as `any`, which the type-aware lint reports at each
 * use. They stand in for a value of whatever type the slot holds, so each returns `never` and the
 * cast is written once, here. `present` replaces a `!` on a lookup the test has just arranged.
 */
import { expect } from "bun:test";

/** The value, or a thrown error naming what the test expected to find. */
export function present<T>(value: T | null | undefined, what = "a value the test arranged"): T {
  if (value === null || value === undefined) throw new Error(`expected ${what} to be present`);
  return value;
}

/** A string that contains `text`. */
export function containing(text: string): never {
  // SAFETY: an asymmetric matcher is compared by `toEqual` and never read as a value.
  return expect.stringContaining(text) as never;
}

/** A string that matches `pattern`. */
export function matching(pattern: RegExp | string): never {
  // SAFETY: an asymmetric matcher is compared by `toEqual` and never read as a value.
  return expect.stringMatching(pattern) as never;
}

/** Any value of the constructor's type, such as `Number` or `String`. */
export function anyOf(constructor: NumberConstructor | StringConstructor | BooleanConstructor): never {
  // SAFETY: an asymmetric matcher is compared by `toEqual` and never read as a value.
  return expect.any(constructor) as never;
}

/** An object that holds at least these fields. */
export function objectWith<Fields extends object>(fields: Fields): never {
  // SAFETY: an asymmetric matcher is compared by `toEqual` and never read as a value.
  return expect.objectContaining(fields) as never;
}

/** An array that holds at least these items. */
export function arrayWith<Item>(items: readonly Item[]): never {
  // SAFETY: an asymmetric matcher is compared by `toEqual` and never read as a value.
  return expect.arrayContaining([...items]) as never;
}

/** A number within `digits` decimal places of `value`. */
export function nearly(value: number, digits: number): never {
  // SAFETY: an asymmetric matcher is compared by `toEqual` and never read as a value.
  return expect.closeTo(value, digits) as never;
}

/** `count` copies of `value`, typed as the item. */
export function copies<T>(count: number, value: T): T[] {
  return Array.from({ length: count }, () => value);
}
