/**
 * Linux's OS isolation, the peer of Darwin Seatbelt. Bubblewrap builds a fresh mount namespace from
 * explicit binds; callers own the policy data (readable, denied and writable roots, network). An
 * unbound path is absent from the namespace.
 *
 * A mount stays attached to its dentry when an ancestor is renamed, so the Darwin path-relocation
 * rules have no Linux counterpart. Support fails closed when Bubblewrap or unprivileged user
 * namespaces are unavailable.
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
import { trustedExecPath } from "../truth/trusted-runtime.ts";
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
  /** A surrounding sandbox is not verifier-specific isolation, so support refuses. */
  outerSandboxed?: boolean;
  /** Skip the namespace probe for tests or re-attestation after initial support was checked. */
  skipNamespaceCheck?: boolean;
}

interface LinuxBwrapSupport {
  ok: boolean;
  reason: string | null;
  mechanismPath: string;
  mechanismDigest: string | null;
  /** Hash of which system roots this host grants, not of their contents. */
  baselineDigest: string | null;
}

/** An option this bubblewrap does not know; the remedy names the rejected flag. */
const UNKNOWN_OPTION = /Unknown option (--[a-z0-9-]+)/;

/** The last attestation per bwrap binary. Support is resolved for every confined child, so the
 *  digest and canary are reused while the binary's complete metadata is unchanged; a remembered
 *  canary also stands in for a skipped one. The cheap, movable baseline digest is recomputed. */
const ATTESTED_BWRAP = new Map<
  string,
  { metadata: ReadRootMetadata; mechanismDigest: string; canaryRan: boolean }
>();

const isSignalName = (name: string): name is RuntimeSignal => name in constants.signals;

/** Bubblewrap reports a command killed by a signal as exit 128 + signal number (137 is SIGKILL).
 *  The host's signal table names it, since bwrap runs on the host that reads the exit. */
export function bwrapWrappedSignal(exitCode: number | null): RuntimeSignal | null {
  if (exitCode === null || exitCode <= 128) return null;
  const name = Object.entries(constants.signals).find(([, number]) => number === exitCode - 128)?.[0];
  return name !== undefined && isSignalName(name) ? name : null;
}

/** Fallback Bubblewrap locations after PATH, for a controller with a deliberately small environment. */
const BWRAP_CANDIDATES = ["/usr/bin/bwrap", "/bin/bwrap", "/usr/local/bin/bwrap"] as const;

/**
 * The read-only system baseline shared by all Bubblewrap postures: interpreters and dynamic
 * libraries, no worktree or operator home. Absent roots such as /lib64 are skipped, so presence is
 * part of the host-bound baseline identity.
 */
export const LINUX_SYSTEM_READ_ROOTS = ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc", "/opt"] as const;

/** The resolver file a network posture needs. On a systemd-resolved host `/etc/resolv.conf` links
 *  into `/run`, which no posture binds, so the link target alone is bound, never its directory. */
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
 * The captured runtime executable's installation prefix (two levels above it) when it lies outside
 * the system baseline, so it is readable without opening the enclosing home. A symlinked executable
 * contributes both lexical and resolved prefixes.
 */
export function nodeRuntimeReadRoots(): string[] {
  const roots = new Set<string>();
  const candidates = [trustedExecPath];
  try {
    candidates.push(realpathSync.native(trustedExecPath));
  } catch {
    // An unresolvable executable is not a candidate.
  }
  for (const exe of candidates) {
    const prefix = dirname(dirname(exe));
    if (prefix !== "" && !underSystemRoot(prefix) && existsSync(prefix)) roots.add(prefix);
  }
  return [...roots].sort();
}

/** The executable directories inside the runtime prefixes, which children also need on PATH. */
export function nodeRuntimeBinDirs(): string[] {
  return nodeRuntimeReadRoots()
    .map((root) => join(root, "bin"))
    .filter(existsSync)
    .sort();
}

/** The full deny-default baseline, bound and hashed from this one list. */
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

/** The host pid of the worker below `bwrapPid` that reported `reportedPid` as its own. bwrap forks
 *  the namespace init, which forks the command; the command's last `NSpid` column must equal what
 *  it reported, or the witness fails closed. */
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

/** Bubblewrap's own stderr for a refused unprivileged user namespace, matched literally. */
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

