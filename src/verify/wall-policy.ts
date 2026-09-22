/**
 * Shared allowed paths, protected paths and toolchain locations for the host isolation policies.
 *
 * Three actors run on this host and each is confined by its own mechanism: the Harness Builder
 * authors the product, the Built Harness solves tasks, and the verifier's declared checks decide
 * correctness. Until 2026-08-18 each wall stated its own idea of what may be read, and the order
 * came out backwards — the Builder's session had network access and installed toolchains, the
 * Built Harness's shell read six system roots, and the verifier, which has to run whatever the
 * Builder installed, read none of them. A probe of `/usr/bin/clang++` under the engine wall
 * returned `unable to read data link at '/var/select/developer_dir' (Operation not permitted)`:
 * `(allow process*)` let the compiler start and the read rules stopped it opening its own
 * toolchain, while the runtime facts were telling the Builder that `cc`, `arduino-cli` and `pio`
 * were available.
 *
 * Each caller keeps its own policy, using the relevant shared lists here. The verifier permits
 * declared reads; authoring and solve commands allow broader tool access while denying protected
 * paths. The common toolchain locations let these processes find the installed compiler.
 */
import type { OptionalEnvValues } from "../backends/scrub-env.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { existsSync, readdirSync } from "../meta/filesystem.ts";
import { dirname, join, resolve } from "../meta/path.ts";

import { keysIf } from "../meta/optional-key.ts";
import { runtimeProcess } from "../meta/process.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";

/**
 * Home-relative roots no confined actor may read.
 *
 * `.claude`, `.claude.json` and `.codex` are here because a transport's own state holds prior
 * Builder sessions: `~/.claude/projects` carries authoring transcripts and `~/.claude.json`
 * carries per-project prompt history, so a solving session reading them would read the authoring
 * of its own tasks.
 */
export const PROTECTED_HOME_NAMES = [
  ".ssh",
  ".aws",
  ".gnupg",
  ".netrc",
  ".npmrc",
  ".config",
  ".codex",
  ".claude",
  ".claude.json",
] as const;

/**
 * The Mach services a confined command may ask for, and the ones it may not.
 *
 * A `(deny default)` profile denies mach-lookup, and a denied lookup does not read as a denial. A
 * tool that builds an HTTP client asks configd for the system proxy configuration before it sends
 * anything; under a denying profile that call returns NULL, and Rust's system-configuration crate
 * treats NULL as impossible and panics. Measured 2026-08-19 on the verifier wall: `uv pip install`
 * exited 101 in about 200ms with a Tokio backtrace naming neither the network nor a proxy, and
 * `--offline` panicked identically because the client is constructed before the flag is read. With
 * these rules the same command exits 2 with "dns error: failed to lookup address information", and
 * `--offline` says the network was disabled. Network access remains denied in both cases.
 *
 * The denies are last, so they win over the allow above them. They name the services that broker
 * secrets and consent — keychain, authorisation, privacy and the pasteboard — because a cell writes
 * into a tree a networked session reads, so a secret it could read here would have a way out.
 *
 * The workshop cell has carried these rules since it was written; the verifier wall gained them
 * when the panic above was measured. One list, both walls.
 */
/** The Seatbelt baseline every wall imports; its closure digest is recorded beside the name. */
export const SEATBELT_BASELINE = "system.sb";

export const SYSTEM_SERVICE_RULES = `(allow mach-lookup)
(deny mach-lookup
  (global-name "com.apple.SecurityServer")
  (global-name "com.apple.securityd")
  (global-name "com.apple.securityd.xpc")
  (global-name "com.apple.CoreAuthentication.daemon")
  (global-name "com.apple.CoreAuthentication.agent")
  (global-name "com.apple.tccd")
  (global-name "com.apple.tccd.system")
  (global-name "com.apple.pasteboard.1"))`;

/**
 * The one directory inside a candidate workspace that holds tools rather than candidate content:
 * the controller links its own Bun runtime here, and a Builder that installs a compiler, a board
 * package tree or a prepared cache puts it here too. The verifier reopens this tree read-only
 * for installed tools. The shared name avoids an earlier mismatch: admission asked for
 * `.tooling`, which nothing created, and refused workspace-installed tools because they sat
 * outside that nonexistent directory.
 */
export const WORKSPACE_TOOL_TREE = ".toolchain";

/** Disposable host locations a Builder cell may write outside its own workspace. Content there
 * remains Builder-influenceable even when the controller pins one exact executable for candidate
 * measurement; it is never independent operator authority or a permitted broad read root. */
