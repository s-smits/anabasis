/** Host-owned OS isolation wall for seat commands and verification checks (`src/kernel/verify.ts`),
 *  where each check runs inside its own cell with outbound network access disabled.
 *
 * Commands receive an explicit environment rather than inheriting the host environment, and seat
 * commands keep outbound network access open so they can install domain toolchains into their
 * private home directory. To prevent installed packages from polluting the evaluated draft, a
 * command may write only within its seat root (which holds its private `HOME` and temporary
 * directory), excluding the host-owned subdirectory within that root. Shared host temporary
 * directories (`/tmp`, `/var/tmp`, and Darwin's per-user temporary directory) are closed. The
 * host home directory and repository remain closed except for the runtime and toolchain roots
 * reopened read-only by the enclosing solve policy and the harness's tool tree, which must resolve
 * inside the seat root when located there (`commandReadAllows`).
 */
import { existsSync, readdirSync, realpathSync, rmSync, writeFileSync } from "../meta/filesystem.ts";
import { tmpdir } from "../meta/os.ts";
import { containsPath } from "../meta/path-containment.ts";
import { basename, dirname, join, resolve } from "../meta/path.ts";
import { capturedExecPath } from "../meta/process.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import {
  LINUX_BWRAP_ID,
  bwrapEnvironmentArgs,
  bwrapOpenReadArgs,
  bwrapReadBinds,
  bwrapReadonlyRemounts,
  bwrapTmpfsDenies,
  bwrapWriteBinds,
  nodeRuntimeReadRoots,
} from "./linux-bwrap.ts";
import type { EnvValues } from "../agent/backends/scrub-env.ts";
import { covers, moveBlockingRules, sbRule } from "./seatbelt-path-guard.ts";
import { seatbeltBaseRules } from "./seatbelt-base.ts";
import type { SolveIsolationPolicy } from "./base.ts";
import {
  ancestorDirectories,
  canonicalForms,
  canonicalRoots,
  darwinToolchainInstallRoots,
  hostToolchainEnv,
  toolchainPathDirs,
  traversalMetadataRules,
  hostRoots,
  userTempRules,
} from "./policy.ts";

/**
 * Complete environment passed to a confined command, constructed from fixed settings, scratch
 * directories, and host toolchain locations. The environment is built from scratch rather than
 * filtered because the host process holds provider credentials (`CLAUDE_CODE_OAUTH_TOKEN` or
 * `ANTHROPIC_API_KEY`, `src/agent/backends/claude.ts`), and an inherited environment would let a
 * confined command print them directly.
 *
 * `HOME` points to the session home instead of the working tree: writes outside writable roots are
 * denied, so pointing `HOME` at the real home causes toolchain caches to fail with permission
 * errors, whereas pointing `HOME` at the working tree mixes build artefacts into candidate drafts.
 *
 * `TMPDIR` points to the seat's temporary directory beside its home. It persists for the seat's
 * lifetime and keeps build artefacts separate from installed packages in `HOME`.
 *
 * `hostToolchainEnv` supplies variables that toolchains use to locate host installations when
 * `HOME` is relocated (for example, `RUSTUP_HOME` pointing read-only to an existing installation).
 * Python's user base remains under the seat's `HOME` so `pip` can install packages locally.
 *
 * Declaring the four required keys on this interface makes the contract visible at the type level
 * and prevents callers from omitting any of them.
 */
interface CommandIsolationEnvironment extends EnvValues {
  PATH: string;
  HOME: string;
  TMPDIR: string;
  LANG: string;
}

/** Directory names searched for executables up to a bounded depth below a harness tool tree. */
const TOOL_TREE_BIN_DIRS = new Set(["bin", "shims", "sbin"]);
const TOOL_TREE_MAX_DEPTH = 5;
const TOOL_TREE_MAX_DIRS = 4000;

