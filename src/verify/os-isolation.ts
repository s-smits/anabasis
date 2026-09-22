/**
 * The one platform dispatch for the OS isolation: callers keep one policy value, and this module
 * selects the mechanism that enforces it on the current host, Darwin Seatbelt or Linux Bubblewrap.
 * Support evidence names the mechanism that enforced the policy, and both branches fail closed: an
 * unavailable mechanism returns an explicit reason and the caller does not run open.
 */
import {
  DARWIN_SEATBELT_ID,
  type DarwinSeatbeltRuntime,
  applyDarwinSeatbeltPlan,
  darwinSeatbeltSupport,
  prepareDarwinSeatbelt,
  verifyDarwinSeatbeltPlan,
} from "./darwin-seatbelt.ts";
import type { ExactReadDrift, ExactReadSnapshot } from "./exact-read-attestation.ts";
import { applyLinuxBwrapPlan, prepareLinuxBwrap, verifyLinuxBwrapPlan } from "./linux-bwrap-verifier.ts";
import {
  LINUX_BWRAP_ID,
  type LinuxBwrapRuntime,
  bwrapConfinedWorker,
  linuxBwrapSupport,
} from "./linux-bwrap.ts";
import type { VerifierConfinementRequest, VerifierSandboxLevel } from "./verifier-port.ts";
import type { OptionalEnvValues } from "../backends/scrub-env.ts";
import { runtimeProcess } from "../meta/process.ts";
import { darwinPlatformReadRoots } from "./wall-policy.ts";
import { errorMessage } from "../meta/runtime-values.ts";

export { DARWIN_SEATBELT_ID, LINUX_BWRAP_ID };

type OsIsolationPlatform = "darwin" | "linux";

/** A runtime override carrying the fields either mechanism may use; the selected host ignores the rest. */
export type OsIsolationRuntime = DarwinSeatbeltRuntime &
  LinuxBwrapRuntime & {
    /** The home whose toolchain install roots the Darwin wall opens; the process HOME by default. */
    toolchainHome?: string;
  };

export interface OsIsolationSupport {
  ok: boolean;
  reason: string | null;
  platform: OsIsolationPlatform | "other";
  /** Stable mechanism identity carried in evidence, such as darwin-seatbelt/v1 or linux-bwrap/v1. */
  mechanismId: string;
  mechanismPath: string;
  mechanismDigest: string | null;
  /** Darwin's imported system profile closure, or Linux's granted system-root identity. */
  baselineDigest: string | null;
}

type VerifierOsIsolationInput = VerifierConfinementRequest & {
  /** The explicit tool environment. Bubblewrap reapplies it after clearing inherited variables;
   *  Darwin receives it through the host's spawn call. */
  environment: OptionalEnvValues;
};
type PreparedVerifierPlan = {
  command: string;
  args: string[];
  policyHash: string;
  /** The wall's own executable and imported-baseline digests. Unlike `policyHash` they name no
   *  host read root, so the host may bind them into the cross-request verdict identity. */
  support: { mechanismDigest: string; baselineDigest: string };
  exactReadSnapshots: ExactReadSnapshot[];
};

/** The selected plan with its own lifecycle, closed over the one concrete mechanism's plan so the
 *  host cannot cast or cross-route it. */
export type VerifierOsIsolationPlan = PreparedVerifierPlan & {
  apply(): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** `changed` names a real drift of an attested byte; `unavailable` a re-read the host could not complete. */
  verify(): ExactReadDrift | null;
};
export type VerifierOsIsolation = {
  id: VerifierSandboxLevel;
  requires: string;
  prepare(input: VerifierOsIsolationInput): VerifierOsIsolationPlan | { unsupported: string };
};

function isolationError(prefix: string, cause: unknown): string {
  return `${prefix}: ${errorMessage(cause)}`;
}

