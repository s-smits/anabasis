import { describe, expect, it } from "bun:test";
import { sep } from "../src/meta/path.ts";
import { containsPath, posixContainsPath } from "../src/meta/path-containment.ts";
import { errorCode } from "../src/meta/runtime-values.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { hashJsonValue, sameJsonValue, stableJson } from "../src/meta/stable-json.ts";
import { keyIfDefined, keyIfNotNull, keysIf } from "../src/meta/optional-key.ts";
import { hasText, textOr } from "../src/meta/text.ts";
import { isObject } from "../src/meta/json-shape.ts";

describe("path containment", () => {
  it("contains host paths at a separator boundary, including roots with a trailing separator", () => {
    const root = sep === "/" ? "/campaign/epoch" : String.raw`C:\campaign\epoch`;
    expect(containsPath(root, root)).toBe(true);
    expect(containsPath(`${root}${sep}nested`, root)).toBe(true);
    expect(containsPath(`${root}${sep}nested`, `${root}${sep}`)).toBe(true);
    expect(containsPath(`${root}-sibling`, root)).toBe(false);
  });

  it("keeps POSIX profile paths separate from host or backslash spelling", () => {
    expect(posixContainsPath("/tmp", "/")).toBe(true);
    expect(posixContainsPath("/tmp/nested", "/tmp/")).toBe(true);
    expect(posixContainsPath("/tmp-sibling", "/tmp")).toBe(false);
    expect(posixContainsPath(String.raw`/tmp\nested`, "/tmp")).toBe(false);
  });
});

describe("owned runtime value types", () => {
  it("accepts only a string error code", () => {
    expect(errorCode(Object.assign(new Error("missing"), { code: "ENOENT" }))).toBe("ENOENT");
    expect(errorCode(Object.assign(new Error("bad"), { code: 2 }))).toBeUndefined();
    expect(errorCode({ code: "ENOENT" })).toBeUndefined();
  });
});

describe("isObject", () => {
  // `typeof null` is "object", so the predicate this replaced returned true for null and asked
  // each caller to add `value !== null`. Twelve of its twenty-nine callers did not, and one of
  // those reached `part.type` on a null and threw a TypeError where its function declares
  // `Error("generated tool result must contain text content")`. The exclusion belongs here.
  it("excludes null while admitting every other object", () => {
    for (const value of [null, undefined, "", 0]) expect(isObject(value)).toBe(false);
    for (const value of [{}, [], new Date(0)]) expect(isObject(value)).toBe(true);
  });
});

describe("stable JSON identity", () => {
  it("ignores object insertion order while retaining array order", () => {
    const left = { z: { beta: 2, alpha: 1 }, a: ["first", "second"] };
    const right = { a: ["first", "second"], z: { alpha: 1, beta: 2 } };
    expect(stableJson(left)).toBe('{"a":["first","second"],"z":{"alpha":1,"beta":2}}');
    expect(hashJsonValue(left)).toBe(hashJsonValue(right));
    expect(sameJsonValue(left, right)).toBe(true);
    expect(sameJsonValue(left, { ...right, a: ["second", "first"] })).toBe(false);
  });

  it("rejects values whose JSON identity would be lossy or surprising", () => {
    const cyclic: Record<string, JsonValue> = {};
    cyclic.self = cyclic;
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, new Date(0), new Map(), cyclic]) {
      expect(() => stableJson(value)).toThrow(/not stable finite JSON/);
    }
  });
});

describe("keyIfDefined", () => {
  it("omits undefined while keeping null, empty string, zero and false", () => {
    const spread = { a: 1, ...keyIfDefined("b", undefined) };
    expect(Object.hasOwn(spread, "b")).toBe(false);
    expect(Object.keys(spread)).toEqual(["a"]);
    for (const value of [null, "", 0, false]) expect<unknown>(keyIfDefined("b", value)).toEqual({ b: value });
  });
});

describe("keyIfNotNull", () => {
  it("omits both spellings of absence at a JSON boundary", () => {
    for (const value of [null, undefined]) expect(Object.keys(keyIfNotNull("b", value))).toEqual([]);
  });
});

describe("keysIf", () => {
  it("does not run the callback when the condition is false", () => {
    let calls = 0;
    const keys = () => {
      calls += 1;
      return { b: 1 };
    };
    expect({ a: 1, ...keysIf(false, keys) }).toEqual({ a: 1 });
    expect(calls).toBe(0);
    expect({ a: 1, ...keysIf(true, keys) }).toEqual({ a: 1, b: 1 });
    expect(calls).toBe(1);
  });
});

describe("hasText", () => {
  it("reads exactly as the truthiness test it replaced, and narrows", () => {
    for (const value of [undefined, null, ""]) expect(hasText(value)).toBe(false);
    for (const value of ["x", " ", "0", "false"]) expect(hasText(value)).toBe(true);
    expect(textOr(" ", "fallback")).toBe(" ");
    expect(textOr("", "fallback")).toBe("fallback");
    expect(textOr(undefined, "fallback")).toBe("fallback");
  });
});
