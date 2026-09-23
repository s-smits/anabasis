/**
 * Shared allowed paths, protected paths and toolchain locations for the host isolation policies.
 *
 * Three actors run on this host and each is confined by its own mechanism: the Harness Builder
 * authors the product, the Built Harness solves tasks, and the verifier's declared checks decide
 * correctness. Until 2026-08-18 each wall also stated its own idea of what may be read, and the
 * order came out backwards. The Builder's session had network access and installed toolchains, the
 * Built Harness's shell read six system roots, and the verifier — which has to run whatever the
 * Builder installed — read none of them. A probe of `/usr/bin/clang++` under the engine wall
 * returned `unable to read data link at '/var/select/developer_dir' (Operation not permitted)`,
 * because `(allow process*)` let the compiler start while the read rules stopped it opening its own
 * toolchain, all while the runtime facts were telling the Builder that `cc`, `arduino-cli` and
 * `pio` were available.
 *
 * So each caller still keeps its own policy, but it builds it from the shared lists here, which is
 * what keeps the three walls agreeing on where toolchains live and what stays protected. The
 * verifier permits declared reads; authoring and solve commands open reads broadly and deny the
 * protected paths.
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
 * `.claude`, `.claude.json` and `.codex` are here because a transport keeps its own state in the
 * home: `~/.claude/projects` carries authoring transcripts and `~/.claude.json` carries per-project
 * prompt history. A solving session that could read either would be reading the authoring of its
 * own tasks, which is the one thing the wall between the Builder and the Built Harness exists to
 * prevent.
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

/** The Seatbelt baseline every wall imports; its closure digest is recorded beside the name. */
export const SEATBELT_BASELINE = "system.sb";

/**
 * The Mach services a confined command may ask for, and the ones it may not.
 *
 * A `(deny default)` profile denies mach-lookup, and the trouble with that is that a denied lookup
 * does not read as a denial. A tool building an HTTP client asks configd for the system proxy
 * configuration before it sends anything; under a denying profile that call returns NULL, and
 * Rust's system-configuration crate treats NULL as impossible and panics. Measured 2026-08-19 on
 * the verifier wall: `uv pip install` exited 101 in about 200ms with a Tokio backtrace naming
 * neither the network nor a proxy, and `--offline` panicked identically because the client is
 * constructed before the flag is read. With the allow below, the same command exits 2 with "dns
 * error: failed to lookup address information" and `--offline` says the network was disabled, so
 * the failure names its own cause. Network access is denied in both cases; only the diagnosis
 * changes.
 *
 * The denies come last so they win over the allow above them, and they name the services that
 * broker secrets and consent — keychain, authorisation, privacy and the pasteboard. A cell writes
 * into a tree that a networked session later reads, which means a secret it could read here would
 * have a way out.
 *
 * The workshop cell has carried these rules since it was written; the verifier wall gained them
 * when the panic above was measured. One list serves both.
 */
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
 * package tree or a prepared cache puts it here too, so the verifier can reopen this one tree
 * read-only for installed tools. The name is shared rather than spelled per caller because an
 * earlier mismatch cost the product real tools: admission asked for `.tooling`, which nothing ever
 * created, and therefore refused every workspace-installed tool on the grounds that it sat outside
 * a directory that did not exist.
 */
export const WORKSPACE_TOOL_TREE = ".toolchain";

/** Disposable host locations a Builder cell may write outside its own workspace. What lands there
 *  remains Builder-influenceable even when the controller has pinned one exact executable for
 *  candidate measurement, which is why a path from this list is never independent operator
 *  authority and never a permitted broad read root. */
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
 * The Built Harness's shell has had these roots since 2026-08-04, measured through its own profile:
 * `sh`, `node`, `python3`, `ls`, `mkdir`, `cat`, `grep`, `sed` and `awk` all run under them. They
 * are deliberately broad because they are meant for platform software, and their contents are not
 * inspected here, so the policy is assuming that protected run data and credentials are kept
 * outside them.
 *
 * They carry no recursive content digest, as with `LINUX_SYSTEM_READ_ROOTS`, because walking
 * `/System` fails when `scandir` refuses its asset store. Exact executable and input files have
 * their own snapshots instead, since granting a directory path establishes no identity for
 * everything underneath it.
 *
 * `/var/select` appears in both spellings because a process opens `/var/select/developer_dir` while
 * the policy evaluates the resolved `/private/var/select`, and a rule naming only one of the two
 * misses the access that actually happens.
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
 * The one run-data name every wall denies, the Builder's own cells included.
 *
 * The rest of `RUN_DATA_DENY_PATTERNS` is Built-Harness-only, because a verifier reads a
 * correctness model as its job and a Builder's own workspace lives at `campaigns/<slug>/`, so a
 * wall denying `/campaigns/` inside a Builder cell would deny that cell its own tree. Hidden
 * expectations are the exception that needs a denial for authoring and solve processes alike: only
 * the protected verifier owns their use, and Builder cells may write Darwin's shared temporary
 * directory, where a staged copy would otherwise sit readable beneath an allowed path.
 */
