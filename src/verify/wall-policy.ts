/**
 * Shared allowed paths, protected paths and toolchain locations for the host isolation policies.
 *
 * Three actors run on this host, each under its own mechanism: the Harness Builder authors the
 * product, the Built Harness solves tasks, and the verifier's declared checks decide correctness.
 * Each keeps its own policy but reads these shared lists, so all three agree on where toolchains
 * live and what stays protected. The verifier permits declared reads; authoring and solve commands
 * open reads broadly and deny protected paths.
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
 * `.claude`, `.claude.json` and `.codex` hold prior Builder transcripts and prompt history, so a
 * solving session reading them would read the authoring of its own tasks.
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
 * Lookups are allowed because a denied one does not read as a denial: an HTTP client asking configd
 * for proxy settings gets NULL, and Rust's system-configuration crate panics on it, so a tool fails
 * with a backtrace instead of a network error. Network access stays denied either way.
 *
 * The denies come last, so they win. They name the services that broker secrets and consent —
 * keychain, authorisation, privacy and the pasteboard — because a cell writes into a tree a
 * networked session reads, so a secret read here would have a way out.
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
 * The one directory in a candidate workspace that holds tools rather than candidate content: the
 * controller's Bun runtime link and whatever the Builder installs. The verifier reopens it read-only.
 */
export const WORKSPACE_TOOL_TREE = ".toolchain";

