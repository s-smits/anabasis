import { dlopen, FFIType } from "bun:ffi";
import { runtimeProcess } from "./process.ts";

interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid: number;
  readonly cwd: string | null;
  readonly program: string | null;
}

const PROC_ALL_PIDS = 1;
const PROC_UID_ONLY = 4;
const VNODE_PATH_INFO = 9;
const VNODE_INFO_BYTES = 152;
const PATH_BYTES = 1024;
const VNODE_PATH_INFO_BYTES = 2 * (VNODE_INFO_BYTES + PATH_BYTES);
const SHORT_BSD_INFO = 13;
const SHORT_BSD_INFO_BYTES = 64;
const PROGRAM_BYTES = 4096;
const FIRST_PIDS = 4096;
const SYMBOLS = {
  proc_listpids: { args: [FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  proc_pidinfo: {
    args: [FFIType.i32, FFIType.i32, FFIType.u64, FFIType.ptr, FFIType.i32],
    returns: FFIType.i32,
  },
  proc_pidpath: { args: [FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
  proc_regionfilename: { args: [FFIType.i32, FFIType.u64, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
} as const;
const TEXT = new TextDecoder();

let libproc: ReturnType<typeof openLibproc> | null = null;

function openLibproc() {
  return dlopen("/usr/lib/libproc.dylib", SYMBOLS).symbols;
}

function cString(buffer: Uint8Array): string | null {
  const end = buffer.indexOf(0);
  const text = TEXT.decode(end === -1 ? buffer : buffer.subarray(0, end));
  return text === "" ? null : text;
}

function listedPids(lib: ReturnType<typeof openLibproc>): Int32Array {
  const uid = runtimeProcess.getuid?.();
  const type = uid === undefined ? PROC_ALL_PIDS : PROC_UID_ONLY;
  for (let room = FIRST_PIDS; ; room *= 2) {
    const pids = new Int32Array(room);
    const bytes = lib.proc_listpids(type, uid ?? 0, pids, pids.byteLength);
    if (bytes < 0) throw new Error("libproc could not list the host's processes");
    const count = Math.trunc(bytes / 4);
    if (count < room) return pids.subarray(0, count);
  }
}

export function processTable(): ProcessRow[] {
  libproc ??= openLibproc();
  const lib = libproc;
  const info = new Uint8Array(VNODE_PATH_INFO_BYTES);
  const bsd = new DataView(new ArrayBuffer(SHORT_BSD_INFO_BYTES));
  const bsdBytes = new Uint8Array(bsd.buffer);
  const path = new Uint8Array(PROGRAM_BYTES);
  return [...listedPids(lib)].map((pid) => {
    const filled = lib.proc_pidinfo(pid, VNODE_PATH_INFO, 0, info, info.byteLength);
    const cwd =
      filled === info.byteLength
        ? cString(info.subarray(VNODE_INFO_BYTES, VNODE_INFO_BYTES + PATH_BYTES))
        : null;
    const pathLen = lib.proc_pidpath(pid, path, path.byteLength);
    const regionLen = pathLen > 0 ? pathLen : lib.proc_regionfilename(pid, 0, path, path.byteLength);
    const kin =
      lib.proc_pidinfo(pid, SHORT_BSD_INFO, 0, bsdBytes, SHORT_BSD_INFO_BYTES) === SHORT_BSD_INFO_BYTES;
    return {
      pid,
      ppid: kin ? bsd.getUint32(4, true) : 0,
      pgid: kin ? bsd.getUint32(8, true) : 0,
      cwd,
      program: regionLen > 0 ? cString(path.subarray(0, regionLen)) : null,
    };
  });
}
