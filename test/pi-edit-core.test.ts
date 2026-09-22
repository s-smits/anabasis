// No pi-mono test covers these functions: upstream exercises edit-diff only through its edit tool
// and its TUI diff rendering, both of which this repository dropped. The cases below are therefore
// written here, and they also pin the one place where this copy deliberately refuses what upstream
// accepted (see the fuzzy-match comment in src/builder/pi-coding/edit-core.ts).

import { describe, expect, it } from "bun:test";
import {
  applyEditsToNormalizedContent,
  detectLineEnding,
  normalizeForFuzzyMatch,
  normalizeToLF,
  restoreLineEndings,
  stripBom,
} from "../src/builder/pi-coding/edit-core.ts";

describe("edit-core line endings and BOM", () => {
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
    expect(stripBom("﻿content")).toEqual({ bom: "﻿", text: "content" });
    expect(stripBom("content")).toEqual({ bom: "", text: "content" });
  });
});

describe("applyEditsToNormalizedContent", () => {
  it("applies one exact replacement and returns the base it matched against", () => {
    const result = applyEditsToNormalizedContent(
      "alpha\nbeta\n",
      [{ oldText: "beta", newText: "gamma" }],
      "f.ts",
    );
    expect(result.baseContent).toBe("alpha\nbeta\n");
    expect(result.newContent).toBe("alpha\ngamma\n");
  });

  it("applies several disjoint edits against the same original offsets", () => {
    const result = applyEditsToNormalizedContent(
      "alpha\nbeta\ngamma\n",
      [
        { oldText: "alpha", newText: "AAAAAAAAAA" },
        { oldText: "gamma", newText: "G" },
      ],
      "f.ts",
    );
    expect(result.newContent).toBe("AAAAAAAAAA\nbeta\nG\n");
  });

  it("normalizes CRLF inside the supplied edit texts before matching", () => {
    const result = applyEditsToNormalizedContent(
      "one\ntwo\n",
      [{ oldText: "one\r\ntwo", newText: "one\r\nTWO" }],
      "f.ts",
    );
    expect(result.newContent).toBe("one\nTWO\n");
  });

  it("refuses a near match that would normalize unrelated text", () => {
    // Upstream rebuilt the whole file from normalizeForFuzzyMatch and replaced from that, folding
    // every smart quote, dash and trailing space outside the edited region. Here the same input
    // must fail and leave the caller to re-read exact bytes.
    const content = "const greeting = “hi”;\n";
    expect(normalizeForFuzzyMatch(content)).toBe('const greeting = "hi";\n');
    expect(() =>
      applyEditsToNormalizedContent(content, [{ oldText: 'const greeting = "hi";', newText: "" }], "f.ts"),
    ).toThrow(/Could not find an exact match for edits\[0\] in f\.ts/);
  });

  it("refuses empty, missing, repeated, overlapping or unchanged edit text", () => {
    const single = (oldText: string, newText: string, content = "abcdef") =>
      applyEditsToNormalizedContent(content, [{ oldText, newText }], "f.ts");

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
  });

  it("counts occurrences after fuzzy folding, so two lines differing only in trailing space collide", () => {
    expect(() =>
      applyEditsToNormalizedContent("foo  \nfoo\n", [{ oldText: "foo", newText: "x" }], "f.ts"),
    ).toThrow(/Found 2 occurrences/);
  });
});
