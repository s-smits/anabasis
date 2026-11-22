/**
 * Platform dispatch for OS-level command isolation. Callers construct a single platform-independent
 * policy (denied roots, readable roots, and network posture), and this module selects the host
 * mechanism that enforces it: Darwin Seatbelt or Linux Bubblewrap. Both backends fail closed,
 * returning an explicit refusal reason when isolation cannot be established.
 */
import { DARWIN_SEATBELT_ID, type DarwinSeatbeltRuntime, darwinSeatbeltSupport } from "./darwin-seatbelt.ts";
import { LINUX_BWRAP_ID, type LinuxBwrapRuntime, linuxBwrapSupport } from "./linux-bwrap.ts";
import { runtimeProcess } from "../meta/process.ts";

/** Combined runtime override type carrying fields for both backends; the active platform ignores
 *  fields belonging to the other backend. */
export type OsIsolationRuntime = DarwinSeatbeltRuntime & LinuxBwrapRuntime;

interface OsIsolationSupport {
  ok: boolean;
  reason: string | null;
  /** Mechanism identifier: `darwin-seatbelt/v1` or `linux-bwrap/v1`. */
  mechanismId: string;
  mechanismPath: string;
  mechanismDigest: string | null;
}

/** Resolves the current host's isolation mechanism and verifies support. Unsupported platforms
 *  return an explicit unavailable result instead of leaving callers to define ad-hoc fallbacks. */
export function osIsolationSupport(runtime: OsIsolationRuntime = {}): OsIsolationSupport {
  const platform = runtime.platform ?? runtimeProcess.platform;
  if (platform === "darwin") return { mechanismId: DARWIN_SEATBELT_ID, ...darwinSeatbeltSupport(runtime) };
  if (platform === "linux") return { mechanismId: LINUX_BWRAP_ID, ...linuxBwrapSupport(runtime) };
  return {
    ok: false,
    reason: "no OS isolation mechanism is available on this platform",
    mechanismId: "none",
    mechanismPath: "",
    mechanismDigest: null,
  };
}
