/** Host-owned OS isolation for the networked Built model process.
 *
 * The Built Harness reaches its provider over the network, so this wall cannot work by closing the
 * machine and reopening a list of allowed paths. It allows by default and then closes the two trees
 * that hold what the solver must not read: the repository, which carries the hidden expectations
 * and the evaluator, and the operator's home. Closing the home also closes the runtime the
 * transport executes when it was installed there, which is why the exact paths
 * `nodeRuntimeReadRoots` names are reopened read-only afterwards and nothing else is. No credential
 * crosses as a file or an environment variable: `startPiBuiltWorker` spawns the child with an empty
 * environment and sends the credential in the start message on the private JSONL pipe.
 *
 * The probe and the live worker are bound together by two values rather than by a shared label.
 * `isolationArgv` builds both launches, and `policyHash` covers the mechanism's digest along with
 * the denied and allowed roots, so `composedIsolation` can refuse a session whose policy bytes
 * differ from the ones the probe executed.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../meta/filesystem.ts";
import { homedir, tmpdir } from "../meta/os.ts";
import { join, resolve } from "../meta/path.ts";
import type { OptionalEnvValues } from "../backends/scrub-env.ts";
import { hashJsonBytes } from "../meta/json-runtime.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import {
  LINUX_BWRAP_ID,
  bwrapEnvironmentArgs,
  bwrapIsolationArgs,
  bwrapWholeRootArgs,
  bwrapReadBinds,
  bwrapTmpfsDenies,
  nodeRuntimeReadRoots,
} from "./linux-bwrap.ts";
import { type OsIsolationRuntime, osIsolationSupport } from "./os-isolation.ts";
import {
  type MoveGuardCheck,
  canonicalForms,
  covers,
  moveBlockingRules,
  probeMoveGuardCheck,
  runIsolationProbe,
  sbRule,
} from "./seatbelt-path-guard.ts";
import { traversalMetadataRules } from "./wall-policy.ts";
import { runtimeProcess } from "../meta/process.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { hasText } from "../meta/text.ts";

/** One evidence discriminator per mechanism family. `ISOLATION_FAMILIES` in
 *  `src/backends/session-isolation.ts` is keyed by these two strings and pairs each with the single
 *  session profile it certifies, so a probe executed under one mechanism can never be composed with
 *  a session that ran under the other. The Darwin constant's name says only "solve" while its value
 *  still says "seatbelt", because the value is the byte a probe record carries and the name is
 *  not. */
export const HOST_SOLVE_ISOLATION_FIXTURE = "host-seatbelt-read-deny/v1" as const;
export const HOST_BWRAP_SOLVE_ISOLATION_FIXTURE = "host-bwrap-read-deny/v1" as const;
type HostSolveIsolationFixture =
  | typeof HOST_SOLVE_ISOLATION_FIXTURE
  | typeof HOST_BWRAP_SOLVE_ISOLATION_FIXTURE;
export const HOST_SOLVE_ISOLATION_PROFILE_ID = "harness-host-solve-isolated";

const CANARY_MARKER = "ANA-HOST-ISOLATION-PROBE-CANARY-DO-NOT-TRUST";
/** A Linux policy is argv, not a second textual policy language, so there is no policy text for
 *  the evidence field to quote. This fixed sentence goes there for a human reader, and
 *  `isolationArgv` below remains the only thing that builds a launch — otherwise the evidence would
 *  become a second implementation of the policy, free to drift from the one in use. */
const LINUX_SOLVE_ISOLATION_DESCRIPTOR =
  "linux-bwrap solve isolation: allow-default host mount, protected roots overmounted, network preserved";
export interface SolveIsolationPolicy {
  profileId: typeof HOST_SOLVE_ISOLATION_PROFILE_ID;
  /** Darwin's exact Seatbelt text, which the launch hands to `-p`; on Linux the descriptor above,
   *  which no launch reads. */
  profile: string;
  /** sha256 over the policy identity: the mechanism's own digest together with the denied and
   *  allowed roots. The probe records this as `profileDigest` and the verified session reports it as
   *  `policyHash`, and `composedIsolation` compares the two, so a session is bound to the rules the
   *  probe executed rather than to a label both happen to spell the same way. */
  policyHash: string;
  deniedReadRoots: string[];
  deniedWriteRoots: string[];
  /** Exact runtime paths reopened read-only inside a denied home or repository. */
  allowedReadRoots: string[];
  mechanismPath: string;
  /** `darwin-seatbelt/v1` or `linux-bwrap/v1`: read by `isolationArgv` to choose how the launch is
   *  built, and by the fixture chooser above to decide which family this evidence belongs to. */
  mechanismId: string;
}

