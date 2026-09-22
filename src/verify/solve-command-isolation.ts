/** Controller-owned wall for Built Bash commands.
 *
 * Commands receive an explicit environment. Outbound network is open, so a command can fetch a
 * toolchain or package into its private home. A command may write its work tree, the session HOME
 * and its private temporary tree; Darwin also permits the temporary children system toolchains use,
 * with product staging paths denied separately. The host home and repository stay closed except
 * for runtime and toolchain roots reopened read-only from the enclosing solve policy.
 */
import { existsSync, readdirSync, rmSync, writeFileSync } from "../meta/filesystem.ts";
import { tmpdir } from "../meta/os.ts";
import { basename, join } from "../meta/path.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { capturedJsonStringify, hashJsonBytes } from "../meta/json-runtime.ts";
import {
  LINUX_BWRAP_ID,
  bwrapEnvironmentArgs,
  bwrapOpenReadArgs,
  bwrapReadBinds,
  bwrapTmpfsDenies,
  bwrapWriteBinds,
  nodeRuntimeBinDirs,
  nodeRuntimeReadRoots,
} from "./linux-bwrap.ts";
import type { EnvValues } from "../backends/scrub-env.ts";
import { canonicalForms, covers, moveBlockingRules, sbRule } from "./seatbelt-path-guard.ts";
import type { SolveIsolationPolicy } from "./solve-sandbox.ts";
import {
  BUILT_COMMAND_SCRATCH_DENY,
  RUN_DATA_DENY_PATTERNS,
  VERIFIER_TEMP_SIBLING_DENY_PATTERNS,
  darwinToolchainInstallRoots,
  darwinUserTempRoot,
  hostToolchainEnv,
  runDataDenyPaths,
  runDataDenyRules,
  toolchainPathDirs,
  traversalMetadataRules,
  userTempChildTreeRules,
  verifierTempSiblingDenyRules,
} from "./wall-policy.ts";
import { runtimeProcess } from "../meta/process.ts";

const BUILT_COMMAND_ISOLATION_PROFILE_ID = "harness-built-command-isolated" as const;
const BUILT_COMMAND_ISOLATION_FIXTURE = "built-command-seatbelt/v3" as const;
/** Bubblewrap takes no profile file, so evidence records this stable descriptor; the argv builder
 *  below is the executable form. */
const LINUX_COMMAND_ISOLATION_DESCRIPTOR =
  "linux-bwrap command isolation: allow-default host read, protected roots overmounted, one scratch tree read-write, network shared";

/**
 * The one parent of every command's scratch tree, created and cleaned at mode 0700. The profile
 * denies the parent and re-allows the running command's own trees, so a sibling tree is closed by
 * a rule rather than by the absence of one.
 */
export const BUILT_COMMAND_SCRATCH_ROOT = join(tmpdir(), basename(BUILT_COMMAND_SCRATCH_DENY));

/**
 * The bytes the command-isolation policy hash is taken over: one shape per mechanism, since each
 * records what it decides, and two closed shapes keep an absent field from hashing like an emitted one.
 */
type CommandIsolationIdentity =
  | {
      schema: typeof BUILT_COMMAND_ISOLATION_FIXTURE;
      profileId: typeof BUILT_COMMAND_ISOLATION_PROFILE_ID;
      mechanismId: string;
      sessionPolicyHash: string;
      default: "allow";
      scratchRoots: string[];
      readAllows: string[];
      readDenies: string[];
      network: "shared";
      toolTree: string | null;
    }
  | {
      schema: typeof BUILT_COMMAND_ISOLATION_FIXTURE;
      profileId: typeof BUILT_COMMAND_ISOLATION_PROFILE_ID;
      sessionPolicyHash: string;
      default: "allow";
      scratchRoots: string[];
      readAllows: string[];
      readDenies: string[];
      readDenyPatterns: string[];
      userTempRoots: string[];
      writeDenies: string[];
      toolTree: string | null;
    };

/**
 * What the Built shell may not touch in the shared temporary directories: the verifier list, less
 * this shell's own scratch parent. That parent is denied by subpath instead, because a name-shaped
 * deny would also match the running command's own tree, whose ancestors `getcwd` must reach.
 */
const COMMAND_TEMP_SIBLING_DENY_PATTERNS = VERIFIER_TEMP_SIBLING_DENY_PATTERNS.filter(
  (pattern) => pattern !== BUILT_COMMAND_SCRATCH_DENY,
);

