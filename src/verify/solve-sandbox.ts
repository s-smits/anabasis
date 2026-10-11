// Copied from v1 (github.com/s-smits/anabasis, 3f93d06b): src/verify/solve-sandbox.ts, its policy
// alone. v1 launched its sandboxed model process here (`isolationArgv`) and probed that launch; v2
// runs the loop in the host process and every command under the command wall, so the launch, its
// probe and the disk cap only that launch mounted went on 11 October (`docs/simplify.md`, W2). The
// wall is probed through the launch in use (`walledBase`, `src/solve/command.ts`).
/** Host-owned OS isolation for a seat's commands: the base every command wall is built on
 *  (`commandIsolationPolicy`, `solve-command-isolation.ts`).
 *
 * The solver reaches its provider over the network and its commands reach the host's programs, so
 * this wall cannot work by closing the machine and reopening a list of allowed paths. It allows by
 * default and then closes the trees that hold what a command must not read: the repository, which
 * carries the hidden expectations and the evaluator, its other worktrees, and the operator's home.
 * Closing the home also closes a runtime installed there, which is why the exact paths
 * `nodeRuntimeReadRoots` names are reopened read-only and nothing else is.
 *
 * `policyHash` covers the mechanism's digest along with the denied and allowed roots: it is the
 * policy's name, by which a process probes each policy once (`walledBase`) and reads each one's
 * network reach once (`networkReach`).
 */
import { homedir } from "../meta/os.ts";
import { hashJsonBytes } from "../meta/json-runtime.ts";
import { nodeRuntimeReadRoots } from "./linux-bwrap.ts";
import { type OsIsolationRuntime, osIsolationSupport } from "./os-isolation.ts";
import { covers } from "./seatbelt-path-guard.ts";
import { canonicalRoots } from "./wall-policy.ts";

/** The profile a condition's `sandbox` names (`tools/d2/campaign.ts`). */
export const HOST_SOLVE_ISOLATION_PROFILE_ID = "harness-host-solve-isolated";

export interface SolveIsolationPolicy {
  profileId: typeof HOST_SOLVE_ISOLATION_PROFILE_ID;
  /** sha256 over the policy identity: the mechanism's own digest together with the denied and
   *  allowed roots. */
  policyHash: string;
  deniedReadRoots: string[];
  deniedWriteRoots: string[];
  /** Exact runtime paths reopened read-only inside a denied home or repository. */
  allowedReadRoots: string[];
  mechanismPath: string;
  /** `darwin-seatbelt/v1` or `linux-bwrap/v1`: read by the command wall to choose how a command is
   *  launched. */
  mechanismId: string;
}

/** Author the solve isolation for one repository. */
export function solveIsolationPolicy(input: {
  repoRoot: string;
  /** The repository's other worktrees, denied with it. Until 10 October only the worktree a
   *  command ran in was denied, and a shell in one worktree read a sibling's `.ana` log, every
   *  hidden value of that campaign in it, on the Linux container (an Examiner's shell, by hand). */
  otherTrees?: readonly string[];
  /** A stored pack's root and bundle, denied with it by path. Until 11 October v1's run-data names
   *  closed them (`/correctness-model`, `/domains/<slug>/…`) on Darwin, and on Linux a scan for
   *  folders carrying those names beside a denied root (docs/simplify.md, F10 and W5). */
  packRoots?: readonly string[];
  runtime?: OsIsolationRuntime;
  readAllowRoots?: readonly string[];
}): SolveIsolationPolicy | { unsupported: string } {
  const support = osIsolationSupport(input.runtime);
  if (!support.ok || support.mechanismDigest === null) {
    return { unsupported: support.reason ?? "the OS isolation mechanism is unavailable" };
  }
  const reads = canonicalRoots([
    input.repoRoot,
    ...(input.otherTrees ?? []),
    ...(input.packRoots ?? []),
    homedir(),
  ]);
  const writes = [...reads];
  const allowedReads = canonicalRoots([...nodeRuntimeReadRoots(), ...(input.readAllowRoots ?? [])]).filter(
    (path) => reads.some((root) => covers(root, path)),
  );
  const identity = {
    profileId: HOST_SOLVE_ISOLATION_PROFILE_ID,
    mechanism: { path: support.mechanismPath, sha256: support.mechanismDigest },
    default: "allow",
    deniedReads: reads,
    deniedWrites: writes,
    allowedReads,
  };
  return {
    profileId: HOST_SOLVE_ISOLATION_PROFILE_ID,
    policyHash: hashJsonBytes(identity),
    deniedReadRoots: reads,
    deniedWriteRoots: writes,
    allowedReadRoots: allowedReads,
    mechanismPath: support.mechanismPath,
    mechanismId: support.mechanismId,
  };
}