export interface HostSolveIsolationEvidence {
  fixture: HostSolveIsolationFixture;
  /** True only when every step held: the protected read was refused, the control read returned its
   *  canary, the deny-lifted read returned the protected canary, and the ancestor-rename guard
   *  refused while its lifted control succeeded. A mechanism that merely failed satisfies none of
   *  them, which is the point — a broken wall has to leave the isolation contractual rather than
   *  earn `physical` by producing errors. */
  isolated: boolean;
  /** False when the mechanism or a required probe could not run. */
  available: boolean;
  deniedReadRefused: boolean;
  controlReadSucceeded: boolean;
  discriminationReadSucceeded: boolean;
  /** Whether an ancestor rename failed to expose a protected path. Both mechanisms run this probe,
   *  for opposite reasons: Seatbelt matches path strings, so renaming a protected root's parent
   *  would move the bytes out from under every rule, while Bubblewrap hides by mounting and the
   *  probe proves the mount stays attached across the same rename. */
  moveGuardRefused: boolean;
  /** The probed policy's digest; the verified session's evidence must carry the same value. */
  profileDigest: string | null;
  probedAt: string;
  evidence: string[];
}

function hostSolveIsolationFixture(mechanismId: string): HostSolveIsolationFixture {
  return mechanismId === LINUX_BWRAP_ID ? HOST_BWRAP_SOLVE_ISOLATION_FIXTURE : HOST_SOLVE_ISOLATION_FIXTURE;
}

/**
 * Author the solve isolation for one repository. `liftDeniesCovering` exists for the probe's
 * discrimination check and nothing else: it returns the same policy with the deny entries covering
 * one concrete path removed, so that when the guarded read is refused and the lifted read succeeds,
 * the refusal can be attributed to those rules instead of to a mechanism that refuses everything.
 */
export function solveIsolationPolicy(input: {
  repoRoot: string;
  runtime?: OsIsolationRuntime;
  liftDeniesCovering?: string;
  readAllowRoots?: readonly string[];
}): SolveIsolationPolicy | { unsupported: string } {
  const support = osIsolationSupport(input.runtime);
  if (!support.ok || support.mechanismDigest === null) {
    return { unsupported: support.reason ?? "the OS isolation mechanism is unavailable" };
  }
  const home = homedir();
  // Compare both path forms of the lifted target. `/var/folders/...` and `/private/var/folders/...`
  // are the same directory, so a `/var/...` target is still covered by a `/private/var/...` deny,
  // and a discrimination check that silently failed to lift its own rule would report "the
  // mechanism is broken" when the mechanism is fine.
  const lifted = input.liftDeniesCovering === undefined ? [] : canonicalForms(input.liftDeniesCovering);
  const keep = (root: string): boolean => !lifted.some((target) => covers(root, target));
  const repoRoots = canonicalForms(input.repoRoot);
  const homeRoots = canonicalForms(home);
  const reads = [...new Set([...repoRoots, ...homeRoots])].filter(keep).sort();
  const writes = [...new Set([...repoRoots, ...homeRoots])].filter(keep).sort();
  const allowedReads = [
    ...new Set(
      [...nodeRuntimeReadRoots(), ...(input.readAllowRoots ?? [])].flatMap((root) => canonicalForms(root)),
    ),
  ]
    .filter((path) => reads.some((root) => covers(root, path)))
    .sort();
  const fixture = hostSolveIsolationFixture(support.mechanismId);
  const identity = {
    schema: fixture,
    profileId: HOST_SOLVE_ISOLATION_PROFILE_ID,
    mechanism: { path: support.mechanismPath, sha256: support.mechanismDigest },
    default: "allow",
    deniedReads: reads,
    deniedWrites: writes,
    allowedReads,
  };
  // Linux reaches the same allow-except posture through Bubblewrap: it begins with the host mount
  // tree so the Built Harness can still reach its provider, then overmounts every protected root
  // with an empty tmpfs, which leaves those paths neither readable nor reachable. Only the
  // descriptor is chosen here; `isolationArgv` owns the launch bytes.
  //
  // The Seatbelt arm is last-match-wins, so the order below is the policy: close the broad roots,
  // reopen the exact runtime paths, then guard their ancestors against relocation. Bubblewrap needs
  // no equivalent of that last family, because a tmpfs mount stays attached to its directory when an
  // ancestor is renamed, where a path rule does not.
  const profile =
    support.platform === "linux"
      ? LINUX_SOLVE_ISOLATION_DESCRIPTOR
      : [
          "(version 1)",
          "(allow default)",
          ...sbRule("deny file-read*", "subpath", reads),
          ...sbRule("deny file-write*", "subpath", writes),
          ...traversalMetadataRules(allowedReads),
          ...sbRule("allow file-read*", "subpath", allowedReads),
          // Nothing above survives a rename of a protected root's parent. `seatbelt-path-guard.ts`
          // measures that bypass directly, by running the same shape of profile once with these
          // lines and once without them.
          ...moveBlockingRules(reads),
          "",
        ].join("\n");
  return {
    profileId: HOST_SOLVE_ISOLATION_PROFILE_ID,
    profile,
    policyHash: hashJsonBytes(identity),
    deniedReadRoots: reads,
    deniedWriteRoots: writes,
    allowedReadRoots: allowedReads,
    mechanismPath: support.mechanismPath,
    mechanismId: support.mechanismId,
  };
}

