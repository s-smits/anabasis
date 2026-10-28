/**
 * Linux's OS isolation, the peer of Darwin Seatbelt. Bubblewrap binds the host's root read-only and
 * overmounts what must stay closed, while the callers own the shared policy data: denied roots,
 * writable roots and network posture.
 *
 * A tmpfs or bind mount stays attached to its dentry when an ancestor is renamed, so the
 * path-relocation rules the Darwin string policy needs have no Linux counterpart; the focused
 * Bubblewrap test checks that renaming an ancestor cannot reveal a tmpfs-hidden probe file. Support
 * fails closed when Bubblewrap or unprivileged user namespaces are unavailable: an isolation that
 * cannot be established is not one that may be run without.
 */

import { existsSync, lstatSync, realpathSync, statSync } from "../meta/filesystem.ts";
import { dirname, isAbsolute, join } from "../meta/path.ts";
import { posixContainsPath } from "../meta/path-containment.ts";
import type { OptionalEnvValues } from "../agent/backends/scrub-env.ts";
import type { RuntimePlatform } from "../meta/runtime-values.ts";
import { sha256OfFile } from "../meta/digest.ts";
import { runtimeProcess, capturedExecPath } from "../meta/process.ts";
import { asError } from "../meta/runtime-values.ts";
import { boundText } from "../meta/bounded-text.ts";
import { surroundingSandbox } from "./policy.ts";

export const LINUX_BWRAP_ID = "linux-bwrap/v1" as const;

export interface LinuxBwrapRuntime {
  platform?: RuntimePlatform;
  bwrapPath?: string;
  /** A surrounding sandbox is not this wall, so this mirrors the Darwin isolation check and refuses rather
   *  than recording isolation someone else established. */
  outerSandboxed?: boolean;
}

interface LinuxBwrapSupport {
  ok: boolean;
  reason: string | null;
  mechanismPath: string;
  mechanismDigest: string | null;
}

/** An option this bubblewrap does not know. Bubblewrap prints the rejected flag, so the remedy can
 *  name it rather than asking the operator to read a baseline argv they never see. */
const UNKNOWN_OPTION = /Unknown option (--[a-z0-9-]+)/;

/** The last proven bwrap binary by path. Support is resolved for every seat and every check, so
 *  without this each would hash the binary and run the `/bin/true` canary again. Both are reused
 *  while the binary keeps its device, inode, mode, size, mtime and ctime. */
const ATTESTED_BWRAP = new Map<string, { metadata: string; mechanismDigest: string }>();

/** Candidate Bubblewrap locations in resolution order. PATH wins so that a normal package install
 *  is found wherever the distribution put it, and these fixed roots exist for a controller running
 *  with a deliberately small environment, where PATH may name nothing useful. */
const BWRAP_CANDIDATES = ["/usr/bin/bwrap", "/bin/bwrap", "/usr/local/bin/bwrap"] as const;

/** The system roots a private runtime prefix or the resolver's target is already under. */
const LINUX_SYSTEM_READ_ROOTS = ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc", "/opt"] as const;

/** The resolver file a network posture needs. On a systemd-resolved host `/etc/resolv.conf` is a
 *  symlink into `/run`, which the Lima VM's wall once left dangling: the child then had a socket and
 *  no way to turn a name into an address. Only the link target is bound, never the directory
 *  holding it. */
