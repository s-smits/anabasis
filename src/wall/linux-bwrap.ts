/**
 * Linux OS isolation backend, corresponding to Darwin Seatbelt. Bubblewrap (`bwrap`) binds the
 * host root read-only and overmounts protected subtrees, while callers supply the shared policy
 * data (denied roots, writable roots, and network posture).
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
  /** Mirrors the Darwin check: detecting an outer sandbox causes the wall to refuse rather than
   *  nest or claim isolation established externally. */
  outerSandboxed?: boolean;
}

interface LinuxBwrapSupport {
  ok: boolean;
  reason: string | null;
  mechanismPath: string;
  mechanismDigest: string | null;
}

/** Matches Bubblewrap's stderr when an unsupported flag is rejected, allowing diagnostics to name
 *  the missing option directly. */
const UNKNOWN_OPTION = /Unknown option (--[a-z0-9-]+)/;

/** Cache of attested `bwrap` binaries keyed by path, avoiding repeated hashing and `/bin/true`
 *  canary launches across seats and checks while binary metadata remains unchanged. */
const ATTESTED_BWRAP = new Map<string, { metadata: string; mechanismDigest: string }>();

/** Fallback Bubblewrap binary paths searched after `PATH` for minimal controller environments. */
const BWRAP_CANDIDATES = ["/usr/bin/bwrap", "/bin/bwrap", "/usr/local/bin/bwrap"] as const;

/** Standard Linux system roots already readable under the open-read default. */
const LINUX_SYSTEM_READ_ROOTS = ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc", "/opt"] as const;

/** Verbatim Bubblewrap stderr signatures indicating that unprivileged user namespaces are blocked. */
const USER_NAMESPACE_REFUSALS = [
  "loopback: Failed RTM_NEWADDR",
  "loopback: Failed RTM_NEWLINK",
  "setting up uid map: Permission denied",
  "No permissions to create a new namespace",
] as const;

/** Returns the resolved target of `/etc/resolv.conf` when it points outside system roots (for
 *  example, into `/run` on `systemd-resolved` hosts), binding only the target file rather than its
 *  enclosing directory. */
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
 * Returns installation prefixes for the active runtime executable (`capturedExecPath`) when it
 * resides outside standard system roots (such as a private user prefix). Admitting the prefix two
 * levels above the binary exposes `bin` and `lib` without reopening the enclosing home directory.
 * Symlinked executables contribute both their lexical and canonical prefixes.
 */
export function nodeRuntimeReadRoots(): string[] {
  const roots = new Set<string>();
  const candidates = [capturedExecPath];
  try {
    candidates.push(realpathSync.native(capturedExecPath));
  } catch {
    // Ignore unresolvable executable paths.
  }
  for (const exe of candidates) {
    const prefix = dirname(dirname(exe));
    if (prefix !== "" && !underSystemRoot(prefix) && existsSync(prefix)) roots.add(prefix);
  }
  return [...roots].toSorted();
}

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

/** Queries the installed `bwrap` version string for refusal diagnostics, returning `null` if the
 *  probe fails. */
function installedBwrapVersion(bwrapPath: string): string | null {
  const probe = runBwrap(bwrapPath, ["--version"]);
  if (probe instanceof Error || !probe.success || probe.exitedDueToTimeout === true) return null;
  return /bubblewrap\s+(\S+)/.exec(probe.stdout.toString())?.[1] ?? null;
}

/** Classifies a failed Bubblewrap launch from its stderr. Unknown flags (such as
 *  `--disable-userns` on Bubblewrap older than 0.8.0) and disabled user namespaces produce
 *  actionable remedies; other failures retain a truncated first stderr line. Dropping
 *  `--disable-userns` is intentionally avoided because it prevents confined children from nesting
 *  their own user namespaces. */