/**
 * The one argv construction for this mechanism. The probe checks and the verified sessions both come
 * through here, so "the rules the probe executed" and "the rules the session ran under" are the same
 * bytes in the same argument positions by construction. Two hand-built argvs would let a flag change
 * reach one of them while the other went on testing an isolation no session uses.
 */
export function isolationArgv(
  policy: Pick<SolveIsolationPolicy, "profile" | "mechanismId" | "deniedReadRoots" | "allowedReadRoots">,
  command: string,
  args: readonly string[],
  environment: OptionalEnvValues = {},
): string[] {
  if (policy.mechanismId === LINUX_BWRAP_ID) {
    // Allow the whole machine, hide every protected root behind an empty tmpfs, and keep the
    // network, which the worker's provider is on.
    return [
      ...bwrapIsolationArgs({ network: true }),
      ...bwrapWholeRootArgs("--dev-bind"),
      ...bwrapTmpfsDenies(policy.deniedReadRoots),
      ...bwrapReadBinds(policy.allowedReadRoots),
      // After the re-exposing binds, so that nothing reopens a hidden root as writable. Without
      // this a write into an overmounted path would succeed against the tmpfs and land on namespace
      // memory the host never sees; with it the write fails with EROFS.
      ...policy.deniedReadRoots.flatMap((path) => ["--remount-ro", path]),
      ...bwrapEnvironmentArgs(environment),
      command,
      ...args,
    ];
  }
  return ["-p", policy.profile, command, ...args];
}

/** Spawn a transport's own process under the isolation with native Bun pipes. Draining stderr is
 *  left to the caller: `startPiBuiltWorker` forwards it to the host's stderr and waits on that drain
 *  before it settles the worker, so nothing in the launch here may consume it first. */
export function spawnUnderSolveIsolation(
  policy: SolveIsolationPolicy,
  options: {
    command: string;
    args: string[];
    cwd?: string;
    env: OptionalEnvValues;
    signal?: AbortSignal;
  },
): Bun.Subprocess<"pipe", "pipe", "pipe"> {
  return Bun.spawn({
    cmd: [policy.mechanismPath, ...isolationArgv(policy, options.command, options.args, options.env)],
    cwd: options.cwd ?? runtimeProcess.cwd(),
    env: options.env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    // The wrapper becomes its own process group, which is what settlement reaps. Under Bubblewrap
    // the worker reports a different pid, and settlement reaps that group by its id as well, so both
    // paths reap by process-group id rather than by matching process names.
    detached: true,
    ...keyIfDefined("signal", options.signal),
  });
}

/**
 * What counts as an observed refusal for each isolation fixture. A denial has to be observable: a
 * generic non-zero exit is not evidence, because a broken mechanism or an invalid profile would then
 * earn `physical` by failing, and the canary appearing in the output refutes a refusal outright
 * however the process exited.
 *
 * The mechanism shapes the refusal string. Seatbelt denies the read, and the kernel reports
 * "Operation not permitted". Bubblewrap never mounts the protected path into the namespace, so there
 * is nothing to deny and the read fails with ENOENT instead. For the bwrap mechanism ENOENT
 * therefore counts, which is safe only because the two accompanying controls have to hold as well:
 * the same-policy control read must return its canary, proving that `cat` and the marker format
 * work, and the deny-lifted discrimination read must return the protected canary, proving the path
 * is readable once it is no longer hidden. Neither a broken probe nor an absent file could satisfy
 * both. The default branch, Darwin or an unspecified mechanism, keeps the strict shape, so "no such
 * file" out of a broken Seatbelt profile still fails to earn `physical`.
 */
