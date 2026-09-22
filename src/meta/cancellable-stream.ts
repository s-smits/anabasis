/** One owned reader for a subprocess pipe. Cancellation closes the pipe and releases its lock. */
interface CancellableByteStream {
  readonly stream: AsyncIterable<Uint8Array>;
  cancel(reason?: Error): void;
}

export function cancellableByteStream(source: ReadableStream<Uint8Array>): CancellableByteStream {
  const reader = source.getReader();
  let cancelled = false;
  let released = false;
  const release = (): void => {
    if (released) return;
    try {
      reader.releaseLock();
      released = true;
    } catch {
      // a lock released by the consumer first is the same end state
    }
  };
  const cancel = (reason?: Error): void => {
    if (cancelled) return;
    cancelled = true;
    try {
      void reader
        .cancel(reason)
        .catch(() => {})
        .finally(release);
    } catch {
      release();
    }
  };
  const stream: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
      return {
        next: async () => {
          try {
            const result = await reader.read();
            if (result.done) release();
            return result.done ? { done: true, value: undefined } : result;
          } catch (error) {
            release();
            if (cancelled) return { done: true, value: undefined };
            throw error;
          }
        },
        return: async () => {
          cancel();
          return { done: true, value: undefined };
        },
      };
    },
  };
  return { stream, cancel };
}