/**
 * The whole environment a command receives, built from fixed settings, scratch paths and named host
 * toolchain locations. It never copies the parent environment, which holds live bearer tokens a
 * command could print.
 *
 * `HOME` is the session home: writes to the real home are denied, and a work-tree HOME would turn
 * every build's temporary file into a draft file. `TMPDIR` is a private tree per command, removed
 * with it, so a build's scratch stays out of both the draft and the home. `hostToolchainEnv` adds
 * the read-only locations a toolchain uses to find its installation once `HOME` moves, such as
 * `RUSTUP_HOME`, present only when the directory exists.
 */
interface CommandIsolationEnvironment extends EnvValues {
  PATH: string;
  HOME: string;
  TMPDIR: string;
  LANG: string;
}

/** Executables under these directory names, a bounded depth below the tool tree. */
const TOOL_TREE_BIN_DIRS = new Set(["bin", "shims", "sbin"]);
const TOOL_TREE_MAX_DEPTH = 5;
const TOOL_TREE_MAX_DIRS = 4000;

interface CommandIsolationPolicy {
  profileId: typeof BUILT_COMMAND_ISOLATION_PROFILE_ID;
  /** The session's mechanism, so `stageCommandIsolation` emits the launch `profile` describes. */
  mechanismId: string;
  /** Darwin's exact Seatbelt rules, or Linux's stable Bubblewrap descriptor. */
  profile: string;
  policyHash: string;
  mechanismPath: string;
  /** The work tree, session home and private temporary tree, in both path forms, sorted. */
  scratchRoots: string[];
  /** Exact host runtimes and toolchains reopened read-only inside a closed home or repository. */
  readAllowRoots: string[];
  /** Linux only: the roots `stageCommandIsolation` overmounts under the open read default. */
  readDenies: string[];
  /** The complete non-secret environment given to this command. */
  environment: CommandIsolationEnvironment;
}

/**
 * The three directories one command may write.
 *
 * `work` holds the draft files and is read back afterwards. `home` is the session's, kept across
 * commands and never read back, so an install lands there without inflating the draft. `temp` is
 * this command's private temporary tree, removed with it.
 */
interface CommandDirectories {
  work: string;
  home: string;
  temp: string;
  /** The adopted harness's `.toolchain` tree, read-only and first on PATH. */
  toolTree?: string | null;
}

/**
 * The tool tree's program directories: `bin` first, then every `bin`, `shims` or `sbin` below it in
 * breadth-first, code-unit order. The check inventory, the check cell and the Built shell share
 * this list, so a tool a check names is also the one the solver's shell finds.
 */
export function toolTreeSearchDirs(toolTree: string): string[] {
  if (!existsSync(toolTree)) return [];
  const found: string[] = [join(toolTree, "bin")].filter(existsSync);
  const queue: Array<{ dir: string; depth: number }> = [{ dir: toolTree, depth: 0 }];
  for (let visited = 0; queue.length > 0 && visited < TOOL_TREE_MAX_DIRS; visited += 1) {
    const { dir, depth } = /* SAFETY: the loop condition proves the queue is non-empty. */ queue.shift() as {
      dir: string;
      depth: number;
    };
    if (TOOL_TREE_BIN_DIRS.has(basename(dir)) && !found.includes(dir)) found.push(dir);
    if (depth >= TOOL_TREE_MAX_DEPTH) continue;
    try {
      const children = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && entry.name !== "node_modules")
        .map((entry) => join(dir, entry.name));
      for (const child of children.sort(compareCodeUnits)) queue.push({ dir: child, depth: depth + 1 });
    } catch {
      // An unreadable directory holds no program this search can name.
    }
  }
  return found;
}

/**
 * The one search path a candidate's tools run under, in the Builder shell and the verifier cell
 * alike. The harness's own tool tree goes first, because an installed tool means that copy. The
 * cell shares it because `#!/usr/bin/env python3` resolves its interpreter at run time.
 */
export function commandSearchPath(toolTree: string | null): string {
  const runtime = runtimeProcess.platform === "linux" ? nodeRuntimeBinDirs() : [];
  const own = toolTree === null ? [] : toolTreeSearchDirs(toolTree);
  return [...new Set([...own, ...runtime, ...toolchainPathDirs()])].join(":");
}

export function commandIsolationEnvironment(dirs: CommandDirectories): CommandIsolationEnvironment {
  return {
    ...hostToolchainEnv(),
    PATH: commandSearchPath(dirs.toolTree ?? null),
    HOME: dirs.home,
    TMPDIR: dirs.temp,
    LANG: "en_US.UTF-8",
  };
}

/**
 * Runtime and toolchain roots to reopen inside denied directories; other host paths are readable
 * already. Darwin emits them after the denials so the permitted files stay reachable.
 */