export function observedRefusal(
  combined: string,
  status: number | null,
  canaryMarker: string,
  mechanismId?: string,
): boolean {
  if (combined.includes(canaryMarker)) return false;
  const patterns =
    mechanismId === LINUX_BWRAP_ID
      ? /operation not permitted|permission denied|not permitted|denied|eperm|eacces|no such file|enoent/i
      : /operation not permitted|permission denied|not permitted|denied|eperm|eacces/i;
  return status !== 0 && patterns.test(combined);
}

function runUnderPolicy(
  policy: Pick<
    SolveIsolationPolicy,
    "profile" | "mechanismId" | "deniedReadRoots" | "allowedReadRoots" | "mechanismPath"
  >,
  cwd: string,
  command: string,
  args: readonly string[],
) {
  return runIsolationProbe(policy.mechanismPath, isolationArgv(policy, command, args, {}), cwd);
}

/** The Bubblewrap half of the host's live probe. It reuses the probe workspace so the guarded and
 *  lifted controls belong to one evidence lifecycle instead of opening a second scratch sandbox.
 *  A tmpfs mount stays attached to its directory when its parent is renamed, unlike a Seatbelt path
 *  rule, and the lifted step is what proves the hidden result came from that mount rather than from
 *  a rename that simply failed. */
function linuxMoveGuardCheck(mechanismPath: string, workRoot: string): MoveGuardCheck {
  try {
    const run = (name: string, hidden: boolean) => {
      const root = join(workRoot, "linux-move-guard", name);
      const home = join(root, "home");
      const secret = join(home, "secret");
      const moved = join(root, "moved");
      mkdirSync(secret, { recursive: true, mode: 0o700 });
      writeFileSync(join(secret, "canary.txt"), `${CANARY_MARKER}\n`, { mode: 0o600 });
      return runUnderPolicy(
        {
          profile: LINUX_SOLVE_ISOLATION_DESCRIPTOR,
          mechanismId: LINUX_BWRAP_ID,
          deniedReadRoots: hidden ? [secret] : [],
          allowedReadRoots: [],
          mechanismPath,
        },
        root,
        "/bin/sh",
        ["-c", `mv ${home} ${moved} 2>/dev/null; cat ${join(moved, "secret", "canary.txt")} 2>&1`],
      );
    };
    const guarded = run("guarded", true);
    const lifted = run("lifted", false);
    if (guarded.error !== undefined || lifted.error !== undefined) {
      return {
        refused: false,
        liftedSucceeded: false,
        detail: `linux move-guard mechanism could not execute: ${guarded.error ?? lifted.error}`,
      };
    }
    const refused = !guarded.combined.includes(CANARY_MARKER);
    const liftedSucceeded = lifted.combined.includes(CANARY_MARKER);
    const attributable = liftedSucceeded
      ? "ancestor rename did not relocate the tmpfs mount; the canary stayed hidden and appeared once the mount was lifted"
      : "canary stayed hidden, but the lifted control also hid it — hiding not attributable to the mount";
    return {
      refused,
      liftedSucceeded,
      detail: refused
        ? attributable
        : "ancestor rename exposed the tmpfs-hidden bytes — the mount relocated (unexpected on Linux)",
    };
  } catch (error) {
    return {
      refused: false,
      liftedSucceeded: false,
      detail: `linux move-guard probe error: ${errorMessage(error)}`,
    };
  }
}

/**
 * Execute the host solve isolation's discriminating fixture. It never throws: an unavailable
 * mechanism returns `available: false`, which the isolation vocabulary reads as contractual, so the
 * caller receives an unproven result and decides for itself whether the run's isolation requirements
 * still permit it.
 */
