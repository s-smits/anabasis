/**
 * The first bytes of a file, without reading the rest. `seed-campaign.mts` sniffs each tool-tree
 * file's head for a NUL before it reads a text file whole, so a binary costs its head rather than
 * its size, and `condition-evidence.mts` reads a transcript's head for the working directory its
 * first rows record.
 */
import { closeSync, openSync, readSync } from "#src/meta/filesystem.ts";

/** Up to `bytes` bytes from the start of `path`. */
export function readHead(path: string, bytes: number): Buffer {
  const head = Buffer.alloc(bytes);
  const handle = openSync(path, "r");
  try {
    return head.subarray(0, readSync(handle, head, 0, bytes, 0));
  } finally {
    closeSync(handle);
  }
}
