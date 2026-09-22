/**
 * Prevent process execution from inside the generated-tool worker.
 *
 * On Linux, the trusted child installs a Landlock ruleset that handles
 * `LANDLOCK_ACCESS_FS_EXECUTE` and grants no rules: every later `execve` in this process tree fails
 * with EACCES, while reads, writes and network keep their existing bounds. Landlock needs kernel
 * 5.13+ with the LSM enabled.
 *
 * On macOS, the Seatbelt profile must allow `process-exec` of the pinned interpreter, because
 * `sandbox-exec` execs it to start this worker, and `sandbox_init` is refused inside a sandboxed
 * process. That route is closed by removing the capability from the reachable namespace instead.
 *
 * The runtime lock runs on both platforms. `Bun.spawn`, `Bun.spawnSync`, `Bun.$` and `Bun.which` are
 * writable own properties of one namespace object that the `bun` module re-exports, so redefining
 * them non-writable is permanent; the trusted child keeps the handles it captured at import. The
 * route around the lock is `bun:ffi`, which `generated-tool-source-policy.ts` refuses to generated
 * modules, and which Landlock also closes on Linux.
 *
 * Unavailable enforcement returns a typed result, and the caller refuses before loading any
 * generated code.
 */
import { runtimeProcess } from "../meta/process.ts";
import { errorMessage } from "../meta/runtime-values.ts";

/** The two Landlock numbers are the same on x86-64 and arm64. Other libc operations are called
 *  through their own symbols, because their raw numbers differ per architecture. */
const LANDLOCK_CREATE_RULESET = 444;
const LANDLOCK_RESTRICT_SELF = 446;
const LANDLOCK_ARCHITECTURES = new Set(["x64", "arm64"]);
const PR_SET_NO_NEW_PRIVS = 38;
/** Bit 0, present since ABI v1, so the ruleset is valid on every ABI version. */
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

/** glibc ships `libc.so.6`; musl `libc.so` or a versioned name. On glibc `libc.so` is a linker
 *  script, so it is tried second. */
const LIBC_CANDIDATES = ["libc.so.6", "libc.so", "libc.musl-x86_64.so.1", "libc.musl-aarch64.so.1"];

/** The process-launching members of the runtime namespace, plus `which`, which would reveal the
 *  host binaries the read wall withholds. */
const RUNTIME_LAUNCH_MEMBERS = ["spawn", "spawnSync", "$", "which"] as const;
/** A Worker is a fresh realm with an unlocked `Bun`, so its constructors are locked too. */
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
      // `syscall` is variadic, so every argument is one machine word and the ruleset attribute is
      // passed by address.
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
