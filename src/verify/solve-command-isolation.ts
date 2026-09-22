/** Controller-owned wall for Built Bash commands.
 *
 * Commands receive an explicit environment. Outbound network (DNS and TCP) is open, so a command can fetch
 * a toolchain or a package into its private home (operator decision 2026-08-15, reaffirmed
 * 2026-09-06). They may write their work tree, private session HOME and private temporary tree.
 * Darwin also permits temporary children used by system toolchains, with product staging paths
 * denied separately. The host home and repository remain closed except for runtime/toolchain
 * roots reopened read-only from the enclosing solve policy.
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
/** Bubblewrap has no profile-file input. Keep a short stable evidence descriptor while the argv
 * builder below remains the single executable representation of the Linux command isolation. */
const LINUX_COMMAND_ISOLATION_DESCRIPTOR =
  "linux-bwrap command isolation: allow-default host read, protected roots overmounted, one scratch tree read-write, network shared";

/**
 * The one directory every command's scratch tree is created under. One parent keeps the trees
 * together for creation and cleanup at mode 0700. Separating one command's tree from another's is
 * the profile's job: the parent is denied and the running command's own trees are re-allowed after
 * it, so a sibling tree is closed by a rule rather than by the absence of one.
 */
export const BUILT_COMMAND_SCRATCH_ROOT = join(tmpdir(), basename(BUILT_COMMAND_SCRATCH_DENY));

/**
 * The bytes the command-isolation policy hash is taken over.
 *
 * The two mechanisms record different fields because they decide different things: Bubblewrap names
 * the read baseline it binds and the network namespace it shares, Seatbelt names the roots its
 * denies close. They stay two shapes rather than one shape with optional fields, so an absent field
 * can never hash the same as a field the guard did emit.
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
 * What the Built Harness shell may not touch inside the shared temporary directories it may now
 * write: the verifier list, less this shell's own scratch parent. That parent is denied by subpath
 * and its running command's tree re-allowed after it; a name-shaped deny on it would also match the
 * running command's own tree, whose ancestors `getcwd` has to reach (measured: the shell starts
 * with `error retrieving current directory` and every command fails before it runs).
 */
const COMMAND_TEMP_SIBLING_DENY_PATTERNS = VERIFIER_TEMP_SIBLING_DENY_PATTERNS.filter(
  (pattern) => pattern !== BUILT_COMMAND_SCRATCH_DENY,
);

/**
 * The whole environment a command receives. Built from fixed settings, scratch paths and the
 * named host toolchain locations below. It does not copy the parent environment or depend on a
 * credential-removal filter. The controller holds live bearer tokens in its own
 * environment (`pi-built-child.ts` sets `CLAUDE_CODE_OAUTH_TOKEN` and `ANTHROPIC_AUTH_TOKEN`), and
 * a command that inherited them could simply print them.
 *
 * `HOME` points at the session home rather than at the work tree, because the write deny is
 * absolute outside the writable roots: a toolchain writing its cache to the real home would be
 * refused, and that refusal would read as a broken tool rather than as the isolation doing its job.
 * Pointing it at the work tree instead was measured worse — every temporary file a build made
 * became a candidate draft file.
 *
 * `TMPDIR` points at a third writable root, created for this one command and removed with it. The
 * session home carried it until run49-sol-0902 counted 284 compiler temporary-file and 40
 * temporary-directory permission failures in Built Harness traces: a toolchain's scratch belongs to
 * the command that made it, and a private tree per command keeps a build's leftovers out of both
 * the draft and the home an install has to survive in.
 *
 * `hostToolchainEnv` adds the names a toolchain uses to find its own installation, which moving
 * `HOME` otherwise hides — `RUSTUP_HOME` and `PYTHONUSERBASE`, each pointing at a real directory
 * the command may read and may not write. They are host-dependent and absent when the directory is,
 * for the same reason the read roots are.
 *
 * The four fixed names are on the type rather than only in the body, so a reader sees what a
 * command gets without opening the function and a caller cannot quietly lose one. It stays an
 * environment block underneath, because that is what a spawn takes.
 */
interface CommandIsolationEnvironment extends EnvValues {
  PATH: string;
  HOME: string;
  TMPDIR: string;
  LANG: string;
}

