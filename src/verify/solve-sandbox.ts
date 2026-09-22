/** Host-owned OS isolation for the networked Built model process.
 *
 * The repository and operator home are closed. The runtime installation and a transport's exact
 * executable may be reopened read-only; credentials cross only through the private JSONL pipe.
 * The probe and live worker use the same policy hash and launch constructor.
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

/** Evidence discriminator for this mechanism family. The isolation vocabulary pairs it with the one
 *  session profile this mechanism activates, so a probe can never certify another family. */
/** Kept as the Darwin alias so existing Seatbelt evidence bytes remain unchanged. */
export const HOST_SOLVE_ISOLATION_FIXTURE = "host-seatbelt-read-deny/v1" as const;
export const HOST_BWRAP_SOLVE_ISOLATION_FIXTURE = "host-bwrap-read-deny/v1" as const;
type HostSolveIsolationFixture =
  | typeof HOST_SOLVE_ISOLATION_FIXTURE
  | typeof HOST_BWRAP_SOLVE_ISOLATION_FIXTURE;
export const HOST_SOLVE_ISOLATION_PROFILE_ID = "harness-host-solve-isolated";

const CANARY_MARKER = "ANA-HOST-ISOLATION-PROBE-CANARY-DO-NOT-TRUST";
/** Linux policies are argv, not a second textual policy language. This stable descriptor is kept
 * in the shared evidence field for human inspection; `isolationArgv` below is the only launch authority. */
const LINUX_SOLVE_ISOLATION_DESCRIPTOR =
  "linux-bwrap solve isolation: allow-default host mount, protected roots overmounted, network preserved";
export interface SolveIsolationPolicy {
  profileId: typeof HOST_SOLVE_ISOLATION_PROFILE_ID;
  /** Darwin's exact Seatbelt text, or Linux's stable Bubblewrap descriptor. The Linux argv is
   * assembled only by isolationArgv, so the evidence cannot become a second policy implementation. */
  profile: string;
  /** sha256 over the policy identity (mechanism digest + denied roots). The verified session's
   *  evidence carries this, and the probe's evidence carries the same field, so the two checks bind
   *  identical policy inputs instead of a shared label. */
  policyHash: string;
  deniedReadRoots: string[];
  deniedWriteRoots: string[];
  /** Exact runtime paths reopened read-only inside a denied home or repository. */
  allowedReadRoots: string[];
  mechanismPath: string;
  /** `darwin-seatbelt/v1` or `linux-bwrap/v1` — the mechanism `isolationArgv` and the probe launch. */
  mechanismId: string;
}

