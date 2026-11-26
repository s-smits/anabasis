import { hashJsonBytes } from "../meta/json-runtime.ts";
import { tmpdir } from "../meta/os.ts";
import { nodeRuntimeReadRoots } from "./linux-bwrap.ts";
import { type OsIsolationRuntime, osIsolationSupport } from "./os-isolation.ts";
import { covers } from "./seatbelt-path-guard.ts";
import { canonicalRoots, closedHome, userTempRules } from "./policy.ts";
import { DARWIN_SEATBELT_ID } from "./darwin-seatbelt.ts";

export const HOST_SOLVE_ISOLATION_PROFILE_ID = "harness-host-solve-isolated";

export interface SolveIsolationPolicy {
  profileId: typeof HOST_SOLVE_ISOLATION_PROFILE_ID;
  policyHash: string;
  deniedReadRoots: string[];
  allowedReadRoots: string[];
  mechanismPath: string;
  mechanismId: string;
  network: boolean;
}

export function solveIsolationPolicy(input: {
  repoRoot: string;
  otherTrees?: readonly string[];
  packRoots?: readonly string[];
  runtime?: OsIsolationRuntime;
  readAllowRoots?: readonly string[];
  network?: boolean;
}): SolveIsolationPolicy | { unsupported: string } {
  const support = osIsolationSupport(input.runtime);
  if (!support.ok || support.mechanismDigest === null) {
    return { unsupported: support.reason ?? "the OS isolation mechanism is unavailable" };
  }
  const home = closedHome();
  if (home === undefined) {
    return { unsupported: "HOME is a relative path, so the wall cannot name the home it closes" };
  }
  const reads = canonicalRoots([
    input.repoRoot,
    ...(input.otherTrees ?? []),
    ...(input.packRoots ?? []),
    home,
  ]);
  const sharedTmp = canonicalRoots([tmpdir(), "/tmp", "/var/tmp", ...userTempRules().roots]);
  const allowedReads = canonicalRoots([...nodeRuntimeReadRoots(), ...(input.readAllowRoots ?? [])]).filter(
    (path) => reads.some((root) => covers(root, path)) || sharedTmp.some((root) => covers(root, path)),
  );
  const network = input.network ?? true;
  const identity = {
    profileId: HOST_SOLVE_ISOLATION_PROFILE_ID,
    mechanism: { path: support.mechanismPath, sha256: support.mechanismDigest },
    default: support.mechanismId === DARWIN_SEATBELT_ID ? "deny" : "allow",
    deniedReads: reads,
    deniedWrites: reads,
    allowedReads,
  };
  return {
    profileId: HOST_SOLVE_ISOLATION_PROFILE_ID,
    policyHash: hashJsonBytes(network ? identity : { ...identity, network }),
    deniedReadRoots: reads,
    allowedReadRoots: allowedReads,
    mechanismPath: support.mechanismPath,
    mechanismId: support.mechanismId,
    network,
  };
}
