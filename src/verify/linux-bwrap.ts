/**
 * Linux's OS isolation, the peer of Darwin Seatbelt. Bubblewrap builds a fresh mount namespace out
 * of explicit binds, while the callers keep ownership of the shared policy data: readable roots,
 * denied roots, writable roots and network posture. A path that is not bound is simply absent from
 * the namespace, and that is what gives the Linux isolations their deny-default form without
 * anyone having to enumerate every host path that must stay closed.
 *
 * A tmpfs or bind mount stays attached to its dentry when an ancestor is renamed, so the whole
 * class of path-relocation rules the Darwin string policy needs has no Linux counterpart at all;
 * the focused Bubblewrap test checks that renaming an ancestor cannot reveal a tmpfs-hidden probe
 * file. Support fails closed when Bubblewrap or unprivileged user namespaces are unavailable,
 * because an isolation that cannot be established is not one that may be run without.
 */

import { existsSync, lstatSync, readFileSync, realpathSync } from "../meta/filesystem.ts";
import { constants } from "../meta/os.ts";
import { dirname, isAbsolute, join } from "../meta/path.ts";
import { posixContainsPath } from "../meta/path-containment.ts";
import type { OptionalEnvValues } from "../backends/scrub-env.ts";
import type { RuntimePlatform, RuntimeSignal } from "../meta/runtime-values.ts";
import { sha256OfFile } from "../meta/digest.ts";
import { hashJsonBytes } from "../meta/json-runtime.ts";
import { runtimeProcess } from "../meta/process.ts";
import {
  type ReadRootMetadata,
  sameReadRootMetadata,
  snapshotReadRootPath,
} from "./read-root-attestation.ts";
import { asError } from "../meta/runtime-values.ts";
import { surroundingSandbox } from "./wall-policy.ts";

export const LINUX_BWRAP_ID = "linux-bwrap/v1" as const;

export interface LinuxBwrapRuntime {
  platform?: RuntimePlatform;
  bwrapPath?: string;
  /** A surrounding sandbox is not verifier-specific proof, so this mirrors the Darwin gate and
   *  refuses rather than recording isolation someone else established. */
  outerSandboxed?: boolean;
  /** Skip the namespace probe for tests or re-attestation after initial support was checked. */
  skipNamespaceCheck?: boolean;
}

interface LinuxBwrapSupport {
  ok: boolean;
  reason: string | null;
  mechanismPath: string;
  mechanismDigest: string | null;
  /** Hash of the system roots granted on this host. Their contents are deliberately not hashed,
   *  because they are mutable platform trees and this evidence records which roots are opened, not
   *  what was inside them at the time. */
  baselineDigest: string | null;
}

/** An option this bubblewrap does not know. Bubblewrap prints the rejected flag, so the remedy can
 *  name it rather than asking the operator to read a baseline argv they never see. */
const UNKNOWN_OPTION = /Unknown option (--[a-z0-9-]+)/;

/** The last attestation per bwrap binary, the Linux twin of Seatbelt's `SUPPORT_BY_RUNTIME`.
 *  Support is resolved for every confined child, so without this each Builder tool call hashed the
 *  binary and ran the `/bin/true` canary again, at 3.5 ms per call in the anabasis VM. Both are
 *  reused while the binary keeps identical complete metadata — device, inode, mode, size, mtime and
 *  ctime — and a remembered canary also stands in for a skipped one. The baseline digest is
 *  recomputed on every call instead, because it reads a few system roots and the resolver link,
 *  which is cheap and is exactly the thing that may have moved. */
const ATTESTED_BWRAP = new Map<
  string,
  { metadata: ReadRootMetadata; mechanismDigest: string; canaryRan: boolean }
>();

const isSignalName = (name: string): name is RuntimeSignal => name in constants.signals;

/** Bubblewrap reports a command killed by a signal as exit 128 + the signal number and raises no
 *  signal of its own, so exit 137 from a confined command is a SIGKILL and not a completed exit —
 *  a caller that read the code at face value would record a clean finish for a killed process. The
 *  host's own signal table names it, which is sound because bwrap only ever runs on the host that
 *  reads the exit. */