function prepareVerifierPlan<Plan extends PreparedVerifierPlan>(
  prepare: () => Plan | { unsupported: string },
  apply: (
    plan: Plan,
  ) => { ok: true } | { ok: false; reason: string } | Promise<{ ok: true } | { ok: false; reason: string }>,
  verify: (plan: Plan) => ExactReadDrift | null,
): VerifierOsIsolationPlan | { unsupported: string } {
  try {
    const plan = prepare();
    if ("unsupported" in plan) return plan;
    return {
      command: plan.command,
      args: plan.args,
      policyHash: plan.policyHash,
      support: { mechanismDigest: plan.support.mechanismDigest, baselineDigest: plan.support.baselineDigest },
      exactReadSnapshots: plan.exactReadSnapshots,
      apply: async () => {
        try {
          return await apply(plan);
        } catch (error) {
          return { ok: false, reason: isolationError("sandbox policy application threw", error) };
        }
      },
      verify: () => {
        try {
          return verify(plan);
        } catch (error) {
          return { kind: "unavailable", detail: isolationError("sandbox re-attestation threw", error) };
        }
      },
    };
  } catch (error) {
    return { unsupported: isolationError("sandbox policy preparation threw", error) };
  }
}

/**
 * Resolve the current host's mechanism and its support evidence. A platform with neither
 * mechanism returns an explicit unavailable value rather than a fallback.
 */
export function osIsolationSupport(runtime: OsIsolationRuntime = {}): OsIsolationSupport {
  const platform = runtime.platform ?? runtimeProcess.platform;
  if (platform === "darwin") {
    return {
      platform: "darwin",
      mechanismId: DARWIN_SEATBELT_ID,
      ...darwinSeatbeltSupport(runtime),
    };
  }
  if (platform === "linux") {
    return {
      platform: "linux",
      mechanismId: LINUX_BWRAP_ID,
      ...linuxBwrapSupport(runtime),
    };
  }
  return {
    ok: false,
    reason: "no OS isolation mechanism is available on this platform",
    platform: "other",
    mechanismId: "none",
    mechanismPath: "",
    mechanismDigest: null,
    baselineDigest: null,
  };
}

/**
 * Select the verifier's mechanism at host construction, never per invocation, so later host code
 * has one uniform capability and no platform switch.
 */
export function verifierOsIsolation(runtime: OsIsolationRuntime): VerifierOsIsolation {
  if ((runtime.platform ?? runtimeProcess.platform) === "linux") {
    return {
      id: LINUX_BWRAP_ID,
      requires: "requires Linux bubblewrap",
      prepare: (input) =>
        prepareVerifierPlan(
          () => prepareLinuxBwrap({ ...input, runtime }),
          applyLinuxBwrapPlan,
          (plan) => verifyLinuxBwrapPlan(plan, runtime),
        ),
    };
  }
  // Read once so every plan of this host binds the same platform roots.
  const platformRoots = darwinPlatformReadRoots(runtime.toolchainHome);
  return {
    id: DARWIN_SEATBELT_ID,
    requires: "requires Darwin Seatbelt",
    prepare: (input) =>
      prepareVerifierPlan(
        () => prepareDarwinSeatbelt({ ...input, runtime, platformRoots }),
        applyDarwinSeatbeltPlan,
        (plan) => verifyDarwinSeatbeltPlan(plan, runtime),
      ),
  };
}

/**
 * Prove a confined worker's reported pid is the controller's actual child, returning the host pid
 * that names it, or null. Darwin sandbox-exec replaces the spawned process, so the pids match;
 * Bubblewrap's private pid namespace is matched through the kernel's `NSpid` column. The
 * controller's own pid is always rejected.
 */

export function witnessConfinedChild(
  reportedPid: number,
  childPid: number | undefined,
  mechanismId: string,
): number | null {
  if (childPid === undefined || reportedPid === runtimeProcess.pid) return null;
  if (mechanismId === LINUX_BWRAP_ID) return bwrapConfinedWorker(reportedPid, childPid);
  return reportedPid === childPid ? reportedPid : null;
}
