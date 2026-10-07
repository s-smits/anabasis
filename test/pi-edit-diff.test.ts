// Pi exercises edit-diff only through its edit tool and its TUI diff rendering, so no upstream test
// pins these functions on their own. The Builder's edit calls them directly (src/builder/tools.ts),
// so the cases below pin what it relies on: the line ending and BOM round trip, the refusals the
// Builder reads, and how a near match is applied.

import { describe, expect, it } from "bun:test";
import {
  applyEditsToNormalizedContent,
  detectLineEnding,
  normalizeForFuzzyMatch,
  normalizeToLF,
  restoreLineEndings,
} from "../vendor/pi-coding-agent/core/tools/edit-diff.ts";
import { splitBom } from "../vendor/pi-coding-agent/utils/text.ts";

const single = (oldText: string, newText: string, content = "abcdef") =>
  applyEditsToNormalizedContent(content, [{ oldText, newText }], "f.ts");

describe("edit-diff line endings and text.ts BOM split", () => {
  it("detects the file's line ending and restores it after editing LF-normalized text", () => {
    expect(detectLineEnding("a\r\nb")).toBe("\r\n");
    expect(detectLineEnding("a\nb\r\nc")).toBe("\n");
    expect(detectLineEnding("single line")).toBe("\n");

    const crlf = "one\r\ntwo\r\n";
    const normalized = normalizeToLF(crlf);
    expect(normalized).toBe("one\ntwo\n");
    expect(restoreLineEndings(normalized, "\r\n")).toBe(crlf);
    expect(restoreLineEndings(normalized, "\n")).toBe(normalized);
  });

  it("separates a UTF-8 BOM from the text so it can be written back unchanged", () => {
    expect(splitBom("﻿content")).toEqual({ bom: "﻿", text: "content" });
    expect(splitBom("content")).toEqual({ bom: "", text: "content" });
  });
});

describe("applyEditsToNormalizedContent", () => {
  it("applies exact replacements against the same original offsets, with CRLF edit text normalized", () => {
    expect(single("beta", "gamma", "alpha\nbeta\n")).toEqual({
      baseContent: "alpha\nbeta\n",
      newContent: "alpha\ngamma\n",
    });
    const several = applyEditsToNormalizedContent(
      "alpha\nbeta\ngamma\n",
      [
        { oldText: "alpha", newText: "AAAAAAAAAA" },
        { oldText: "gamma", newText: "G" },
      ],
      "f.ts",
    );
    expect(several.newContent).toBe("AAAAAAAAAA\nbeta\nG\n");
    expect(single("one\r\ntwo", "one\r\nTWO", "one\ntwo\n").newContent).toBe("one\nTWO\n");
  });

  it("refuses empty, missing, repeated, overlapping or unchanged edit text", () => {
    expect(() => single("", "x")).toThrow(/oldText must not be empty in f\.ts/);
    expect(() => single("zzz", "x")).toThrow(/Could not find the exact text in f\.ts/);
    expect(() => single("abc", "abc")).toThrow(/No changes made to f\.ts/);
    expect(() => single("foo", "x", "foo\nfoo\n")).toThrow(/Found 2 occurrences of the text in f\.ts/);
    expect(() =>
      applyEditsToNormalizedContent(
        "abcdef",
        [
          { oldText: "abc", newText: "X" },
          { oldText: "cde", newText: "Y" },
        ],
        "f.ts",
      ),
    ).toThrow(/edits\[0\] and edits\[1\] overlap in f\.ts/);
    // Occurrences are counted after folding, so two lines differing only in trailing space collide.
    expect(() => single("foo", "x", "foo  \nfoo\n")).toThrow(/Found 2 occurrences/);
  });

  it("folds only special spaces, smart quotes, dashes and trailing whitespace", () => {
    expect(normalizeForFuzzyMatch("{3} a b c　d “q” x—y  ")).toBe('{3} a b c d "q" x-y');
    expect(() => single("return {", "return {\n  b: 2,", "return {\n  a: 1,\n};\nreturn 3;\n")).not.toThrow();
  });

  it("applies a near match to the lines it touches and keeps every other line's bytes", () => {
    const content = "const greeting = “hi”;\nconst keep = “untouched”;  \nconst set = {3};\n";
    expect(single('const greeting = "hi";', 'const greeting = "hello";', content).newContent).toBe(
      'const greeting = "hello";\nconst keep = “untouched”;  \nconst set = {3};\n',
    );
  });
});