export function bwrapWrappedSignal(exitCode: number | null): RuntimeSignal | null {
  if (exitCode === null || exitCode <= 128) return null;
  const name = Object.entries(constants.signals).find(([, number]) => number === exitCode - 128)?.[0];
  return name !== undefined && isSignalName(name) ? name : null;
}

/** Candidate Bubblewrap locations in resolution order. PATH wins so that a normal package install
 *  is found wherever the distribution put it, and these fixed roots exist for a controller running
 *  with a deliberately small environment, where PATH may name nothing useful. */
const BWRAP_CANDIDATES = ["/usr/bin/bwrap", "/bin/bwrap", "/usr/local/bin/bwrap"] as const;

/**
 * The read-only system baseline shared by all Bubblewrap postures. These roots cover the
 * interpreter and the ordinary dynamic libraries without admitting a worktree or an operator home,
 * which is the whole trade the baseline makes. Missing architecture-specific roots are skipped
 * rather than refused, because `/lib64` is normal on some Linux hosts and absent on others; that
 * is why the presence of each root is part of the host-bound baseline identity below.
 */
export const LINUX_SYSTEM_READ_ROOTS = ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc", "/opt"] as const;

/** The resolver file a network posture needs. `/etc/resolv.conf` arrives with the `/etc` baseline,
 *  but on a systemd-resolved host it is a symlink into `/run`, which no posture binds: the child
 *  then has a socket and no way to turn a name into an address, measured 2026-08-18 in the Lima
 *  `anabasis` VM as `curl: (6) Could not resolve host` for every hostname. Only the link target is
 *  bound, never the directory holding it, so the fix costs nothing beyond the one file. */
export function networkResolverReadPaths(): string[] {
  try {
    const target = realpathSync.native("/etc/resolv.conf");
    return target === "/etc/resolv.conf" || underSystemRoot(target) ? [] : [target];
  } catch {
    return [];
  }
}

function resolveBwrap(runtime: LinuxBwrapRuntime): string | null {
  if (runtime.bwrapPath !== undefined) return existsSync(runtime.bwrapPath) ? runtime.bwrapPath : null;
  const onPath = (Bun.env.PATH ?? "")
    .split(":")
    .filter((dir) => dir !== "" && isAbsolute(dir))
    .map((dir) => join(dir, "bwrap"))
    .find(existsSync);
  return onPath ?? BWRAP_CANDIDATES.find(existsSync) ?? null;
}

/** The system roots that actually exist on this host, in fixed order. */
export function presentSystemReadRoots(): string[] {
  return LINUX_SYSTEM_READ_ROOTS.filter((root) => existsSync(root));
}

function underSystemRoot(path: string): boolean {
  return LINUX_SYSTEM_READ_ROOTS.some((root) => posixContainsPath(path, root));
}

/**
 * Grants the running runtime's installation when it lives outside the system baseline, such as in a
 * private prefix. The directory two levels above the executable normally contains `bin` and `lib`,
 * so granting that one directory admits the runtime and its bundled modules without opening the
 * enclosing home directory. A symlinked executable contributes both its lexical and its resolved
 * prefix, since either spelling may be the one a child opens, and a prefix that already sits under
 * `/usr` or another system root is omitted as redundant.
 */
export function nodeRuntimeReadRoots(): string[] {
  const roots = new Set<string>();
  const candidates = [runtimeProcess.execPath];
  try {
    candidates.push(realpathSync.native(runtimeProcess.execPath));
  } catch {
    // An unresolvable executable is not a candidate.
  }
  for (const exe of candidates) {
    const prefix = dirname(dirname(exe));
    if (prefix !== "" && !underSystemRoot(prefix) && existsSync(prefix)) roots.add(prefix);
  }
  return [...roots].sort();
}

/** The executable directories inside the runtime prefixes. A bind does not alter command lookup,
 *  so a child that can read these directories still cannot name what is in them until they arrive
 *  through its explicit PATH as well. */
