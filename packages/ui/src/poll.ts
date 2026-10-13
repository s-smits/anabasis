/** Wait for each read before scheduling the next, so slow reads cannot starve their own results. */
export function poll(read: () => Promise<void>, intervalMs: number): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  function next(): void {
    read()
      .catch((error: unknown) =>
        console.error("Polling read failed.", error instanceof Error ? error : String(error)),
      )
      .finally(() => {
        if (!stopped) timer = setTimeout(next, intervalMs);
      });
  }
  next();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