export const BUILDER_SCRATCH_ROOTS: readonly string[] = [
  "/tmp",
  "/private/tmp",
  "/var/tmp",
  "/var/folders",
  "/private/var/folders",
];

/**
 * The read-only platform baseline the Darwin walls grant.
 *
 * The Built Harness's shell has had these roots since 2026-08-04, measured through its own
 * profile: `sh`, `node`, `python3`, `ls`, `mkdir`, `cat`, `grep`, `sed` and `awk` all run under
 * them. These broad roots are intended for platform software. Their contents are not inspected
 * here; the policy assumes protected run data and credentials are kept outside them.
 *
 * They carry no recursive content digest, as with `LINUX_SYSTEM_READ_ROOTS`. Walking `/System`
 * fails because `scandir` refuses its asset store. Exact executable and input files have their
 * own snapshots; a granted directory path does not establish an identity for all its contents.
 *
 * `/var/select` appears in both spellings: a process opens `/var/select/developer_dir` while the
 * policy evaluates `/private/var/select`.
 */
export const DARWIN_SYSTEM_READ_ROOTS = [
  "/Applications",
  "/Library",
  "/System",
  "/bin",
  "/etc",
  "/opt",
  "/private/etc",
  "/private/var/select",
  "/sbin",
  "/usr",
  "/var/select",
] as const;

/**
 * The directory and file names that mean run data, wherever on the host they sit.
 *
 * These close a leak the old allow-list posture closed only as a side effect. On 2026-08-04 a Built
 * Harness command read a sibling worktree's `domains/<slug>/correctness-model/tasks.json` and
 * `evaluator.ts`: runs repeat a slug, so the neighbour held this task family's own tasks and
 * verifier source. The answer was to open reads by allow list, which shut the neighbour by shutting
 * everything, and which then had to grow a toolchain enumeration that never reached a compiler.
 *
 * A path-name pattern closes copies that retain these directory names. It covers earlier runs,
 * archives and temporary copies without enumerating their locations, while
 * `/usr`, `/opt` and a home toolchain stay open. Codex takes the same route for the paths it must
 * keep shut under an open read default, denying by regex rather than by naming every place a file
 * could be (`build_seatbelt_unreadable_glob_policy`, `codex-rs/sandboxing/src/seatbelt.rs`).
 *
 * These are anchored on a path separator so a directory called `my-domains` does not match, and
 * they are applied only to the Built Harness. The verifier reads a correctness model as its job.
 */
/**
 * The one run-data name every wall denies, including the Builder's own cells.
 *
 * The rest of the list below is Built-Harness-only for the reason that paragraph gives: a verifier
 * reads a correctness model as its job, and the Builder's own workspace lives at `campaigns/<slug>/`,
 * so a wall that denied `/campaigns/` inside a Builder cell would deny that cell its own tree.
 * Hidden tasks need a separate denial for authoring and solve processes. The protected verifier
 * owns their use. Builder cells may write Darwin's shared temporary directory, where a staged
 * copy would otherwise be readable beneath an allowed path.
 */
export const HIDDEN_TASKS_DENY_PATTERN = String.raw`/hidden-tasks\.json$`;

/** The directory names that mark a checkout as one of these, carrying run data of its own. */
const RUN_DATA_NAMES = ["domains", "campaigns", "correctness-model"];

/** The host-level half of verifier toolchain access: the env homes and install roots that exist
 * under `home` when the host is built. A verifier host reads it once, so a root that a sibling
 * run creates mid-battery moves no request's read roots and no policy hash. truss-run10 and
 * truss-run11 (2026-09-03) each lost one 25-case battery to `~/Library/Arduino15` appearing between
 * two requests; the platform roots were already frozen, these per-request roots were not. */
export type FrozenToolchainAccess = {
  readonly environment: Record<string, string>;
  readonly installRoots: readonly string[];
};

/**
 * The metadata-only grants that let a path be resolved without its directory being readable.
 *
 * A profile that denies a directory denies `lstat` on it too, and a resolver walks every ancestor
 * of the file it opens. Measured 2026-08-18 under the open-read profile: `node t.js` failed with
 * `EPERM: operation not permitted, lstat '<scratch parent>'` for every script on disk, while
 * `node -e` worked, because Node realpaths its entry point. The verifier wall has always carried
 * this grant (`prepareDarwinSeatbelt` builds `metadataAncestors` the same way); the Built shell
 * lost it when its allow list went away.
 *
 * The grant is `file-read-metadata` on each ancestor directory as a literal, so a path can be
 * traversed and the directory still cannot be listed: `stat ~` succeeds, `ls ~` stays refused.
 */