export function nodeRuntimeBinDirs(): string[] {
  return nodeRuntimeReadRoots()
    .map((root) => join(root, "bin"))
    .filter(existsSync)
    .sort();
}

/** The full deny-default baseline: the present system roots plus a private runtime installation
 *  where one is needed. Keeping it in one function is what makes the roots that are bound and the
 *  roots that are hashed into the support identity come from a single owner. */
export function baselineReadRoots(): string[] {
  return [...presentSystemReadRoots(), ...nodeRuntimeReadRoots()];
}

/** The one child process of `pid`, from the kernel's own `children` list; null when there is
 * none, more than one, or the list is unreadable. */
function onlyChild(pid: number): number | null {
  try {
    const children = readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return children.length === 1 ? Number(children[0]) : null;
  } catch {
    return null;
  }
}

/** The host pid of the worker below `bwrapPid` that reported `reportedPid` as its own pid. Every
 *  Bubblewrap child here runs in a private pid namespace, so bwrap forks the namespace init, the
 *  init forks the command, and the command sees itself as pid 2. Two exact parent links therefore
 *  reach the command, and the kernel's last `NSpid` column must equal what the command reported.
 *  Anything else fails the witness closed, because a pid that cannot be correlated proves nothing
 *  about which process ran confined. */
export function bwrapConfinedWorker(reportedPid: number, bwrapPid: number): number | null {
  const init = onlyChild(bwrapPid);
  const command = init === null ? null : onlyChild(init);
  if (command === null) return null;
  try {
    const status = readFileSync(`/proc/${command}/status`, "utf8");
    const namespacePid = /^NSpid:\s*(.+)$/m.exec(status)?.[1]?.trim().split(/\s+/).at(-1);
    return Number(namespacePid) === reportedPid ? command : null;
  } catch {
    return null;
  }
}

/** Bubblewrap's own stderr messages for a refused unprivileged user namespace. They are matched
 *  literally because they are what the installed bwrap prints, not text this module owns, so
 *  paraphrasing them here would silently stop matching. */
const USER_NAMESPACE_REFUSALS = [
  "loopback: Failed RTM_NEWADDR",
  "loopback: Failed RTM_NEWLINK",
  "setting up uid map: Permission denied",
  "No permissions to create a new namespace",
] as const;

function runBwrap(
  path: string,
  args: string[],
  env: OptionalEnvValues = Bun.env,
): Bun.SyncSubprocess<"pipe", "pipe"> | Error {
  try {
    return Bun.spawnSync({ cmd: [path, ...args], env, timeout: 5000, stdout: "pipe", stderr: "pipe" });
  } catch (error) {
    return asError(error);
  }
}

/** The installed bubblewrap's own version string, so a remedy can say what is actually on the
 *  host. Null when the binary cannot report one, because an unreadable version is not worth turning
 *  into a second failure on top of the first. */
function installedBwrapVersion(bwrapPath: string): string | null {
  const probe = runBwrap(bwrapPath, ["--version"]);
  if (probe instanceof Error || !probe.success || probe.exitedDueToTimeout === true) return null;
  return /bubblewrap\s+(\S+)/.exec(probe.stdout.toString())?.[1] ?? null;
}

/** Names the cause of a failed Bubblewrap launch from its stderr. A recognised user-namespace
 *  refusal keeps its remedy, and any other refusal carries one capped stderr line, so a host
 *  non-result can tell a kernel policy from a rejected bind without rerunning the canary.
 *
 *  The unknown-option case is separated out because it is the one refusal an operator can fix in a
 *  minute and previously could not act on. The baseline hardening includes `--disable-userns`,
 *  which an older bubblewrap does not carry: Ubuntu 22.04 LTS ships 0.6.1, where every launch
 *  refuses with a bare "Unknown option --disable-userns". Measured 2026-08-07 on 0.6.1, that string
 *  reached 74 test failures across five files and named neither the package nor the remedy. The
 *  isolation still fails closed, since dropping the flag would quietly weaken it — it is what stops
 *  a confined child nesting a user namespace of its own. */
