/**
 * Shared filesystem compatibility exports for operations Bun 1.4 does not expose with equivalent
 * synchronous, descriptor, metadata, permission or atomicity semantics. Callers retain the original
 * API contracts; replace exports only when Bun provides the same ordering and error behaviour.
 */
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
