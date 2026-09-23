/** Controller-owned wall for Built Bash commands.
 *
 * A command receives an explicit environment rather than an inherited one, and outbound network is
 * open so it can fetch a toolchain into its private home (operator decision). That is what makes
 * the rest of this file necessary: a solver that can install things needs somewhere to install them
 * that is not the draft it is judged on, so a command may write its work tree, the session HOME and
 * its own private temporary tree, and nothing else. Darwin additionally permits the temporary
 * children system toolchains take without asking, since they resolve their scratch directory
 * through `confstr` and never read `TMPDIR`; product staging paths there are denied separately. The
 * host home and the repository stay closed, except for the runtime and toolchain roots the
 * enclosing solve policy reopens read-only so an installed interpreter can still find itself.
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
/** Bubblewrap takes no profile file, only argv, so there is no rule text to record. Re-rendering
 *  the argv would be a second representation that could drift from the one that launched, so the
 *  evidence carries this descriptor and `stageCommandIsolation` stays the single executable form. */
const LINUX_COMMAND_ISOLATION_DESCRIPTOR =
  "linux-bwrap command isolation: allow-default host read, protected roots overmounted, one scratch tree read-write, network shared";

/**
 * The one directory every command's scratch tree is created under, which keeps them together for
 * creation and cleanup at mode 0700. One parent does not separate them; the profile does that, by
 * denying the parent and re-allowing the running command's own trees after it, so a sibling's tree
 * is closed by a rule that can be read and tested rather than by nobody having named it.
 */
export const BUILT_COMMAND_SCRATCH_ROOT = join(tmpdir(), basename(BUILT_COMMAND_SCRATCH_DENY));

/**
 * The bytes the command-isolation policy hash is taken over. The two mechanisms record different
 * fields because they decide different things: Bubblewrap names the mechanism it bound and the
 * network namespace it shares, Seatbelt the patterns and temporary roots its rules close. They stay
 * two closed shapes rather than one shape with optional fields, because an absent optional field
 * would hash identically to one the guard did emit, and two different walls must not claim one
 * identity.
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
 * What the Built shell may not touch inside the shared temporary directories it may now write: the
 * verifier's list, less this shell's own scratch parent. That one is denied by subpath further down
 * instead, because a name-shaped deny matches by basename and so would also match the running
 * command's own tree, whose ancestors are what `getcwd` walks: the shell would start with `error
 * retrieving current directory` and every command would fail before it ran.
 */
const COMMAND_TEMP_SIBLING_DENY_PATTERNS = VERIFIER_TEMP_SIBLING_DENY_PATTERNS.filter(
  (pattern) => pattern !== BUILT_COMMAND_SCRATCH_DENY,
);

/**
 * The whole environment a command receives, built from fixed settings, scratch paths and the host
 * toolchain locations below. It is built rather than filtered: the controller resolves a live
 * bearer token for every model call, and `pi-providers.ts` puts `CLAUDE_CODE_OAUTH_TOKEN` into the
 * child environment it composes, so a command that inherited the parent environment could simply
 * print one. No credential-removal filter is trusted to stand between the two.
 *
 * `HOME` points at the session home rather than at the work tree, because the write deny is
 * absolute outside the writable roots: a toolchain writing its cache to the real home would be
 * refused, and that refusal reads to the solver as a broken tool rather than as the isolation doing
 * its job. Pointing `HOME` at the work tree instead makes every temporary file a build writes a
 * candidate draft file.
 *
 * `TMPDIR` points at a third writable root created for this one command and removed with it. A
 * toolchain's scratch belongs to the command that made it, and a private tree per command keeps a
 * build's leftovers out of both the draft and the home that an install has to survive in.
 *
 * `hostToolchainEnv` adds the names a toolchain uses to find its own installation, which moving
 * `HOME` otherwise hides — `RUSTUP_HOME` and `PYTHONUSERBASE`, each naming a real directory the
 * command may read and may not write. Both are host-dependent and absent when the directory is.
 *
 * The four fixed names sit on the type rather than only in the body, so a reader sees what a
 * command gets without opening the function and a caller cannot quietly lose one.
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
  /** `darwin-seatbelt/v1` or `linux-bwrap/v1`, carried from the session isolation rather than
   *  re-decided here, so `stageCommandIsolation` emits the launch this `profile` describes. */
  mechanismId: string;
  /** Darwin's exact Seatbelt rules, or Linux's stable Bubblewrap descriptor. The Linux argv stays
   *  owned by `stageCommandIsolation`; a rendered copy here could disagree with what launched. */
  profile: string;
  policyHash: string;
  mechanismPath: string;
  /** The three writable directories — work tree, session home, private temporary tree — in both
   *  path forms and sorted, so the hashed identity does not move with the order they were built. */
  scratchRoots: string[];
  /** Exact host runtimes and toolchains reopened read-only inside a closed home or repository. */
  readAllowRoots: string[];
  /** What stays closed under the open read default. Darwin carries these inside `profile` as
   *  rules; Linux has no profile text, so `stageCommandIsolation` overmounts each one from here. */
  readDenies: string[];
  /** The complete non-secret environment given to this command. Linux serialises it as bwrap
   *  `--setenv` entries after its mandatory `--clearenv`; Darwin passes the same map to pi. */
  environment: CommandIsolationEnvironment;
}

