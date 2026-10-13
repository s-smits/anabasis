/** Darwin's mechanism for the command wall: whether `sandbox-exec` can wall a command here, and
 *  the wrapper's digest, which a seat's policy hash carries (`solve-sandbox.ts`). Until 11 October
 *  this file also built the verifier's own deny-default wall and attested its inputs before and
 *  after each check; a check now runs under the command wall (`docs/simplify.md`, W6). */
import { realpathSync, statSync } from "../meta/filesystem.ts";
import type { RuntimePlatform } from "../meta/runtime-values.ts";
import { sha256OfFile } from "../meta/digest.ts";
import { surroundingSandbox } from "./wall-policy.ts";
import { runtimeProcess } from "../meta/process.ts";

export const DARWIN_SEATBELT_ID = "darwin-seatbelt/v1" as const;
const DARWIN_SANDBOX_EXEC = "/usr/bin/sandbox-exec";

export interface DarwinSeatbeltRuntime {
  platform?: RuntimePlatform;
  sandboxExecPath?: string;
  /** Applying Seatbelt inside another Seatbelt fails on macOS, so a surrounding sandbox refuses
   *  rather than letting a command run unwrapped under someone else's wall. */
  outerSandboxed?: boolean;
}

interface DarwinSeatbeltSupport {
  ok: boolean;
  reason: string | null;
  mechanismPath: string;
  mechanismDigest: string | null;
}

/** The wrapper's digest by its canonical path. It lies on the sealed system volume, so it is read
 *  once a process: every seat and every check asks. */
const DIGEST_BY_PATH = new Map<string, string>();

/** Check support without a model call. The reasons omit paths, to keep the operator's filesystem
 *  layout out of CLI diagnostics. */
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
