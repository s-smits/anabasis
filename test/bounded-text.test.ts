import { describe, expect, it } from "bun:test";

import { boundText } from "../src/meta/bounded-text.ts";

describe("boundText", () => {
  it("returns a text within the bound trimmed and unmarked", () => {
    expect(boundText("  short\n", 100)).toEqual({
      text: "short",
      truncated: false,
      totalBytes: 5,
      shown: "short",
    });
  });

  it("keeps whole lines and never ends on the whitespace at the cut", () => {
    const cut = boundText(`${"a".repeat(9)}\n\n${"b".repeat(20)}`, 10);
    expect([cut.text, cut.truncated, cut.shown]).toEqual([
      "a".repeat(9),
      true,
      `${"a".repeat(9)} […22 bytes omitted]`,
    ]);
  });

  it("cuts a single line longer than the bound on a whole code point", () => {
    // Each 🙂 is four UTF-8 bytes, so a 6-byte bound holds one and a half of them.
    const cut = boundText("🙂🙂🙂", 6);
    expect([cut.text, cut.totalBytes, cut.shown]).toEqual(["🙂", 12, "🙂 […8 bytes omitted]"]);
  });

  it("keeps the end of a tail and marks the omission in front", () => {
    const cut = boundText("first line\nsecond\nerror: last", 12, "tail");
    expect([cut.text, cut.shown]).toEqual(["error: last", "[…18 bytes omitted] error: last"]);
  });

  it("counts a single omitted byte in the singular", () => {
    expect(boundText("abcd", 3).shown).toBe("abc […1 byte omitted]");
  });

  it("applies a line bound as well as a byte bound", () => {
    expect(boundText("one\ntwo\nthree", 1000, "head", 2).text).toBe("one\ntwo");
    expect(boundText("one\ntwo\nthree", 1000, "tail", 2).text).toBe("two\nthree");
  });

  it("keeps a whole code point at either edge of an oversized line", () => {
    expect(boundText("prefix\n🙂é終", 6, "tail").text).toBe("é終");
    expect(boundText("🙂é終\nsuffix", 6).text).toBe("🙂é");
    expect(boundText("🙂", 0).shown).toBe("[…4 bytes omitted]");
    expect(boundText("🙂", 0, "tail").shown).toBe("[…4 bytes omitted]");
  });

  it("never exceeds the byte bound or breaks Unicode at either edge", () => {
    const source = "a🙂é\n終\n🙂last";
    for (const keep of ["head", "tail"] as const) {
      for (let bytes = 0; bytes <= 24; bytes++) {
        const cut = boundText(source, bytes, keep);
        expect(new TextEncoder().encode(cut.text).byteLength).toBeLessThanOrEqual(bytes);
        expect(cut.text).not.toContain("�");
        expect(cut.text).toBe(cut.text.trim());
        expect(keep === "head" ? source.startsWith(cut.text) : source.endsWith(cut.text)).toBe(true);
      }
    }
  });
});
