/**
 * Two windows over one file, one owner. `readWindow` takes the whole text and `readFileWindow`
 * streams it, and the claim is equivalence: the same window, whether or not the file was already in
 * memory. Anything weaker would let the streaming path drift from the owner that defines a window,
 * which is where a character split across a chunk boundary and a page that retains every chunk
 * before it both live. `windowRange` is the arithmetic underneath both, so the offsets and limits a
 * model actually sends are settled here too.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { heapStats } from "bun:jsc";
import { readdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { readFileCharacterWindow, readFileWindow, scanTextFile } from "../src/builder/file-window.ts";
import { readWindow } from "../src/builder/read-window.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

afterAll(cleanupScratch);

function fwFile(name: string, text: string) {
  const dir = scratchDir("ana-window-");
  const path = join(dir, name);
  writeFileSync(path, text);
  return { path, lines: text.split(/\r?\n/).length, text };
}

describe("streaming file window", () => {
  // The claim under test is equivalence: the same window, whether the file is in memory or not.
  // Anything weaker would let the streaming path drift from the owner that defines a window.
  it("returns what the in-memory owner returns, at the start, the middle and the end", () => {
    const sample = fwFile(
      "sample.txt",
      `${Array.from({ length: 5_000 }, (_, i) => `line ${i + 1} ${"y".repeat(i % 40)}`).join("\n")}\n`,
    );
    for (const [offset, limit] of [
      [1, 5],
      [100, 3],
      [2_500, 400],
      [4_999, 10],
    ] as const) {
      expect(readFileWindow(sample.path, sample.lines, offset, limit)).toEqual(
        readWindow(sample.text, offset, limit),
      );
    }
  });

  it("clamps a negative offset and a zero limit rather than paging from the end", () => {
    // windowRange is the arithmetic both windows share, and a model sends a negative offset and a
    // zero limit often enough that run 35 recorded both. Unclamped, a negative offset slices from
    // the end of the file: the caller asked for the start and would be handed the tail with nothing
    // saying so. A zero limit is one line, not none, because an empty page cannot be walked.
    const sample = fwFile("clamped.txt", "one\ntwo\nthree\nfour\n");
    for (const [offset, limit] of [
      [-40, 2],
      [1, 0],
      [1, 2.7],
      [0, 1],
    ] as const) {
      expect(readFileWindow(sample.path, sample.lines, offset, limit)).toEqual(
        readWindow(sample.text, offset, limit),
      );
    }
    expect(readWindow(sample.text, -40, 2)).toMatchObject({ from: 1, to: 2, text: "one\ntwo" });
    expect(readWindow(sample.text, 1, 0)).toMatchObject({ from: 1, to: 1, text: "one" });
  });

  it("completes a character split across the chunk boundary instead of decoding a replacement", () => {
    // The euro sign is three bytes and its first byte is the last byte of the 256 KiB chunk.
    const wide = fwFile("wide.txt", `${"a".repeat(256 * 1024 - 1)}€\nsecond\nthird\n`);
    expect(readFileWindow(wide.path, wide.lines, 2, 2).text).toBe("second\nthird");
    // The first line is longer than the byte guard, so both paths cut it in the same place and
    // neither may leave a replacement character at the cut.
    expect(readFileWindow(wide.path, wide.lines, 1, 1)).toEqual(readWindow(wide.text, 1, 1));
    expect(readFileWindow(wide.path, wide.lines, 1, 1).text).not.toContain("\uFFFD");
  });

  it("reports the file's own total, so a window inside a large file is not read as complete", () => {
    const sample = fwFile("many.txt", `${Array.from({ length: 900 }, (_, i) => `row ${i}`).join("\n")}\n`);
    const window = readFileWindow(sample.path, sample.lines, 10, 5);
    expect([window.from, window.to, window.total, window.more]).toEqual([10, 14, 901, true]);
  });

  it("gives an empty window past the end rather than an error", () => {
    const sample = fwFile("short.txt", "one\ntwo\n");
    expect(readFileWindow(sample.path, sample.lines, 99, 5)).toEqual(readWindow(sample.text, 99, 5));
  });

  it("closes the file at an early stop, so a page and a refused scan leak no descriptor", () => {
    // The chunk walk is a generator, so the handle is released by the `for...of` protocol calling
    // its `return()` at the break rather than by a callback returning false. Both stops below take
    // that path — the page has its characters before the file ends, and the scan meets a zero byte
    // — and neither is visible to a test that only reads what they returned.
    const page = fwFile("pages.txt", "x".repeat(4096));
    const binary = fwFile("binary.bin", `head\u0000tail`);
    const open = (): number => readdirSync("/dev/fd").length;
    const before = open();
    for (let repeat = 0; repeat < 64; repeat += 1) {
      expect(readFileCharacterWindow(page.path, 4096, 0, 8).text).toBe("x".repeat(8));
      expect(scanTextFile(binary.path).text).toBe(false);
    }
    expect(open()).toBe(before);
  });

  it("holds one chunk, not the bytes it skipped", () => {
    // 24 MiB of ASCII: paging to the last line must not cost the file's size in memory. opencode's
    // rope retains every leaf up to the requested line, which is the difference being tested.
    const rows = 300_000;
    const sample = fwFile(
      "big.txt",
      `${Array.from({ length: rows }, (_, i) => `${i} ${"z".repeat(70)}`).join("\n")}\n`,
    );
    // Bun's own heap figure: the gate keeps process APIs out, and heapSize is the JS heap the
    // retained leaves would land in. Collect around both samples, because heapSize counts garbage
    // that has not been collected yet and the 24 MiB fixture string is one such object.
    Bun.gc(true);
    const before = heapStats().heapSize;
    const window = readFileWindow(sample.path, sample.lines, rows - 2, 3);
    Bun.gc(true);
    const grew = heapStats().heapSize - before;
    expect(window.text.startsWith(`${rows - 3} `)).toBe(true);
    expect(grew).toBeLessThan(8 * 1024 * 1024);
  });
});