interface CommandIsolationPolicy {
  /** Rendered Darwin Seatbelt profile staged as a file, or `null` on Linux where
   *  `stageCommandIsolation` encodes the policy directly as `bwrap` arguments. */
  profile: string | null;
  mechanismPath: string;
  /** Whether outbound network access is enabled; on Darwin this is also encoded in `profile`. */
  network: boolean;
  /** Canonical forms of the seat root that commands are permitted to write. */
  scratchRoots: string[];
  /** Canonical forms of the host-owned subdirectory inside the seat root (readable, not writable). */
  keptRoots: string[];
  /** Exact host runtime and toolchain paths reopened read-only inside denied roots. */
  readAllowRoots: string[];
  /** Paths denied under the allow-by-default read posture. Darwin embeds these in `profile`;
   *  Linux overmounts each path in `stageCommandIsolation`. */
  readDenies: string[];
  /** Complete non-secret environment passed to the command. Linux emits these as `bwrap --setenv`
   *  flags after `--clearenv`; Darwin passes the map directly to the runner. */
  environment: CommandIsolationEnvironment;
}

/**
 * Directory layout for a confined seat: a single writable root containing `home` and `temp`,
 * plus a read-only `kept` directory owned by the host.
 *
 * `home` (`HOME`) persists installed tools across commands in the seat, and `temp` (`TMPDIR`)
 * holds temporary files. `kept` stores host-written artefacts (such as truncated command outputs)
 * that commands may read without modifying; preventing writes inside `kept` closes symlink races
 * while output is streamed.
 */
interface CommandDirectories {
  root: string;
  kept: string;
  home: string;
  temp: string;
  /** Adopted harness `.toolchain` directory placed first on `PATH` and mounted read-only, or
   *  `null` when the harness provides no tool tree. */
  toolTree?: string | null;
}

/**
 * Returns executable search directories under `toolTree`: `bin` first, followed by all `bin`,
 * `shims`, and `sbin` subdirectories in breadth-first, code-unit order.
 *
 * The verification inventory, verifier cell, and solver shell all share this traversal so that
 * binaries installed under nested tool-tree paths resolve identically during verification and
 * solving rather than falling back to a host interpreter lacking installed packages.
 */
export function toolTreeSearchDirs(toolTree: string): string[] {
  if (!existsSync(toolTree)) return [];
  const found: string[] = [join(toolTree, "bin")].filter(existsSync);
  const queue: { dir: string; depth: number }[] = [{ dir: toolTree, depth: 0 }];
  for (let visited = 0; visited < TOOL_TREE_MAX_DIRS; visited += 1) {
    const next = queue.shift();
    if (next === undefined) break;
    const { dir, depth } = next;
    if (TOOL_TREE_BIN_DIRS.has(basename(dir)) && !found.includes(dir)) found.push(dir);
    if (depth >= TOOL_TREE_MAX_DEPTH) continue;
    try {
      const children = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && entry.name !== "node_modules")
        .map((entry) => join(dir, entry.name));
      for (const child of children.toSorted(compareCodeUnits)) queue.push({ dir: child, depth: depth + 1 });
    } catch {
      // Skip unreadable directories that cannot yield executable paths.
    }
  }
  return found;
}

/**
 * Builds the `PATH` shared by the Builder shell, solver shell, and verifier cell. The harness's
 * own tool tree precedes host directories so harness-installed binaries take precedence over host
 * versions, and `#!/usr/bin/env python3` scripts resolve to the same interpreter at verification
 * time as at install time.
 *
 * The real directory of the host's active runtime executable (`capturedExecPath`) comes next so
 * `bun` resolves to the exact binary running the host rather than an older copy under `/usr` or
 * `/opt`. `executable` and `fallback` default to host values and are injectable for tests.
 */
function commandSearchPath(
  toolTree: string | null,
  executable: string = capturedExecPath,
  fallback: readonly string[] = toolchainPathDirs(),
): string {
  const own = toolTree === null ? [] : toolTreeSearchDirs(toolTree);
  return [...new Set([...own, dirname(realpathSync.native(executable)), ...fallback])].join(":");
}

function commandIsolationEnvironment(dirs: CommandDirectories): CommandIsolationEnvironment {
  return {
    ...hostToolchainEnv(),
    PATH: commandSearchPath(dirs.toolTree ?? null),
    HOME: dirs.home,
    TMPDIR: dirs.temp,
    LANG: "en_US.UTF-8",
    // Homebrew marks its Python as externally managed (PEP 668), causing `pip` to refuse even
    // `--user` installs. Because the wall blocks writes to Homebrew directories, setting this flag
    // allows `pip` to install into the seat's private `HOME` without modifying the host.
    PIP_BREAK_SYSTEM_PACKAGES: "1",
  };
}

