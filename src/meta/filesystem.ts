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

export { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";

type Flock = (fd: number, operation: number) => number;
let flock: Flock | undefined;

export function lockExclusiveSync(fd: number): void {
  flock ??= dlopen(runtimeProcess.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6", {
    flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  }).symbols.flock;
  if (flock(fd, 2) !== 0) throw new Error(`cannot lock file descriptor ${String(fd)}`);
}

export function cloneFile(source: string, destination: string): void {
  copyFileSync(source, destination, constants.COPYFILE_FICLONE);
}

export function readHeadSync(path: string, bytes: number): Buffer {
  const fd = openSync(path, "r");
  const head = Buffer.allocUnsafe(bytes);
  try {
    return head.subarray(0, readSync(fd, head, 0, bytes, 0));
  } finally {
    closeSync(fd);
  }
}

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
