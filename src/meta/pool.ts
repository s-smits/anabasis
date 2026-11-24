import { asError } from "./runtime-values.ts";

export async function pooled<Item, Result>(
  items: readonly Item[],
  width: number,
  run: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = [];
  const failed: { thrown: unknown }[] = [];
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
  const places = Math.max(1, Math.min(Math.floor(width) || 1, items.length));
  await Promise.all(Array.from({ length: places }, worker));
  const [first] = failed;
  if (first !== undefined) throw asError(first.thrown);
  return results;
}