/**
 * Computes runtime and toolchain paths to reopen read-only inside denied roots. Only paths covered
 * by a read denial are included, avoiding redundant rules under the open-read default. The adopted
 * harness tool tree is added explicitly because it typically resides under the repository or a
 * stored pack, both of which are denied as a whole.
 *
 * When `toolTree` lies lexically inside the seat root (such as the Builder's `harness/.toolchain`),
 * it is reopened only if its resolved real path also stays inside that root; otherwise a symlink
 * pointing to the repository, a sibling worktree, a pack, or the operator's home would bypass the
 * wall. Tool trees outside the seat root are host-owned kept harnesses or stored bundles and are
 * reopened with their resolved targets.
 *
 * `manifests` lists `package.json` paths between the tool tree and its enclosing denied root.
 * Darwin reopens these individually because Node resolves `.js` module type by walking ancestor
 * `package.json` files and exits on `EPERM`. The repository's own `package.json` remains closed so
 * its `"type": "module"` does not alter CommonJS scripts from a kept harness; each campaign
 * directory contains an empty `package.json` (`openCampaign`) to stop that walk. Linux requires no
 * manifest exceptions because its tmpfs overmounts hide ancestor files completely.
 */
function commandReadAllows(
  base: SolveIsolationPolicy,
  readDenies: readonly string[],
  dirs: Pick<CommandDirectories, "root" | "toolTree">,
) {
  const covered = canonicalRoots([
    ...base.allowedReadRoots,
    ...nodeRuntimeReadRoots(),
    ...darwinToolchainInstallRoots(),
  ]).filter((path) => readDenies.some((root) => covers(root, path)));
  // Reopen an existing harness tool tree after its enclosing denied root so harness-installed
  // tools remain executable. Omit non-existent trees because `bwrap` refuses to bind missing paths.
  const toolTree = dirs.toolTree ?? null;
  const tree = toolTree === null || !existsSync(toolTree) ? null : resolve(toolTree);
  const seated = tree !== null && canonicalForms(dirs.root).some((root) => containsPath(tree, root));
  const escapes = seated && !containsPath(realpathSync(tree), realpathSync(dirs.root));
  const own = tree === null || escapes ? [] : canonicalForms(tree);
  const inside = (dir: string) => readDenies.some((root) => dir !== root && covers(root, dir));
  const manifests = own.flatMap((path) => ancestorDirectories(path).filter(inside));
  return {
    roots: [...new Set([...covered, ...own])].toSorted(),
    manifests: [...new Set(manifests)].toSorted().map((dir) => join(dir, "package.json")),
  };
}