const BROAD_SANDBOX_READ_ROOTS = new Set([
  "/",
  "/Applications",
  "/Library",
  "/System",
  "/Users",
  "/Volumes",
  "/home",
  "/opt",
  "/private",
  "/usr",
  "/var",
]);

/** The Built shell's own scratch parent, named here with its siblings. `solve-command-isolation`
 *  creates it and drops this one entry from the list the running command is denied. */
export const BUILT_COMMAND_SCRATCH_DENY = "/ana-built-bash";

/**
 * Where a host toolchain installs itself, for the two walls that must name a place.
 *
 * The Built Harness shell reads by default outside protected roots. This list helps reopen
 * toolchains within a denied home and construct PATH; it does not enumerate every readable
 * installation. A complete install allowlist was tried on 2026-08-18 and dropped the same day,
 * because it prevented the shell from using tools that were already installed elsewhere.
 *
 * The verifier also needs concrete directories: it denies reads by default and executes a
 * selected tool. PATH separately needs directories to search. These consumers read the same
 * list, so adding an installation location here updates both access and command lookup.
 */
export function darwinToolchainInstallRoots(home: string | undefined = Bun.env.HOME): string[] {
  const shared = ["/usr/local"];
  const perUser =
    home === undefined || home === ""
      ? []
      : [
          ".bun",
          ".cargo",
          ".deno",
          ".espressif",
          ".local",
          ".nvm",
          ".platformio",
          ".pyenv",
          ".rustup",
          "Library/Arduino15",
          "go",
        ].map((relative) => join(home, relative));
  return [...shared, ...perUser].filter(existsSync).sort(compareCodeUnits);
}

/** The Darwin platform roots the verifier wall opens: present system roots plus the toolchain
 * install roots under `home`. A verifier host reads this once at construction and hands the list
 * to every plan, so a root appearing on the shared machine mid-census no longer moves the policy
 * hash: esp32-opus 2026-08-22 discarded three exit-0 verdicts that way. */
export function darwinPlatformReadRoots(home: string | undefined = Bun.env.HOME): string[] {
  return [
    ...DARWIN_SYSTEM_READ_ROOTS.filter((root) => existsSync(root)),
    ...darwinToolchainInstallRoots(home),
  ];
}

/**
 * The controller's own checkout, derived from this file rather than from a caller.
 *
 * A Builder's workspace is a campaign directory, not this tree. Once the account's home opens, this
 * tree is inside it, and it holds the verifier source, the hidden tasks and every other run's
 * recorded evidence. Closing it by name is what keeps the home grant from re-opening the leak
 * measured on 2026-08-04, when a Built Harness command read a sibling worktree's `tasks.json` and
 * `evaluator.ts` because runs repeat a slug.
 */
export function controllerCheckoutRoot(): string {
  return resolve(Bun.fileURLToPath(new URL("../../", import.meta.url)));
}

export const RUN_DATA_DENY_PATTERNS = [
  "/correctness-model(/|$)",
  // `domains` is also a normal library directory (for example sympy/polys/domains). A harness
  // domain has one more distinctive join: slug, then one of the bundle/evidence roots.
  "/domains/[^/]+/(agent|correctness-model|runs)(/|$)",
  "/campaigns/",
  String.raw`/\.env($|\.)`,
  HIDDEN_TASKS_DENY_PATTERN,
] as const;

/**
 * The run-data denies as SBPL rules, for a profile whose read default is open.
 *
 * The pattern list is a parameter because the three directory names above are Built-Harness-only
 * for the reason just given, and because two of them are ordinary dictionary words: measured on
 * 2026-08-19, denying `/domains/` inside a Builder cell made `import sympy` fail on
 * `sympy/polys/domains`, a third-party package that is neither run data nor the cell's own tree.
 */
export function runDataDenyRules(patterns: readonly string[] = RUN_DATA_DENY_PATTERNS): string[] {
  return patterns.map((pattern) => `(deny file-read* file-read-metadata (regex #"${pattern}"))`);
}

