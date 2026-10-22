/** Controller-owned wall for a seat's commands, and for a check (`src/kernel/verify.ts`), whose
 * cell is its root and whose network is closed.
 *
 * A command receives an explicit environment rather than an inherited one, and outbound network is
 * open so it can fetch a toolchain into its private home (operator decision). That is what makes
 * the rest of this file necessary: a solver that can install things needs somewhere to install them
 * that is not the draft it is judged on, so a command may write its seat's root, which holds the
 * seat's HOME and its temporary folder, but for the host's own folder in it, and nothing else.
 * The host's shared temporary folders, `/tmp`, `/var/tmp` and Darwin's per-user one, are closed to
 * it whole. The host home and the repository stay closed, except for the
 * runtime and toolchain roots the enclosing solve policy reopens read-only so an installed
 * interpreter can still find itself, and for the tool tree, which a tree inside the seat's root
 * has to really lie inside that root to be (`commandReadAllows`).
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
 * The whole environment a command receives, built from fixed settings, scratch paths and the host
 * toolchain locations below. It is built rather than filtered: the host's environment holds the
 * provider's credential, `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`
 * (`src/agent/backends/claude.ts`), so a command that inherited the parent environment could simply print
 * it. No credential-removal filter is trusted to stand between the two.
 *
 * `HOME` points at the session home rather than at the work tree, because the write deny is
 * absolute outside the writable roots: a toolchain writing its cache to the real home would be
 * refused, and that refusal reads to the solver as a broken tool rather than as the isolation doing
 * its job. Pointing `HOME` at the work tree instead makes every temporary file a build writes a
 * candidate draft file.
 *
 * `TMPDIR` points at the seat's temporary folder, beside the home on its root. It lasts the seat, as
 * the home does, and keeps a build's leftovers out of the home that an install has to survive in;
 * the seat's cap counts them.
 *
 * `hostToolchainEnv` adds the names a toolchain uses to find its own installation, which moving
 * `HOME` otherwise hides — `RUSTUP_HOME`, naming a real directory the command may read and may not
 * write, absent where the directory is. Python's user base stays in the home, where pip can install.
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
  /** Darwin's Seatbelt rules, staged as a file. Null on Linux, whose launch is argv alone, built
   *  from the fields below by `stageCommandIsolation`. */
  profile: string | null;
  mechanismPath: string;
  /** Whether the command may reach the network; Darwin's profile already says so. */
  network: boolean;
  /** The seat's root, in both path forms: what a command may write. */
  scratchRoots: string[];
  /** The host's own folder in the root, in both path forms: what a command may read there and may
   *  not write. */
  keptRoots: string[];
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
 * A seat's folders, as its commands' wall names them: one root a command writes, but for the
 * host's own folder in it.
 *
 * `home` is where an install lands and where `HOME` points, kept across the seat's commands. `temp`
 * is where `TMPDIR` points. `kept` is the host's: it writes there, and a command reads there, what
 * must not follow a link a command made. pi writes a long output there while the command runs, so
 * a check before the write could not close that race; a command that cannot write the folder can
 * make no link in it.
 */
interface CommandDirectories {
  root: string;
  kept: string;
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
 *
 * Next comes the folder that holds the executable the host runs on, its real path, so that a
 * command's `bun` is that executable wherever it is installed. Until 19 October only Linux put a
 * runtime folder there, taken from the read grants, which leave out a prefix under `/usr` or `/opt`;
 * on a macOS runner whose `/opt/homebrew/bin` held Bun 1.1.34 a command's `bun` was that one, and
 * started in the seat it read no environment: no `TMPDIR`, `/tmp` refused, and no `bun` on its
 * PATH. `executable` and `fallback` are the host's own but where a test names others.
 */
export function commandSearchPath(
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
  };
}

