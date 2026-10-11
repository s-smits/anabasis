/**
 * Shared allowed paths, protected paths and toolchain locations for the host isolation policies.
 *
 * Three actors run on this host, each confined by its own mechanism: the Harness Builder authors
 * the product, the Built Harness solves tasks, and the verifier's declared checks decide
 * correctness. When each wall also states its own idea of what may be read, the order comes out
 * backwards — the verifier, which has to run whatever the Builder installed, ends up with the
 * fewest system roots, so `(allow process*)` lets a compiler start while the read rules stop it
 * opening its own toolchain and the runtime facts still advertise that compiler as available.
 *
 * So each caller keeps its own policy but builds it from the shared lists here, which is what keeps
 * the three walls agreeing on where toolchains live and what stays protected. The verifier permits
 * declared reads; authoring and solve commands open reads broadly and deny the protected paths.
 */
import type { OptionalEnvValues } from "../backends/scrub-env.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { existsSync, mkdirSync, mkdtempSync, realpathSync } from "../meta/filesystem.ts";
import { activeDeveloperBinDirs } from "../meta/host-tool.ts";
import { dirname, join, resolve } from "../meta/path.ts";
import { keysIf } from "../meta/optional-key.ts";
import { tmpdir } from "../meta/os.ts";
import { runtimeProcess } from "../meta/process.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";

/** What a Darwin system command answered, by the command: each is asked once per process. */
const darwinAnswers = new Map<string, string | undefined>();

/** The Seatbelt baseline every wall imports; its closure digest is recorded beside the name. */
export const SEATBELT_BASELINE = "system.sb";

/**
 * The Mach services a confined command may ask for, and the ones it may not.
 *
 * A `(deny default)` profile denies mach-lookup, and a denied lookup does not read as a denial. A
 * tool building an HTTP client asks configd for the system proxy configuration before it sends
 * anything; under a denying profile that call returns NULL, and Rust's system-configuration crate
 * treats NULL as impossible and panics — before the `--offline` flag is read, so the backtrace
 * names neither the network nor a proxy. With the allow below the same command fails with "dns
 * error: failed to lookup address information". Network access is denied either way; only the
 * diagnosis changes.
 *
 * The denies come last so they win over the allow above them, and they name the services that
 * broker secrets and consent — keychain, authorisation, privacy and the pasteboard. A cell writes
 * into a tree that a networked session later reads, so a secret it could read here would have a way
 * out. One list serves the workshop cell and the verifier wall alike.
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
 * The read-only platform baseline the Darwin walls grant.
 *
 * These are deliberately broad because they are meant for platform software — `sh`, `node`,
 * `python3` and the coreutils all run under them — and their contents are not inspected here, so
 * the policy assumes protected run data and credentials are kept outside them. They carry no
 * recursive content digest, as `LINUX_SYSTEM_READ_ROOTS` does, because walking `/System` fails when
 * `scandir` refuses its asset store; exact executable and input files have their own snapshots
 * instead, since granting a directory path establishes no identity for what lies underneath it.
 */
export const DARWIN_SYSTEM_READ_ROOTS: readonly string[] = [
  "/Applications",
  "/Library",
  "/System",
  "/bin",
  "/etc",
  "/opt",
  "/sbin",
  "/usr",
  "/var/select",
].flatMap(canonicalForms);

/** The host-level half of verifier toolchain access: the environment homes and install roots that
 *  exist under `home` at the moment the verifier host is built. A host reads them once and hands
 *  the frozen result to every plan, so a root that a sibling run creates mid-battery moves no
 *  request's read roots and no policy hash. Left per-request, a toolchain root appearing between
 *  two requests loses a whole battery to a policy hash that changed under it. */
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

/**
 * The one directory every seat's root is made under, which keeps them together for creation and
 * cleanup at mode 0700. One parent does not separate them; the profile does that, by denying the
 * parent and re-allowing the running seat's root after it, so another seat's root is closed by a
 * rule that can be read and tested rather than by nobody having named it.
 */
export const BUILT_COMMAND_SCRATCH_ROOT = join(tmpdir(), "ana-built-bash");

/**
 * The host's own scratch, beside the seats' parent: a verifier's cells, which hold a check program
 * and a task's hidden value, and the state a reviewer's or the Examiner's Claude Code keeps, which
 * holds what it read. Every wall closes it by path, as it closes the seats' parent, so a wall that
 * grants the shared temporary directory names no folder of the host's by pattern.
 */
const HOST_SCRATCH_ROOT = join(tmpdir(), "ana-host");

