import { describe, expect, it } from "bun:test";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { SANITIZER_VERSION, sanitizeForEvaluator } from "../src/correctness-bundle/sanitize.ts";

/** The sanitized value, which the sanitizer answers as `unknown` because it takes `unknown`. */
const sanitized = <T>(out: { value: unknown }): T =>
  // SAFETY: the sanitizer preserves structure and only rewrites string leaves and keys, so the
  // shape each caller states is the shape it handed in one line above.
  out.value as T;

describe("sanitizeForEvaluator (versioned evaluator-input normalizer)", () => {
  it("an untouched input records modified:false with the version and no actions", () => {
    const input = { route: ["a", "b"], note: "plain prose\nwith a line break\tand a tab" };
    const out = sanitizeForEvaluator(input);
    expect(out).toEqual({ value: input, version: SANITIZER_VERSION, modified: false, actions: [] });
    // The walk rebuilds the tree: the evaluator can never alias the controller's objects.
    expect(out.value).not.toBe(input);
  });

  it("strips C0/C1 controls (keeping newline and tab) and the invisible/bidi characters", () => {
    const out = sanitizeForEvaluator({
      c0: "a\u0007b\u0000c",
      kept: "line\nbreak\ttab",
      c1: "x\u0085y",
      zeroWidth: "S​Y‌S‍TEM",
      bidi: "safe‮txet-desrever‬",
      isolate: "a⁦b⁩c",
      bom: "﻿lead",
    });
    expect(out.value).toEqual({
      c0: "abc",
      kept: "line\nbreak\ttab",
      c1: "xy",
      zeroWidth: "SYSTEM",
      bidi: "safetxet-desrever",
      isolate: "abc",
      bom: "lead",
    });
    expect(out.modified).toBe(true);
    expect(out.actions).toEqual(["stripped-control-characters"]);
  });

  it("sanitises object keys too — a key is model-visible bytes like any other string", () => {
    const out = sanitizeForEvaluator({ "no​te": "v" });
    expect(out.value).toEqual({ note: "v" });
    expect(out.actions).toEqual(["stripped-control-characters"]);
  });

  it('preserves a model-authored "__proto__" key as an own entry instead of dropping it', () => {
    // JSON.parse creates "__proto__" as an OWN key; a plain out[key]=v rebuild would invoke the
    // Object.prototype setter and silently remove the entry from the judge-visible bytes.
    const hostile = JSON.parse('{"__proto__":{"hiddenDefect":"judge must see this"},"kept":"x"}');
    const out = sanitizeForEvaluator(hostile);
    const serialized = JSON.stringify(out.value);
    expect(serialized).toContain("hiddenDefect");
    expect(serialized).toContain("judge must see this");
    expect(Object.getPrototypeOf(out.value)).toBe(Object.prototype);
    expect(out.modified).toBe(false);
  });

  it("renames keys that collide after sanitization so neither value silently vanishes", () => {
    const out = sanitizeForEvaluator({ note: "first", "no​te": "second" });
    const value = sanitized<Record<string, string>>(out);
    expect(value.note).toBe("first");
    expect(value["note…[sanitizer: truncated]"]).toBe("second");
    expect(out.actions).toEqual(["renamed-colliding-key", "stripped-control-characters"]);
  });

  it("bounds total text across strings and collapses the remaining container once", () => {
    const out = sanitizeForEvaluator({ files: Array.from({ length: 1_000 }, () => "x".repeat(4_000)) });
    const value = sanitized<{ files: string[] }>(out);
    const rendered = JSON.stringify(value);
    expect(rendered.length).toBeLessThan(65_000);
    expect(rendered).toContain("…[sanitizer: truncated]");
    expect(value.files[0]).toBe("x".repeat(4_000));
    expect(value.files.length).toBeLessThan(20);
    expect(out.actions).toEqual(["truncated-text"]);
  });

  it("caps nesting depth with the marker in place of the deep subtree", () => {
    let deep: JsonValue = "leaf";
    for (let i = 0; i < 70; i += 1) deep = { nest: deep };
    const out = sanitizeForEvaluator(deep);
    expect(out.actions).toEqual(["truncated-depth"]);
    expect(JSON.stringify(out.value)).toContain("…[sanitizer: truncated]");
  });

  it("caps total node count and replaces the remainder with one marker", () => {
    const out = sanitizeForEvaluator({ rows: Array.from({ length: 25000 }, (_, i) => i) });
    expect(out.actions).toEqual(["truncated-nodes"]);
    expect(out.modified).toBe(true);
    // root object + "rows" key + the array = 3 nodes, so 19997 elements fit under the 20000
    // budget; the remaining 5003 elements must appear as a single trailing marker.
    const { rows } = sanitized<{ rows: unknown[] }>(out);
    expect(rows).toHaveLength(19998);
    expect(rows[19997]).toBe("…[sanitizer: truncated]");
    expect(rows[19996]).toBe(19996);
  });

  it("passes scalars and null through unchanged", () => {
    expect(sanitizeForEvaluator(null)).toMatchObject({ value: null, modified: false });
    expect(sanitizeForEvaluator(42)).toMatchObject({ value: 42, modified: false });
    expect(sanitizeForEvaluator(true)).toMatchObject({ value: true, modified: false });
  });
});