/**
 * Runtime and toolchain roots to reopen inside the directories a denial closed. Only paths a read
 * denial actually covers are kept, since every other host path is readable already under the open
 * default and re-allowing it would add a rule that changes nothing. The adopted tool tree is added
 * explicitly, as no list above names it: it lies under the repository or a stored pack, both closed
 * whole. Both operating systems use this list, and Darwin emits it after the denials so the later,
 * more specific rule decides.
 *
 * A tool tree inside the seat's root, the Builder's `harness/.toolchain`, is one the seat's own
 * commands write, and it is reopened only where its real path lies inside that root too: reopened
 * wherever it led, a Builder that linked `harness/.toolchain` to the repository, another worktree,
 * a pack or the operator's home would read that root through the wall. A tree outside the seat's
 * root is the host's or a pack's, a kept state's link to the tree beside it or a stored bundle's,
 * and is reopened with what it links to.
 *
 * `manifests` are the package.json paths between the tree and the root that closes it, which
 * Darwin reopens one by one: Node takes a `.js` program's module type from the nearest one above
 * it, and a refused read of one ends the program at startup. On esp32 (12 October) every program of
 * a kept tree with none of its own died so in 6 of 6 practice solves, on the checkout's. That one
 * stays closed: opened, its `"type": "module"` would make the same program an ES module, which it
 * was not on the Builder's bench outside the checkout. A campaign's folder holds an empty one
 * (`openCampaign`), so the walk ends there as it ends on the bench with none. Linux needs none: its
 * overmount leaves every one of them absent.
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
  // The harness's tool tree lies under a closed root, the campaign's states in the repository, so
  // without this the Builder's own install answers `command not found`. Allowing it by path after
  // the root's deny restores that one tree and leaves the rest of the root closed. A tree a Builder
  // has yet to install is left out, as bwrap refuses to bind a missing path.
  const toolTree = dirs.toolTree ?? null;
  const tree = toolTree === null || !existsSync(toolTree) ? null : resolve(toolTree);
  const seated = tree !== null && canonicalForms(dirs.root).some((root) => containsPath(tree, root));
  const escapes = seated && !containsPath(realpathSync(tree), realpathSync(dirs.root));
  const own = tree === null || escapes ? [] : canonicalForms(tree);
  const inside = (dir: string) => readDenies.some((root) => dir !== root && covers(root, dir));
  const manifests = own.flatMap((path) => ancestorDirectories(path).filter(inside));
  return {
    roots: [...new Set([...covered, ...own])].sort(),
    manifests: [...new Set(manifests)].sort().map((dir) => join(dir, "package.json")),
  };
}

function darwinCommandProfile(
  base: SolveIsolationPolicy,
  scratchRoots: string[],
  keptRoots: string[],
  dirs: Pick<CommandDirectories, "root" | "toolTree">,
) {
  const writeDenies = [...new Set(["/", ...base.deniedWriteRoots])].sort();
  // The seats' parent and the host's own scratch beside it. Reads are open by default, so both are
  // denied here and this seat's root is re-allowed after them.
  const closed = hostRoots();
  const readDenies = [...new Set([...base.deniedReadRoots, ...closed])].sort();
  const { roots: readAllows, manifests } = commandReadAllows(base, readDenies, dirs);
  // The host's shared temporary folders. `mktemp` and Python follow `TMPDIR`, which is the seat's
  // own folder, and what a command spells as `/tmp/...` outright landed in a folder every seat of
  // every campaign on the host shares: on 10 October reference solves of two campaigns ran a
  // PHREEQC that a third campaign's Builder had installed under `/tmp` four hours before. Linux
  // gives each command an empty `/tmp` of its own; a Seatbelt rule cannot, so Darwin closes it, and
  // such a write is refused where Linux would keep it private. `/var/tmp` is the same, and was left
  // open until 12 October: a v1 run's folder there held a held-out task's text and a graded solve of
  // it, and an Examiner listed and read inside it. The per-user one, `confstr`'s, is the same
  // again but for the files and folders `mktemp` and Apple's `/usr/bin` shims make in it, which
  // take it whatever `TMPDIR` says (`userTempRules`).
  const userTemp = userTempRules();
  const sharedTmp = canonicalRoots(["/tmp", "/var/tmp", ...userTemp.roots]);
  const profile = [
    "(version 1)",
    // Reads open by default, with the repository and its worktrees, a stored pack and the home
    // closed. All of it arrives through `solveIsolationPolicy`, so there is no second list here to
    // fall out of step.
    "(allow default)",
    // A seat's command may reach the network, so it can install what its task needs; a check may
    // not (`src/kernel/verify.ts`).
    base.network ? "(allow network*)" : "(deny network*)",
    // A command signals its own processes and nothing else. `(allow default)` let one `kill` the
    // host's processes outside its wall, the campaign that runs it among them (probe, 20 October);
    // Linux gives each command a pid namespace of its own.
    "(deny signal)",
    "(allow signal (target same-sandbox))",
    ...sbRule("deny file-write*", "subpath", writeDenies),
    // The host's shared temporary folders, closed whole: what another process left there is
    // neither read nor run, and a command leaves nothing there for the next. Their listings are
    // every tenant's names, which Linux hides under a tmpfs. The seat's root, which lies in the
    // per-user one, is opened again further down, after it, and so is a tool tree there.
    ...sbRule("deny file-read* file-read-metadata file-write*", "subpath", sharedTmp),
    ...userTemp.rules,
    ...sbRule("deny file-read*", "subpath", readDenies),
    ...traversalMetadataRules(readAllows),
    // Seatbelt prefers the rule naming the more specific operation over the one naming the family,
    // whatever their order, so a `file-read*` allow on its own leaves the pattern denies above —
    // which name `file-read-metadata` outright — in charge of `stat`: `cat .toolchain/bin/own-tool`
    // prints the file while `ls` of its directory and the shell's PATH search over it answer
    // "Operation not permitted". Naming both operations in the allow puts this rule back in charge.
    ...sbRule("allow file-read* file-read-metadata", "subpath", readAllows),
    ...sbRule("allow file-read* file-read-metadata", "literal", manifests),
    // The parent of every seat's root and the host's own scratch, closed for the same three
    // operations the temporary grant above opened. `file-read-metadata` is named outright for the
    // same specificity reason: without it, one seat's `stat` of another seat's file reports its size
    // while `cat` of the same file is refused.
    ...sbRule("deny file-read* file-read-metadata file-write*", "subpath", closed),
    // A command may read and create files under its seat's root, and outside it and the shared
    // temporary roots above it may create them nowhere. This allow names the same operations as the
    // deny immediately above, which makes order the tie-break, and being later it wins.
    ...sbRule("allow file-read* file-read-metadata", "subpath", scratchRoots),
    ...sbRule("allow file-write*", "subpath", scratchRoots),
    // But for the host's own folder in it, which a command reads and does not write, by the same
    // tie-break: later than the allow, this deny wins. A subpath names the folder itself, so a
    // command can neither remove it nor put a link in its place.
    ...sbRule("deny file-write*", "subpath", keptRoots),
    // A resolver walks every ancestor of the file it opens, so each ancestor needs `lstat` even
    // where the directory itself stays closed. Without this, `node t.js` fails on the scratch
    // parent and no script on disk runs at all.
    ...traversalMetadataRules(scratchRoots),
    `(allow file-write* (literal ${capturedJsonStringify("/dev/null")}))`,
    ...moveBlockingRules(base.deniedReadRoots),
    "",
  ].join("\n");
  return { profile, readAllows };
}

/** The wall a seat's commands run under. It is a pure function of the seat's folders and its tool
 *  tree, and taken for each command, because a Builder's tool tree grows during its session and its
 *  preview runs another harness's under the same seat. */
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
   * What the Linux command wall overmounts under its open read default: the session's
   * denied roots, which are the repository, its other worktrees, a stored pack and the operator
   * home; and the shared temporary directories. The temporary directory holds every
   * other seat's root and every concurrent verification's staged workdir, so it is hidden whole
   * and this seat's root is bound back inside it — a separation the Darwin profile spends two rules
   * on only because a Seatbelt deny cannot be reopened by a mount.
   *
   * `TMPDIR` points at a tree bound back inside the overmount, so hiding the shared directory costs
   * a toolchain nothing. `/tmp` is hidden the same way even when the host's temporary directory is
   * elsewhere, because the overmount is an empty writable tmpfs: that is what gives `mktemp` and a
   * build script spelling `/tmp` a private directory rather than the read-only root bind, where a
   * `mkdir` answers "Read-only file system".
   */
  const readDenies = [...new Set([...base.deniedReadRoots, tmpdir(), "/tmp", "/var/tmp"])].sort();
  return {
    ...shared,
    profile: null,
    readAllowRoots: commandReadAllows(base, readDenies, dirs).roots,
    readDenies,
  };
}

