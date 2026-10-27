/**
 * Shared filesystem compatibility exports for operations Bun 1.4 does not expose with equivalent
 * synchronous, descriptor, metadata, permission or atomicity semantics. Callers retain the original
 * API contracts; replace exports only when Bun provides the same ordering and error behaviour.
 * The log's two-process transition test exposed concurrent validation against stale history on
 * 26 October. `flock` supplies a cross-process exclusive lock released by closing the descriptor;
 * Bun exposes no equivalent descriptor lock.
 */
import { dlopen, FFIType } from "bun:ffi";
import { runtimeProcess } from "./process.ts";

export {
  accessSync,
  appendFileSync,
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  cpSync,
  existsSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  opendirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  readSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statfsSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from "node:fs";
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
