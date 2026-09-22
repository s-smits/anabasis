/**
 * Linux's OS isolation, the peer of Darwin Seatbelt. Bubblewrap builds a fresh mount namespace from
 * explicit binds, while callers keep ownership of the shared policy data: readable roots, denied
 * roots, writable roots, and network posture. An unbound path is absent from the namespace, which
 * gives the Linux isolations their deny-default form without enumerating every host path to close.
 *
 * A tmpfs or bind mount remains attached to its dentry when an ancestor is renamed. Therefore the
 * path-relocation rules needed by the Darwin string policy have no Linux counterpart; the focused
 * Bubblewrap test checks that an ancestor rename cannot reveal a tmpfs-hidden probe file.
 * Support fails closed when Bubblewrap or unprivileged user namespaces are unavailable.
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
  /** A surrounding sandbox is not verifier-specific proof; mirror the Darwin gate and refuse. */
  outerSandboxed?: boolean;
  /** Skip the namespace probe for tests or re-attestation after initial support was checked. */
  skipNamespaceCheck?: boolean;
}

interface LinuxBwrapSupport {
  ok: boolean;
  reason: string | null;
  mechanismPath: string;
  mechanismDigest: string | null;
  /** Hash of the system roots granted on this host. Mutable root contents are intentionally not
   * hashed; this evidence records which roots are opened, not their contents. */
  baselineDigest: string | null;
}

/** An option this bubblewrap does not know. Bubblewrap prints the rejected flag, so the remedy can
 * name it instead of asking the operator to read a baseline argv they never see. */
const UNKNOWN_OPTION = /Unknown option (--[a-z0-9-]+)/;

/** The last attestation per bwrap binary, the Linux twin of Seatbelt's `SUPPORT_BY_RUNTIME`. The
 *  support is resolved for every confined child, so each Builder tool call hashed the binary and
 *  ran the `/bin/true` canary again (3.5 ms per call in the anabasis VM). Both are reused while
 *  the binary keeps identical complete metadata (device, inode, mode, size, mtime, ctime); a
 *  remembered canary also stands in for a skipped one. The baseline digest is recomputed each
 *  call: it reads a few system roots and the resolver link, which is cheap and may move. */
const ATTESTED_BWRAP = new Map<
  string,
  { metadata: ReadRootMetadata; mechanismDigest: string; canaryRan: boolean }
>();

const isSignalName = (name: string): name is RuntimeSignal => name in constants.signals;

/** Bubblewrap reports a command killed by a signal as exit 128 + signal number, with no signal of
 *  its own: exit 137 from a confined command is SIGKILL, not a completed exit. The host's own
 *  signal table names it, since bwrap only ever runs on the host that reads the exit. */
export function bwrapWrappedSignal(exitCode: number | null): RuntimeSignal | null {
  if (exitCode === null || exitCode <= 128) return null;
  const name = Object.entries(constants.signals).find(([, number]) => number === exitCode - 128)?.[0];
  return name !== undefined && isSignalName(name) ? name : null;
}

/** Candidate Bubblewrap locations in resolution order. PATH wins so a normal package install is
 * found; the fixed roots support a controller with a deliberately small environment. */
const BWRAP_CANDIDATES = ["/usr/bin/bwrap", "/bin/bwrap", "/usr/local/bin/bwrap"] as const;

/**
 * The read-only system baseline shared by all Bubblewrap postures. These roots cover the
 * interpreter and ordinary dynamic libraries without admitting a worktree or an operator home.
 * Missing architecture-specific roots are skipped: /lib64 is normal on some Linux hosts and absent
 * on others, so presence is part of the host-bound baseline identity below.
 */
export const LINUX_SYSTEM_READ_ROOTS = ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc", "/opt"] as const;

/** The resolver file a network posture needs. `/etc/resolv.conf` arrives with the `/etc` baseline,
 * but on a systemd-resolved host it is a symlink into `/run`, which no posture binds: the child
 * then has a socket and no way to turn a name into an address, measured 2026-08-18 in the Lima
 * `anabasis` VM as `curl: (6) Could not resolve host` for every hostname. The link target alone is
 * bound, never the directory holding it. */
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
 * Grant the running runtime's installation when it lives outside the system baseline, such as a
 * private prefix. The directory two levels above the executable normally contains bin and lib,
 * allowing the runtime and its bundled modules without opening the enclosing home directory.
 * A symlinked executable contributes both lexical and resolved prefixes; a prefix under /usr or
 * another system root is omitted as redundant.
 */