/** Escapes one argument for a `/bin/sh -c` command line. A single quote ends the literal, so the
 *  quote itself is spliced back in outside it — the standard transformation. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

/**
 * The command line that applies these rules to one shell command, and the profile file it reads.
 *
 * The profile is staged as a file rather than passed with `-p` because its rules contain newlines
 * and would otherwise have to survive a second round of shell quoting. `profileFile` must sit
 * outside the seat's root and every other writable location, since a command that could rewrite
 * the rules would be choosing the wall a later command in the same seat runs under. `exec` replaces
 * the outer shell, so nothing of the controller's process survives into the command beyond the file
 * descriptors pi opened to capture its output.
 *
 * Seatbelt has no namespace to end what a command leaves behind, so the host ends the command's
 * process group and its descendants after it (`endHolders`, `src/wall/seat-root.ts`).
 */
export function stageCommandIsolation(
  policy: CommandIsolationPolicy,
  profileFile: string,
  command: string,
): string {
  // Every argument is quoted, so a scratch path with a space cannot split into two.
  return `exec ${isolatedArgv(policy, profileFile, ["/bin/sh", "-c", command]).map(shellQuote).join(" ")}`;
}

/**
 * The argv that runs `argv` under these rules, with Darwin's profile staged at `profileFile`. A
 * seat's command takes it through the line above, and a check takes it bare (`src/kernel/verify.ts`),
 * where the verifier ends the check's process group itself.
 */
export function isolatedArgv(
  policy: CommandIsolationPolicy,
  profileFile: string,
  argv: readonly string[],
): string[] {
  if (policy.profile === null) {
    // bwrap rules are argv with no newlines, so nothing is staged. The order is itself the policy,
    // as on Darwin: the host opens for reading, the protected paths are overmounted, the seat's
    // root is bound back writable and the host's folder in it read-only over that, and only then
    // do the host root and the overmounts over product trees go read-only, so a write there fails
    // with EROFS instead of landing on the host or vanishing into an overmount. The two overmounts
    // holding the seat's root, `/tmp` and the host tmpdir, stay writable, as Darwin lets `mktemp`
    // through. Each remount touches one mount, which is why the overmounts are named beside the
    // root and why the binds, mounted earlier, are unaffected.
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
  // The staged file is read-only and cannot be overwritten in place; removing it first is what lets
  // the same policy be restaged, with the same rules either way since its bytes are a pure function
  // of the policy.
  rmSync(profileFile, { force: true });
  // The rendered rules carry no trailing newline, and a staged file ends in one.
  writeFileSync(profileFile, `${policy.profile}\n`, { mode: 0o400 });
  return [policy.mechanismPath, "-f", profileFile, ...argv];
}