export function probeHostSolveReadDeny(opts: {
  repoRoot: string;
  runtime?: OsIsolationRuntime;
  readAllowRoots?: readonly string[];
}): HostSolveIsolationEvidence {
  const probedAt = new Date().toISOString();
  const fallbackFixture = hostSolveIsolationFixture(
    (opts.runtime?.platform ?? runtimeProcess.platform) === "linux" ? LINUX_BWRAP_ID : "",
  );
  const unproven = (detail: string, profileDigest: string | null = null): HostSolveIsolationEvidence => ({
    fixture: fallbackFixture,
    isolated: false,
    available: false,
    deniedReadRefused: false,
    controlReadSucceeded: false,
    discriminationReadSucceeded: false,
    moveGuardRefused: false,
    profileDigest,
    probedAt,
    evidence: [detail],
  });
  const runtime = opts.runtime === undefined ? {} : { runtime: opts.runtime };
  const readAllow = opts.readAllowRoots === undefined ? {} : { readAllowRoots: opts.readAllowRoots };
  const real = solveIsolationPolicy({ repoRoot: opts.repoRoot, ...runtime, ...readAllow });
  if ("unsupported" in real) {
    return unproven(`host solve isolation unavailable — remaining contractual: ${real.unsupported}`);
  }
  let workRoot: string | null = null;
  let repoCanaryDir: string | null = null;
  try {
    const parent = join(tmpdir(), "ana-host-isolation-probe");
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    workRoot = mkdtempSync(join(parent, "run-"));
    const controlCanary = join(workRoot, "control-canary.txt");
    writeFileSync(controlCanary, `${CANARY_MARKER}\n`, { mode: 0o600 });
    // The deny target sits inside the protected root, where the live policy must refuse the read and
    // the deny-lifted policy must not.
    repoCanaryDir = mkdtempSync(join(resolve(opts.repoRoot), ".ana-host-isolation-probe-"));
    const repoCanary = join(repoCanaryDir, "canary.txt");
    writeFileSync(repoCanary, `${CANARY_MARKER}\n`, { mode: 0o600 });
    const open = solveIsolationPolicy({
      repoRoot: opts.repoRoot,
      ...runtime,
      ...readAllow,
      liftDeniesCovering: repoCanary,
    });
    if ("unsupported" in open) {
      return unproven(`discrimination policy unavailable: ${open.unsupported}`, real.policyHash);
    }
    return judgeSteps(real, open, workRoot, { repoCanary, controlCanary, probedAt });
  } catch (error) {
    return unproven(
      `host solve isolation check failed — remaining contractual: ${errorMessage(error)}`,
      real.policyHash,
    );
  } finally {
    for (const dir of [workRoot, repoCanaryDir]) {
      if (hasText(dir)) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          // The directory may already be gone.
        }
      }
    }
  }
}

function judgeSteps(
  real: SolveIsolationPolicy,
  open: SolveIsolationPolicy,
  workRoot: string,
  targets: { repoCanary: string; controlCanary: string; probedAt: string },
): HostSolveIsolationEvidence {
  const deny = runUnderPolicy(real, workRoot, "/bin/cat", [targets.repoCanary]);
  const control = runUnderPolicy(real, workRoot, "/bin/cat", [targets.controlCanary]);
  const discrimination = runUnderPolicy(open, workRoot, "/bin/cat", [targets.repoCanary]);
  const executionError = [deny, control, discrimination].find((run) => hasText(run.error))?.error;
  const base = {
    fixture: hostSolveIsolationFixture(real.mechanismId),
    profileDigest: real.policyHash,
    probedAt: targets.probedAt,
  } as const;
  if (executionError !== undefined) {
    return {
      ...base,
      isolated: false,
      available: false,
      deniedReadRefused: false,
      controlReadSucceeded: false,
      discriminationReadSucceeded: false,
      moveGuardRefused: false,
      evidence: [`the isolation mechanism could not execute — remaining contractual: ${executionError}`],
    };
  }
  const deniedReadRefused = observedRefusal(deny.combined, deny.status, CANARY_MARKER, real.mechanismId);
  const controlReadSucceeded = control.combined.includes(CANARY_MARKER);
  const discriminationReadSucceeded = discrimination.combined.includes(CANARY_MARKER);
  const moveGuard: MoveGuardCheck =
    real.mechanismId === LINUX_BWRAP_ID
      ? linuxMoveGuardCheck(real.mechanismPath, workRoot)
      : probeMoveGuardCheck(real.mechanismPath);
  const moveGuardRefused = moveGuard.refused && moveGuard.liftedSucceeded;
  const isolated =
    deniedReadRefused && controlReadSucceeded && discriminationReadSucceeded && moveGuardRefused;
  const liftedCount = real.deniedReadRoots.length - open.deniedReadRoots.length;
  return {
    ...base,
    isolated,
    available: true,
    deniedReadRefused,
    controlReadSucceeded,
    discriminationReadSucceeded,
    moveGuardRefused,
    evidence: [
      `protected-root read: ${deniedReadRefused ? "REFUSED" : "not refused"} (status=${deny.status ?? "null"})`,
      `same-policy tmp control read: ${controlReadSucceeded ? "canary returned" : "canary NOT returned"} (status=${control.status ?? "null"})`,
      `deny-lifted discrimination read (${liftedCount} covering rules lifted): ${discriminationReadSucceeded ? "canary returned" : "canary NOT returned"} (status=${discrimination.status ?? "null"})`,
      `ancestor-rename guard: ${moveGuard.detail}`,
      isolated
        ? "physical read-deny proven — the OS refused a protected read the lifted policy shows would otherwise succeed"
        : "physical read-deny NOT proven — isolation remains contractual",
    ],
  };
}
