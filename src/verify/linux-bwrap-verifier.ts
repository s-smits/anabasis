/** Linux bubblewrap plan for the verifier host's deny-default engine boundary. */

import { realpathSync } from "../meta/filesystem.ts";
import { posixContainsPath } from "../meta/path-containment.ts";
import { VERIFIER_POSTURE, prepareVerifierReads } from "./darwin-seatbelt.ts";
import type { VerifierConfinementRequest } from "./verifier-port.ts";
import { hashJsonBytes } from "../meta/json-runtime.ts";
import {
  attestedInputDrift,
  type ExactReadDrift,
  type ExactReadSnapshot,
  exactReadDrift,
  mechanismDrift,
} from "./exact-read-attestation.ts";
import {
  LINUX_BWRAP_ID,
  type LinuxBwrapRuntime,
  baselineReadRoots,
  bwrapBaselineArgs,
  bwrapEnvironmentArgs,
  bwrapReadBinds,
  bwrapWriteBinds,
  classifyBwrapRefusal,
  linuxBwrapSupport,
} from "./linux-bwrap.ts";
import type { OptionalEnvValues } from "../backends/scrub-env.ts";
import { errorMessage } from "../meta/runtime-values.ts";

interface LinuxBwrapPlan {
  command: string;
  bwrapFlags: string[];
  args: string[];
  policyHash: string;
  workdir: string;
  support: { mechanismPath: string; mechanismDigest: string; baselineDigest: string };
  exactReadSnapshots: ExactReadSnapshot[];
  readRoots: string[];
}

function underAny(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => posixContainsPath(path, root));
}

/** The private workdir path is excluded from policyHash. The hash records exact file snapshots
 * and the granted read roots. Execution rechecks the mechanism, exact files and workdir path;
 * it does not hash every file beneath the granted directory roots. */
export function prepareLinuxBwrap(
  input: VerifierConfinementRequest & {
    runtime?: LinuxBwrapRuntime;
    /** The host has already constructed this allowlist. It is re-applied after --clearenv, never
     * inherited from Bubblewrap's own parent process. */
    environment?: OptionalEnvValues;
  },
): LinuxBwrapPlan | { unsupported: string } {
  const support = linuxBwrapSupport(input.runtime);
  if (!support.ok || support.mechanismDigest === null || support.baselineDigest === null) {
    return { unsupported: support.reason ?? "Linux bubblewrap is unavailable" };
  }
  const prepared = prepareVerifierReads(input, "the verifier command cannot be resolved for bubblewrap");
  if ("unsupported" in prepared) return prepared;
  const { command, workdir, reads, exactReadSnapshots, readRoots } = prepared;
  const baselineRoots = baselineReadRoots();
  const policyHash = hashJsonBytes({
    schema: LINUX_BWRAP_ID,
    mechanism: { path: support.mechanismPath, sha256: support.mechanismDigest },
    baseline: { schema: LINUX_BWRAP_ID, roots: baselineRoots, digest: support.baselineDigest },
    default: "deny",
    network: VERIFIER_POSTURE.network ? "allow" : "deny",
    process: "private-pid-namespace",
    reads: { exact: exactReadSnapshots, roots: readRoots, privateWorkdir: true },
    writes: { privateWorkdir: true, privateTmp: true, devNull: true },
  });
  const bwrapFlags = [
    ...bwrapBaselineArgs(VERIFIER_POSTURE),
    // A private /tmp, as the Builder and Built shells have, for tools that spell it: Frame3DD's
    // `temp_dir()` returns "/tmp" on Unix and a truss check exited 12 here. Before the binds, so
    // a workdir or read root under the host's /tmp stays visible on top of it.
    "--tmpfs",
    "/tmp",
    ...bwrapReadBinds(reads.filter((path) => !underAny(path, baselineRoots))),
    ...bwrapReadBinds(readRoots.filter((path) => !underAny(path, baselineRoots))),
    ...bwrapWriteBinds([workdir]),
    // After every mount: parents bwrap created for the binds become read-only, so a write beside
    // a bind fails with EROFS instead of landing on namespace memory the host never sees.
    "--remount-ro",
    "/",
    "--chdir",
    workdir,
    ...bwrapEnvironmentArgs(input.environment ?? {}),
  ];
  return {
    command: support.mechanismPath,
    bwrapFlags,
    args: [...bwrapFlags, command, ...input.engineArgs],
    policyHash,
    workdir,
    support: {
      mechanismPath: support.mechanismPath,
      mechanismDigest: support.mechanismDigest,
      baselineDigest: support.baselineDigest,
    },
    exactReadSnapshots,
    readRoots,
  };
}

/** Bubblewrap resolves each bind source through the live directory tree at spawn time, so a
 * workdir whose ancestor became a symbolic link after preparation would bind another location
 * read-write. The prepared workdir is already canonical; any resolution change refuses. */
function workdirResolutionDrift(workdir: string): string | null {
  try {
    if (realpathSync.native(workdir) === workdir) return null;
  } catch {
    // an unresolvable workdir is the change the line below reports
  }
  return "the verifier workdir resolution changed during verifier execution";
}

export function applyLinuxBwrapPlan(plan: LinuxBwrapPlan): { ok: true } | { ok: false; reason: string } {
  const drift = workdirResolutionDrift(plan.workdir);
  if (drift !== null) return { ok: false, reason: drift };
  try {
    const applied = Bun.spawnSync({
      cmd: [plan.command, ...plan.bwrapFlags, "/bin/true"],
      env: {},
      timeout: 5000,
      stdout: "pipe",
      stderr: "pipe",
    });
    return applied.success && applied.exitedDueToTimeout !== true
      ? { ok: true }
      : { ok: false, reason: classifyBwrapRefusal(applied.stderr.toString()) };
  } catch (error) {
    return { ok: false, reason: errorMessage(error) };
  }
}

export function verifyLinuxBwrapPlan(
  plan: LinuxBwrapPlan,
  runtime: LinuxBwrapRuntime = {},
): ExactReadDrift | null {
  const mechanism = mechanismDrift(
    linuxBwrapSupport({ ...runtime, skipNamespaceCheck: true }),
    plan.support,
    "Linux bubblewrap executable or read baseline",
  );
  if (mechanism !== null) return mechanism;
  const workdir = workdirResolutionDrift(plan.workdir);
  if (workdir !== null) return { kind: "changed", detail: workdir };
  return attestedInputDrift(exactReadDrift(plan.exactReadSnapshots));
}
