import { describe, expect, it } from "bun:test";
import { hostname, homedir, tmpdir } from "../src/meta/os.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from "../src/meta/path.ts";
import { containsPath, posixContainsPath } from "../src/meta/path-containment.ts";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { errorCode } from "../src/meta/runtime-values.ts";
import { sha256 } from "../src/meta/digest.ts";
import { hashJsonBytes } from "../src/meta/json-runtime.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import {
  canonicalJson,
  canonicalJsonCopy,
  compareCodeUnits,
  hashJsonValue,
  sameJsonValue,
  stableJson,
} from "../src/meta/stable-json.ts";
import { keyIfDefined, keyIfNotNull, keyIfTruthy, keysIf } from "../src/meta/optional-key.ts";
import { hasText, textOr } from "../src/meta/text.ts";
import { isObject, isRecord } from "../src/meta/json-shape.ts";

describe("OS compatibility exports", () => {
  it("preserves host directory and identity values", () => {
    expect(tmpdir().length).toBeGreaterThan(0);
    expect(homedir().startsWith("/")).toBe(true);
    expect(hostname().length).toBeGreaterThan(0);
  });
});

describe("process compatibility exports", () => {
  it("preserves cwd, pid and platform identity", () => {
    expect(runtimeProcess.cwd().length).toBeGreaterThan(0);
    expect(runtimeProcess.pid).toBeGreaterThan(0);
    expect(["darwin", "linux", "win32"]).toContain(runtimeProcess.platform);
  });
});

describe("path compatibility exports", () => {
  it("preserves filesystem and hostile traversal semantics", () => {
    const root = "/tmp/ana-path-root";
    const inside = resolve(root, "nested", "value.txt");
    const escaped = resolve(root, "..", "outside.txt");
    expect(join(root, "nested", "value.txt")).toBe(inside);
    expect(normalize(`${root}${sep}nested${sep}..${sep}value.txt`)).toBe(`${root}${sep}value.txt`);
    expect(relative(root, escaped).startsWith("..")).toBe(true);
    expect(isAbsolute(inside)).toBe(true);
    expect(dirname(inside)).toBe(`${root}${sep}nested`);
    expect(basename(inside)).toBe("value.txt");
  });

  it("contains host paths at a separator boundary, including roots with a trailing separator", () => {
    const root = sep === "/" ? "/campaign/epoch" : String.raw`C:\campaign\epoch`;
    expect(containsPath(root, root)).toBe(true);
    expect(containsPath(`${root}${sep}nested`, root)).toBe(true);
    expect(containsPath(`${root}${sep}nested`, `${root}${sep}`)).toBe(true);
    expect(containsPath(`${root}-sibling`, root)).toBe(false);
  });

  it("treats the platform filesystem root as the boundary root", () => {
    if (sep === "/") {
      expect(containsPath("/tmp", "/")).toBe(true);
    } else {
      expect(containsPath(String.raw`C:\tmp`, "C:\\")).toBe(true);
    }
  });

  it("keeps POSIX profile paths separate from host or backslash spelling", () => {
    expect(posixContainsPath("/tmp", "/")).toBe(true);
    expect(posixContainsPath("/tmp/nested", "/tmp/")).toBe(true);
    expect(posixContainsPath("/tmp-sibling", "/tmp")).toBe(false);
    expect(posixContainsPath(String.raw`/tmp\nested`, "/tmp")).toBe(false);
  });
});