/** The two roots of the host's own above, in both path forms, for a wall to close whole. */
export function hostRoots(): string[] {
  return [BUILT_COMMAND_SCRATCH_ROOT, HOST_SCRATCH_ROOT].flatMap(canonicalForms).sort(compareCodeUnits);
}

/** A fresh folder of the host's under `HOST_SCRATCH_ROOT`, named from `prefix`. */
export function hostScratch(prefix: string): string {
  mkdirSync(HOST_SCRATCH_ROOT, { recursive: true, mode: 0o700 });
  return mkdtempSync(join(HOST_SCRATCH_ROOT, prefix));
}

/** Both path forms of a root: a rule that names only the symlink form misses the access Seatbelt
 *  actually evaluates, which on Darwin is the difference between `/var` and `/private/var`. Every
 *  wall list is written once per directory and derived through this, so no list carries a
 *  hand-kept pair that one entry can be missing. */
export function canonicalForms(path: string): string[] {
  const abs = resolve(path);
  try {
    const real = realpathSync.native(abs);
    return real === abs ? [abs] : [abs, real];
  } catch {
    return [abs];
  }
}

/** Every path form of `paths`, each once and sorted: the root list a rule set and the policy
 *  identity recording it are both written from. */
export function canonicalRoots(paths: readonly string[]): string[] {
  return [...new Set(paths.flatMap(canonicalForms))].sort();
}

/**
 * Where a host toolchain installs itself, for the two walls that must name a place.
 *
 * The Built Harness shell reads by default outside its protected roots, so this is not an
 * enumeration of every readable installation; it exists to reopen a toolchain that a denied home
 * sits on top of, and to construct PATH. A complete install allow list was tried and dropped,
 * because it stopped the shell using tools installed somewhere the list did not name.
 *
 * The verifier needs concrete directories for a different reason: it denies reads by default and
 * then executes a selected tool, so the place has to be named, and PATH needs directories to
 * search. All three consumers read this one list, so adding an installation location updates access
 * and command lookup together rather than one of them.
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
 *  toolchain install roots under the process home. A verifier host reads this once at construction
 *  and hands the list to every plan, so a root appearing on the shared machine mid-census cannot
 *  move the policy hash and discard exit-0 verdicts for a wall that never changed. */
export function darwinPlatformReadRoots(): string[] {
  return [...DARWIN_SYSTEM_READ_ROOTS.filter((root) => existsSync(root)), ...darwinToolchainInstallRoots()];
}

/** The one line a Darwin system command answers with, asked once per process: undefined on another
 *  system, and where the command fails or says nothing. */
function darwinAnswer(...command: string[]): string | undefined {
  if (runtimeProcess.platform !== "darwin") return undefined;
  const asked = command.join(" ");
  if (!darwinAnswers.has(asked)) {
    const probe = Bun.spawnSync(command, { stdout: "pipe", stderr: "ignore" });
    const found = probe.exitCode === 0 ? probe.stdout.toString().trim() : "";
    darwinAnswers.set(asked, found === "" ? undefined : found);
  }
  return darwinAnswers.get(asked);
}

/**
 * The confstr temp root and `extraRoots` in both path forms, which each wall records in its policy
 * identity, and the rules granting a toolchain every direct child of them and what lies beneath it.
 * `regex-quote` is Seatbelt's own path-to-regex boundary, the form Apple's shipped profiles and
 * Firefox's macOS sandbox use.
 *
 * A narrower, files-only version of this rule keeps concurrent verifier workdirs shut, but it also
 * refuses `mktemp -d`, `mkdir /tmp/x` and every python `TemporaryDirectory()`. So both walls grant
 * this shape and close the host's two roots by path after it (`hostRoots`), which is the only
 * arrangement under which a toolchain works and a sibling's workdir stays shut.
 */