export const HIDDEN_TASKS_DENY_PATTERN = String.raw`/hidden-tasks\.json$`;

/** The directory names that mark a checkout as one of these, carrying run data of its own. */
const RUN_DATA_NAMES = ["domains", "campaigns", "correctness-model"];

/** The host-level half of verifier toolchain access: the environment homes and install roots that
 *  exist under `home` at the moment the verifier host is built. A host reads them once and hands
 *  the frozen result to every plan, so a root that a sibling run creates mid-battery moves no
 *  request's read roots and no policy hash. truss-run10 and truss-run11 (2026-09-03) each lost a
 *  whole 25-case battery to `~/Library/Arduino15` appearing between two requests: the platform
 *  roots were already frozen by then and these per-request roots were not. */
export type FrozenToolchainAccess = {
  readonly environment: Record<string, string>;
  readonly installRoots: readonly string[];
};

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
 * The Built Harness shell reads by default outside its protected roots, so this list is not an
 * enumeration of every readable installation; it exists to reopen a toolchain that a denied home
 * happens to sit on top of, and to construct PATH. A complete install allow list was tried on
 * 2026-08-18 and dropped the same day, because it stopped the shell using tools that were already
 * installed somewhere the list did not name.
 *
 * The verifier needs concrete directories for a different reason: it denies reads by default and
 * then executes a selected tool, so the place has to be named. PATH needs directories to search.
 * All three consumers read this one list, which is what makes adding an installation location
 * update access and command lookup together rather than one of them.
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

/** The Darwin platform roots the verifier wall opens: the system roots that are present, plus the
 *  toolchain install roots under `home`. A verifier host reads this once at construction and hands
 *  the list to every plan, so a root appearing on the shared machine mid-census no longer moves the
 *  policy hash — an Opus run on 2026-08-22 discarded three exit-0 verdicts exactly that way. */
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
 * tree sits inside it, and it holds the verifier source, the hidden expectations and every other
 * run's recorded evidence. Closing it by path is what keeps the home grant from reopening the leak
 * measured on 2026-08-04, when a Built Harness command read a sibling worktree's `tasks.json` and
 * `evaluator.ts` because runs repeat a slug.
 */
export function controllerCheckoutRoot(): string {
  return resolve(Bun.fileURLToPath(new URL("../../", import.meta.url)));
}

/**
 * The directory and file names that mean run data, wherever on the host they sit.
 *
 * These close a leak that the old allow-list posture closed only as a side effect. On 2026-08-04 a
 * Built Harness command read a sibling worktree's `domains/<slug>/correctness-model/tasks.json` and
 * `evaluator.ts`: runs repeat a slug, so the neighbour held this very task family's tasks and
 * verifier source. The answer at the time was to open reads by allow list, which shut the neighbour
 * by shutting everything, and which then had to grow a toolchain enumeration that never quite
 * reached a compiler.
 *
 * A path-name pattern closes the copies instead, because it covers earlier runs, archives and
 * temporary copies without enumerating where any of them are, while `/usr`, `/opt` and a home
 * toolchain stay open. Codex takes the same route for the paths it must keep shut under an open
 * read default, denying by regex rather than naming every place a file could be.
 *
 * Each pattern is anchored on a path separator so a directory called `my-domains` does not match,
 * and the list is applied only to the Built Harness, because the verifier reads a correctness model
 * as its job.
 */