export function classifyBwrapRefusal(stderr: string, bwrapPath?: string): string {
  const unknown = UNKNOWN_OPTION.exec(stderr);
  if (unknown !== null) {
    const version = bwrapPath === undefined ? null : installedBwrapVersion(bwrapPath);
    const installed = version === null ? "" : ` (installed bubblewrap ${version})`;
    // 0.8.0 rather than "newer": measured 2026-08-07, Debian 12 ships 0.8.0 and it carries the
    // flag, Ubuntu 22.04 ships 0.6.1 and does not. Naming a version an operator can check against
    // their own package beats asking them to bisect their package manager.
    return `this bubblewrap does not support ${unknown[1]}${installed} — the OS isolation needs bubblewrap 0.8.0 or newer; upgrade the bubblewrap package`;
  }
  if (USER_NAMESPACE_REFUSALS.some((signature) => stderr.includes(signature))) {
    return "bubblewrap could not create an unprivileged user namespace — the kernel may have user namespaces disabled";
  }
  const detail = stderr
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "");
  return detail === undefined
    ? "bubblewrap refused its baseline policy"
    : `bubblewrap refused its baseline policy: ${detail.slice(0, 200)}`;
}

/** Hash the binary and prove its namespace, once per unchanged binary; a failed canary is the
 *  refusal reason and is not remembered, so the next call proves again. */
function attestBwrap(
  bwrapPath: string,
  namespaceCheck: "skip" | "require",
): { mechanismDigest: string } | { refused: string } {
  const metadata = snapshotReadRootPath(bwrapPath);
  const remembered = ATTESTED_BWRAP.get(bwrapPath);
  const current =
    remembered !== undefined && sameReadRootMetadata(remembered.metadata, metadata) ? remembered : null;
  const canaryRan = current?.canaryRan ?? false;
  if (namespaceCheck === "require" && !canaryRan) {
    // Exercise the exact baseline a posture grants, rather than the flags alone. /bin/true has to
    // load from the bound libraries to run at all, so a clean exit proves a usable namespace and
    // not merely that Bubblewrap was willing to parse its arguments.
    const canary = runBwrap(bwrapPath, [...bwrapBaselineArgs({ network: false }), "/bin/true"], {});
    if (canary instanceof Error || !canary.success || canary.exitedDueToTimeout === true) {
      return {
        refused: classifyBwrapRefusal(
          canary instanceof Error ? canary.message : canary.stderr.toString(),
          bwrapPath,
        ),
      };
    }
  }
  const mechanismDigest = current?.mechanismDigest ?? sha256OfFile(bwrapPath);
  ATTESTED_BWRAP.set(bwrapPath, {
    metadata,
    mechanismDigest,
    canaryRan: canaryRan || namespaceCheck === "require",
  });
  return { mechanismDigest };
}

/** Fail closed unless Bubblewrap and an unprivileged user namespace are usable. */
export function linuxBwrapSupport(runtime: LinuxBwrapRuntime = {}): LinuxBwrapSupport {
  const outerSandboxed = runtime.outerSandboxed ?? surroundingSandbox(Bun.env);
  const unavailable = (reason: string): LinuxBwrapSupport => ({
    ok: false,
    reason,
    mechanismPath: runtime.bwrapPath ?? BWRAP_CANDIDATES[0],
    mechanismDigest: null,
    baselineDigest: null,
  });
  if ((runtime.platform ?? runtimeProcess.platform) !== "linux") {
    return unavailable("Linux bubblewrap is unavailable on this platform");
  }
  if (outerSandboxed) {
    return unavailable(
      "a surrounding sandbox is not verifier-specific isolation; bubblewrap refuses to nest",
    );
  }
  const bwrapPath = resolveBwrap(runtime);
  if (bwrapPath === null) {
    return unavailable(
      "bubblewrap (bwrap) is not installed — install it with the OS package manager (apt-get install bubblewrap)",
    );
  }
  const roots = presentSystemReadRoots();
  if (roots.length === 0) return unavailable("no system read baseline root is present on this host");
  try {
    const attested = attestBwrap(bwrapPath, runtime.skipNamespaceCheck === true ? "skip" : "require");
    if ("refused" in attested) return unavailable(attested.refused);
    return {
      ok: true,
      reason: null,
      mechanismPath: bwrapPath,
      mechanismDigest: attested.mechanismDigest,
      baselineDigest: hashJsonBytes({
        schema: LINUX_BWRAP_ID,
        readBaselineRoots: baselineReadRoots(),
        // Recorded unconditionally, although only a network posture binds it, because the
        // identity states which grants this host's baseline decides and not which grants one
        // posture happened to use.
        resolverReadPaths: networkResolverReadPaths(),
      }),
    };
  } catch {
    return unavailable("the bubblewrap mechanism could not be attested");
  }
}

