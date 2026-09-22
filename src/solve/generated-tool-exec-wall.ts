/**
 * Prevent process execution from inside the generated-tool worker.
 *
 * On Linux, Bubblewrap builds its namespace from argv and offers no exec restriction, so the
 * trusted child installs a Landlock ruleset that handles `LANDLOCK_ACCESS_FS_EXECUTE` and grants
 * no rules: every later `execve` in this process tree fails with EACCES while unhandled rights
 * (reads, writes, network connect) keep their existing bounds. This also prevents launching the
 * interpreter again if generated code recovers a runtime handle through a computed global
 * lookup: the kernel still denies the process execution.
 *
 * Landlock needs kernel 5.13+ with the LSM enabled.
 *
 * macOS has no in-process equivalent: `sandbox_init` is refused inside an already sandboxed
 * process, and its Seatbelt profile has to allow one literal `process-exec` for the pinned
 * interpreter, because `sandbox-exec` compiles the profile and then execs that interpreter to
 * start this worker at all. That allowance was a live escape — generated code recovering the
 * runtime through a computed global lookup ran `spawnSync([Bun.argv[0]])` successfully inside an
 * otherwise isolated worker, measured 2026-08-22 — so the interpreter route is closed by removing
 * the capability from the reachable namespace rather than by asking the kernel twice. Every host
 * binary other than that one literal stays denied by the launch profile.
 *
 * The runtime lock runs on both platforms and holds because `Bun.spawn`, `Bun.spawnSync`, `Bun.$` and
 * `Bun.which` are writable own properties of one namespace object, which the `bun` module
 * re-exports rather than rebuilds. Redefining them non-writable is permanent for the process, and
 * the trusted child keeps the handles it captured at import time, before this call. The route
 * around a JavaScript property lock is `bun:ffi`, so `generated-tool-source-policy.ts` refuses every `bun` and
 * `bun:*` specifier from generated modules the same way it refuses node builtins; on Linux
 * Landlock closes that route in the kernel as well.
 *
 * Unavailable enforcement on either platform produces a typed non-result:
 * caller refuses before loading any generated code.
 */

/** The two Landlock numbers are the same on x86-64 and on the generic table arm64 uses. Ordinary
 *  libc operations are called through their own symbols: their raw numbers differ per
 *  architecture (x86-64 prctl is 157, arm64 prctl is 167 and 157 is setsid), and a wrong number
 *  would report enforcement unavailable on every arm64 host. */
import { runtimeProcess } from "../meta/process.ts";
import { errorMessage } from "../meta/runtime-values.ts";

const LANDLOCK_CREATE_RULESET = 444;
const LANDLOCK_RESTRICT_SELF = 446;
const LANDLOCK_ARCHITECTURES = new Set(["x64", "arm64"]);
const PR_SET_NO_NEW_PRIVS = 38;
/** LANDLOCK_ACCESS_FS_EXECUTE is bit 0 and exists since ABI v1; handling only this right keeps
 *  the ruleset valid on every ABI version instead of negotiating the newest feature bits. */
const LANDLOCK_ACCESS_FS_EXECUTE = 1n;

/** Darwin is Seatbelt around the worker plus a runtime lock inside it: the launch profile must
 *  allow the pinned Bun binary, so the JavaScript namespace is what refuses re-execution. */
export type ExecWallMechanism = "landlock" | "seatbelt-and-runtime-lock";

interface LibcEntry {
  syscall: (...args: number[]) => number | bigint;
  prctl: (option: number, a: number, b: number, c: number, d: number) => number;
  close: (descriptor: number) => number;
}

export type ExecWall =
  | { status: "installed"; mechanism: ExecWallMechanism }
  | { status: "unavailable"; detail: string };

/** glibc ships the syscall entry point as `libc.so.6`; musl as `libc.so` or its versioned name.
 *  `libc.so` alone is a linker script on glibc systems, so it is tried late and only as found. */
const LIBC_CANDIDATES = ["libc.so.6", "libc.so", "libc.musl-x86_64.so.1", "libc.musl-aarch64.so.1"];

/** The process-launching members of the runtime namespace. `which` is included because it reports
 *  which host binaries exist, which is the same host detail the read wall withholds. */
const RUNTIME_LAUNCH_MEMBERS = ["spawn", "spawnSync", "$", "which"] as const;
/** A Worker is a fresh JavaScript instance with an unlocked `Bun`, so a computed constructor
 *  lookup plus a blob URL would recover `spawn` in a runtime this lock never touched. */
const REALM_CONSTRUCTORS = ["Worker", "SharedWorker"] as const;

