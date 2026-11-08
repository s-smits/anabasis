import { asError } from "./runtime-values.ts";

/**
 * `run` over `items`, at most `width` at once, each started as a place frees, with the results in
 * the items' order. A wave that waits for its slowest member before the next begins leaves places
 * idle, and a solve runs from two minutes to two hours.
 *
 * A `run` that throws rejects the whole, with the first thing thrown, once the runs in flight have
 * settled; no further item is started. Nothing is left running behind a rejection.
 */
export async function pooled<Item, Result>(
  items: readonly Item[],
  width: number,
  run: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = [];
  const failed: { thrown: unknown }[] = [];
  // One iterator the workers share, so each item is taken once, in order, by whichever is free.
  const queue = items.entries();
  const worker = async (): Promise<void> => {
    for (const [index, item] of queue) {
      if (failed.length > 0) return;
      try {
        results[index] = await run(item);
      } catch (error) {
        failed.push({ thrown: error });
      }
    }
  };
  // A width that is no number, a flag misread say, is one place and never none: with no worker
  // nothing would run and the caller would be told it all had.
  const places = Math.max(1, Math.min(Math.floor(width) || 1, items.length));
  await Promise.all(Array.from({ length: places }, worker));
  const [first] = failed;
  if (first !== undefined) throw asError(first.thrown);
  return results;
}