export const RUN_DATA_DENY_PATTERNS = [
  "/correctness-model(/|$)",
  // `domains` is also an ordinary library directory name, for example sympy/polys/domains. A
  // harness domain has one more distinctive join than that: the slug, then one of the bundle or
  // evidence roots, which is what this pattern requires and a bare `/domains/` would not.
  "/domains/[^/]+/(agent|correctness-model|runs)(/|$)",
  "/campaigns/",
  String.raw`/\.env($|\.)`,
  HIDDEN_TASKS_DENY_PATTERN,
] as const;

/**
 * The run-data denies as SBPL rules, for a profile whose read default is open.
 *
 * The pattern list is a parameter rather than a constant because the three directory names above
 * are Built-Harness-only for the reason just given, and because two of them are ordinary dictionary
 * words. Measured 2026-08-19: denying `/domains/` inside a Builder cell made `import sympy` fail on
 * `sympy/polys/domains`, a third-party package that is neither run data nor the cell's own tree.
 */
export function runDataDenyRules(patterns: readonly string[] = RUN_DATA_DENY_PATTERNS): string[] {
  return patterns.map((pattern) => `(deny file-read* file-read-metadata (regex #"${pattern}"))`);
}

/**
 * The same run-data class as above, named as paths, for a wall that cannot match a name.
 *
 * Bubblewrap confines by mount rather than by rule, so `RUN_DATA_DENY_PATTERNS` has no Linux
 * counterpart at all: a tmpfs hides a path, and there is nothing with which to hide a directory
 * name. What those patterns close is a peer checkout of this same system — the 2026-08-04 leak was
 * a sibling worktree's `domains/<slug>/correctness-model/tasks.json`, reached because runs repeat a
 * slug — so the Linux wall closes the same class by hiding those checkouts whole.
 *
 * A checkout counts as one when it sits beside a denied root and carries a run-data directory of
 * its own. The scan is one `readdir` per parent directory and never descends, which is what lets an
 * operator home stay open while the trees inside it that hold run data do not.
 *
 * What this does not cover is a checkout created after the command launched: the host mount is
 * live, so a directory appearing later appears inside the namespace as well. That window lasts for
 * the command's lifetime and has no Darwin equivalent, because a Seatbelt deny is a pattern the
 * kernel evaluates on every open.
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
 * it execs. Until 2026-08-18 that write was refused, which made `cc` the one advertised runtime the
 * shell could not use: `clang: error: unable to make temporary file: Operation not permitted`.
 *
 * The first fix read the controller's own `TMPDIR`, which is that directory in a terminal and not
 * under launchd. The launch procedure sets `TMPDIR=/private/var/tmp/ana-<runId>-tmp`, so every paid
 * run from 2026-08-27 to 2026-09-02 granted the wrong directory and 511 Built Harness compiles
 * failed exactly as the 2026-08-18 measurement had. The directory is therefore asked of the system
 * rather than of the environment, once per process, and a host that cannot answer has no such
 * directory to grant.
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
 * it. `regex-quote` is Seatbelt's own path-to-regex boundary, and this is the same form Apple's
 * shipped profiles and Firefox's macOS sandbox use.
 *
 * The Built Harness shell had a narrower, files-only version of this rule until 2026-09-02, on the
 * theory that a directory-deep grant would open concurrent verifier workdirs. Measured that same
 * day across 57 recorded runs, the narrow rule refused `mktemp -d`, `mkdir /tmp/x` and every python
 * `TemporaryDirectory()`, while the verifier wall had already moved to this rule on 2026-08-22 and
 * closed the product's own trees by name instead (`verifierTempSiblingDenyRules`). Both walls now
 * grant the same shape and deny the same names, which is the only arrangement under which a
 * toolchain works and a sibling's workdir stays shut.
 */
export function userTempChildTreeRules(roots: string[]): string[] {
  return roots.map(
    (root) =>
      `(allow file-read* file-read-metadata file-write* (regex (string-append #"^" (regex-quote ${capturedJsonStringify(root)}) #"/[^/]+(/.*)?$")))`,
  );
}