/**
 * The same run-data class as above, named as paths, for a wall that cannot match a name.
 *
 * Bubblewrap confines by mount rather than by rule, so `RUN_DATA_DENY_PATTERNS` has no Linux
 * counterpart: a tmpfs hides a path, and there is nothing to hide a directory name with. The class
 * the patterns close is a peer checkout of this same system — the 2026-08-04 leak was a sibling
 * worktree's `domains/<slug>/correctness-model/tasks.json`, reached because runs repeat a slug — so
 * the Linux wall closes it by hiding those checkouts whole.
 *
 * A checkout is one that sits beside a denied root and carries a run-data directory of its own. The
 * scan is one `readdir` per parent directory and never descends, so an operator home stays open
 * while the trees inside it that hold run data do not.
 *
 * What this does not cover: a checkout created after the command launched. The host mount is live,
 * so a directory appearing later appears inside the namespace as well. This limit lasts for the
 * command's lifetime; the same window does not exist on
 * Darwin, where the deny is a pattern the kernel evaluates per open.
 */
export function runDataDenyPaths(deniedRoots: readonly string[]): string[] {
  const denied = new Set(deniedRoots);
  const found = new Set<string>();
  for (const parent of new Set(deniedRoots.map((root) => dirname(root)))) {
    let entries: string[];
    try {
      entries = readdirSync(parent);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(parent, entry);
      if (denied.has(path)) continue;
      if (RUN_DATA_NAMES.some((name) => existsSync(join(path, name)))) found.add(path);
    }
  }
  return [...found].sort(compareCodeUnits);
}

/**
 * The per-user temporary directory a Darwin toolchain uses whatever `TMPDIR` says.
 *
 * Clang takes its scratch directory from `confstr(_CS_DARWIN_USER_TEMP_DIR)` and ignores the
 * environment, and Apple's `/usr/bin/python3` shim rewrites `TMPDIR` to the same directory before
 * it execs. Until 2026-08-18 that write was refused and `cc` was the one advertised runtime the
 * shell could not use: `clang: error: unable to make temporary file: Operation not permitted`.
 *
 * The fix read the controller's own `TMPDIR`, which is that directory in a terminal and not under
 * launchd: the launch procedure sets `TMPDIR=/private/var/tmp/ana-<runId>-tmp`, so every paid run
 * from 2026-08-27 to 2026-09-02 granted the wrong directory and 511 Built Harness compiles failed
 * the same way the 2026-08-18 measurement did. The directory is asked of the system now, once per
 * process, and a host that cannot answer has no such directory to grant.
 */
let confstrTempRoot: string | undefined | null = null;