/**
 * The one search path a candidate's tools run under, in the Builder shell and in the verifier
 * cell alike. The harness's own tool tree goes first: a Builder that installed `arduino-cli` there
 * meant that one, not a host copy of another version. The cell shares it because a script whose
 * shebang is `#!/usr/bin/env python3` resolves its interpreter at run time: eaf98f
 * (2026-09-14) installed cp39 wheels under the shell's `/usr/bin/python3` and then failed all
 * 148 census rows in a cell that inherited the launcher's PATH, where zerobrew's 3.14 came first.
 */
/** Executables under these directory names, a bounded depth below the tool tree. */
const TOOL_TREE_BIN_DIRS = new Set(["bin", "shims", "sbin"]);
const TOOL_TREE_MAX_DEPTH = 5;
const TOOL_TREE_MAX_DIRS = 4000;

interface CommandIsolationPolicy {
  profileId: typeof BUILT_COMMAND_ISOLATION_PROFILE_ID;
  /** `darwin-seatbelt/v1` or `linux-bwrap/v1` — carried from the session isolation so `stageCommandIsolation`
   *  emits the launch this policy's `profile` describes and no other mechanism's. */
  mechanismId: string;
  /** Darwin's exact Seatbelt rules, or Linux's stable Bubblewrap descriptor. Linux command argv
   * remains owned by stageCommandIsolation rather than being re-rendered into this evidence field. */
  profile: string;
  policyHash: string;
  mechanismPath: string;
  /** The three writable directories — this command's work tree, the session home and this
   *  command's private temporary tree — each in both path forms, sorted so the identity is
   *  stable. */
  scratchRoots: string[];
  /** Exact host runtimes and toolchains reopened read-only inside a closed home or repository. */
  readAllowRoots: string[];
  /** What stays closed under the open read default. Darwin carries these inside `profile` as rules;
   * Linux has no profile text, so `stageCommandIsolation` reads them here and overmounts each one. */
  readDenies: string[];
  /** The complete non-secret environment given to this command. Linux serialises it as bwrap
   * `--setenv` entries after its mandatory `--clearenv`; Darwin passes the same map to Pi. */
  environment: CommandIsolationEnvironment;
}

/**
 * The three directories one command may write.
 *
 * `work` holds the draft files and is read back afterwards, so anything left there is a candidate
 * draft file. `home` is the session's, kept across its commands and never read back: it is where an
 * install lands, and where HOME points. Separating them was forced by the network. A simulation on
 * 2026-08-19 ran a command that installed 600 files and edited one source file, and with one
 * directory there was nowhere to install that the draft did not have to carry: the install broke
 * the draft's file bound, and it was gone by the next command anyway, since the work tree is
 * deleted when a command ends.
 *
 * `temp` is this one command's private temporary tree, where TMPDIR points. It is created before
 * the command and removed with it, so a build's scratch is neither read back as a draft file nor
 * left in the home a later command inherits.
 */
interface CommandDirectories {
  work: string;
  home: string;
  temp: string;
  /** The adopted harness's own `.toolchain` tree, read-only and first on PATH; null when the
   *  bundle has none. */
  toolTree?: string | null;
}

