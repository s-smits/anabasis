/**
 * Shared protected paths and toolchain locations for the command wall, which a seat's commands and
 * a check both run under (`isolation.ts`). A check runs there with the network
 * closed, and reads open by default with the protected paths denied.
 */
import type { OptionalEnvValues } from "../agent/backends/scrub-env.ts";
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
 * Where a host toolchain installs itself.
 *
 * The command wall reads by default outside its protected roots, so this is not an enumeration of
 * every readable installation; it exists to reopen a toolchain that a denied home sits on top of,
 * and to construct PATH. A complete install allow list was tried and dropped, because it stopped
 * the shell using tools installed somewhere the list did not name. Both read this one list, so
 * adding an installation location updates access and command lookup together.
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
 * The per-user temporary directory a Darwin toolchain takes whatever `TMPDIR` says, in both path
 * forms, and what the command wall grants inside it once it has closed it whole
 * (`darwinCommandProfile`). `mktemp` takes it before `TMPDIR` on macOS 15, and Apple's `/usr/bin`
 * shims, `cc` and `python3` among them, reset `TMPDIR` to it, so without a grant `mktemp -d` fails
 * in every command and a check's tool that names `/usr/bin/cc` cannot compile (`unable to make
 * temporary file`). The grant is what those tools make there: a regular file directly in it, and a
 * folder named as `mktemp` names one (a prefix, a dot and ten letters or digits) or as Python's
 * `tempfile` does (`tmp` and eight of its own), with what lies in it. Any other folder there is
 * another process's, and stays closed with everything in it, as the directory's listing does, so a
 * folder of the grant's shape is found only by its random name.
 *
 * Until 12 October every child of the directory was granted, folders and all, so a command read and
 * wrote every other process's folder there: a v1 run's, another agent's scratch, a test suite's.
 * `vnode-type` keeps the first grant to files, and Seatbelt's regex takes no counted repetition, so
 * the names are spelled out class by class. The directory is asked of the system rather than of the
 * environment, once per process, since `confstr` is what those tools read and `TMPDIR` does not move
 * it; a host that cannot answer has no such directory to grant.
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
      // A `stat` of the directory itself, which a tool makes before it writes there.
      `(allow file-read-metadata (literal ${capturedJsonStringify(root)}))`,
    ];
  });
  return { roots, rules };
}

/**
 * The directories a confined command searches for a program.
 *
 * A read grant lets a toolchain be opened, but PATH decides whether it can be named at all, and the
 * two come apart: with reads already open, `rustc` still reports `command not found` while
 * `~/.cargo/bin/rustc` sits present and readable. So the same install roots that grant the read
 * supply the search path too, which makes a toolchain a Builder installs usable without a
 * second list being edited.
 *
 * `shims` is here for pyenv and rbenv, which put no binaries in `bin` at all.
 */
export function toolchainPathDirs(): string[] {
  // Both /opt entries are readable under the open read default, so neither needs a read rule of its
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
 * sits readable on disk. `RUSTUP_HOME` puts rustup back on its real installation, which it may read
 * and may not write.
 *
 * Python's user base stays in the seat's home. It was pointed at the real `~/.local` until
 * 21 October, so `pip install` and `pip install --user` were refused there ("Operation not
 * permitted: '~/.local/lib/python'") wherever that directory existed. In the first DeepSeek
 * campaign on a macOS host, 7 of 10 solves ran pip and 4 were refused so, then spent turns finding
 * `--target`. A solve on the Linux host would also have seen the 609 packages installed there by
 * hand, which one on macOS could not.
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
  return { ...compiler, ...keysIf(existsSync(rustup), () => ({ RUSTUP_HOME: rustup })) };
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
 * a `-e` script has none.
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
 * wall refuse to nest. Presence of the name is the test and not its value, because a
 * surrounding sandbox that exports an empty `CODEX_SANDBOX` is still a surrounding sandbox, and a
 * wall that ran anyway would record isolation it does not have.
 */
export function surroundingSandbox(env: OptionalEnvValues): boolean {
  return Object.hasOwn(env, "CODEX_SANDBOX") || Object.hasOwn(env, "HARNESS_INNER_UNSANDBOXED");
}
