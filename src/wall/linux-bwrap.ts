/**
 * Linux OS isolation backend, corresponding to Darwin Seatbelt. Bubblewrap (`bwrap`) binds the
 * host root read-only and overmounts protected subtrees, while callers supply the shared policy
 * data (denied roots, writable roots, and network posture).
 */

import { existsSync, lstatSync, realpathSync, statSync } from "../meta/filesystem.ts";
import { homedir } from "../meta/os.ts";
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
  const home = homedir();
  for (const exe of candidates) {
    const prefix = [dirname(dirname(exe)), dirname(exe), exe].find((dir) => dir !== home) ?? exe;
    if (prefix !== "" && !underSystemRoot(prefix) && existsSync(prefix)) roots.add(prefix);
  }
  return [...roots].toSorted();
}

function runBwrap(
  path: string,
  args: string[],
  env: OptionalEnvValues = Bun.env,
): { ok: true; stdout: string } | { ok: false; error: string } {
  try {
    const probe = Bun.spawnSync({ cmd: [path, ...args], env, timeout: 5000, stdout: "pipe", stderr: "pipe" });
    return probe.success && probe.exitedDueToTimeout !== true
      ? { ok: true, stdout: probe.stdout.toString() }
      : { ok: false, error: probe.stderr.toString() };
  } catch (error) {
    return { ok: false, error: asError(error).message };
  }
}

/** Classifies a failed Bubblewrap launch from its stderr. Unknown flags (such as
 *  `--disable-userns` on Bubblewrap older than 0.8.0) and disabled user namespaces produce
 *  actionable remedies; other failures retain a truncated first stderr line. Dropping
 *  `--disable-userns` is intentionally avoided because it prevents confined children from nesting
 *  their own user namespaces. */
function classifyBwrapRefusal(stderr: string, bwrapPath?: string): string {
  const unknown = UNKNOWN_OPTION.exec(stderr);
  if (unknown !== null) {
    const probe = bwrapPath === undefined ? null : runBwrap(bwrapPath, ["--version"]);
    const version = probe?.ok === true ? (/bubblewrap\s+(\S+)/.exec(probe.stdout)?.[1] ?? null) : null;
    const installed = version === null ? "" : ` (installed bubblewrap ${version})`;
    return `this bubblewrap does not support ${unknown[1]}${installed} — the OS isolation needs bubblewrap 0.8.0 or newer; upgrade the bubblewrap package`;
  }
  if (USER_NAMESPACE_REFUSALS.some((signature) => stderr.includes(signature))) {
    return "bubblewrap could not create an unprivileged user namespace — the kernel may have user namespaces disabled";
  }
  const detail = stderr
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
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
  if (!canary.ok) return { refused: classifyBwrapRefusal(canary.error, bwrapPath) };
  const mechanismDigest = sha256OfFile(bwrapPath);
  ATTESTED_BWRAP.set(bwrapPath, { metadata, mechanismDigest });
  return { mechanismDigest };
}

/** Checks Bubblewrap availability and unprivileged user-namespace support, failing closed on error. */
export function linuxBwrapSupport(runtime: LinuxBwrapRuntime = {}): LinuxBwrapSupport {
  const unavailable = (reason: string): LinuxBwrapSupport => ({
    ok: false,
    reason,
    mechanismPath: runtime.bwrapPath ?? BWRAP_CANDIDATES[0],
    mechanismDigest: null,
  });
  if ((runtime.platform ?? runtimeProcess.platform) !== "linux") {
    return unavailable("Linux bubblewrap is unavailable on this platform");
  }
  if (runtime.outerSandboxed ?? surroundingSandbox(Bun.env)) {
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
    return "refused" in attested
      ? unavailable(attested.refused)
      : { ok: true, reason: null, mechanismPath: bwrapPath, mechanismDigest: attested.mechanismDigest };
  } catch {
    return unavailable("the bubblewrap mechanism could not be attested");
  }
}

/** Serialises an explicit environment as sorted `--setenv` flags after `--clearenv`. */
function bwrapEnvironmentArgs(environment: OptionalEnvValues): string[] {
  return Object.entries(environment)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .toSorted(([left], [right]) => (left < right ? -1 : 1))
    .flatMap(([name, value]) => {
      if (name === "" || /[=\0]/.test(name) || value.includes("\0")) {
        throw new Error("the explicit Bubblewrap environment is invalid");
      }
      return ["--setenv", name, value];
    });
}

const bwrapBinds = (flag: "--ro-bind" | "--bind", paths: readonly string[]): string[] =>
  paths.flatMap((path) => [flag, path, path]);

/**
 * Builds the baseline namespace and allow-by-default read mount posture: unprivileged user, IPC,
 * UTS, cgroup, and PID namespaces (`--disable-userns`, all capabilities dropped), host `/` bound
 * read-only, plus fresh `/proc` and `/dev`. Only network isolation varies between seat commands
 * and verification checks. Callers layer `bwrapTmpfsDenies` and writable binds on top.
 */
export function bwrapOpenReadArgs(options: { network: boolean }): string[] {
  return [
    "--die-with-parent",
    "--new-session",
    "--unshare-user",
    "--cap-drop",
    "ALL",
    "--disable-userns",
    "--unshare-ipc",
    "--unshare-uts",
    "--unshare-cgroup",
    "--unshare-pid",
    ...(options.network ? [] : ["--unshare-net"]),
    "--clearenv",
    "--ro-bind",
    "/",
    "/",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    ...(options.network ? bwrapBinds("--ro-bind", networkResolverReadPaths()) : []),
  ];
}

/** Builds the complete Bubblewrap mount and environment argument sequence for an isolated command. */
export function bwrapCommandArgs(options: {
  readonly network: boolean;
  readonly readDenies: readonly string[];
  readonly readAllowRoots: readonly string[];
  readonly scratchRoots: readonly string[];
  readonly keptRoots: readonly string[];
  readonly remounts: readonly string[];
  readonly environment: OptionalEnvValues;
}): string[] {
  return [
    ...bwrapOpenReadArgs({ network: options.network }),
    ...bwrapTmpfsDenies(options.readDenies),
    ...bwrapBinds("--ro-bind", options.readAllowRoots),
    ...bwrapBinds("--bind", options.scratchRoots),
    ...bwrapBinds("--ro-bind", options.keptRoots),
    ...options.remounts.flatMap((path) => (existsSync(path) ? ["--remount-ro", path] : [])),
    ...bwrapEnvironmentArgs(options.environment),
  ];
}

/** Overmounts each protected directory with an empty tmpfs (and each protected regular file —
 *  including symlinks targeting a regular file — with read-only `/dev/null`), also masking canonical
 *  symlink targets that lie outside already-denied paths so protected bytes stay unreachable. */
export function bwrapTmpfsDenies(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const path of paths) {
    seen.add(path);
    try {
      if (lstatSync(path).isSymbolicLink()) {
        const real = realpathSync.native(path);
        if (!paths.some((other) => posixContainsPath(real, other))) seen.add(real);
      }
    } catch {
      // Missing path or dangling symlink; skipped below.
    }
  }
  return [...seen].flatMap((path) => {
    try {
      return statSync(path).isFile() ? ["--ro-bind", "/dev/null", path] : ["--tmpfs", path];
    } catch {
      return [];
    }
  });
}