/** What the product itself creates under the user temporary directory and a verifier tool may not
 *  touch: a concurrent verification's cell (`ana-cell-`, the host's per-check workdir), Built
 *  Harness scratch, reference-solve staging and tool staging. Each is named by prefix because the
 *  rest of the path is only known once it is created. The tools overhaul first dropped the cell
 *  prefix along with the engine names, and the gate's leak test caught a Built shell reading a
 *  staged cell, which is why it is spelled out here rather than derived. A host Claude session
 *  keeps its CLI state in `ana-claude-cli-`, and the Builder's holds the whole authoring history,
 *  hidden expectations included, for the length of the run. */
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
 * A read grant lets a toolchain be opened, but PATH decides whether it can be named at all, and the
 * two came apart. Measured 2026-08-18 under the Built Harness profile with reads already open:
 * `arduino-cli`, `pio`, `uv` and Node's TypeScript all ran because they sit in `/opt/homebrew/bin`,
 * while `rustc` reported `command not found` with `~/.cargo/bin/rustc` present and readable. So the
 * same install roots that grant the read supply the search path too, which is what makes a
 * toolchain the Harness Builder installs usable without a second list being edited.
 *
 * `shims` is here for pyenv and rbenv, which put no binaries in `bin` at all.
 */
export function toolchainPathDirs(home: string | undefined = Bun.env.HOME): string[] {
  // Both /opt entries sit under the granted /opt read root, so neither needs a read rule of its
  // own. This host may have its only system Node under zerobrew, so the derived toolchain owner has
  // to retain that executable directory rather than assume /usr/bin holds one.
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
  // Every entry is checked for existence, the fixed ones included: /opt/homebrew/bin exists on this
  // Darwin host and not in the Linux VM, so an unchecked list would put a directory that is not
  // there on PATH.
  return [...new Set([...system, ...installed])].filter(existsSync);
}

/**
 * Host state a toolchain reads through an environment name rather than through PATH.
 *
 * A confined command's `HOME` points at its own scratch tree, because a toolchain writing its cache
 * to the real home would be refused and that refusal would read as a broken tool rather than as the
 * isolation doing its job. The cost of moving `HOME` is that a toolchain looking for its
 * installation under `$HOME` no longer finds it: measured, `rustc` fails with `rustup could not
 * choose a version` while `~/.rustup` sits readable on disk. These names put each such toolchain
 * back on its real installation, which it may read and may not write.
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

/** Whether a declared sandbox read names an over-broad root, which both operating systems refuse
 *  after resolving the path, so a symlink or a relative spelling cannot slip one through. The
 *  platform baseline grants are a separate decision and are not subject to this check: the wall
 *  chooses those, whereas a declared read is whatever the candidate asked for. */
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

/**
 * The metadata-only grants that let a path be resolved without its directory being readable.
 *
 * A profile that denies a directory denies `lstat` on it too, and a resolver walks every ancestor
 * of the file it opens. Measured 2026-08-18 under the open-read profile: `node t.js` failed with
 * `EPERM: operation not permitted, lstat '<scratch parent>'` for every script on disk, while
 * `node -e` worked, because Node realpaths its entry point and a `-e` script has none. The verifier
 * wall has always carried this grant — `prepareDarwinSeatbelt` in `darwin-seatbelt.ts` builds its
 * `metadataAncestors` the same way — and the Built shell lost it when its allow list went away.
 *
 * The grant is `file-read-metadata` on each ancestor directory as a literal rather than a subpath,
 * which is what lets a path be traversed while the directory itself stays unlistable: `stat ~`
 * succeeds and `ls ~` stays refused.
 */
export function traversalMetadataRules(paths: string[]): string[] {
  const ancestors = [...new Set(paths.flatMap(ancestorDirectories))]
    .filter((path) => path !== "/")
    .sort(compareCodeUnits);
  return ancestors.map((path) => `(allow file-read-metadata (literal ${capturedJsonStringify(path)}))`);
}

/**
 * Whether this environment already sits inside someone else's OS sandbox, which is what makes a
 * verifier wall refuse to nest. Presence of the name is the test and not its value, because a
 * surrounding sandbox that exports an empty `CODEX_SANDBOX` is still a surrounding sandbox, and a
 * wall that ran anyway would record isolation it does not have.
 */
export function surroundingSandbox(env: OptionalEnvValues): boolean {
  return Object.hasOwn(env, "CODEX_SANDBOX") || Object.hasOwn(env, "HARNESS_INNER_UNSANDBOXED");
}
