// Derived from the policy layer of v1's `e7636e472:src/verify/solve-sandbox.ts`. In v2, the
// evaluation loop runs in the host process and executes every command inside the command wall,
// whose isolation probe exercises the active launch mechanism (`walledBase`, `src/tools/command.ts`).
/** Host-owned OS isolation policy for seat commands: the shared base from which every command wall
 *  is constructed (`commandIsolationPolicy`, `isolation.ts`).
 *
 * Because the solver contacts its model provider over the network and invokes host toolchains, the
 * wall cannot operate by denying the entire filesystem and reopening an explicit allow-list.
 * Instead, it permits reads by default and denies the subtrees that hold evaluation secrets or
 * host state: the repository (which contains hidden expectations and the evaluator), its sibling
 * worktrees, any stored packs, and the operator's home directory.
 * Denying the home directory also hides runtimes installed there, so the exact paths returned by
 * `nodeRuntimeReadRoots` are reopened read-only while the rest of the directory remains closed.
 *
 * `policyHash` hashes the isolation mechanism's digest together with the denied and allowed roots.
 * It serves as the policy's cache key so each host process probes a given policy once
 * (`walledBase`) and verifies its network reachability once (`networkReach`).
 */
import { hashJsonBytes } from "../meta/json-runtime.ts";
import { tmpdir } from "../meta/os.ts";
import { nodeRuntimeReadRoots } from "./linux-bwrap.ts";
import { type OsIsolationRuntime, osIsolationSupport } from "./os-isolation.ts";
import { covers } from "./seatbelt-path-guard.ts";
import { canonicalRoots, closedHome, userTempRules } from "./policy.ts";
import { DARWIN_SEATBELT_ID } from "./darwin-seatbelt.ts";

/** Isolation profile identifier recorded in a solve condition's `sandbox` field (`tools/d2/campaign.ts`). */
export const HOST_SOLVE_ISOLATION_PROFILE_ID = "harness-host-solve-isolated";

export interface SolveIsolationPolicy {
  profileId: typeof HOST_SOLVE_ISOLATION_PROFILE_ID;
  /** SHA-256 digest of the policy identity, combining the mechanism binary digest with the denied
   *  and allowed roots. */
  policyHash: string;
  deniedReadRoots: string[];
  /** Exact runtime paths reopened read-only inside a denied home directory or repository. */
  allowedReadRoots: string[];
  mechanismPath: string;
  /** Mechanism identifier (`darwin-seatbelt/v1` or `linux-bwrap/v1`) used by the command wall to
   *  select the launch strategy. */
  mechanismId: string;
  /** Whether outbound network access is permitted: enabled for seats so they can install task
   *  dependencies, and disabled for verification checks (`src/kernel/verify.ts`). */
  network: boolean;
}

/** Constructs the base solve isolation policy for a repository. */
export function solveIsolationPolicy(input: {
  repoRoot: string;
  /** Sibling worktrees of the repository, denied alongside `repoRoot`. Denying only the active
   *  worktree would allow a confined shell to read another worktree's `.ana` campaign log and
   *  expose its hidden evaluation values. */
  otherTrees?: readonly string[];
  /** An exam's bundle where it lies outside the repository, denied alongside it by path. */
  packRoots?: readonly string[];
  runtime?: OsIsolationRuntime;
  readAllowRoots?: readonly string[];
  /** Whether outbound network access is allowed; defaults to `true`, matching seat posture. */
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
    // Darwin's command profile starts from a deny-by-default sandbox-runtime base (`seatbelt-base.ts`).
    default: support.mechanismId === DARWIN_SEATBELT_ID ? "deny" : "allow",
    deniedReads: reads,
    deniedWrites: reads,
    allowedReads,
  };
  return {
    profileId: HOST_SOLVE_ISOLATION_PROFILE_ID,
    // Include `network` in the hash only when disabled so existing seat policy hashes remain stable.
    policyHash: hashJsonBytes(network ? identity : { ...identity, network }),
    deniedReadRoots: reads,
    allowedReadRoots: allowedReads,
    mechanismPath: support.mechanismPath,
    mechanismId: support.mechanismId,
    network,
  };
}