/** Disposable host locations a Builder cell may write outside its workspace. Their content stays
 *  Builder-influenced, so they are never an authority or a permitted broad read root. */
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
 * These broad roots hold platform software; the policy assumes protected run data and credentials
 * sit outside them. Like `LINUX_SYSTEM_READ_ROOTS` they carry no recursive content digest (`scandir`
 * refuses `/System`'s asset store); exact executables and inputs have their own snapshots.
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
 * The one run-data name every wall denies, the Builder's own cells included; the rest of
 * `RUN_DATA_DENY_PATTERNS` is Built-Harness-only, since a Builder cell lives under `campaigns/`.
 * Only the protected verifier may read hidden tasks, and a staged copy in a shared temporary
 * directory would otherwise be readable.
 */
export const HIDDEN_TASKS_DENY_PATTERN = String.raw`/hidden-tasks\.json$`;

/** The directory names that mark a checkout as one of these, carrying run data of its own. */
const RUN_DATA_NAMES = ["domains", "campaigns", "correctness-model"];

/** The env homes and install roots that exist under `home` when a verifier host is built. The host
 *  reads them once, so a root a sibling run creates mid-battery moves no read root or policy hash. */
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
 * It reopens toolchains inside a denied home, opens them to the deny-default verifier and builds
 * PATH; it is not a list of every readable installation. One list serves all three, so a new
 * location updates access and command lookup together.
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

/** The Darwin platform roots the verifier wall opens: present system roots plus toolchain install
 *  roots. A host reads this once, so a root appearing mid-census does not move the policy hash. */
export function darwinPlatformReadRoots(home: string | undefined = Bun.env.HOME): string[] {
  return [
    ...DARWIN_SYSTEM_READ_ROOTS.filter((root) => existsSync(root)),
    ...darwinToolchainInstallRoots(home),
  ];
}

/**
 * The controller's own checkout, derived from this file rather than from a caller.
 *
 * It sits inside the open home and holds the verifier source, hidden tasks and other runs'
 * evidence, so the walls close it by path.
 */
export function controllerCheckoutRoot(): string {
  return resolve(Bun.fileURLToPath(new URL("../../", import.meta.url)));
}

/**
 * Path-name patterns that mean run data wherever it sits, so earlier runs, archives and temporary
 * copies are closed without enumerating their locations. Anchored on a separator, so `my-domains`
 * does not match. Built Harness only: the verifier reads a correctness model as its job.
 */
export const RUN_DATA_DENY_PATTERNS = [
  "/correctness-model(/|$)",
  // `domains` is also a library directory name (sympy/polys/domains), so match slug plus a bundle root.
  "/domains/[^/]+/(agent|correctness-model|runs)(/|$)",
  "/campaigns/",
  String.raw`/\.env($|\.)`,
  HIDDEN_TASKS_DENY_PATTERN,
] as const;

/**
 * The run-data denies as SBPL rules, for a profile whose read default is open.
 *
 * The pattern list is a parameter because most patterns are Built-Harness-only; `/domains/` in a
 * Builder cell would break `import sympy`, which ships `sympy/polys/domains`.
 */
export function runDataDenyRules(patterns: readonly string[] = RUN_DATA_DENY_PATTERNS): string[] {
  return patterns.map((pattern) => `(deny file-read* file-read-metadata (regex #"${pattern}"))`);
}

/**
 * The same run-data class as above, named as paths, for a wall that cannot match a name.
 *
 * Bubblewrap hides paths by mount and cannot match a name, so the Linux wall hides every peer
 * checkout whole: a directory beside a denied root that carries a run-data directory of its own.
 * The scan is one `readdir` per parent and never descends.
 *
 * Limit: a checkout created after the command launched appears inside the namespace, since the host
 * mount is live. Darwin has no such window, because its deny is a pattern evaluated per open.
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
 * Clang takes its scratch directory from `confstr(_CS_DARWIN_USER_TEMP_DIR)`, and Apple's
 * `/usr/bin/python3` shim rewrites `TMPDIR` to it. The controller's own `TMPDIR` differs under a
 * launcher, so the system is asked once per process; a host that cannot answer has none to grant.
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
 * it, so `mktemp -d` works. `regex-quote` is Seatbelt's own path-to-regex boundary. Concurrent
 * verifier workdirs are closed by name instead (`verifierTempSiblingDenyRules`).
 */
export function userTempChildTreeRules(roots: string[]): string[] {
  return roots.map(
    (root) =>
      `(allow file-read* file-read-metadata file-write* (regex (string-append #"^" (regex-quote ${capturedJsonStringify(root)}) #"/[^/]+(/.*)?$")))`,
  );
}

/** What the product creates under the user temporary directory that a confined tool may not touch:
 *  concurrent verifier cells, Built Harness scratch, reference-solve and tool staging, and a host
 *  Claude session's CLI state, which holds the authoring history. Named by prefix because each path
 *  is known only once created. */
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
 * A read grant lets a toolchain be opened; PATH decides whether it can be named. The install roots
 * that grant the read also supply the search path, so one list serves both. `shims` is for pyenv
 * and rbenv, which put no binaries in `bin`.
 */
export function toolchainPathDirs(home: string | undefined = Bun.env.HOME): string[] {
  // Both /opt entries sit under the granted /opt read root; a host may have its only Node under zerobrew.
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
  // Every entry is checked, the fixed ones included, so PATH names no absent directory.
  return [...new Set([...system, ...installed])].filter(existsSync);
}

/**
 * Host state a toolchain reads through an environment name rather than through PATH.
 *
 * A confined command's `HOME` is a scratch tree, so a toolchain looking under `$HOME` for its
 * installation would miss it. These names point it at the real, read-only installation.
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

/** Whether a declared sandbox read names an over-broad root; platform baseline grants are separate. */
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
 * `file-read-metadata` on each ancestor as a literal: a resolver `lstat`s every ancestor of the file
 * it opens, and a literal grant lets it traverse without listing (`stat ~` works, `ls ~` does not).
 */
export function traversalMetadataRules(paths: string[]): string[] {
  const ancestors = [...new Set(paths.flatMap(ancestorDirectories))]
    .filter((path) => path !== "/")
    .sort(compareCodeUnits);
  return ancestors.map((path) => `(allow file-read-metadata (literal ${capturedJsonStringify(path)}))`);
}

/**
 * Whether this environment already sits inside another OS sandbox, where a verifier wall refuses to
 * nest. Presence is the test, not the value: an empty `CODEX_SANDBOX` still marks a sandbox.
 */

export function surroundingSandbox(env: OptionalEnvValues): boolean {
  return Object.hasOwn(env, "CODEX_SANDBOX") || Object.hasOwn(env, "HARNESS_INNER_UNSANDBOXED");
}