/**
 * The tool tree's program directories: `bin` first, then every `bin`, `shims` or `sbin` below it in
 * breadth-first, code-unit order. One list for the check inventory, the check cell and the Built
 * shell (2026-09-16): until then only the inventory searched below `bin`, so a check could name
 * `.toolchain/home/.local/bin/x` while the solver's shell found no `x` and its `python3` was the
 * host's, and Built cases of 2026-09-13 to 2026-09-15 met 20 missing numpy modules.
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
 * Runtime and toolchain roots to reopen within protected directories.
 *
 * Keep only paths covered by a read denial; other host paths are readable already. The adopted
 * tool tree is added explicitly because its campaign path may be denied by a pattern rather
 * than by one of the listed roots. Both OS implementations use this list, and Darwin emits it
 * after the denials so the permitted tool files remain available.
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
  // The adopted bundle's tool tree is a symlink into the candidate workspace under `campaigns/`,
  // which the run-data pattern denies by name. Measured 2026-09-02 across the week's recorded runs:
  // `arduino-cli: command not found` in every case while the Builder's install sat there.
  // It is allowed by path after the pattern denies, so the rest of that workspace stays closed.
  const own = toolTree === null ? [] : canonicalForms(toolTree);
  return [...new Set([...covered, ...own])].sort();
}

function darwinCommandProfile(base: SolveIsolationPolicy, scratchRoots: string[], toolTree: string | null) {
  const writeDenies = [...new Set(["/", ...base.deniedWriteRoots])].sort();
  const scratchParent = canonicalForms(BUILT_COMMAND_SCRATCH_ROOT).sort();
  // One command's scratch tree stayed private under the old deny-default rule without needing a
  // rule of its own. Reads are open now, so the separation has to be stated: the shared parent is
  // denied and this command's own trees are re-allowed after it.
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
    // The same read posture as the session that owns this command, and as the Harness Builder's own
    // wall: open by default, with one short list closed. What must stay closed is the repository
    // tree, the protected home roots and run data wherever it sits, and all of it arrives through
    // `wall-policy.ts` rather than from a second list kept here.
    "(allow default)",
    // The same network posture, and the same spelling, as the Harness Builder's authoring wall
    // (candidate-isolation-profile.ts): open, so a command can install what the task needs.
    "(allow network*)",
    ...sbRule("deny file-write*", "subpath", writeDenies),
    // The writes outside the scratch tree a toolchain takes without asking: Darwin's clang and the
    // python3 shim resolve their temporary directory through `confstr` and never read `TMPDIR`, and
    // `mktemp` spells `/tmp`. Both open one level down, directories included: a `mktemp -d` there
    // is a directory whose name only the tool knows, so the grant cannot be narrower without
    // refusing the tool. What that leaves open is another tenant's tree under the same root — the
    // Darwin wall's stated limit, which the Linux path closes with a private tmpfs instead.
    ...userTempChildTreeRules(tempRoots),
    // What those directories hold that must stay separate: concurrent verifier workdirs and the
    // product's other staging trees, closed by name because each path is only known when it is
    // created. The parent of every command's scratch tree is closed by subpath below.
    ...verifierTempSiblingDenyRules(COMMAND_TEMP_SIBLING_DENY_PATTERNS),
    // Run data is denied by name rather than by place, so every earlier run's copy of the same task
    // family is covered by one rule instead of by an enumeration of worktrees. It follows the
    // temporary-directory grant so a copy left under /tmp stays closed too.
    ...runDataDenyRules(),
    ...sbRule("deny file-read*", "subpath", readDenies),
    ...traversalMetadataRules(readAllows),
    // Seatbelt prefers the rule that names the more specific operation over the one that names
    // the family, whatever their order, so a `file-read*` allow alone leaves the pattern denies
    // above, which name `file-read-metadata` outright, in charge of stat. Measured 2026-09-02:
    // `cat .toolchain/bin/own-tool` printed the file while `ls` of its directory and the shell's
    // PATH search on the same file answered "Operation not permitted" and "command not found".
    ...sbRule("allow file-read* file-read-metadata", "subpath", readAllows),
    // The parent of every command's scratch tree, closed for the same three operations the
    // temporary grant above opened. `file-read-metadata` is named rather than left to the
    // `file-read*` deny, for the same specificity reason: measured 2026-09-03 on the profile
    // without this rule, one command's `stat` of another command's draft file answered "28 bytes"
    // while `cat` of that file answered "Operation not permitted".
    ...sbRule("deny file-read* file-read-metadata file-write*", "subpath", scratchParent),
    // A command may read and create files under its own tree; outside it and the shared temporary
    // roots above, it may create them nowhere. The read allow names the same operations as the deny
    // above, so the order decides and this wins.
    ...sbRule("allow file-read* file-read-metadata", "subpath", scratchRoots),
    ...sbRule("allow file-write*", "subpath", scratchRoots),
    // A resolver walks every ancestor of the file it opens, so each one needs `lstat` even when the
    // directory itself stays closed. Without this, `node t.js` fails on the scratch parent and no
    // script on disk runs at all.
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
   * What the Linux command wall overmounts, now that its reads open by default.
   *
   * The session's denied roots are the verified repository and operator home. The shared temporary
   * directory holds every other command's scratch tree and every concurrent verification's staged
   * workdir, so it is hidden whole and this command's own tree is bound back inside it — the Darwin
   * profile spends two rules on the same separation because a Seatbelt deny cannot be re-opened by
   * a mount. The third group is the peer checkouts `runDataDenyPaths` finds.
   *
   * `TMPDIR` points at a tree bound back inside it, so hiding the shared directory costs a
   * toolchain nothing. `/tmp` is hidden the same way even when the host's temporary directory is
   * elsewhere: the overmount is an empty writable tmpfs, so `mktemp` and a build script that spells
   * `/tmp` get a private directory instead of the read-only root bind (measured 2026-09-02 in the
   * anabasis VM: "mkdir: Read-only file system").
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

/** Escape one argument for a `/bin/sh -c` command line. Single quotes end the literal, so the
 *  quote itself is spliced back in outside it — the standard transformation. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

/**
 * The command line that applies these rules to one shell command, and the profile file it reads.
 *
 * The profile is staged as a file rather than passed with `-p` because the rules contain newlines
 * and would otherwise have to survive a second round of shell quoting. `profileFile` must sit
 * outside the scratch tree and other writable locations, so a command cannot
 * rewrite the rules that a later command in the same case would run under.
 *
 * `exec` replaces the outer shell, so nothing of the controller's process survives into the
 * command beyond the file descriptors Pi opened to capture its output.
 */
