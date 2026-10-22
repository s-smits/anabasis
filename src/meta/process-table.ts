/**
 * Darwin's process table, read through libproc: each process's working directory, the program it
 * runs, its parent and its process group, the facts a seat's release reads to end what its commands
 * left behind (`endHolders`, `src/wall/seat-root.ts`).
 *
 * Until 22 October the release asked `lsof -d cwd,txt` for them. On the operator's macOS host that
 * listing took 240 ms over 770 processes, and a solve asked it after each of its commands, at its
 * release and after each check of its verdict: 238 of the 264 ms a walled `true` took, and most of
 * the 1.9 s a solve with no model time spent outside the model. libproc gives the same facts in
 * 3 ms. Over every process on that host the working directories read here matched lsof's, 562 of
 * 562. A program is read by its path, and where a process's file was replaced after it started, as
 * 68 Chrome and Spotify helpers' were, by the file of its first mapped region, which is where lsof
 * reads it too.
 *
 * The parent and the group replaced a shell trap that ended a command's group and descendants by
 * `pgrep` as the command exited: 30 ms of each walled command on that host, against 0.6 ms for this
 * table's 723 more reads.
 */
import { dlopen, FFIType } from "bun:ffi";

/** One process: its working directory and its program, each null where libproc gave none, and its
 *  parent and process group, each 0 where it gave none. */
interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid: number;
  readonly cwd: string | null;
  readonly program: string | null;
}

/** `PROC_PIDVNODEPATHINFO` of `<sys/proc_info.h>`, and the `proc_vnodepathinfo` it fills: the
 *  working directory's `vnode_info` of 152 bytes and its path of `MAXPATHLEN` bytes, then the same
 *  for the root directory. */
const VNODE_PATH_INFO = 9;
const VNODE_INFO_BYTES = 152;
const PATH_BYTES = 1024;
const VNODE_PATH_INFO_BYTES = 2 * (VNODE_INFO_BYTES + PATH_BYTES);
/** `PROC_PIDT_SHORTBSDINFO`, and the `proc_bsdshortinfo` it fills, whose first three words are the
 *  pid, the parent's pid and the process group. */
const SHORT_BSD_INFO = 13;
const SHORT_BSD_INFO_BYTES = 64;
/** `PROC_PIDPATHINFO_MAXSIZE`. */
const PROGRAM_BYTES = 4096;
/** Room for this many pids at first; a table that fills it is read again into twice the room. */
const FIRST_PIDS = 4096;
const SYMBOLS = {
  proc_listallpids: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
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

/** The bytes of `buffer` up to its first NUL, as text, or null where that is empty. */
function cString(buffer: Uint8Array): string | null {
  const end = buffer.indexOf(0);
  const text = TEXT.decode(end < 0 ? buffer : buffer.subarray(0, end));
  return text === "" ? null : text;
}

/** Every pid the host has now. */
function allPids(lib: ReturnType<typeof openLibproc>): Int32Array {
  for (let room = FIRST_PIDS; ; room *= 2) {
    const pids = new Int32Array(room);
    const count = lib.proc_listallpids(pids, pids.byteLength);
    if (count < 0) throw new Error("libproc could not list the host's processes");
    if (count < room) return pids.subarray(0, count);
  }
}

/** Each process on this Darwin host with its working directory, program, parent and group. A
 *  process that is gone by the time it is read, or that this user may not inspect, reads as nulls
 *  and zeros. */
export function processTable(): ProcessRow[] {
  libproc ??= openLibproc();
  const lib = libproc;
  const info = new Uint8Array(VNODE_PATH_INFO_BYTES);
  const bsd = new DataView(new ArrayBuffer(SHORT_BSD_INFO_BYTES));
  const bsdBytes = new Uint8Array(bsd.buffer);
  const path = new Uint8Array(PROGRAM_BYTES);
  return [...allPids(lib)].map((pid) => {
    const filled = lib.proc_pidinfo(pid, VNODE_PATH_INFO, 0, info, info.byteLength);
    const cwd =
      filled === info.byteLength
        ? cString(info.subarray(VNODE_INFO_BYTES, VNODE_INFO_BYTES + PATH_BYTES))
        : null;
    path.fill(0);
    const named =
      lib.proc_pidpath(pid, path, path.byteLength) > 0 ||
      lib.proc_regionfilename(pid, 0, path, path.byteLength) > 0;
    const kin =
      lib.proc_pidinfo(pid, SHORT_BSD_INFO, 0, bsdBytes, SHORT_BSD_INFO_BYTES) === SHORT_BSD_INFO_BYTES;
    return {
      pid,
      ppid: kin ? bsd.getUint32(4, true) : 0,
      pgid: kin ? bsd.getUint32(8, true) : 0,
      cwd,
      program: named ? cString(path) : null,
    };
  });
}