function lockRuntimeLaunchMembers(): string | null {
  const denied = () => {
    throw new Error("process execution is denied inside the generated-tool worker");
  };
  for (const member of RUNTIME_LAUNCH_MEMBERS) {
    try {
      Object.defineProperty(Bun, member, { value: denied, writable: false, configurable: false });
    } catch (error) {
      return `${member}: ${errorMessage(error)}`;
    }
  }
  for (const name of REALM_CONSTRUCTORS) {
    try {
      Object.defineProperty(globalThis, name, { value: denied, writable: false, configurable: false });
    } catch (error) {
      return `${name}: ${errorMessage(error)}`;
    }
  }
  return null;
}

export async function denyProcessExecution(platform: string): Promise<ExecWall> {
  const lockFailure = lockRuntimeLaunchMembers();
  if (lockFailure !== null) {
    return {
      status: "unavailable",
      detail: `the runtime launch namespace stayed reachable — ${lockFailure}`,
    };
  }
  if (platform === "darwin") return { status: "installed", mechanism: "seatbelt-and-runtime-lock" };
  if (platform !== "linux") {
    return { status: "unavailable", detail: `${platform} has no admitted process-execution wall` };
  }
  let ffi: typeof import("bun:ffi");
  try {
    ffi = await import("bun:ffi");
  } catch (error) {
    return {
      status: "unavailable",
      detail: `bun:ffi unavailable: ${errorMessage(error)}`,
    };
  }
  if (!LANDLOCK_ARCHITECTURES.has(runtimeProcess.arch)) {
    return { status: "unavailable", detail: `${runtimeProcess.arch} has no tested Landlock syscall numbers` };
  }
  let libc: LibcEntry | null = null;
  let loadError = "";
  for (const name of LIBC_CANDIDATES) {
    try {
      // `syscall` is variadic, so every argument is one machine word; the ruleset attribute is
      // passed by address through `ptr` rather than through a pointer-typed parameter slot.
      // `prctl` and `close` are fixed-signature symbols, so they carry their full argument list.
      const lib = ffi.dlopen(name, {
        syscall: {
          args: [ffi.FFIType.i64, ffi.FFIType.i64, ffi.FFIType.i64, ffi.FFIType.i64, ffi.FFIType.i64],
          returns: ffi.FFIType.i64,
        },
        prctl: {
          args: [ffi.FFIType.i32, ffi.FFIType.u64, ffi.FFIType.u64, ffi.FFIType.u64, ffi.FFIType.u64],
          returns: ffi.FFIType.i32,
        },
        close: { args: [ffi.FFIType.i32], returns: ffi.FFIType.i32 },
      });
      // SAFETY: the descriptor above declares these exact symbols and signatures, so the call
      // shapes here are the loaded contract itself.
      const { syscall, prctl, close } = lib.symbols as {
        syscall: LibcEntry["syscall"];
        prctl: LibcEntry["prctl"];
        close: LibcEntry["close"];
      };
      libc = { syscall, prctl, close };
      break;
    } catch (error) {
      loadError = errorMessage(error);
    }
  }
  if (libc === null) {
    return { status: "unavailable", detail: `libc syscall entry point not loaded: ${loadError}` };
  }
  const call = (...args: [number, ...number[]]): number => Number(libc.syscall(...args));
  // The ruleset attribute is one little-endian u64 word: the handled-access bitmask, EXECUTE only.
  const attr = new Uint8Array(8);
  new DataView(attr.buffer).setBigUint64(0, LANDLOCK_ACCESS_FS_EXECUTE, true);
  // SAFETY: bun:ffi exports `ptr` for exactly this conversion — a buffer view to its machine
  // address — and `attr` is the Uint8Array allocated above.
  const ptrOf = ffi.ptr as (value: Uint8Array) => number;
  const attrAddress = ptrOf(attr);
  const ruleset = call(LANDLOCK_CREATE_RULESET, attrAddress, 8, 0, 0);
  if (ruleset < 0) {
    return {
      status: "unavailable",
      detail: "landlock_create_ruleset refused (kernel < 5.13 or the Landlock LSM is disabled)",
    };
  }
  try {
    if (libc.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) !== 0) {
      return { status: "unavailable", detail: "PR_SET_NO_NEW_PRIVS was refused" };
    }
    if (call(LANDLOCK_RESTRICT_SELF, ruleset, 0, 0, 0) !== 0) {
      return { status: "unavailable", detail: "landlock_restrict_self was refused" };
    }
    return { status: "installed", mechanism: "landlock" };
  } finally {
    libc.close(ruleset);
  }
}