export interface HostSolveIsolationEvidence {
  fixture: HostSolveIsolationFixture;
  /** True only when every denial, control, discrimination, and relocation check held. A run fingerprints
   * physical iff this is true; a mechanism failure remains an unproven, contractual isolation. */
  isolated: boolean;
  /** False when the mechanism or a required probe could not run. */
  available: boolean;
  deniedReadRefused: boolean;
  controlReadSucceeded: boolean;
  discriminationReadSucceeded: boolean;
  /** Both isolations execute an ancestor-rename probe here. Seatbelt relies on path rules; Bubblewrap
   * proves its tmpfs mount stays attached across the host rename in guarded and lifted steps. */
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
 * Author the solve isolation for one repository. `liftDeniesCovering` is the probe's discrimination
 * check only: the same rules with the deny entries covering one concrete path removed, so a
 * refusal can be attributed to those rules instead of to a broken mechanism.
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
  // Compare both path forms of the lifted target: a `/var/...` target under a `/private/var/...`
  // deny is still denied, and a discrimination check that silently fails to lift its own rule
  // reports "the mechanism is broken" when the mechanism is fine.
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
  // Linux confines the same allow-except posture with Bubblewrap. It begins with the host mount
  // tree so the Built Harness can still reach its provider, then overmounts every protected root
  // with empty tmpfs so those paths are neither readable nor reachable. The profile below is a
  // human-readable evidence descriptor; isolationArgv owns the actual launch bytes.
  //
  // Seatbelt needs path-rename rules because it matches path strings. A Bubblewrap tmpfs mount
  // remains attached when an ancestor directory moves, so that rule family is inert on Linux. The
  // focused Bubblewrap test checks this with a guarded and lifted probe. The Seatbelt arm is
  // last-match-wins: close broad roots, reopen exact runtime bytes, then guard their ancestors
  // against relocation.
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
          // Nothing above survives a rename of a protected root's parent; see
          // seatbelt-path-guard.ts, where that bypass is measured against this profile without
          // these lines.
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
 * The one argv construction for this mechanism. The probe checks and the verified sessions both go
 * through here, so "the rules the probe executed" and "the rules the session ran under" are the
 * same bytes in the same argument position by construction. Two hand-built argvs would let a flag
 * change reach one check while the other still tests an isolation no session uses.
 */
export function isolationArgv(
  policy: Pick<SolveIsolationPolicy, "profile" | "mechanismId" | "deniedReadRoots" | "allowedReadRoots">,
  command: string,
  args: readonly string[],
  environment: OptionalEnvValues = {},
): string[] {
  if (policy.mechanismId === LINUX_BWRAP_ID) {
    // Allow the whole machine, hide every protected root behind an empty tmpfs, keep the network.
    return [
      ...bwrapIsolationArgs({ network: true }),
      ...bwrapWholeRootArgs("--dev-bind"),
      ...bwrapTmpfsDenies(policy.deniedReadRoots),
      ...bwrapReadBinds(policy.allowedReadRoots),
      // After the re-exposing binds: a write into a hidden root fails with EROFS instead of landing
      // on namespace memory the host never sees.
      ...policy.deniedReadRoots.flatMap((path) => ["--remount-ro", path]),
      ...bwrapEnvironmentArgs(environment),
      command,
      ...args,
    ];
  }
  return ["-p", policy.profile, command, ...args];
}

/** Spawn a transport's own process under the isolation with native Bun pipes. The owning transport
 * drains stderr because some workers persist a bounded diagnostic while others forward it. */
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
    // Own the isolation wrapper group. Pi also reaps Bubblewrap's separately witnessed worker
    // group, so neither path needs process-name matching.
    detached: true,
    ...keyIfDefined("signal", options.signal),
  });
}

/**
 * What counts as an observed refusal for each isolation fixture (the Codex family's probe imports
 * this too). A denial requires an observable refusal: a generic non-zero exit is not evidence,
 * because a broken mechanism or an invalid profile must leave the isolation contractual rather than
 * earn `physical` by failing. The canary's presence in the output refutes a refusal outright.
 *
 * The mechanism shapes the refusal string. Seatbelt denies a read with "Operation not permitted".
 * Bubblewrap does not deny the read: it never mounts the protected path into the namespace, so the
 * kernel reports "No such file or directory" (ENOENT). For the bwrap mechanism ENOENT therefore
 * counts as a refusal, provided the accompanying controls succeed: the same-policy control
 * read must return its canary (so `cat` and the marker format work) and the deny-lifted
 * discrimination read must return the protected canary (so the path is readable once un-hidden),
 * which a broken or absent-file probe could not satisfy. The default (Darwin, or an
 * unspecified mechanism) keeps the strict shape, so "no such file" from a broken Seatbelt profile
 * still fails to earn `physical`.
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
 * lifted controls are part of one evidence lifecycle instead of opening a second scratch sandbox.
 * A tmpfs mount stays attached to its dentry when its parent is renamed, unlike a Seatbelt path
 * rule; the lifted step proves that the hidden result comes from that mount rather than a failed
 * host rename. */
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
 * Execute the host solve isolation's discriminating fixture. Never throws: an unavailable mechanism is
 * `{available:false}`, which the isolation vocabulary reads as contractual. The caller receives
 * an unproven result and can enforce the run's isolation requirements.
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
    // Put the deny target inside the protected root, where the live policy must refuse reads.
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
          // cleanup of a home that may already be gone
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