export function stageCommandIsolation(
  policy: CommandIsolationPolicy,
  profileFile: string,
  command: string,
): string {
  if (policy.mechanismId === LINUX_BWRAP_ID) {
    // bwrap rules are argv with no newlines, so the launch inlines rather than staging a file; every
    // argument is quoted so a scratch path with a space cannot split it. The order is the policy,
    // as it is on Darwin: the host opens for reading, the protected paths are overmounted, the
    // scratch trees are bound back writable, and then the host root and the overmounts over
    // product trees go read-only, so a write there fails with EROFS instead of landing on the host
    // or vanishing into an overmount. The overmounts holding a scratch tree (/tmp and the host
    // tmpdir) stay writable, as Darwin lets mktemp and /tmp writes through. Each remount touches
    // one mount, which is why the overmounts are named beside the root and why the scratch binds,
    // mounted earlier, stay writable.
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
  // The staged file is read-only, so it cannot be overwritten in place; remove it first. The
  // bytes are a pure function of the policy, so restaging is the same rules either way.
  rmSync(profileFile, { force: true });
  // The rendered rules carry no trailing newline; a staged file ends in one.
  writeFileSync(profileFile, `${policy.profile}\n`, { mode: 0o400 });
  // Seatbelt has no namespace to end what the command leaves behind, and pi kills the group only
  // on timeout: on run truss-opus-20260915T160303030Z-298967 `nohup python3 r3.py & sleep 100`
  // returned and the search ran on at full CPU for 17 minutes past its case. So the shell SIGKILLs
  // its group and every live descendant on exit, as Linux gets from bwrap's pid namespace above:
  // the group as Codex's `kill_process_group` does, the descendants as Bun's `--no-orphans` walks
  // them from every group member, which catches a child that left the group with `setsid` even
  // after its parent was orphaned. Both lists are taken before the first kill. Both `exec`s keep
  // the pid, so `$$` leads the group; the shell spares itself so the command's exit code still
  // reports. The command runs in a subshell, so its own `exec` replaces
  // that child and not the shell owning the trap: `sleep 30 & exec /bin/true` in the trap's shell
  // left the sleep running. A subshell keeps `$$` and the group, so the group kill still reaches a
  // child the replaced process orphaned. A process that left the group and was already reparented
  // to launchd is out of reach.
  const reaped = `trap 'd(){ for c in $(pgrep -P "$1"); do echo "$c"; d "$c"; done; }; g=$(pgrep -g $$); for p in $g $(for q in $g; do d "$q"; done); do [ "$p" != "$$" ] && kill -9 "$p" 2>/dev/null; done' EXIT\n(\n${command}\n)`;
  return `exec ${shellQuote(policy.mechanismPath)} -f ${shellQuote(profileFile)} /bin/sh -c ${shellQuote(reaped)}`;
}
