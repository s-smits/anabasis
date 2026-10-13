/**
 * The one platform dispatch for the OS isolation. Callers keep a single policy value — which roots
 * are readable or denied, whether the network is open — and this module selects the mechanism that
 * enforces it on the current host, Darwin Seatbelt or Linux Bubblewrap. Both fail closed: an
 * unavailable mechanism returns an explicit reason, and the caller does not run open.
 */
import { DARWIN_SEATBELT_ID, type DarwinSeatbeltRuntime, darwinSeatbeltSupport } from "./darwin-seatbelt.ts";
import { LINUX_BWRAP_ID, type LinuxBwrapRuntime, linuxBwrapSupport } from "./linux-bwrap.ts";
import { runtimeProcess } from "../meta/process.ts";

/** A shared test and runtime override carrying the fields either mechanism may use. The selected
 *  host ignores the irrelevant half. */
export type OsIsolationRuntime = DarwinSeatbeltRuntime & LinuxBwrapRuntime;

interface OsIsolationSupport {
  ok: boolean;
  reason: string | null;
  /** `darwin-seatbelt/v1` or `linux-bwrap/v1`. */
  mechanismId: string;
  mechanismPath: string;
  mechanismDigest: string | null;
}

/** Resolve the current host's mechanism and its support. A platform with neither returns an
 *  explicit unavailable value, instead of leaving each caller to invent its own fallback. */
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