export function nodeRuntimeReadRoots(): string[] {
  const roots = new Set<string>();
  const candidates = [runtimeProcess.execPath];
  try {
    candidates.push(realpathSync.native(runtimeProcess.execPath));
  } catch {
    // an unresolvable executable is simply not a candidate
  }
  for (const exe of candidates) {
    const prefix = dirname(dirname(exe));
    if (prefix !== "" && !underSystemRoot(prefix) && existsSync(prefix)) roots.add(prefix);
  }
  return [...roots].sort();
}

/** The executable directories inside the runtime prefixes. A bind does not alter command
 * lookup, so children also receive these directories through their explicit PATH. */
export function nodeRuntimeBinDirs(): string[] {
  return nodeRuntimeReadRoots()
    .map((root) => join(root, "bin"))
    .filter(existsSync)
    .sort();
}

/** The full deny-default baseline: present system roots plus a private runtime installation when
 * needed. Keeping it here makes the bound roots and the hashed support identity use one owner. */
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
 * Bubblewrap child here runs in a private pid namespace: bwrap forks the namespace init, the init
 * forks the command, and the command sees itself as pid 2. Two exact parent links reach the
 * command, and the kernel's last `NSpid` column must equal what it reported. Anything else fails
 * the witness closed. */
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

/** Bubblewrap's own stderr messages for a refused unprivileged user namespace. Match them
 * literally: they are what the installed bwrap prints, not text this module owns. */
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

/** The installed bubblewrap's own version string, for a remedy that says what is actually here.
 *  Null when the binary cannot report one: an unreadable version is not worth a second failure. */
function installedBwrapVersion(bwrapPath: string): string | null {
  const probe = runBwrap(bwrapPath, ["--version"]);
  if (probe instanceof Error || !probe.success || probe.exitedDueToTimeout === true) return null;
  return /bubblewrap\s+(\S+)/.exec(probe.stdout.toString())?.[1] ?? null;
}

/** Name the cause of a failed Bubblewrap launch from its stderr. A recognised user-namespace
 * refusal keeps its remedy; any other refusal carries one capped stderr line so a host non-result
 * can distinguish a kernel policy from a rejected bind without rerunning the canary.
 *
 * The unknown-option case is separated because it is the one refusal an operator can fix in a
 * minute and could not previously act on. The baseline hardening includes `--disable-userns`,
 * which an older bubblewrap does not carry: Ubuntu 22.04 LTS ships 0.6.1, where every launch
 * refuses with a bare "Unknown option --disable-userns". Measured 2026-08-07 on 0.6.1, that string
 * reached 74 test failures across five files and named neither the package nor the remedy. The
 * isolation still fails closed — dropping the flag would quietly weaken it, since it is what stops a
 * confined child nesting its own user namespace. */
export function classifyBwrapRefusal(stderr: string, bwrapPath?: string): string {
  const unknown = UNKNOWN_OPTION.exec(stderr);
  if (unknown !== null) {
    const version = bwrapPath === undefined ? null : installedBwrapVersion(bwrapPath);
    const installed = version === null ? "" : ` (installed bubblewrap ${version})`;
    // 0.8.0 rather than "newer": measured 2026-08-07, Debian 12 ships 0.8.0 and it carries the
    // flag, Ubuntu 22.04 ships 0.6.1 and does not. Naming a version an operator can check beats
    // asking them to bisect their package manager.
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
    // Exercise the exact baseline a posture grants. /bin/true must load from the bound libraries,
    // so this proves a usable namespace rather than merely that Bubblewrap accepted its flags.
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
        // Recorded unconditionally, although only a network posture binds it: the identity states
        // which grants this host's baseline decides, not which one posture used.
        resolverReadPaths: networkResolverReadPaths(),
      }),
    };
  } catch {
    return unavailable("the bubblewrap mechanism could not be attested");
  }
}

/** The whole-machine exposure both bwrap callers open with: a cleared environment, the host root
 *  bound at `/` — writable for the solve sandbox, read-only for the workshop guest — and the
 *  namespace's own `/proc` and `/dev`. The two agreed on seven of these eight arguments by being
 *  written out twice, and the guest's copy is hashed into `sandboxPlanDigest`. */