/** The whole-machine exposure both bwrap callers open with: a cleared environment, the host root
 *  bound at `/` — writable for the solve sandbox, read-only for the workshop guest — and the
 *  namespace's own `/proc` and `/dev`. The two callers agreed on seven of these eight arguments
 *  only by having been written out twice, which is the kind of agreement that lasts until someone
 *  edits one copy; the guest's copy is hashed into `sandboxPlanDigest`, so a drift there would
 *  change a recorded identity. */
export function bwrapWholeRootArgs(rootBind: "--dev-bind" | "--ro-bind"): string[] {
  return ["--clearenv", rootBind, "/", "/", "--proc", "/proc", "--dev", "/dev"];
}

/**
 * Isolation common to every Bubblewrap launch: a user namespace, a new session, no inherited
 * capabilities, and separate IPC, UTS and cgroup namespaces. Only network isolation is left to the
 * caller, because that is the one posture the three actors genuinely differ on. A setup that fails
 * makes the isolation unavailable rather than producing a weakened launch, since a launch missing
 * one of these flags would still look like a confined run in the evidence.
 */
export function bwrapIsolationArgs(options: { network: boolean }): string[] {
  const args = [
    "--die-with-parent",
    "--new-session",
    "--unshare-user",
    "--cap-drop",
    "ALL",
    "--disable-userns",
    "--unshare-ipc",
    "--unshare-uts",
    "--unshare-cgroup",
    // A private pid namespace, which buys four things at once. The confined command dies with
    // bwrap's init, so ending the wrapper ends the command too, and procfs — mounted after this
    // flag — shows no host process. Without it, `--new-session` leaves the command outside the
    // wrapper's process group, and a group kill then orphans it with its pipes still open. The init
    // also keeps the inherited stdio open, so a command that closes its own stdin never breaks the
    // host's pipe; the request wall bounds that case instead. And running the command as pid 1
    // itself would have it drop an unhandled SIGTERM from the host, which is why the init sits
    // between the two. All four measured in the anabasis VM, 2026-09-13.
    "--unshare-pid",
  ];
  if (!options.network) args.push("--unshare-net");
  return args;
}

/**
 * Clears the inherited environment and adds only deterministic explicit grants, because a
 * controller environment may carry a provider credential or another capability and must not flow
 * into a child by default. Sorting the names keeps argv stable, which matters because argv is
 * hashed into the launch identity. A malformed POSIX name or value throws here rather than being
 * passed on, since a name containing `=` or a NUL would change how bwrap parses the options that
 * follow it.
 */
export function bwrapEnvironmentArgs(environment: OptionalEnvValues): string[] {
  const entries = Object.entries(environment)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const args: string[] = [];
  for (const [name, value] of entries) {
    if (name === "" || name.includes("=") || name.includes("\0") || value.includes("\0")) {
      throw new Error("the explicit Bubblewrap environment is invalid");
    }
    args.push("--setenv", name, value);
  }
  return args;
}

export function bwrapBaselineArgs(options: { network: boolean }): string[] {
  const args = [...bwrapIsolationArgs(options), "--clearenv"];
  args.push("--proc", "/proc", "--dev", "/dev");
  for (const root of baselineReadRoots()) args.push("--ro-bind", root, root);
  if (options.network) for (const path of networkResolverReadPaths()) args.push("--ro-bind", path, path);
  return args;
}