function commandReadAllows(
  base: SolveIsolationPolicy,
  readDenies: readonly string[],
  toolTree: string | null,
): string[] {
  const covered = [
    ...new Set(
      [...base.allowedReadRoots, ...nodeRuntimeReadRoots(), ...darwinToolchainInstallRoots()].flatMap(
        (root) => canonicalForms(root),
      ),
    ),
  ].filter((path) => readDenies.some((root) => covers(root, path)));
  // The tool tree links into the candidate workspace under `campaigns/`, which the run-data
  // pattern denies by name; allowing it by path keeps the rest of that workspace closed.
  const own = toolTree === null ? [] : canonicalForms(toolTree);
  return [...new Set([...covered, ...own])].sort();
}

function darwinCommandProfile(base: SolveIsolationPolicy, scratchRoots: string[], toolTree: string | null) {
  const writeDenies = [...new Set(["/", ...base.deniedWriteRoots])].sort();
  const scratchParent = canonicalForms(BUILT_COMMAND_SCRATCH_ROOT).sort();
  // Reads are open by default, so the shared scratch parent is denied and this command's own trees
  // re-allowed after it.
  const readDenies = [...new Set([...base.deniedReadRoots, ...scratchParent])].sort();
  const readAllows = commandReadAllows(base, readDenies, toolTree);
  // The two shared temporary directories a toolchain writes without asking: the confstr one
  // clang and Apple's python3 shim use, and `/tmp`, which `mktemp` and most build scripts
  // spell literally.
  const confstr = darwinUserTempRoot();
  const roots = confstr === undefined ? ["/tmp"] : [confstr, "/tmp"];
  const tempRoots = [...new Set(roots.flatMap((root) => canonicalForms(root)))].sort();
  const profile = [
    "(version 1)",
    // Open reads by default, as the owning session does; every closed root comes from `wall-policy.ts`.
    "(allow default)",
    // Open network, as the Builder's authoring wall, so a command can install what the task needs.
    "(allow network*)",
    ...sbRule("deny file-write*", "subpath", writeDenies),
    // Darwin's clang and python3 shim find their temporary directory through `confstr`, ignoring
    // `TMPDIR`, and `mktemp` spells `/tmp`. Both open one level down, since a `mktemp -d` name is
    // known only to the tool. Another tenant's tree under the same root stays reachable: the Darwin
    // wall's stated limit, which Linux closes with a private tmpfs.
    ...userTempChildTreeRules(tempRoots),
    // Concurrent verifier workdirs and other staging trees in those directories, closed by name
    // because each path is known only once created.
    ...verifierTempSiblingDenyRules(COMMAND_TEMP_SIBLING_DENY_PATTERNS),
    // Run data is denied by name, so one rule covers every copy; it follows the temporary grant so a
    // copy under /tmp stays closed too.
    ...runDataDenyRules(),
    ...sbRule("deny file-read*", "subpath", readDenies),
    ...traversalMetadataRules(readAllows),
    // Seatbelt prefers the more specific operation over the family whatever the order, so the allow
    // names `file-read-metadata` too; otherwise the pattern denies keep `stat` and PATH search closed.
    ...sbRule("allow file-read* file-read-metadata", "subpath", readAllows),
    // Close the scratch parent for the operations the temporary grant opened; `file-read-metadata`
    // is named for the same specificity reason, or `stat` would still see a sibling's files.
    ...sbRule("deny file-read* file-read-metadata file-write*", "subpath", scratchParent),
    // Reopen this command's own trees; the allow names the deny's operations, so the later rule wins.
    ...sbRule("allow file-read* file-read-metadata", "subpath", scratchRoots),
    ...sbRule("allow file-write*", "subpath", scratchRoots),
    // A resolver `lstat`s every ancestor of the file it opens, including the closed scratch parent.
    ...traversalMetadataRules(scratchRoots),
    `(allow file-write* (literal ${capturedJsonStringify("/dev/null")}))`,
    ...moveBlockingRules(base.deniedReadRoots),
    "",
  ].join("\n");
  return {
    profile,
    identity: {
      schema: BUILT_COMMAND_ISOLATION_FIXTURE,
      profileId: BUILT_COMMAND_ISOLATION_PROFILE_ID,
      sessionPolicyHash: base.policyHash,
      default: "allow",
      scratchRoots,
      readAllows,
      readDenies,
      readDenyPatterns: [...RUN_DATA_DENY_PATTERNS, ...COMMAND_TEMP_SIBLING_DENY_PATTERNS],
      userTempRoots: tempRoots,
      writeDenies,
      toolTree,
    } satisfies CommandIsolationIdentity,
  };
}

