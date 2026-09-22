/**
 * The one platform dispatch for the OS isolation. Callers keep one policy value — which roots are
 * readable or denied, whether the network is open — and this module selects the mechanism that
 * enforces that policy on the current host: Darwin Seatbelt or Linux Bubblewrap.
 *
 * Support is deliberately mechanism-neutral: an id, executable, executable digest, and baseline
 * identity. Evidence therefore says which mechanism enforced the policy rather than silently
 * treating a Darwin profile and Linux mount namespace as interchangeable. Both branches fail
 * closed: an unavailable mechanism returns an explicit reason and the caller does not run open.
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

/** A shared test/runtime override carries the fields either mechanism may use. The irrelevant
 * half is ignored by the selected host, which preserves the existing per-mechanism test boundaries. */
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
  /** The explicit tool environment, prepared by the host and reapplied after Bubblewrap clears
   * inherited variables. Darwin receives it through the host's spawn call. */
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

/** The selected plan carries its own lifecycle. The closures retain the one concrete Darwin or
 * Bubblewrap plan selected at host construction, so the host cannot later cast or cross-route it. */
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
 * supported isolation returns an explicit unavailable value instead of leaving each caller to guess at
 * a fallback. The mechanism-specific support routines still own their exact executable and
 * namespace checks.
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
 * Select the verifier's mechanism at host construction, never per invocation. The prepared plan
 * captures matching lifecycle callbacks here, so later host code has one uniform capability and
 * no platform switch or generic plan cast.
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
  // Read once: every plan of this host binds the same platform roots, so its policy hash moves
  // only when the command, inputs or declared roots move.
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
 * A confined worker reports its pid and the controller proves the report is its actual child,
 * returning the host pid that names it, or null. Darwin sandbox-exec replaces the spawned process,
 * so the pids match. Bubblewrap runs the worker in a private pid namespace beneath itself, so the
 * reported pid is matched to the host process through the kernel's `NSpid` column. Either
 * mechanism rejects the controller's own pid.
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