function classifyBwrapRefusal(stderr: string, bwrapPath?: string): string {
  const unknown = UNKNOWN_OPTION.exec(stderr);
  if (unknown !== null) {
    const version = bwrapPath === undefined ? null : installedBwrapVersion(bwrapPath);
    const installed = version === null ? "" : ` (installed bubblewrap ${version})`;
    // Bubblewrap 0.8.0 introduced `--disable-userns`; naming the minimum version lets the operator
    // verify their installed package directly.
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

/** Hashes `bwrapPath` and attests namespace creation via a canary launch, caching successful
 *  attestations per unchanged binary metadata. Failed canaries are never cached. */
function attestBwrap(bwrapPath: string): { mechanismDigest: string } | { refused: string } {
  const stat = statSync(bwrapPath);
  const metadata = [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");
  const remembered = ATTESTED_BWRAP.get(bwrapPath);
  if (remembered?.metadata === metadata) return { mechanismDigest: remembered.mechanismDigest };
  // Exercise the full offline isolation posture by executing `/bin/true` from the bound root,
  // confirming a functional namespace rather than flag parsing alone.
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

/** Checks Bubblewrap availability and unprivileged user-namespace support, failing closed on error. */
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
 * Baseline namespace isolation shared by every Bubblewrap launch: unprivileged user namespace,
 * new session, all capabilities dropped, nested user namespaces disabled, and isolated IPC, UTS,
 * cgroup, and PID namespaces. Only network isolation varies between seat commands and verification
 * checks. Failing any flag marks isolation unavailable rather than degrading silently.
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
    // Private PID namespace: terminates confined children when bwrap exits, hides host processes
    // in `/proc`, avoids orphaned processes under `--new-session`, and places bwrap's init as
    // PID 1 so unhandled SIGTERM still terminates the workload.
    "--unshare-pid",
  ];
  if (!options.network) args.push("--unshare-net");
  return args;
}

/**
 * Serialises an explicit environment as sorted `--setenv` flags after `--clearenv`. Sorting keeps
 * the launch argv deterministic for hashing, and rejecting names with `=` or NUL bytes prevents
 * argument injection into subsequent `bwrap` flags.
 */
export function bwrapEnvironmentArgs(environment: OptionalEnvValues): string[] {
  const entries = Object.entries(environment)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
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
 * Builds the allow-by-default read mount posture: host `/` bound read-only, followed by a fresh
 * `/proc` and minimal `/dev` so the root bind does not obscure them. Callers layer
 * `bwrapTmpfsDenies` and writable binds on top.
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

/** Emits `--ro-bind` arguments mounting each path read-only at its own location. */
export function bwrapReadBinds(paths: readonly string[]): string[] {
  return paths.flatMap((path) => ["--ro-bind", path, path]);
}

/** Emits `--remount-ro` for each existing path so earlier binds cannot leave it writable. Missing
 *  paths are skipped because Bubblewrap aborts on non-existent remount targets. */
export function bwrapReadonlyRemounts(paths: readonly string[]): string[] {
  return paths.flatMap((path) => (existsSync(path) ? ["--remount-ro", path] : []));
}

/** Emits `--bind` arguments mounting each writable root read-write at its own location. */
export function bwrapWriteBinds(paths: readonly string[]): string[] {
  return paths.flatMap((path) => ["--bind", path, path]);
}

/** Overmounts each protected directory with an empty tmpfs (and each protected regular file with
 *  read-only `/dev/null`), keeping protected bytes inaccessible even if an ancestor is renamed. */
export function bwrapTmpfsDenies(paths: readonly string[]): string[] {
  // Regular files are bound to read-only `/dev/null` so writes fail with EACCES and reads do not
  // return host contents, while missing paths are skipped because `bwrap` cannot create
  // mountpoints under a read-only `/` (for example, if a sibling worktree is removed mid-campaign).
  return paths.flatMap((path) => {
    if (isRegularFileDeny(path)) return ["--ro-bind", "/dev/null", path];
    return existsSync(path) ? ["--tmpfs", path] : [];
  });
}

/**
 * Reports whether `path` is an existing regular file that cannot accept a `--tmpfs` directory mount
 * (such as `~/.claude.json`, `~/.netrc`, or `~/.npmrc`). Uses `lstatSync` instead of `statSync` so
 * a symbolic link to a directory is not mistaken for a directory.
 */
function isRegularFileDeny(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}