export function commandIsolationPolicy(
  base: SolveIsolationPolicy,
  dirs: CommandDirectories,
): CommandIsolationPolicy {
  const scratchRoots = [
    ...new Set([...canonicalForms(dirs.work), ...canonicalForms(dirs.home), ...canonicalForms(dirs.temp)]),
  ].sort();
  const toolTree = dirs.toolTree ?? null;
  const linux = base.mechanismId === LINUX_BWRAP_ID;
  /*
   * What the Linux command wall overmounts under its open read default: the session's denied roots,
   * the peer checkouts `runDataDenyPaths` finds, and the shared temporary directories, which hold
   * other commands' scratch and concurrent verifier workdirs. This command's own tree is bound back
   * inside. `/tmp` becomes an empty writable tmpfs, so `mktemp` gets a private directory rather than
   * the read-only root bind.
   */
  const readDenies = linux
    ? [
        ...new Set([...base.deniedReadRoots, tmpdir(), "/tmp", ...runDataDenyPaths(base.deniedReadRoots)]),
      ].sort()
    : [];
  const readAllowRoots = linux ? commandReadAllows(base, readDenies, toolTree) : [];
  const { profile, identity } = linux
    ? {
        profile: LINUX_COMMAND_ISOLATION_DESCRIPTOR,
        identity: {
          schema: BUILT_COMMAND_ISOLATION_FIXTURE,
          profileId: BUILT_COMMAND_ISOLATION_PROFILE_ID,
          mechanismId: base.mechanismId,
          sessionPolicyHash: base.policyHash,
          default: "allow",
          scratchRoots,
          readAllows: readAllowRoots,
          readDenies,
          network: "shared",
          toolTree,
        } satisfies CommandIsolationIdentity,
      }
    : darwinCommandProfile(base, scratchRoots, toolTree);
  return {
    profileId: BUILT_COMMAND_ISOLATION_PROFILE_ID,
    mechanismId: base.mechanismId,
    profile,
    policyHash: hashJsonBytes(identity),
    mechanismPath: base.mechanismPath,
    scratchRoots,
    readAllowRoots: linux ? readAllowRoots : identity.readAllows,
    readDenies,
    environment: commandIsolationEnvironment(dirs),
  };
}

/** Single-quotes one argument for a `/bin/sh -c` command line. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

/**
 * The command line that applies these rules to one shell command, and the profile file it reads.
 *
 * The profile is staged as a file rather than passed with `-p` because its rules contain newlines.
 * `profileFile` must sit outside every writable location, so a command cannot rewrite the rules a
 * later command runs under. `exec` replaces the outer shell, so only the output descriptors Pi
 * opened survive into the command.
 */
export function stageCommandIsolation(
  policy: CommandIsolationPolicy,
  profileFile: string,
  command: string,
): string {
  if (policy.mechanismId === LINUX_BWRAP_ID) {
    // bwrap takes argv, so the launch is inlined and every argument quoted. Order is policy: open
    // host reads, overmount protected paths, bind scratch back writable, then remount the root and
    // the overmounts not holding a scratch tree read-only, so a stray write fails with EROFS. Each
    // remount touches one mount, so the scratch binds stay writable.
    const argv = [
      policy.mechanismPath,
      ...bwrapOpenReadArgs({ network: true }),
      ...bwrapTmpfsDenies(policy.readDenies),
      ...bwrapReadBinds(policy.readAllowRoots),
      ...bwrapWriteBinds(policy.scratchRoots),
      ...[
        "/",
        ...policy.readDenies.filter((deny) => !policy.scratchRoots.some((root) => covers(deny, root))),
      ].flatMap((path) => ["--remount-ro", path]),
      ...bwrapEnvironmentArgs(policy.environment),
      "/bin/sh",
      "-c",
      command,
    ];
    return `exec ${argv.map(shellQuote).join(" ")}`;
  }
  // The staged file is read-only, so remove it before restaging the same policy's bytes.
  rmSync(profileFile, { force: true });
  writeFileSync(profileFile, `${policy.profile}\n`, { mode: 0o400 });
  // Seatbelt has no pid namespace and pi kills the group only on timeout, so a backgrounded job
  // would outlive its case. On exit the shell SIGKILLs its process group and every live descendant
  // of each member, which also catches a child that left the group with `setsid`; both lists are
  // taken before the first kill. Both `exec`s keep the pid, so `$$` leads the group, and the shell
  // spares itself so the exit code still reports. The command runs in a subshell so its own `exec`
  // cannot replace the shell owning the trap. A process already reparented to launchd is out of reach.

  const reaped = `trap 'd(){ for c in $(pgrep -P "$1"); do echo "$c"; d "$c"; done; }; g=$(pgrep -g $$); for p in $g $(for q in $g; do d "$q"; done); do [ "$p" != "$$" ] && kill -9 "$p" 2>/dev/null; done' EXIT\n(\n${command}\n)`;
  return `exec ${shellQuote(policy.mechanismPath)} -f ${shellQuote(profileFile)} /bin/sh -c ${shellQuote(reaped)}`;
}