function darwinCommandProfile(
  base: SolveIsolationPolicy,
  scratchRoots: string[],
  keptRoots: string[],
  dirs: Pick<CommandDirectories, "root" | "toolTree">,
) {
  // Deny the shared seat parent and host scratch root; this seat's own root is reopened below.
  const closed = hostRoots();
  const readDenies = [...new Set([...base.deniedReadRoots, ...closed])].toSorted();
  const { roots: readAllows, manifests } = commandReadAllows(base, readDenies, dirs);
  // Shared host temporary directories (`/tmp`, `/var/tmp`, and Darwin's per-user temporary
  // directory). Unlike Linux, which mounts a private tmpfs over `/tmp`, Seatbelt cannot create a
  // per-command `/tmp`, so Darwin denies shared temporary directories outright to prevent
  // cross-campaign leakage through hardcoded `/tmp` paths or stale run directories. Narrow
  // exceptions for `mktemp` and Apple `/usr/bin` shims are added via `userTempRules`.
  const userTemp = userTempRules();
  const sharedTmp = canonicalRoots(["/tmp", "/var/tmp", ...userTemp.roots]);
  const profile = [
    // Deny-by-default sandbox-runtime base (`seatbelt-base.ts`), blocking cross-process signals
    // and unlisted Mach services.
    ...seatbeltBaseRules(base),
    // Explicitly deny `process-info*` on other processes: under the default rule, a confined
    // `sysctl(KERN_PROCARGS2)` can still inspect another seat's command line.
    "(deny process-info* (target others))",
    // Block `/bin/launchctl` so a confined process cannot kickstart or disable user launchd jobs.
    '(deny process-exec* (literal "/bin/launchctl"))',
    // Allow reads by default, then deny the repository, sibling worktrees, stored packs, and home
    // via `solveIsolationPolicy`. Writes remain denied except for the seat root and device nodes.
    "(allow file-read*)",
    // Seat commands may access the network to install dependencies; verification checks may not
    // (`src/kernel/verify.ts`). Outbound Unix sockets outside the seat root are denied to block
    // access to unconfined host daemons (such as SSH control masters), except `mDNSResponder` for
    // DNS resolution when networking is enabled.
    ...(base.network
      ? [
          "(allow network*)",
          '(deny network-outbound (remote unix-socket (path-regex #"^/")))',
          '(allow network-outbound (remote unix-socket (path-literal "/private/var/run/mDNSResponder")))',
        ]
      : []),
    ...scratchRoots.flatMap((root) => [
      `(allow network-bind (local unix-socket (subpath ${capturedJsonStringify(root)})))`,
      `(allow network-outbound (remote unix-socket (subpath ${capturedJsonStringify(root)})))`,
    ]),
    // Deny shared host temporary directories so commands cannot list, read, or write files created
    // by other processes. The seat root and tool tree are reopened by later rules below.
    ...sbRule("deny file-read* file-read-metadata file-write*", "subpath", sharedTmp),
    ...userTemp.rules,
    // Permit the random-named regular files (`/tmp/diff.XXXXXXXX`) that Apple's `diff` creates for
    // process substitution (`diff <(a) <(b)`) regardless of `TMPDIR`. Because `/tmp` cannot be
    // listed, another process's file is only guessable by its eight random characters.
    `(allow file-read* file-read-metadata file-write* (require-all (regex #"^/private/tmp/diff[.]${"[A-Za-z0-9]".repeat(8)}$") (vnode-type REGULAR-FILE)))`,
    ...sbRule("allow file-read-metadata", "literal", ["/tmp", "/private/tmp"]),
    ...sbRule("deny file-read*", "subpath", readDenies),
    ...traversalMetadataRules(readAllows),
    // Seatbelt gives precedence to more specific operations over wildcard families regardless of
    // rule order. Naming both `file-read*` and `file-read-metadata` ensures this allow overrides
    // earlier `file-read-metadata` denials so `stat`, `ls`, and `PATH` lookups succeed on allowed
    // tool trees.
    ...sbRule("allow file-read* file-read-metadata", "subpath", readAllows),
    ...sbRule("allow file-read* file-read-metadata", "literal", manifests),
    // Deny the seat parent and host scratch root for all three operations; naming
    // `file-read-metadata` explicitly prevents `stat` from leaking metadata across seats.
    ...sbRule("deny file-read* file-read-metadata file-write*", "subpath", closed),
    // Reopen this seat's root for reading and writing. Matching the operation set of the denial
    // immediately above lets rule order break the tie so this later allow takes precedence.
    ...sbRule("allow file-read* file-read-metadata", "subpath", scratchRoots),
    ...sbRule("allow file-write*", "subpath", scratchRoots),
    // Re-deny writes to the host-owned subdirectory inside the seat root. Using `subpath` also
    // covers the directory itself, preventing removal or symlink replacement.
    ...sbRule("deny file-write*", "subpath", keptRoots),
    // Permit `lstat` on ancestor directories of `scratchRoots` so runtimes such as Node can
    // resolve real paths without making parent directories listable.
    ...traversalMetadataRules(scratchRoots),
    // Permit writes to standard device nodes (`SANDBOX_OWN_WRITE_PATHS`) and already-open
    // `/dev/fd/N` descriptors used by Bash process substitution (`>(cmd)`).
    ...sbRule("allow file-write*", "literal", [
      "/dev/stdout",
      "/dev/stderr",
      "/dev/null",
      "/dev/tty",
      "/dev/dtracehelper",
      "/dev/autofs_nowait",
    ]),
    String.raw`(allow file-write* (regex #"^/dev/fd/[0-9]+$"))`,
    ...moveBlockingRules(base.deniedReadRoots),
    "",
  ].join("\n");
  return { profile, readAllows };
}

/** Constructs the per-command isolation policy from the base solve policy and seat directories.
 *  Recomputed per command because a Builder's tool tree may change during its session and previews
 *  may temporarily mount another harness's tool tree under the same seat. */