export function darwinUserTempRoot(): string | undefined {
  if (runtimeProcess.platform !== "darwin") return undefined;
  if (confstrTempRoot === null) {
    const probe = Bun.spawnSync(["/usr/bin/getconf", "DARWIN_USER_TEMP_DIR"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const found = probe.exitCode === 0 ? probe.stdout.toString().trim() : "";
    confstrTempRoot = found === "" ? undefined : found.replace(/\/$/, "");
  }
  return confstrTempRoot;
}

/**
 * The grant a toolchain needs in a temporary directory: every direct child and what lies beneath
 * it. `regex-quote` is Seatbelt's own path-to-regex boundary; this is the same form used by Apple's
 * shipped profiles and Firefox's macOS sandbox.
 *
 * The Built Harness shell had a narrower, files-only version of this rule until 2026-09-02, on the
 * theory that a directory-deep grant would open concurrent verifier workdirs. Measured on the same
 * day across 57 recorded runs, that rule refused `mktemp -d`, `mkdir /tmp/x` and every python
 * `TemporaryDirectory()` while the verifier wall had already moved to this rule on 2026-08-22 and
 * closed the product's own trees by name instead (`verifierTempSiblingDenyRules`). Both walls now
 * grant the same shape and deny the same names.
 */
export function userTempChildTreeRules(roots: string[]): string[] {
  return roots.map(
    (root) =>
      `(allow file-read* file-read-metadata file-write* (regex (string-append #"^" (regex-quote ${capturedJsonStringify(root)}) #"/[^/]+(/.*)?$")))`,
  );
}

/** What the product itself creates under the user temporary directory and a verifier tool may
 * not touch: a concurrent verification's cell (`ana-cell-`, the host's per-check workdir),
 * Built Harness scratch, reference-solve and tool staging. Named by prefix because each path is
 * only known when it is created. The tools overhaul first dropped the cell prefix with the engine
 * names, and the gate's leak test caught a Built shell reading a staged cell. A host Claude
 * session keeps its CLI state in `ana-claude-cli-`; the Builder's holds the whole authoring
 * history, hidden expectations included, for the whole run. */
export const VERIFIER_TEMP_SIBLING_DENY_PATTERNS = [
  "/ana-cell-",
  BUILT_COMMAND_SCRATCH_DENY,
  "/ana-pi-built-",
  "/ana-reference-solve-cwd-",
  "/ana-generated-tools-",
  "/ana-claude-cli-",
] as const;

export function verifierTempSiblingDenyRules(
  patterns: readonly string[] = VERIFIER_TEMP_SIBLING_DENY_PATTERNS,
): string[] {
  return patterns.map((pattern) => `(deny file-read* file-read-metadata file-write* (regex #"${pattern}"))`);
}

/**
 * The directories a confined command searches for a program.
 *
 * A read grant lets a toolchain be opened; PATH decides whether it can be named at all. Measured
 * 2026-08-18 under the Built Harness profile with reads already open: `arduino-cli`, `pio`, `uv`
 * and Node's TypeScript all ran, because they sit in `/opt/homebrew/bin`, while `rustc` reported
 * `command not found` with `~/.cargo/bin/rustc` present and readable. So the same install roots
 * that grant the read also supply the search path, and a toolchain the Harness Builder installs
 * becomes usable without a second list being edited.
 *
 * `shims` is here for pyenv and rbenv, which put no binaries in `bin`.
 */
export function toolchainPathDirs(home: string | undefined = Bun.env.HOME): string[] {
  // Both /opt entries sit under the granted /opt read root. This host may have its only system
  // Node under zerobrew, so the derived toolchain owner must retain that executable directory.
  const system = [
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/opt/zerobrew/bin",
  ];
  const installed = darwinToolchainInstallRoots(home).flatMap((root) => [
    join(root, "bin"),
    join(root, "shims"),
  ]);
  // Every entry is checked, the fixed ones included: /opt/homebrew/bin exists on this Darwin host
  // and not in the Linux VM, so an unchecked list would name a directory that is not there.
  return [...new Set([...system, ...installed])].filter(existsSync);
}

/**
 * Host state a toolchain reads through an environment name rather than through PATH.
 *
 * A confined command's `HOME` points at its own scratch tree, because a toolchain writing its cache
 * to the real home would be refused and the refusal would read as a broken tool. The cost is that a
 * toolchain looking for its installation under `$HOME` no longer finds it: measured, `rustc` fails
 * with `rustup could not choose a version` while `~/.rustup` sits readable on disk. These names put
 * each such toolchain back on its real installation, which it may read and may not write.
 */
export function hostToolchainEnv(home: string | undefined = Bun.env.HOME) {
  if (home === undefined || home === "") return {};
  const rustup = join(home, ".rustup");
  const pythonUserBase = join(home, ".local");
  return {
    ...keysIf(existsSync(rustup), () => ({ RUSTUP_HOME: rustup })),
    ...keysIf(existsSync(pythonUserBase), () => ({ PYTHONUSERBASE: pythonUserBase })),
  };
}

export function frozenToolchainAccess(home: string | undefined): FrozenToolchainAccess {
  return { environment: hostToolchainEnv(home), installRoots: darwinToolchainInstallRoots(home) };
}

/** Refuse these broad roots when supplied as declared sandbox reads. Platform baseline grants
 *  are separate. Both OS implementations apply this check after resolving the path. */
export function isOverbroadSandboxReadRoot(path: string): boolean {
  const normalized = resolve(path);
  return BROAD_SANDBOX_READ_ROOTS.has(normalized) || /^\/(?:Users|home)\/[^/]+$/.test(normalized);
}

/** Every directory between `/` and `path`, outermost first, as a resolver walks them. */
export function ancestorDirectories(path: string): string[] {
  const ancestors: string[] = [];
  let current = dirname(path);
  while (current !== "/" && current !== ".") {
    ancestors.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return ancestors.toReversed();
}

export function traversalMetadataRules(paths: string[]): string[] {
  const ancestors = [...new Set(paths.flatMap(ancestorDirectories))]
    .filter((path) => path !== "/")
    .sort(compareCodeUnits);
  return ancestors.map((path) => `(allow file-read-metadata (literal ${capturedJsonStringify(path)}))`);
}

/**
 * Whether this environment already sits inside someone else's OS sandbox, which is what makes a
 * verifier wall refuse to nest. Presence is the test and not the value: a surrounding sandbox that
 * exports an empty `CODEX_SANDBOX` is still a surrounding sandbox, and a wall that ran anyway would
 * record isolation it does not have.
 */
export function surroundingSandbox(env: OptionalEnvValues): boolean {
  return Object.hasOwn(env, "CODEX_SANDBOX") || Object.hasOwn(env, "HARNESS_INNER_UNSANDBOXED");
}
