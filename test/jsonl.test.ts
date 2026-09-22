import { describe, expect, it } from "bun:test";
import { JSONL_LINE_MAX_BYTES, attachJsonlLineReader } from "../vendor/pi-built/jsonl.ts";

async function* asyncChunks(chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  yield* chunks;
}

describe("JSONL line framing", () => {
  it("splits complete lines before refusing an oversized unfinished buffer", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });
    const lines: string[] = [];
    const completed = attachJsonlLineReader(stream, (line) => lines.push(line), 12);

    controller.enqueue(new TextEncoder().encode('{"a":1}\n{"b":2}\n'));
    controller.enqueue(new TextEncoder().encode("x".repeat(13)));
    controller.close();
    await completed;
    expect(lines).toEqual(['{"a":1}', '{"b":2}', `${"x".repeat(12)}\0`]);
  });

  it("never retains a giant unterminated chunk and resumes after discarding its rest", async () => {
    const chunks = [
      new TextEncoder().encode("x".repeat(JSONL_LINE_MAX_BYTES * 3)),
      new TextEncoder().encode('\n{"ok":true}\n'),
    ];
    const lines: string[] = [];
    await attachJsonlLineReader(asyncChunks(chunks), (line) => lines.push(line));
    expect(lines).toEqual([`${"x".repeat(JSONL_LINE_MAX_BYTES)}\0`, '{"ok":true}']);
    expect(new TextEncoder().encode(lines[0]).byteLength).toBe(JSONL_LINE_MAX_BYTES + 1);
  });

  it("frames a multibyte record split across chunks without decoding partial bytes", async () => {
    const bytes = new TextEncoder().encode('{"text":"å🙂"}\n');
    const lines: string[] = [];
    await attachJsonlLineReader(asyncChunks([bytes.subarray(0, 8), bytes.subarray(8)]), (line) =>
      lines.push(line),
    );
    expect(lines).toEqual(['{"text":"å🙂"}']);
  });
});
