/** Keep an unfinished JSONL wire record bounded even when a peer never sends LF. */
export const JSONL_LINE_MAX_BYTES = 2 * 1024 * 1024;

/** Read newline-delimited records with a byte limit. Emit an oversized prefix with a NUL marker
 * so parsing fails, then discard the remaining bytes through the next newline. */
export async function attachJsonlLineReader(
  stream: AsyncIterable<Uint8Array>,
  onLine: (line: string) => void,
  maxBufferedBytes = JSONL_LINE_MAX_BYTES,
): Promise<void> {
  const limit = Number.isFinite(maxBufferedBytes)
    ? Math.max(1, Math.floor(maxBufferedBytes))
    : JSONL_LINE_MAX_BYTES;
  const decoder = new TextDecoder();
  let buffer = new Uint8Array(Math.min(limit, 1024));
  let buffered = 0;
  let discarding = false;

  const emitLine = (length: number, overflow = false): void => {
    const suffix = overflow ? "\0" : "";
    const line = `${decoder.decode(buffer.subarray(0, length))}${suffix}`;
    onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
  };
  /** Whether the rest of this line is being dropped once `chunk` has been taken: true when it was
   *  already being dropped, and true when this fragment is what pushed the line past the limit. */
  const append = (chunk: Uint8Array, dropping: boolean): boolean => {
    if (dropping || chunk.byteLength === 0) return dropping;
    const remaining = limit - buffered;
    if (chunk.byteLength > remaining) {
      if (remaining > 0) {
        if (buffer.length < limit) {
          const next = new Uint8Array(limit);
          next.set(buffer.subarray(0, buffered));
          buffer = next;
        }
        buffer.set(chunk.subarray(0, remaining), buffered);
        buffered += remaining;
      }
      emitLine(buffered, true);
      buffered = 0;
      return true;
    }
    if (buffer.length < buffered + chunk.byteLength) {
      const size = Math.min(limit, Math.max(buffer.length * 2, buffered + chunk.byteLength));
      const next = new Uint8Array(size);
      next.set(buffer.subarray(0, buffered));
      buffer = next;
    }
    buffer.set(chunk, buffered);
    buffered += chunk.byteLength;
    return false;
  };

  for await (const chunk of stream) {
    let offset = 0;
    while (offset < chunk.byteLength) {
      const newline = chunk.indexOf(10, offset);
      if (newline < 0) {
        discarding = append(chunk.subarray(offset), discarding);
        break;
      }
      const dropped = append(chunk.subarray(offset, newline), discarding);
      // The newline ends the line whether it was kept or dropped, so this is where dropping stops.
      if (!dropped) emitLine(buffered);
      discarding = false;
      buffered = 0;
      offset = newline + 1;
    }
  }
  if (!discarding && buffered > 0) emitLine(buffered);
}
