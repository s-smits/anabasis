/**
 * Shared protected paths, scratch roots, and toolchain locations for the command wall used by
 * seat commands and offline verification checks (`isolation.ts`).
 */
import type { OptionalEnvValues } from "../agent/backends/scrub-env.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { existsSync, mkdirSync, mkdtempSync, realpathSync } from "../meta/filesystem.ts";
import { activeDeveloperBinDirs } from "../meta/host-tool.ts";
import { dirname, isAbsolute, join, resolve } from "../meta/path.ts";
import { keysIf } from "../meta/optional-key.ts";
import { homedir, tmpdir } from "../meta/os.ts";
import { runtimeProcess } from "../meta/process.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { claim } from "./seat-root.ts";

/** Process-level cache of Darwin system probe outputs keyed by command string. */
const darwinAnswers = new Map<string, string | undefined>();

/**
 * Shared parent directory (mode `0700`) for all seat roots. Isolation between seats is enforced
 * by denying this parent directory in the wall profile and reopening only the active seat's root.
 */
export const BUILT_COMMAND_SCRATCH_ROOT = join(tmpdir(), "ana-built-bash");

/**
 * Host-owned scratch parent beside `BUILT_COMMAND_SCRATCH_ROOT`, holding verifier cells (with
 * check programs and hidden task values) and Claude Code session state for reviewers and the
 * Examiner. Every command wall denies this root by path.
 */
const HOST_SCRATCH_ROOT = join(tmpdir(), "ana-host");

/** All scratch parent directories scanned by orphan cleanup sweeps. */
export const SCRATCH_ROOTS: readonly string[] = [BUILT_COMMAND_SCRATCH_ROOT, HOST_SCRATCH_ROOT];

/** Parent directory for test-suite temporary roots (`tools/runtime/test-suite.ts`), claimed like
 *  seat roots so periodic cleanup removes leftovers from killed test runs. */
export const SUITE_SCRATCH_ROOT = join(tmpdir(), "ana-test-suite");

/** Per-user home subdirectories where toolchains install binaries, ordered for `PATH` resolution. */
export const TOOLCHAIN_HOME_ROOTS = [
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
];

/** Returns all canonical path forms of `SCRATCH_ROOTS`, sorted for wall denial rules. */
export function hostRoots(): string[] {
  return SCRATCH_ROOTS.flatMap(canonicalForms).toSorted(compareCodeUnits);
}

/** Creates and claims a fresh host-owned scratch directory under `HOST_SCRATCH_ROOT`; callers
 *  release it with `releaseRoot` (`seat-root.ts`). */
export function hostScratch(prefix: string): string {
  mkdirSync(HOST_SCRATCH_ROOT, { recursive: true, mode: 0o700 });
  const folder = mkdtempSync(join(HOST_SCRATCH_ROOT, prefix));
  claim(folder);
  return folder;
}

/** Returns both the resolved lexical path and its canonical `realpath` when they differ (for
 *  example, `/var` and `/private/var` on Darwin), preventing Seatbelt rules from missing aliased
 *  accesses. */
export function canonicalForms(path: string): string[] {
  const abs = resolve(path);
  try {
    const real = realpathSync.native(abs);
    return real === abs ? [abs] : [abs, real];
  } catch {
    return [abs];
  }
}

/** Expands `paths` into deduplicated, sorted canonical path forms for rules and policy hashing. */
export function canonicalRoots(paths: readonly string[]): string[] {
  return [...new Set(paths.flatMap(canonicalForms))].toSorted();
}

/**
 * Returns existing host toolchain roots reopened read-only inside the denied home directory and
 * used to build `PATH`, keeping filesystem access and command lookup synchronised.
 */
export function darwinToolchainInstallRoots(): string[] {
  const shared = ["/usr/local"];
  const home = closedHome();
  const perUser = home === undefined ? [] : TOOLCHAIN_HOME_ROOTS.map((relative) => join(home, relative));
  return [...shared, ...perUser].filter(existsSync).toSorted(compareCodeUnits);
}

/** Runs a Darwin system command once per process and returns its trimmed stdout, or `undefined`
 *  on other platforms or when the command fails. */
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
 * Returns Darwin's per-user temporary directory (in canonical path forms) and narrow Seatbelt
 * exceptions inside it (`darwinCommandProfile`). Because `mktemp` and Apple's `/usr/bin` shims
 * (`cc`, `python3`) reset `TMPDIR` to `DARWIN_USER_TEMP_DIR`, the wall denies the directory as a
 * whole and permits only top-level regular files plus random-named `mktemp` (`*.XXXXXXXXXX`) and
 * Python `tempfile` (`tmpXXXXXXXX`) subdirectories. Other directories and directory listings stay
 * denied so commands cannot discover or access sibling processes' scratch trees. Because Seatbelt
 * regular expressions do not support counted quantifiers, character classes are repeated
 * explicitly.
 */