export function bwrapWholeRootArgs(rootBind: "--dev-bind" | "--ro-bind"): string[] {
  return ["--clearenv", rootBind, "/", "/", "--proc", "/proc", "--dev", "/dev"];
}

/**
 * Isolation common to every Bubblewrap launch: a user namespace, a new session, no inherited
 * capabilities, and separate IPC, UTS, and cgroup namespaces. Callers select network isolation;
 * a failed setup is an unavailable isolation rather than a weakened launch.
 *
 * The normal worker keeps the host PID namespace because it reports a host-visible pid for the
 * controller's witness. Verifier calls add a private PID namespace in bwrapBaselineArgs because
 * their model does not need that correlation.
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
    // A private pid namespace: the confined command dies with bwrap's init, so ending the wrapper
    // ends the command too, and procfs (mounted after this flag) shows no host process. Without it,
    // `--new-session` leaves the command outside the wrapper's group and a group kill orphans it
    // with its pipes open. The init also keeps the inherited stdio open, so a command closing its
    // stdin never breaks the host's pipe; the request wall bounds that case instead. Running the
    // command as pid 1 itself would drop an unhandled SIGTERM from the host (all measured in the
    // anabasis VM, 2026-09-13).
    "--unshare-pid",
  ];
  if (!options.network) args.push("--unshare-net");
  return args;
}

/**
 * Clear inherited environment and add only deterministic explicit grants. A controller environment
 * may carry a provider credential or another capability, so it must not flow into a child by
 * default. Sorted names make argv stable; malformed POSIX names or values fail before option
 * parsing could be affected.
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
 * `bwrapBaselineArgs` enumerates the roots it binds, which is right for a declared verifier engine:
 * one pinned command whose needs are known. It is wrong for a shell a model may name, because the
 * enumeration then decides which programs exist. Measured 2026-08-18 in the Lima `anabasis` VM
 * under the enumerated baseline, `/usr/bin/cc` ran while a binary at `~/.cargo/bin` reported "not
 * found" and a file at `~/.local/lib` reported "No such file or directory" — the toolchain was on
 * disk and simply not in the namespace.
 *
 * The caller hides what must stay closed with `bwrapTmpfsDenies` and binds its writable tree after,
 * which is the same order the session isolation uses. `/proc` and `/dev` are mounted after the root
 * bind because a bind over `/` would otherwise cover them.
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

/** Overmount each protected root with an empty tmpfs in an allow-default namespace. The bytes are
 * absent rather than merely refused, and an ancestor rename cannot relocate that mount. */
export function bwrapTmpfsDenies(paths: readonly string[]): string[] {
  // A file-shaped path takes `/dev/null` read-only instead: that denies both read and write with
  // EACCES and leaves the host file untouched, where an empty tmpfs file would read as empty rather
  // than refuse. The probe's witness requires an observable refusal, because an isolation that
  // returns "" instead of an error cannot be told apart from one that is not running.
  return paths.flatMap((path) =>
    isRegularFileDeny(path) ? ["--ro-bind", "/dev/null", path] : ["--tmpfs", path],
  );
}

/**
 * Whether a protected path is a plain file on this host, and so cannot take a tmpfs.
 *
 * `--tmpfs` mounts a directory. Bubblewrap creates a missing mountpoint, so an absent path is
 * fine, and a directory is fine — but an existing regular file refuses the whole launch with
 * "Can't mkdir <path>: Not a directory", and one refused mountpoint takes the entire isolation with it.
 *
 * Three of the protected home paths are file-shaped: `.netrc`, `.npmrc` and `.claude.json`. A
 * fresh Linux VM has none of them, which is why a clean-VM gate run passes; an operator machine
 * that has actually run Claude Code has `~/.claude.json` and every confined call refuses.
 * Measured 2026-08-07 on Ubuntu 22.04 with Bubblewrap 0.11.1 — the same version a clean VM passed
 * on — so this is host state rather than a bubblewrap version.
 *
 * `lstat` rather than `stat`: a symbolic link to a directory must not be treated as a directory
 * here, because the tmpfs would land on the link's target and leave the named path readable.
 *
 * This is why the predicate is written out rather than shared. `isRegularFile` in
 * `exact-read-attestation.ts` and `regularGuard` in `command-guard.ts` are the same four lines
 * with `stat`, and both are right to follow the link, because they ask what a path leads to. This
 * one asks what the path is. Merging them would be a silent hole here.
 */
function isRegularFileDeny(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}