/** The installed bubblewrap's version for the remedy text, or null when it cannot report one. */
function installedBwrapVersion(bwrapPath: string): string | null {
  const probe = runBwrap(bwrapPath, ["--version"]);
  if (probe instanceof Error || !probe.success || probe.exitedDueToTimeout === true) return null;
  return /bubblewrap\s+(\S+)/.exec(probe.stdout.toString())?.[1] ?? null;
}

/** Names the cause of a failed Bubblewrap launch from its stderr. A recognised user-namespace
 *  refusal keeps its remedy; any other carries one capped stderr line.
 *
 *  An unknown option usually means a bubblewrap too old for `--disable-userns`, so the remedy names
 *  the upgrade. The isolation still fails closed: dropping the flag would let a confined child nest
 *  its own user namespace. */
export function classifyBwrapRefusal(stderr: string, bwrapPath?: string): string {
  const unknown = UNKNOWN_OPTION.exec(stderr);
  if (unknown !== null) {
    const version = bwrapPath === undefined ? null : installedBwrapVersion(bwrapPath);
    const installed = version === null ? "" : ` (installed bubblewrap ${version})`;
    // 0.8.0 is the oldest common packaged version that carries the flag.
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
    // /bin/true must load from the bound libraries, proving a usable namespace, not just accepted flags.
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
        // Recorded for every posture: the identity states what this host's baseline decides.
        resolverReadPaths: networkResolverReadPaths(),
      }),
    };
  } catch {
    return unavailable("the bubblewrap mechanism could not be attested");
  }
}

/** The whole-machine exposure both bwrap callers open with: a cleared environment, the host root
 *  bound at `/` (writable for the solve sandbox, read-only for the workshop guest) and the
 *  namespace's own `/proc` and `/dev`. The guest's copy is hashed into `sandboxPlanDigest`. */
export function bwrapWholeRootArgs(rootBind: "--dev-bind" | "--ro-bind"): string[] {
  return ["--clearenv", rootBind, "/", "/", "--proc", "/proc", "--dev", "/dev"];
}

/**
 * Isolation common to every Bubblewrap launch: a user namespace, a new session, no inherited
 * capabilities, and separate IPC, UTS, and cgroup namespaces. Callers select network isolation;
 * a failed setup is an unavailable isolation rather than a weakened launch.
 *
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
    // A private pid namespace: the command dies with bwrap's init, so ending the wrapper ends it,
    // and procfs shows no host process. Without it `--new-session` leaves the command outside the
    // wrapper's group, so a group kill would orphan it. The init also keeps inherited stdio open,
    // and spares the command pid 1's habit of dropping an unhandled SIGTERM.
    "--unshare-pid",
  ];
  if (!options.network) args.push("--unshare-net");
  return args;
}

/**
 * Explicit, sorted `--setenv` grants; the controller environment may hold credentials and never
 * flows into a child. Malformed names or values throw before they can affect option parsing.
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
 * `bwrapBaselineArgs` enumerates roots, which suits one pinned verifier command; for a model's
 * shell the enumeration would decide which installed programs exist. The caller hides protected
 * paths with `bwrapTmpfsDenies` and binds its writable tree after. `/proc` and `/dev` follow the
 * root bind, which would otherwise cover them.
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

/** Overmounts each protected root with an empty tmpfs, so its bytes are absent and a rename of an
 *  ancestor cannot relocate the mount. */
export function bwrapTmpfsDenies(paths: readonly string[]): string[] {
  // A file takes `/dev/null` read-only instead, which refuses reads and writes with EACCES; the
  // probe needs an observable refusal, since an empty read looks like no isolation at all.
  return paths.flatMap((path) =>
    isRegularFileDeny(path) ? ["--ro-bind", "/dev/null", path] : ["--tmpfs", path],
  );
}

/**
 * Whether a protected path is a plain file on this host, and so cannot take a tmpfs.
 *
 * `--tmpfs` mounts a directory; an existing regular file (such as `~/.claude.json`) refuses the
 * whole launch with "Can't mkdir <path>: Not a directory".
 *
 * `lstat`, not `stat`: a tmpfs on a symlinked directory would land on the target and leave the
 * named path readable. That is why this predicate is not shared with the `stat`-based ones in
 * `exact-read-attestation.ts` and `command-guard.ts`, which ask what a path leads to.
 */

function isRegularFileDeny(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}
