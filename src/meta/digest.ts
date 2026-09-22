import { readFileSync } from "./filesystem.ts";

/**
 * Shared SHA-256 helper. Callers specify the bytes to hash; this function fixes the algorithm
 * and hexadecimal output format. Sixteen files previously repeated this operation. Keeping
 * it here makes digest comparisons consistent without requiring readers to inspect each
 * module's choice of algorithm and encoding.
 *
 * Streaming callers (a directory walk, an HTTP body) still hold their own `Bun.CryptoHasher` — they
 * hash chunks that are not held as one value, so they cannot use this whole-value helper.
 */
export function sha256(value: string | Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

/** sha256 over a file's bytes. Read as bytes, so no encoding assumption enters the digest. */
export function sha256OfFile(path: string): string {
  return sha256(readFileSync(path));
}
