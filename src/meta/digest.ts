import { closeSync, openSync, readSync } from "./filesystem.ts";

export function sha256(value: string | Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

const FILE_CHUNK = Buffer.alloc(1 << 20);

export function sha256OfFile(path: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  const fd = openSync(path, "r");
  try {
    for (let read = readSync(fd, FILE_CHUNK); read > 0; read = readSync(fd, FILE_CHUNK)) {
      hasher.update(FILE_CHUNK.subarray(0, read));
    }
  } finally {
    closeSync(fd);
  }
  return hasher.digest("hex");
}