describe("synchronous filesystem compatibility exports", () => {
  it("preserves synchronous file identity and temporary-tree cleanup", () => {
    const root = join(import.meta.dir, "../.scratch");
    mkdirSync(root, { recursive: true });
    const dir = mkdtempSync(`${root}/meta-compat-`);
    try {
      const file = `${dir}/value.txt`;
      writeFileSync(file, "value\n", "utf8");
      expect(readFileSync(file, "utf8")).toBe("value\n");
      expect(realpathSync(file)).toBe(file);
      expect(existsSync(file)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      expect(existsSync(dir)).toBe(false);
    }
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
    expect(isObject(null)).toBe(false);
    expect(isObject({})).toBe(true);
    expect(isObject([])).toBe(true);
    expect(isObject(new Date(0))).toBe(true);
    expect(isObject(undefined)).toBe(false);
    expect(isObject("")).toBe(false);
    expect(isObject(0)).toBe(false);
  });

  it("leaves isRecord excluding arrays as well as null", () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord({ a: 1 })).toBe(true);
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

  it("keeps native ordered JSON hashes explicit and byte-compatible", () => {
    const left = { z: 2, a: 1 };
    const right = { a: 1, z: 2 };
    expect(hashJsonBytes(left)).toBe(sha256(JSON.stringify(left)));
    expect(hashJsonBytes(left)).not.toBe(hashJsonBytes(right));
    expect(hashJsonValue(left)).toBe(hashJsonValue(right));
  });

  it("uses explicit code-unit order and native JSON array omission semantics", () => {
    expect(["ä", "z", "a"].sort(compareCodeUnits)).toEqual(["a", "z", "ä"]);
    expect(stableJson(Array(1))).toBe("[null]");
    expect(stableJson([undefined])).toBe("[null]");
    expect(stableJson({ kept: null, omitted: undefined })).toBe('{"kept":null}');
  });

  it("rejects values whose JSON identity would be lossy or surprising", () => {
    const cyclic: Record<string, JsonValue> = {};
    cyclic.self = cyclic;
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, new Date(0), new Map(), cyclic]) {
      expect(() => stableJson(value)).toThrow(/not stable finite JSON/);
    }
  });

  it("does not read a replaced global stringifier", () => {
    const original = JSON.stringify;
    // SAFETY: a deliberately poisoned stringifier, installed under the real signature so the
    // module under test reaches it exactly as it would reach the host one.
    JSON.stringify = (() => '"poisoned"') as typeof JSON.stringify;
    try {
      expect(stableJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
      expect(canonicalJson({ b: 2, a: undefined })).toBe('{"a":undefined,"b":2}');
      expect(hashJsonBytes({ b: 2, a: 1 })).toBe(sha256('{"b":2,"a":1}'));
    } finally {
      JSON.stringify = original;
    }
  });

  it("keeps strict boundary copies distinct from optional-field identity", () => {
    expect(canonicalJsonCopy({ b: 2, a: 1 })).toEqual({
      value: { b: 2, a: 1 },
      bytes: '{"a":1,"b":2}',
    });
    expect(() => canonicalJsonCopy({ optional: undefined })).toThrow(/not plain finite JSON/);
    expect(canonicalJson({ optional: undefined })).not.toBe(canonicalJson({ optional: null }));
  });
});

/**
 * Tests for src/meta/optional-key.ts, the helpers that replaced conditional empty-object
 * spreads. The property that matters is not "the key is there when the value is": it is that an
 * absent key is absent rather than present holding `undefined`, because `exactOptionalPropertyTypes`
 * makes those two different values and the recorded evidence writes whichever one it is given.
 *
 * The three absence tests are separate on purpose. A call site that meant "omit when undefined"
 * must not start dropping `""` or `0`, and a truthiness site must not start keeping them; a single
 * helper would have made that difference invisible at the call.
 */

describe("keyIfDefined", () => {
  it("omits the key rather than writing undefined", () => {
    const spread = { a: 1, ...keyIfDefined("b", undefined) };
    expect(Object.hasOwn(spread, "b")).toBe(false);
    expect(Object.keys(spread)).toEqual(["a"]);
  });

  it("keeps null, empty string, zero and false, which are values", () => {
    expect<unknown>(keyIfDefined("b", null)).toEqual({ b: null });
    expect(keyIfDefined("b", "")).toEqual({ b: "" });
    expect(keyIfDefined("b", 0)).toEqual({ b: 0 });
    expect(keyIfDefined("b", false)).toEqual({ b: false });
  });
});

describe("keyIfNotNull", () => {
  it("omits both spellings of absence at a JSON boundary", () => {
    expect(Object.keys({ ...keyIfNotNull("b", null) })).toEqual([]);
    expect(Object.keys({ ...keyIfNotNull("b", undefined) })).toEqual([]);
  });

  it("keeps zero, which a JSON boundary must not confuse with nothing measured", () => {
    expect(keyIfNotNull("cost", 0)).toEqual({ cost: 0 });
  });
});

describe("keyIfTruthy", () => {
  it("drops every falsy value, which is what the truthiness spreads did", () => {
    for (const value of [undefined, null, "", 0, false]) {
      expect(Object.keys({ ...keyIfTruthy("b", value) })).toEqual([]);
    }
  });

  it("keeps a present value", () => {
    expect(keyIfTruthy("b", "x")).toEqual({ b: "x" });
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

  it("adds every key of the group at once", () => {
    expect({ ...keysIf(true, () => ({ b: 1, c: 2 })) }).toEqual({ b: 1, c: 2 });
  });
});

describe("hasText", () => {
  it("reads exactly as the truthiness test it replaced, and narrows", () => {
    for (const value of [undefined, null, ""]) expect(hasText(value)).toBe(false);
    for (const value of ["x", " ", "0", "false"]) expect(hasText(value)).toBe(true);
  });

  it("keeps whitespace, because a blank line is text and an absent value is not", () => {
    // The nearest wrong turn is trimming here. `hasText` answers "did this arrive with
    // anything in it", and 160 conditions read it that way; a caller that means "and not
    // only spaces" trims its own value first.
    expect(hasText("\n")).toBe(true);
    expect(textOr(" ", "fallback")).toBe(" ");
    expect(textOr("", "fallback")).toBe("fallback");
    expect(textOr(undefined, "fallback")).toBe("fallback");
  });
});
