import { readFileSync } from "./filesystem.ts";

/**
 * Shared SHA-256 helper with hexadecimal output, so digest comparisons agree across modules.
 * Streaming callers keep their own `Bun.CryptoHasher`.
 */
export function sha256(value: string | Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

/** sha256 over a file's bytes. Read as bytes, so no encoding assumption enters the digest. */
export function sha256OfFile(path: string): string {
  return sha256(readFileSync(path));
}