export function commandIsolationPolicy(
  base: SolveIsolationPolicy,
  dirs: CommandDirectories,
): CommandIsolationPolicy {
  const shared = {
    mechanismPath: base.mechanismPath,
    network: base.network,
    scratchRoots: canonicalRoots([dirs.root]),
    keptRoots: canonicalRoots([dirs.kept]),
    environment: commandIsolationEnvironment(dirs),
  };
  if (base.mechanismId !== LINUX_BWRAP_ID) {
    const { profile, readAllows } = darwinCommandProfile(base, shared.scratchRoots, shared.keptRoots, dirs);
    return { ...shared, profile, readAllowRoots: readAllows, readDenies: [] };
  }
  /*
   * Paths overmounted with empty tmpfs on Linux under the open-read default: the base denied roots
   * (repository, sibling worktrees, stored packs, and operator home) plus shared temporary
   * directories. Overmounting the shared temporary directory hides other seats' roots and
   * concurrent verification cells, while the current seat root is bound back inside it. Mounting an
   * empty writable tmpfs over `/tmp` also gives tools that hardcode `/tmp` a private writable
   * directory instead of failing on the read-only root bind.
   */
  const readDenies = [...new Set([...base.deniedReadRoots, tmpdir(), "/tmp", "/var/tmp"])].toSorted();
  return {
    ...shared,
    profile: null,
    readAllowRoots: commandReadAllows(base, readDenies, dirs).roots,
    readDenies,
  };
}

/** Quotes a single argument for POSIX shells and `/bin/bash` using single-quote escaping. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

/**
 * Renders the shell command line that executes `command` under `policy`, staging Darwin's Seatbelt
 * profile at `profileFile`.
 *
 * Staging the profile avoids a second round of shell quoting for multiline rules. `profileFile`
 * must reside outside the seat root and all writable directories so a confined command cannot
 * modify its own policy for subsequent commands. Prefixing with `exec` replaces the outer shell so
 * no host shell process remains inside the invocation.
 *
 * Because Darwin Seatbelt provides no PID namespace, the host terminates the command's process
 * group and descendants on exit (`endHolders`, `src/wall/seat-root.ts`). Commands execute under
 * `/bin/bash` rather than `/bin/sh` (matching `src/tools/env.ts`) because models write Bash syntax
 * such as process substitution and grouped `time` pipelines.
 */
export function stageCommandIsolation(
  policy: CommandIsolationPolicy,
  profileFile: string,
  command: string,
): string {
  // Quote every argument so scratch paths containing spaces cannot split into multiple tokens.
  return `exec ${isolatedArgv(policy, profileFile, ["/bin/bash", "-c", command]).map(shellQuote).join(" ")}`;
}

/**
 * Returns the argument vector that runs `argv` under `policy`, staging Darwin's profile file at
 * `profileFile` when applicable. Seat commands invoke this via `stageCommandIsolation`; verification
 * checks invoke it directly (`src/kernel/verify.ts`) and manage process-group termination themselves.
 */
export function isolatedArgv(
  policy: CommandIsolationPolicy,
  profileFile: string,
  argv: readonly string[],
): string[] {
  if (policy.profile === null) {
    // On Linux, argument order encodes the mount policy: open host reads, overmount denied paths,
    // bind back allowed tool trees and the writable seat root, bind the host-owned subdirectory
    // read-only, then remount `/` and non-enclosing overmounts read-only so writes fail with EROFS.
    // Overmounts enclosing the seat root (`/tmp` and host `tmpdir`) remain writable for `mktemp`.
    return [
      policy.mechanismPath,
      ...bwrapOpenReadArgs({ network: policy.network }),
      ...bwrapTmpfsDenies(policy.readDenies),
      ...bwrapReadBinds(policy.readAllowRoots),
      ...bwrapWriteBinds(policy.scratchRoots),
      ...bwrapReadBinds(policy.keptRoots),
      ...bwrapReadonlyRemounts([
        "/",
        ...policy.readDenies.filter((deny) => !policy.scratchRoots.some((root) => covers(deny, root))),
      ]),
      ...bwrapEnvironmentArgs(policy.environment),
      ...argv,
    ];
  }
  // Remove the read-only staged file before rewriting so identical policies can be restaged cleanly.
  rmSync(profileFile, { force: true });
  // Append a trailing newline to the rendered profile rules.
  writeFileSync(profileFile, `${policy.profile}\n`, { mode: 0o400 });
  return [policy.mechanismPath, "-f", profileFile, ...argv];
}
