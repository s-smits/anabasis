/** Darwin isolation backend for the command wall: checks whether `sandbox-exec` can confine a
 *  command on the current host and computes the binary digest recorded in the policy hash
 *  (`base.ts`). */
import { realpathSync, statSync } from "../meta/filesystem.ts";
import type { RuntimePlatform } from "../meta/runtime-values.ts";
import { sha256OfFile } from "../meta/digest.ts";
import { surroundingSandbox } from "./policy.ts";
import { runtimeProcess } from "../meta/process.ts";

export const DARWIN_SEATBELT_ID = "darwin-seatbelt/v1" as const;
const DARWIN_SANDBOX_EXEC = "/usr/bin/sandbox-exec";

export interface DarwinSeatbeltRuntime {
  platform?: RuntimePlatform;
  sandboxExecPath?: string;
  /** Nested Seatbelt profiles fail on macOS; detecting an outer sandbox causes the wall to refuse
   *  rather than run a command unconfined under an external sandbox. */
  outerSandboxed?: boolean;
}

interface DarwinSeatbeltSupport {
  ok: boolean;
  reason: string | null;
  mechanismPath: string;
  mechanismDigest: string | null;
}

/** Cached SHA-256 digests of `sandbox-exec` keyed by canonical path. Because the binary resides on
 *  the sealed system volume, hashing it once per process avoids redundant reads across seats and
 *  verification checks. */
const DIGEST_BY_PATH = new Map<string, string>();

/** Checks Darwin Seatbelt availability without invoking a model. Refusal messages omit filesystem
 *  paths so host layout details do not leak into CLI diagnostics. */
export function darwinSeatbeltSupport(runtime: DarwinSeatbeltRuntime = {}): DarwinSeatbeltSupport {
  const sandboxExecPath = runtime.sandboxExecPath ?? DARWIN_SANDBOX_EXEC;
  const unavailable = (reason: string): DarwinSeatbeltSupport => ({
    ok: false,
    reason,
    mechanismPath: sandboxExecPath,
    mechanismDigest: null,
  });
  if ((runtime.platform ?? runtimeProcess.platform) !== "darwin") {
    return unavailable("Darwin Seatbelt is unavailable on this platform");
  }
  if (runtime.outerSandboxed ?? surroundingSandbox(Bun.env)) {
    return unavailable("a surrounding sandbox is not this wall and nested Seatbelt is unsupported");
  }
  try {
    const mechanismPath = realpathSync.native(sandboxExecPath);
    if (!statSync(mechanismPath).isFile()) throw new Error("not a file");
    const mechanismDigest = DIGEST_BY_PATH.get(mechanismPath) ?? sha256OfFile(mechanismPath);
    DIGEST_BY_PATH.set(mechanismPath, mechanismDigest);
    return { ok: true, reason: null, mechanismPath, mechanismDigest };
  } catch {
    return unavailable("the Darwin Seatbelt executable is unavailable");
  }
}