function networkResolverReadPaths(): string[] {
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

function underSystemRoot(path: string): boolean {
  return LINUX_SYSTEM_READ_ROOTS.some((root) => posixContainsPath(path, root));
}

/**
 * Grants the captured runtime executable's installation when it lives outside the system roots,
 * such as in a private prefix. The directory two levels above the executable normally contains `bin`
 * and `lib`, so granting that one directory admits the runtime and its bundled modules without
 * opening the enclosing home. A symlinked executable contributes both its lexical and its resolved
 * prefix, since either spelling may be the one a child opens; a prefix already under a system root
 * is redundant.
 */
export function nodeRuntimeReadRoots(): string[] {
  const roots = new Set<string>();
  const candidates = [capturedExecPath];
  try {
    candidates.push(realpathSync.native(capturedExecPath));
  } catch {
    // An unresolvable executable is not a candidate.
  }
  for (const exe of candidates) {
    const prefix = dirname(dirname(exe));
    if (prefix !== "" && !underSystemRoot(prefix) && existsSync(prefix)) roots.add(prefix);
  }
  return [...roots].sort();
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

/** The installed bubblewrap's own version string, so a remedy can say what is on the host. Null when
 *  the binary cannot report one: an unreadable version is not worth a second failure. */
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
 *  minute. The baseline hardening includes `--disable-userns`, which an older bubblewrap does not
 *  carry, and every launch on such a host refuses with a bare "Unknown option --disable-userns"
 *  naming neither the package nor the remedy. Dropping the flag instead would quietly weaken the
 *  isolation: it is what stops a confined child nesting a user namespace of its own. */
function classifyBwrapRefusal(stderr: string, bwrapPath?: string): string {
  const unknown = UNKNOWN_OPTION.exec(stderr);
  if (unknown !== null) {
    const version = bwrapPath === undefined ? null : installedBwrapVersion(bwrapPath);
    const installed = version === null ? "" : ` (installed bubblewrap ${version})`;
    // 0.8.0 rather than "newer": 0.8.0 carries `--disable-userns` and 0.6.1 does not, and naming a
    // version an operator can check against their own package beats asking them to bisect.
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
    : `bubblewrap refused its baseline policy: ${boundText(detail, 200).shown}`;
}

/** Hash the binary and prove its namespace, once per unchanged binary; a failed canary is the
 *  refusal reason and is not remembered, so the next call proves again. */
function attestBwrap(bwrapPath: string): { mechanismDigest: string } | { refused: string } {
  const stat = statSync(bwrapPath);
  const metadata = [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");
  const remembered = ATTESTED_BWRAP.get(bwrapPath);
  if (remembered?.metadata === metadata) return { mechanismDigest: remembered.mechanismDigest };
  // Exercise the posture a closed command is launched under, not the flags alone. /bin/true has to
  // load from the bound root to run, so a clean exit proves a usable namespace rather than a parsed
  // argument list.
  const canary = runBwrap(bwrapPath, [...bwrapOpenReadArgs({ network: false }), "/bin/true"], {});
  if (canary instanceof Error || !canary.success || canary.exitedDueToTimeout === true) {
    return {
      refused: classifyBwrapRefusal(
        canary instanceof Error ? canary.message : canary.stderr.toString(),
        bwrapPath,
      ),
    };
  }
  const mechanismDigest = sha256OfFile(bwrapPath);
  ATTESTED_BWRAP.set(bwrapPath, { metadata, mechanismDigest });
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
  });
  if ((runtime.platform ?? runtimeProcess.platform) !== "linux") {
    return unavailable("Linux bubblewrap is unavailable on this platform");
  }
  if (outerSandboxed) {
    return unavailable("a surrounding sandbox is not this wall; bubblewrap refuses to nest");
  }
  const bwrapPath = resolveBwrap(runtime);
  if (bwrapPath === null) {
    return unavailable(
      "bubblewrap (bwrap) is not installed — install it with the OS package manager (apt-get install bubblewrap)",
    );
  }
  try {
    const attested = attestBwrap(bwrapPath);
    if ("refused" in attested) return unavailable(attested.refused);
    return { ok: true, reason: null, mechanismPath: bwrapPath, mechanismDigest: attested.mechanismDigest };
  } catch {
    return unavailable("the bubblewrap mechanism could not be attested");
  }
}

/**
 * Isolation common to every Bubblewrap launch: a user namespace, a new session, no inherited
 * capabilities, and separate IPC, UTS and cgroup namespaces. Only network isolation is left to the
 * caller, the one posture a seat's command and a check differ on. A setup that fails makes the
 * isolation unavailable rather than weakened, because a launch missing one of these flags would
 * still look like a confined run in the evidence.
 */
function bwrapIsolationArgs(options: { network: boolean }): string[] {
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
    // A private pid namespace, which buys four things. The confined command dies with bwrap's init,
    // so ending the wrapper ends the command, and procfs — mounted after this flag — shows no host
    // process. Without it, `--new-session` leaves the command outside the wrapper's process group,
    // and a group kill orphans it with its pipes still open. The init also keeps the inherited stdio
    // open, so a command that closes its own stdin never breaks the host's pipe; the request wall
    // bounds that case instead. And a command running as pid 1 itself would drop an unhandled
    // SIGTERM from the host, which is why the init sits between the two.
    "--unshare-pid",
  ];
  if (!options.network) args.push("--unshare-net");
  return args;
}

/**
 * Clears the inherited environment and adds only deterministic explicit grants, because a controller
 * environment may carry a provider credential or another capability and must not flow into a child
 * by default. Sorting the names keeps argv stable, and argv is hashed into the launch identity. A
 * malformed POSIX name or value throws rather than being passed on, since a name containing `=` or
 * a NUL would change how bwrap parses the options after it.
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

/**
 * The allow-default read posture: the whole host mount tree, read-only, with a fresh procfs and a
 * minimal /dev over it.
 *
 * Enumerating the roots to bind instead lets the enumeration decide which programs exist: under
 * such a wall `/usr/bin/cc` ran while a binary in
 * `~/.cargo/bin` reported "not found", the toolchain being on disk and simply not in the namespace.
 *
 * The caller hides what must stay closed with `bwrapTmpfsDenies` and binds its writable tree after
 * that. `/proc` and `/dev` are mounted after the root
 * bind, because a bind over `/` would otherwise cover them.
 */
export function bwrapOpenReadArgs(options: { network: boolean }): string[] {
  const args = [
    ...bwrapIsolationArgs(options),
    "--clearenv",
    "--ro-bind",
    "/",
    "/",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
  ];
  if (options.network) for (const path of networkResolverReadPaths()) args.push("--ro-bind", path, path);
  return args;
}

/** `--ro-bind` each exact readable path (a file or directory) at its own location. */
export function bwrapReadBinds(paths: readonly string[]): string[] {
  return paths.flatMap((path) => ["--ro-bind", path, path]);
}

/** `--remount-ro` each path, so that a bind made earlier cannot reopen it writable. A path that no
 *  longer exists is left out, as `bwrapTmpfsDenies` leaves it unmounted and for the same reason:
 *  Bubblewrap refuses the launch on it ("realpath(destination): No such file or directory"). */
export function bwrapReadonlyRemounts(paths: readonly string[]): string[] {
  return paths.flatMap((path) => (existsSync(path) ? ["--remount-ro", path] : []));
}

/** `--bind` each writable root read-write at its own location. */
export function bwrapWriteBinds(paths: readonly string[]): string[] {
  return paths.flatMap((path) => ["--bind", path, path]);
}

/** Overmounts each protected root with an empty tmpfs in an allow-default namespace, so the bytes
 *  are absent rather than refused and an ancestor rename cannot relocate the mount away from what
 *  it was hiding. */
export function bwrapTmpfsDenies(paths: readonly string[]): string[] {
  // A file-shaped path takes `/dev/null` read-only instead, which denies read and write with EACCES
  // and leaves the host file untouched, where an empty tmpfs file would read as empty rather than
  // refuse. The wall test (`probeWall`, `src/tools/command.ts`) requires an observable refusal,
  // because an isolation returning "" instead of an error cannot be told apart from one that is not
  // running.
  //
  // A path that no longer exists takes no mount. The root is bound read-only, so Bubblewrap cannot
  // make the mountpoint ("Can't mkdir <path>: Read-only file system") and refuses the whole launch.
  // The policy names the repository's other worktrees, read once when the campaign opens, and on
  // 10 October two of them were removed while a simulated campaign ran: from the next policy on
  // every solve ended `sandbox-crash`, 12 in a row, with the wall test's own-folder read refused. A
  // path that does not exist cannot be read, so leaving it unmounted denies nothing; it stays in
  // the policy's identity, which says what was denied by name.
  return paths.flatMap((path) => {
    if (isRegularFileDeny(path)) return ["--ro-bind", "/dev/null", path];
    return existsSync(path) ? ["--tmpfs", path] : [];
  });
}

/**
 * Whether a protected path is a plain file on this host, and so cannot take a tmpfs.
 *
 * `--tmpfs` mounts a directory. An existing regular file refuses the whole launch with "Can't mkdir
 * <path>: Not a directory", and one refused mountpoint takes the entire isolation with it. (An
 * absent path refuses it too, under a read-only root; `bwrapTmpfsDenies` leaves those out.) Three of
 * the protected home paths are file-shaped: `.netrc`, `.npmrc` and `.claude.json`. A fresh Linux VM
 * has none of them, so a clean-VM CI gate run passes while an operator machine that has actually run
 * Claude Code has `~/.claude.json` and refuses every confined call.
 *
 * It uses `lstat` rather than `stat`, because a symbolic link to a directory must not count as a
 * directory here: the tmpfs would land on the link's target and leave the named path readable. It
 * asks what the path is, not what it leads to.
 */
function isRegularFileDeny(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}