export function userTempRules(extraRoots: readonly string[]) {
  // The per-user temporary directory a Darwin toolchain uses whatever `TMPDIR` says.
  //
  // Clang takes its scratch directory from `confstr(_CS_DARWIN_USER_TEMP_DIR)` and ignores the
  // environment, and Apple's `/usr/bin/python3` shim rewrites `TMPDIR` to the same directory before
  // it execs, for a command that names the shim by its path (`toolchainPathDirs` keeps it from being
  // found first). Without a write grant there, `cc` is an advertised runtime the shell cannot use:
  // `clang: error: unable to make temporary file: Operation not permitted`.
  //
  // Reading the controller's own `TMPDIR` instead grants a different directory: it is this one under
  // a terminal and not under launchd, and the launch procedure sets a run-specific one, so the grant
  // lands where no compiler looks and every Built Harness compile fails the same way. The directory
  // is therefore asked of the system rather than of the environment, once per process, and a host
  // that cannot answer has no such directory to grant.
  const confstr = darwinAnswer("/usr/bin/getconf", "DARWIN_USER_TEMP_DIR")?.replace(/\/$/, "");
  const roots = canonicalRoots(confstr === undefined ? extraRoots : [confstr, ...extraRoots]);
  const childTrees = roots.map(
    (root) =>
      `(allow file-read* file-read-metadata file-write* (regex (string-append #"^" (regex-quote ${capturedJsonStringify(root)}) #"/[^/]+(/.*)?$")))`,
  );
  return { roots, rules: childTrees };
}

/**
 * The directories a confined command searches for a program.
 *
 * A read grant lets a toolchain be opened, but PATH decides whether it can be named at all, and the
 * two come apart: with reads already open, `rustc` still reports `command not found` while
 * `~/.cargo/bin/rustc` sits present and readable. So the same install roots that grant the read
 * supply the search path too, which makes a toolchain the Harness Builder installs usable without a
 * second list being edited.
 *
 * `shims` is here for pyenv and rbenv, which put no binaries in `bin` at all.
 */
export function toolchainPathDirs(): string[] {
  // Both /opt entries sit under the granted /opt read root, so neither needs a read rule of its
  // own. This host may have its only system Node under zerobrew, so the derived toolchain owner has
  // to retain that executable directory rather than assume /usr/bin holds one.
  // The active developer directory goes ahead of /usr/bin, where Darwin keeps `python3`, `make`,
  // `git` and `cc` as xcrun shims. A shim starts its tool with TMPDIR reset to the user temporary
  // directory, so a command's own TMPDIR never reached a Python it started: every temp folder of
  // every solve landed in that one shared directory, outside the solve's capped volume, and stayed
  // when the command was gone. On 2026-10-10 one host held 1.56 million of them, 121 GB, from three
  // days of campaigns. Started by its own path a tool keeps the TMPDIR it is given.
  const system = [
    ...activeDeveloperBinDirs(),
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/opt/zerobrew/bin",
  ];
  const installed = darwinToolchainInstallRoots().flatMap((root) => [join(root, "bin"), join(root, "shims")]);
  // Every entry is checked for existence, the fixed ones included: /opt/homebrew/bin exists on this
  // Darwin host and not in the Linux VM, so an unchecked list would put a directory that is not
  // there on PATH.
  return [...new Set([...system, ...installed])].filter(existsSync);
}

/**
 * Host state a toolchain reads through an environment name rather than through PATH.
 *
 * A confined command's `HOME` points at its own scratch tree, because a toolchain writing its cache
 * to the real home would be refused and that refusal reads as a broken tool rather than as the
 * isolation doing its job. The cost is that a toolchain looking for its installation under `$HOME`
 * no longer finds it — `rustc` fails with `rustup could not choose a version` while `~/.rustup`
 * sits readable on disk. These names put each such toolchain back on its real installation, which
 * it may read and may not write.
 *
 * `SDKROOT` is the same for a Darwin compiler. `/usr/bin/cc` is an xcrun shim that names the SDK for
 * the compiler it starts; with the developer directory ahead of `/usr/bin` on PATH no shim runs, and
 * `cc` started by its own path finds no `<stdio.h>` unless the name is set.
 */
export function hostToolchainEnv(home: string | undefined = Bun.env.HOME) {
  const sdk = darwinAnswer("/usr/bin/xcrun", "--show-sdk-path");
  const compiler = sdk === undefined ? {} : { SDKROOT: sdk };
  if (home === undefined || home === "") return compiler;
  const rustup = join(home, ".rustup");
  const pythonUserBase = join(home, ".local");
  return {
    ...compiler,
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
 * of the file it opens. Without this, `node t.js` fails with `EPERM: operation not permitted,
 * lstat` for every script on disk while `node -e` works, because Node realpaths its entry point and
 * a `-e` script has none. `prepareDarwinSeatbelt` in `darwin-seatbelt.ts` builds its
 * `metadataAncestors` the same way.
 *
 * The grant is `file-read-metadata` on each ancestor directory as a literal rather than a subpath,
 * which lets a path be traversed while the directory itself stays unlistable: `stat ~` succeeds and
 * `ls ~` stays refused.
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
