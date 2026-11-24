/**
 * Shared filesystem compatibility exports for operations Bun 1.4 does not expose with equivalent
 * synchronous, descriptor, metadata, permission or atomicity semantics. Callers retain the original
 * API contracts; replace exports only when Bun provides the same ordering and error behaviour.
 * The log's two-process transition test holds that two writers never validate against stale
 * history. `flock` supplies a cross-process exclusive lock released by closing the descriptor;
 * Bun exposes no equivalent descriptor lock.
 */
import { dlopen, FFIType } from "bun:ffi";
import { closeSync, constants, copyFileSync, openSync, readSync, renameSync, rmSync } from "node:fs";
import { runtimeProcess } from "./process.ts";

export { closeSync, constants, copyFileSync, openSync, readSync, renameSync, rmSync };
export {
  accessSync,
  appendFileSync,
  chmodSync,
  cpSync,
  existsSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  opendirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmdirSync,
  statfsSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from "node:fs";
// oxlint-disable-next-line import/no-default-export -- `node:fs`'s default export, re-exported so a default import has its one route through src/meta (`ana/require-meta-runtime-import`)
export { default } from "node:fs";
export type { Dirent, Stats } from "node:fs";

/**
 * Asynchronous directory and temporary-path operations with no Bun-native equivalent. Callers that
 * only read or write a whole file use Bun.file and Bun.write instead of adding names here.
 */
export { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";

type Flock = (fd: number, operation: number) => number;
/** libc's `flock`, opened on first use so that importing this module loads no library. */
let flock: Flock | undefined;

/** Wait for `LOCK_EX` on this descriptor. Closing it releases the lock, including after a crash. */
export function lockExclusiveSync(fd: number): void {
  flock ??= dlopen(runtimeProcess.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6", {
    flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  }).symbols.flock;
  if (flock(fd, 2) !== 0) throw new Error(`cannot lock file descriptor ${String(fd)}`);
}

/** Copies `source` to `destination` using copy-on-write cloning where the filesystem supports it. */
export function cloneFile(source: string, destination: string): void {
  copyFileSync(source, destination, constants.COPYFILE_FICLONE);
}

/** Reads up to `bytes` from the start of `path` without loading the full file into memory. */
export function readHeadSync(path: string, bytes: number): Buffer {
  const fd = openSync(path, "r");
  const head = Buffer.allocUnsafe(bytes);
  try {
    return head.subarray(0, readSync(fd, head, 0, bytes, 0));
  } finally {
    closeSync(fd);
  }
}

/** Replaces `path` with a private copy-on-write inode so mutating it never alters sibling hard links. */
export function detachHardlink(path: string): void {
  const temp = `${path}.private`;
  try {
    cloneFile(path, temp);
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}