/**
 * The allow-default read posture: the whole host mount tree, read-only, with a fresh procfs and a
 * minimal /dev over it.
 *
 * `bwrapBaselineArgs` enumerates the roots it binds, which is right for a declared verifier
 * engine: one pinned command whose needs are known in advance. It is wrong for a shell a model may
 * name anything into, because the enumeration then decides which programs exist. Measured
 * 2026-08-18 in the Lima `anabasis` VM under the enumerated baseline, `/usr/bin/cc` ran while a
 * binary at `~/.cargo/bin` reported "not found" and a file at `~/.local/lib` reported "No such file
 * or directory" — the toolchain was on disk and simply not in the namespace.
 *
 * The caller hides what must stay closed with `bwrapTmpfsDenies` and binds its writable tree after
 * that, which is the same order the session isolation uses. `/proc` and `/dev` are mounted after
 * the root bind, because a bind over `/` would otherwise cover them.
 */
export function bwrapOpenReadArgs(options: { network: boolean }): string[] {
  const args = [...bwrapIsolationArgs(options), "--clearenv"];
  args.push("--ro-bind", "/", "/", "--proc", "/proc", "--dev", "/dev");
  if (options.network) for (const path of networkResolverReadPaths()) args.push("--ro-bind", path, path);
  return args;
}

/** `--ro-bind` each exact readable path (a file or directory) at its own location. */
export function bwrapReadBinds(paths: readonly string[]): string[] {
  return paths.flatMap((path) => ["--ro-bind", path, path]);
}

/** `--bind` each writable root read-write at its own location. */
export function bwrapWriteBinds(paths: readonly string[]): string[] {
  return paths.flatMap((path) => ["--bind", path, path]);
}

/** Overmounts each protected root with an empty tmpfs in an allow-default namespace, which makes
 *  the bytes absent rather than merely refused, and means an ancestor rename cannot relocate the
 *  mount away from what it was hiding. */
export function bwrapTmpfsDenies(paths: readonly string[]): string[] {
  // A file-shaped path takes `/dev/null` read-only instead. That denies both read and write with
  // EACCES and leaves the host file untouched, where an empty tmpfs file would read as empty
  // rather than refuse. The probe's witness requires an observable refusal, because an isolation
  // that returns "" instead of an error cannot be told apart from one that is not running.
  return paths.flatMap((path) =>
    isRegularFileDeny(path) ? ["--ro-bind", "/dev/null", path] : ["--tmpfs", path],
  );
}

/**
 * Whether a protected path is a plain file on this host, and so cannot take a tmpfs.
 *
 * `--tmpfs` mounts a directory. Bubblewrap creates a missing mountpoint, so an absent path is fine
 * and a directory is fine, but an existing regular file refuses the whole launch with "Can't mkdir
 * <path>: Not a directory", and one refused mountpoint takes the entire isolation with it.
 *
 * Three of the protected home paths are file-shaped: `.netrc`, `.npmrc` and `.claude.json`. A fresh
 * Linux VM has none of them, which is why a clean-VM gate run passes, while an operator machine
 * that has actually run Claude Code has `~/.claude.json` and every confined call refuses. Measured
 * 2026-08-07 on Ubuntu 22.04 with Bubblewrap 0.11.1, the same version a clean VM passed on, so this
 * is host state rather than a bubblewrap version.
 *
 * It uses `lstat` rather than `stat`, because a symbolic link to a directory must not be treated as
 * a directory here: the tmpfs would land on the link's target and leave the named path readable.
 * That is also why the predicate is written out rather than shared. `isRegularFile` in
 * `exact-read-attestation.ts` and the identity check in `command-guard.ts` are the same few lines
 * with `stat`, and both are right to follow the link, because they ask what a path leads to. This
 * one asks what the path is, so merging them would be a silent hole here.
 */
function isRegularFileDeny(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}
