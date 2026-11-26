import { DARWIN_SEATBELT_ID, type DarwinSeatbeltRuntime, darwinSeatbeltSupport } from "./darwin-seatbelt.ts";
import { LINUX_BWRAP_ID, type LinuxBwrapRuntime, linuxBwrapSupport } from "./linux-bwrap.ts";
import { runtimeProcess } from "../meta/process.ts";

export type OsIsolationRuntime = DarwinSeatbeltRuntime & LinuxBwrapRuntime;

interface OsIsolationSupport {
  ok: boolean;
  reason: string | null;
  mechanismId: string;
  mechanismPath: string;
  mechanismDigest: string | null;
}

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