/**
 * The three directories one command may write.
 *
 * `work` holds the draft files and is read back afterwards, so anything left there becomes a
 * candidate draft file. `home` is the session's: kept across its commands and never read back, it
 * is where an install lands and where `HOME` points. Opening the network forced the separation,
 * because with one directory an install of several hundred files has nowhere to land that the draft
 * does not then have to carry, breaking the draft's file bound — and it would be gone by the next
 * command anyway, since the work tree is deleted when a command ends.
 *
 * `temp` is this command's private temporary tree, where `TMPDIR` points. It is created before the
 * command and removed with it, so a build's scratch is neither read back as a draft file nor left
 * behind in the home a later command inherits.
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
 * breadth-first, code-unit order.
 *
 * The check inventory, the check cell and the Built shell all read this one list. When only the
 * inventory searched below `bin`, a check could name `.toolchain/home/.local/bin/x` and be
 * satisfied while the solver's shell found no `x` and fell back to the host's `python3`, which then
 * lacked the modules the install had put in the other tree. Sharing the list is what makes "the
 * tool a check names" and "the tool the solver's shell finds" the same tool.
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
 * The one search path a candidate's tools run under, in the Builder shell and in the verifier cell
 * alike. The harness's own tool tree goes first, because a Builder that installed `arduino-cli`
 * there meant that copy and not whatever version the host happens to carry. The cell shares the
 * same path because a script whose shebang is `#!/usr/bin/env python3` resolves its interpreter at
 * run time rather than at install time: wheels installed under the shell's `python3` fail
 * wholesale in a cell that inherited the launcher's PATH and found a different version first.
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
 * Runtime and toolchain roots to reopen inside the directories a denial closed. Only paths a read
 * denial actually covers are kept, since every other host path is readable already under the open
 * default and re-allowing it would add a rule that changes nothing. The adopted tool tree is added
 * explicitly rather than filtered in, because its campaign path is denied by a name pattern rather
 * than by one of the listed roots. Both operating systems use this list, and Darwin emits it after
 * the denials so the later, more specific rule decides.
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
  // which the run-data pattern denies by name, so without this the Builder's own install answers
  // `command not found`. Allowing it by path after the pattern denies restores that one tree and
  // leaves the rest of the workspace closed, which a wider relaxation of the pattern would not.
  const own = toolTree === null ? [] : canonicalForms(toolTree);
  return [...new Set([...covered, ...own])].sort();
}

function darwinCommandProfile(base: SolveIsolationPolicy, scratchRoots: string[], toolTree: string | null) {
  const writeDenies = [...new Set(["/", ...base.deniedWriteRoots])].sort();
  const scratchParent = canonicalForms(BUILT_COMMAND_SCRATCH_ROOT).sort();
  // Under a deny-default read rule one command's scratch tree stayed private without a rule of its
  // own. Reads are open now, so the shared parent is denied here and this command's own trees are
  // re-allowed after it.
  const readDenies = [...new Set([...base.deniedReadRoots, ...scratchParent])].sort();
  const readAllows = commandReadAllows(base, readDenies, toolTree);
  // The two shared temporary directories a toolchain writes without asking: the confstr one clang
  // and Apple's python3 shim use, and `/tmp`, which `mktemp` and most build scripts spell literally.
  const confstr = darwinUserTempRoot();
  const roots = confstr === undefined ? ["/tmp"] : [confstr, "/tmp"];
  const tempRoots = [...new Set(roots.flatMap((root) => canonicalForms(root)))].sort();
  const profile = [
    "(version 1)",
    // The same read posture as the session that owns this command and as the Builder's authoring
    // wall: open by default, with the repository tree, the protected home roots and run data
    // wherever it sits closed. All of it arrives through `wall-policy.ts`, so there is no second
    // list here to fall out of step.
    "(allow default)",
    // The same network posture, and the same spelling, as the Builder's authoring wall, so a
    // command can install what its task needs.
    "(allow network*)",
    ...sbRule("deny file-write*", "subpath", writeDenies),
    // The writes outside the scratch tree a toolchain takes without asking. Both open one level
    // down, directories included, because a `mktemp -d` there has a name only the tool knows, so
    // the grant cannot be narrower without refusing the tool outright. That leaves another tenant's
    // tree under the same root open, which is the Darwin wall's stated limit; the Linux path closes
    // it with a private tmpfs instead.
    ...userTempChildTreeRules(tempRoots),
    // What those same directories hold that must stay separate: concurrent verifier workdirs and
    // the product's other staging trees, closed by name because each path is known only once it has
    // been created. The parent of every command's scratch tree is closed by subpath below instead.
    ...verifierTempSiblingDenyRules(COMMAND_TEMP_SIBLING_DENY_PATTERNS),
    // Run data is denied by name rather than by place, so one rule covers every earlier run's copy
    // instead of a worktree enumeration that goes stale. It follows the temporary-directory grant
    // so that a copy left under /tmp stays closed too.
    ...runDataDenyRules(),
    ...sbRule("deny file-read*", "subpath", readDenies),
    ...traversalMetadataRules(readAllows),
    // Seatbelt prefers the rule naming the more specific operation over the one naming the family,
    // whatever their order, so a `file-read*` allow on its own leaves the pattern denies above —
    // which name `file-read-metadata` outright — in charge of `stat`: `cat .toolchain/bin/own-tool`
    // prints the file while `ls` of its directory and the shell's PATH search over it answer
    // "Operation not permitted". Naming both operations in the allow puts this rule back in charge.
    ...sbRule("allow file-read* file-read-metadata", "subpath", readAllows),
    // The parent of every command's scratch tree, closed for the same three operations the
    // temporary grant above opened. `file-read-metadata` is named outright for the same specificity
    // reason: without it, one command's `stat` of another command's draft file reports its size
    // while `cat` of the same file is refused.
    ...sbRule("deny file-read* file-read-metadata file-write*", "subpath", scratchParent),
    // A command may read and create files under its own trees, and outside them and the shared
    // temporary roots above it may create them nowhere. This allow names the same operations as the
    // deny immediately above, which makes order the tie-break, and being later it wins.
    ...sbRule("allow file-read* file-read-metadata", "subpath", scratchRoots),
    ...sbRule("allow file-write*", "subpath", scratchRoots),
    // A resolver walks every ancestor of the file it opens, so each ancestor needs `lstat` even
    // where the directory itself stays closed. Without this, `node t.js` fails on the scratch
    // parent and no script on disk runs at all.
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
   * What the Linux command wall overmounts, now that its reads open by default: the session's
   * denied roots, which are the verified repository and the operator home; the shared temporary
   * directory; and the peer checkouts `runDataDenyPaths` finds. The temporary directory holds every
   * other command's scratch tree and every concurrent verification's staged workdir, so it is
   * hidden whole and this command's own tree is bound back inside it — a separation the Darwin
   * profile spends two rules on only because a Seatbelt deny cannot be reopened by a mount.
   *
   * `TMPDIR` points at a tree bound back inside the overmount, so hiding the shared directory costs
   * a toolchain nothing. `/tmp` is hidden the same way even when the host's temporary directory is
   * elsewhere, because the overmount is an empty writable tmpfs: that is what gives `mktemp` and a
   * build script spelling `/tmp` a private directory rather than the read-only root bind, where a
   * `mkdir` answers "Read-only file system".
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

/** Escapes one argument for a `/bin/sh -c` command line. A single quote ends the literal, so the
 *  quote itself is spliced back in outside it — the standard transformation. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

/**
 * The command line that applies these rules to one shell command, and the profile file it reads.
 *
 * The profile is staged as a file rather than passed with `-p` because its rules contain newlines
 * and would otherwise have to survive a second round of shell quoting. `profileFile` must sit
 * outside the scratch tree and every other writable location, since a command that could rewrite
 * the rules would be choosing the wall a later command in the same case runs under. `exec` replaces
 * the outer shell, so nothing of the controller's process survives into the command beyond the file
 * descriptors pi opened to capture its output.
 */