export function userTempRules() {
  const confstr = darwinAnswer("/usr/bin/getconf", "DARWIN_USER_TEMP_DIR")?.replace(/\/$/, "");
  const roots = confstr === undefined ? [] : canonicalForms(confstr);
  const made = `([^/]+[.]${"[A-Za-z0-9]".repeat(10)}|tmp${"[a-z0-9_]".repeat(8)})`;
  const rules = roots.flatMap((root) => {
    const under = `(regex-quote ${capturedJsonStringify(root)})`;
    return [
      `(allow file-read* file-read-metadata file-write* (require-all (regex (string-append #"^" ${under} #"/[^/]+$")) (vnode-type REGULAR-FILE)))`,
      `(allow file-read* file-read-metadata file-write* (regex (string-append #"^" ${under} #"/${made}(/.*)?$")))`,
      // Permit `stat` on the temporary directory itself before tools create entries inside it.
      `(allow file-read-metadata (literal ${capturedJsonStringify(root)}))`,
    ];
  });
  return { roots, rules };
}

/**
 * Builds the host `PATH` directories for confined commands, placing pinned Python, user-installed
 * package managers (Homebrew, zerobrew, `/usr/local`), per-user toolchain `bin`/`shims`
 * directories, active developer binaries, and standard system directories in precedence order.
 */
export function toolchainPathDirs(): string[] {
  // User-managed prefixes are readable under the open-read default and precede system directories.
  const user = ["/usr/local/bin", "/opt/homebrew/bin", "/opt/zerobrew/bin"];
  const installed = darwinToolchainInstallRoots().flatMap((root) => [join(root, "bin"), join(root, "shims")]);
  // Place active developer tools ahead of `/usr/bin` so Darwin invokes real binaries instead of
  // `xcrun` shims, which reset `TMPDIR` to the shared user temporary directory.
  const system = [...activeDeveloperBinDirs(), "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  // Probe each prefix for Homebrew/zerobrew Python `libexec/bin` directories when present.
  const scan = { onlyFiles: false, absolute: true, followSymlinks: true };
  const glob = (cwd: string) => [...new Bun.Glob("opt/python*/libexec/bin").scanSync({ ...scan, cwd })];
  const brewed = user.map(dirname).filter(existsSync).flatMap(glob).toSorted(compareCodeUnits);
  const home = closedHome();
  const pinned = home === undefined ? [] : [pinnedPythonDir(home)];
  return [...new Set([...pinned, ...user, ...brewed.toReversed(), ...installed, ...system])].filter(
    existsSync,
  );
}

/**
 * Returns the host home directory when it is an absolute path, or `undefined` if `HOME` is
 * relative. Rejecting relative paths prevents the wall from closing a working-directory subpath
 * instead of the operator's real home or prepending a seat-writable path to `PATH`.
 */
export function closedHome(): string | undefined {
  const home = homedir();
  return isAbsolute(home) ? home : undefined;
}

/**
 * Returns the directory holding the host-pinned Python managed by `bun run runs sync`. When
 * present, it takes precedence on `PATH` so `python3` remains stable across package-manager updates;
 * it sits under `~/.local`, which `darwinToolchainInstallRoots` already reopens read-only.
 */
export function pinnedPythonDir(home: string): string {
  return join(home, ".local", "share", "ana-python", "bin");
}

/**
 * Supplies environment variables needed by host toolchains when `HOME` is redirected to the seat
 * scratch directory: `RUSTUP_HOME` (read-only host `~/.rustup` when present) and `SDKROOT` on
 * Darwin (needed when invoking developer `cc` directly without `xcrun` shims). Python's user base
 * intentionally remains under the seat's `HOME` so `pip` installs stay local and reproducible.
 */
export function hostToolchainEnv() {
  const sdk = darwinAnswer("/usr/bin/xcrun", "--show-sdk-path");
  const compiler = sdk === undefined ? {} : { SDKROOT: sdk };
  const home = closedHome();
  if (home === undefined) return compiler;
  const rustup = join(home, ".rustup");
  return { ...compiler, ...keysIf(existsSync(rustup), () => ({ RUSTUP_HOME: rustup })) };
}

/** Returns every ancestor directory between `/` and `path`, ordered from outermost to innermost. */
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
 * Emits literal `file-read-metadata` rules for every ancestor of `paths` so path resolvers (such
 * as Node's `realpath` on script entry points) can `lstat` parent directories while keeping those
 * directories unlistable.
 */
export function traversalMetadataRules(paths: string[]): string[] {
  const ancestors = [...new Set(paths.flatMap(ancestorDirectories))]
    .filter((path) => path !== "/")
    .toSorted(compareCodeUnits);
  return ancestors.map((path) => `(allow file-read-metadata (literal ${capturedJsonStringify(path)}))`);
}

/**
 * Reports whether the current process already runs inside an outer OS sandbox, based on variable
 * presence rather than value, so the wall refuses to nest or claim external isolation as its own.
 */
export function surroundingSandbox(env: OptionalEnvValues): boolean {
  return Object.hasOwn(env, "CODEX_SANDBOX") || Object.hasOwn(env, "HARNESS_INNER_UNSANDBOXED");
}
