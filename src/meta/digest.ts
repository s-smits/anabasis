import { readFileSync } from "./filesystem.ts";

/**
 * Shared SHA-256 helper. The caller says which bytes to hash; this fixes the algorithm and the
 * hexadecimal output, so two modules comparing digests agree without a reader checking what each
 * of them chose.
 *
 * Streaming callers still hold their own `Bun.CryptoHasher`: a walk of the source tree and a
 * downloaded HTTP body hash chunks that are never held as one value, so the whole-value helper
 * cannot serve them.
 */
export function sha256(value: string | Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

/** sha256 over a file's bytes. Read as bytes, so no encoding assumption enters the digest. */
export function sha256OfFile(path: string): string {
  return sha256(readFileSync(path));
}
