import { describe, expect, it, mock } from "bun:test";
import * as nodeFs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const realFilesystem = await import("../src/meta/filesystem.ts");
const realOpenSync = nodeFs.openSync;
const realOpendirSync = nodeFs.opendirSync;
let descriptorSwapTarget = "";
let descriptorSwapDone = false;
let descriptorSwapFifo = false;
let mutationRoot = "";
let invalidUtf8Root = "";
let rootReadCalls = 0;
let firstChild: string | null = null;
const opensByPath = new Map<string, number>();

const hostileOpenSync: typeof realFilesystem.openSync = (path, flags, mode) => {
  opensByPath.set(String(path), (opensByPath.get(String(path)) ?? 0) + 1);
  if (path !== descriptorSwapTarget || descriptorSwapDone) return realOpenSync(path, flags, mode);
  descriptorSwapDone = true;
  const backup = `${path}.original`;
  nodeFs.renameSync(path, backup);
  let handle: ReturnType<typeof realFilesystem.openSync> | undefined;
  try {
    if (descriptorSwapFifo) {
      const result = Bun.spawnSync({
        cmd: ["mkfifo", path],
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      if (result.exitCode !== 0) throw new Error("hostile FIFO creation failed");
    } else nodeFs.writeFileSync(path, "foreign bytes");
    handle = realOpenSync(path, flags, mode);
  } finally {
    nodeFs.rmSync(path, { force: true });
    nodeFs.renameSync(backup, path);
  }
  return handle;
};

const hostileOpendirSync: typeof realFilesystem.opendirSync = (path, options) => {
  if (path === invalidUtf8Root) {
    let emitted = false;
    // SAFETY: this narrow fake implements the only two methods the attestation walk consumes;
    // it injects raw bytes at the directory-reader boundary to exercise invalid UTF-8 handling.
    return {
      readSync: () => {
        if (emitted) return null;
        emitted = true;
        return Buffer.from([0xff, 0xfe, 0xfd]);
      },
      closeSync: () => {},
    } as ReturnType<typeof realOpendirSync>;
  }
  const directory = realOpendirSync(path, options);
  if (path !== mutationRoot) return directory;
  const read = directory.readSync.bind(directory);
  Object.defineProperty(directory, "readSync", {
    configurable: true,
    value: () => {
      rootReadCalls += 1;
      if (rootReadCalls === 1) {
        const child = read();
        firstChild = child === null ? null : Buffer.isBuffer(child) ? child.toString("utf8") : child.name;
        return child;
      }
      if (rootReadCalls === 2 && firstChild !== null) {
        nodeFs.writeFileSync(join(path, firstChild), "changed after its local check");
      }
      return read();
    },
  });

  return directory;
};

await mock.module("../src/meta/filesystem.ts", () => ({
  ...realFilesystem,
  openSync: hostileOpenSync,
  opendirSync: hostileOpendirSync,
}));

const { attestReadRootFile, createReadRootBudget, READ_ROOT_MAX_BYTES } = await import(
  "../src/verify/read-root-attestation.ts"
);

describe("read-root attestation hostile transitions", () => {
  it("reuses a digest only while the complete metadata is unchanged, and rehashes same-size bytes under a restored mtime", () => {
    const root = nodeFs.mkdtempSync(join(tmpdir(), "ana-read-root-digest-reuse-"));
    const file = join(root, "runtime.bin");
    nodeFs.writeFileSync(file, "before");
    try {
      const first = attestReadRootFile(file, createReadRootBudget());
      expect(attestReadRootFile(file, createReadRootBudget()).digest).toBe(first.digest);
      // The second attestation compared metadata and reopened nothing.
      expect(opensByPath.get(file)).toBe(1);
      const { atime, mtime } = nodeFs.statSync(file);
      nodeFs.writeFileSync(file, "after!");
      nodeFs.utimesSync(file, atime, mtime);
      // Same path, size and mtime; only ctime moved, which no unprivileged writer can restore.
      const rewritten = attestReadRootFile(file, createReadRootBudget());
      expect(rewritten.digest).not.toBe(first.digest);
      expect(rewritten.digest).toBe(new Bun.CryptoHasher("sha256").update("after!").digest("hex"));
      expect(opensByPath.get(file)).toBe(2);
    } finally {
      nodeFs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an oversized sparse file before allocating or reading its contents", () => {
    const root = nodeFs.mkdtempSync(join(tmpdir(), "ana-read-root-oversized-file-"));
    const file = join(root, "sparse.bin");
    let handle: number | undefined;
    try {
      handle = nodeFs.openSync(file, "w");
      nodeFs.ftruncateSync(handle, Number(READ_ROOT_MAX_BYTES + 1n));
      expect(() => attestReadRootFile(file, createReadRootBudget())).toThrow(/content-byte budget exceeded/);
    } finally {
      if (handle !== undefined) nodeFs.closeSync(handle);
      nodeFs.rmSync(root, { recursive: true, force: true });
    }
  });
});