export function stageCommandIsolation(
  policy: CommandIsolationPolicy,
  profileFile: string,
  command: string,
): string {
  if (policy.mechanismId === LINUX_BWRAP_ID) {
    // bwrap rules are argv with no newlines, so the launch inlines rather than staging a file, and
    // every argument is quoted so a scratch path with a space cannot split into two. The order is
    // itself the policy, as on Darwin: the host opens for reading, the protected paths are
    // overmounted, the scratch trees are bound back writable, and only then do the host root and
    // the overmounts over product trees go read-only, so a write there fails with EROFS instead of
    // landing on the host or vanishing into an overmount. The two overmounts holding a scratch
    // tree, `/tmp` and the host tmpdir, stay writable, as Darwin lets `mktemp` through. Each
    // remount touches one mount, which is why the overmounts are named beside the root and why the
    // scratch binds, mounted earlier, are unaffected.
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
  // The staged file is read-only and cannot be overwritten in place; removing it first is what lets
  // the same policy be restaged, with the same rules either way since its bytes are a pure function
  // of the policy.
  rmSync(profileFile, { force: true });
  // The rendered rules carry no trailing newline, and a staged file ends in one.
  writeFileSync(profileFile, `${policy.profile}\n`, { mode: 0o400 });
  // Seatbelt has no namespace to end what a command leaves behind, and pi kills the process group
  // only on timeout, so a command that backgrounds work and returns — `nohup python3 r.py & sleep
  // 100` — leaves that work running at full CPU long past its case. So on exit the shell SIGKILLs
  // its own group and every live descendant, which is what Linux gets for free from bwrap's pid
  // namespace above: the group as Codex's `kill_process_group` does it, the descendants as Bun's
  // `--no-orphans` walks them from every group member, which is what catches a child that left the
  // group with `setsid` even after its parent was orphaned. Both lists are taken before the first
  // kill, because killing changes what the next `pgrep` can see. Both `exec`s keep the pid, so `$$`
  // leads the group, and the shell spares itself so the command's exit code still reports. The
  // command runs in a subshell so that its own `exec` replaces that child rather than the shell
  // owning the trap — `sleep 30 & exec /bin/true` in the trap's shell leaves the sleep running. A
  // subshell keeps `$$` and the group, so the group kill still reaches a child the replaced process
  // orphaned. A process that left the group and was already reparented to launchd is out of reach.

  const reaped = `trap 'd(){ for c in $(pgrep -P "$1"); do echo "$c"; d "$c"; done; }; g=$(pgrep -g $$); for p in $g $(for q in $g; do d "$q"; done); do [ "$p" != "$$" ] && kill -9 "$p" 2>/dev/null; done' EXIT\n(\n${command}\n)`;
  return `exec ${shellQuote(policy.mechanismPath)} -f ${shellQuote(profileFile)} /bin/sh -c ${shellQuote(reaped)}`;
}
