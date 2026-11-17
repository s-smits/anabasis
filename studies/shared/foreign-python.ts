/**
 * A tool tree a campaign built on one machine, made to run on another. A Builder that wants Python
 * packages copies an interpreter and installs wheels into its `.toolchain`, so a tree built on a Mac
 * holds a CPython and compiled extension modules for the Mac, and on a Linux machine its programs
 * die at the first exec or import. On 16 November one promoted jobstat reference held a
 * python-build-standalone CPython 3.12.15 (its executable, seven shared libraries of `libpython` and
 * Tcl/Tk, and three `lib-dynload` modules) and 200 extension modules of numpy, scipy, pandas,
 * statsmodels and wrapt, beside 5,106 Python files that run anywhere.
 *
 * Each program `foreignFiles` names (`foreignHead`, the rollout's own test) is put down to its owner:
 * - a file a distribution's `RECORD` lists: that distribution is installed again for this machine,
 *   the same name at the same version, without its dependencies, over its foreign files;
 * - otherwise a file inside a CPython prefix (one holding `lib/pythonX.Y/os.py`): that interpreter
 *   is replaced by the place's CPython of the same version, each executable by the one of its name
 *   and each foreign shared library dropped, and what that CPython's `lib` holds that the tree
 *   lacks (its own `libpython`, `lib-dynload` and `_sysconfigdata`) is added, its `site-packages`
 *   left out.
 * A compiled distribution in a folder that names no minor (a flat `--target`) is read by the place's
 * own `python3` where the tree carries no CPython of its minor, so where the place's minor is known
 * (`Place.python`) it is installed again for that minor, built for its own where that has no build:
 * on 17 November two references of 3.14 wheels imported 8 of 14 and 8 of 10 of their modules under
 * the Linux benchmark's 3.12. Nothing else changes: pure-Python distributions, the harness's own programs and its data keep their
 * bytes, and a tree with no foreign program is not touched. A program no owner accounts for, a
 * version with no CPython for the place, a distribution with no build for it, and a compiled file
 * no reinstall puts back (a module no `RECORD` lists among an interpreter's packages, a
 * distribution's program under `bin` or outside its folder) is refused whole (`PlatformRefusal`),
 * before anything moves.
 *
 * The place is the machine that will roll the tree, which need not be the one that exports it: a
 * campaign stays on its own host, so a reference built on a Mac is exported there for the Linux
 * machine and the tree carried over. `uv` does both jobs (`uvPython`), as it pins a host's own
 * Python (`pinScript`, `tools/runs/sync.ts`); a test stands in for it through `PythonFor`.
 */
import { copyFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "#src/meta/filesystem.ts";
import { hostTool } from "#src/meta/host-tool.ts";
import { homedir, tmpdir } from "#src/meta/os.ts";
import { basename, dirname, join, normalize } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { decodeOutput, runSync } from "#src/meta/subprocess.ts";
import { pinnedPythonDir } from "#src/wall/policy.ts";
import { AARCH64, foreignFiles, foreignPrograms, type Place } from "./bundle.ts";

/** What stands in, on one machine, for Python built for another. */
export interface PythonFor {
  /** The prefix of a CPython at `version` (`3.12.15`, or `3.12`) built for the place, or null. */
  readonly interpreter: (version: string) => string | null;
  /** Installs `requirement` (`name==version`) for Python `python` (`3.12`) into `target`, without
   *  its dependencies. Returns why it could not, or null once installed. */
  readonly install: (target: string, requirement: string, python: string) => string | null;
}

/** What `rebuildForeignPython` replaced: each interpreter's prefix and version, and each
 *  distribution as `name==version`. */
interface Rebuilt {
  readonly interpreters: readonly string[];
  readonly distributions: readonly string[];
}

/** One installed distribution, from its `.dist-info` folder. */
interface Distribution {
  /** The folder it is installed into, relative to the tree. */
  readonly site: string;
  readonly requirement: string;
  /** Its Python's minor version, or null where neither its folder nor its wheel tag names one. */
  readonly python: string | null;
  /** Whether its folder names that minor (`lib/python3.14/site-packages`), not its wheel alone. */
  readonly named: boolean;
}

/** A shared library, which no machine loads under another's suffix, so one dropped breaks nothing. */
const SHARED_LIBRARY = /\.(?:so(?:\.\d+)*|dylib|dll|pyd)$/u;

/** A `RECORD` row's path: quoted, with doubled quotes, where it holds a comma. */
const RECORD_PATH = /^(?:"((?:[^"]|"")*)"|([^,]*))/u;

/** The refusal of a tree that would not run here, naming what stands in the way. */
export class PlatformRefusal extends Error {}

/** Makes the tool tree `tree` run on `place`, in place. Returns what it replaced, or null where it
 *  held no foreign program. */
export async function rebuildForeignPython(
  tree: string,
  place: Place,
  python: PythonFor,
): Promise<Rebuilt | null> {
  if (!existsSync(tree)) return null;
  const found = await foreignFiles(tree, place);
  const foreign = found.map(({ path }) => path);
  const owners = await distributionsIn(tree);
  // A folder that names no minor (a flat `--target`) is read by whichever `python3` comes first,
  // which on the place is its own where the tree carries no CPython of the folder's minor; a
  // distribution compiled for another minor there is installed again for the place's.
  const scan = (pattern: string) => [...new Bun.Glob(pattern).scanSync({ cwd: tree, dot: true })];
  const carried = new Set([
    ...scan("**/lib/python[0-9].*/os.py").map((os) => basename(dirname(os)).slice("python".length)),
    ...scan("**/pyvenv.cfg").map((cfg) => minorIn(venvOf(join(tree, dirname(cfg))) ?? "")),
  ]);
  const minorOf = ({ named, python: own }: Distribution) =>
    named || own === null || carried.has(own) ? own : (place.python ?? own);
  const retargeted = [...new Set(owners.values())].filter((one) => minorOf(one) !== one.python);
  if (foreign.length === 0 && retargeted.length === 0) return null;
  // One for each folder that holds it: `distributionsIn` makes one record a `RECORD`.
  const distributions = new Set<Distribution>(retargeted);
  const prefixes = new Map<string, string[]>();
  const unowned: string[] = [];
  for (const { path, why } of found) {
    const distribution = owners.get(path);
    const prefix = distribution === undefined ? prefixOf(tree, path) : null;
    if (distribution !== undefined) distributions.add(distribution);
    else if (prefix === null) unowned.push(`${path} (${why})`);
    else prefixes.set(prefix, [...(prefixes.get(prefix) ?? []), path]);
  }
  const interpreters = [...prefixes].map(([prefix, files]) => interpreterFor(tree, prefix, files, python));
  const refused = [
    ...unowned.map((path) => `${path}, which no Python distribution or interpreter in the tree installed`),
    ...interpreters.flatMap(({ refused: why }) => why),
    // A reinstall writes a distribution's packages into its folder, and nothing beside it or under `bin`.
    ...foreign.flatMap((path) => {
      const owner = owners.get(path);
      if (owner === undefined) return [];
      return path.startsWith(`${owner.site}/`) && !path.startsWith(`${join(owner.site, "bin")}/`)
        ? []
        : [
            `${path}, a compiled program of ${owner.requirement} outside its package folders, which a reinstall does not put back`,
          ];
    }),
    ...[...distributions].flatMap(({ requirement, python: version }) =>
      version === null ? [`${requirement}, whose Python version neither its folder nor its wheel names`] : [],
    ),
  ];
  if (refused.length > 0) throw refusal(place, refused);
  const stage = mkdtempSync(join(tmpdir(), "ana-foreign-python-"));
  try {
    // Where the place's minor has no build of a distribution, it is built for its own, as before.
    const staged = [...distributions].map((one, index) => {
      const into = join(stage, String(index));
      const at = minorOf(one) ?? "";
      const why = python.install(into, one.requirement, at);
      if (why === null || at === one.python) return { one, into, python: at, why };
      return {
        one,
        into: `${into}-own`,
        python: one.python,
        why: python.install(`${into}-own`, one.requirement, one.python ?? ""),
      };
    });
    const missing = staged.flatMap(({ one, why }) =>
      why === null ? [] : [`no build of ${one.requirement} (${why})`],
    );
    if (missing.length > 0) throw refusal(place, missing);
    for (const one of interpreters) one.apply();
    for (const { one, into } of staged) {
      // Its files for another machine or minor go; those under `bin` stay, as the copy leaves `bin` out.
      for (const [path, owner] of owners) {
        const own = path.startsWith(`${one.site}/`) && !path.startsWith(`${join(one.site, "bin")}/`);
        if (owner === one && (own || foreign.includes(path))) rmSync(join(tree, path), { force: true });
      }
      // A console script `--target` writes under its own `bin` names the installer's interpreter, and a
      // harness's programs never called one there.
      cpSync(into, join(tree, one.site), {
        recursive: true,
        verbatimSymlinks: true,
        filter: (from) => from !== join(into, "bin"),
      });
    }
    await foreignPrograms(tree, place);
    return {
      interpreters: interpreters.map(({ named }) => named),
      distributions: [
        ...new Set(
          staged.map(
            ({ one, python: at }) => `${one.requirement}${at === one.python ? "" : ` for CPython ${at}`}`,
          ),
        ),
      ].toSorted(),
    };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

/** Each folder of `tree` that distributions are installed into, relative to the tree, with the
 *  Python minors they were built for: what an export tells a solver whose own interpreter reads
 *  none of them. */
export async function packageFolders(tree: string) {
  const folders = new Map<string, Set<string>>();
  for (const { site, python } of new Set((await distributionsIn(tree)).values())) {
    const minors = folders.get(site) ?? new Set<string>();
    if (python !== null) minors.add(python);
    folders.set(site, minors);
  }
  return [...folders]
    .map(([site, minors]) => ({ site, pythons: [...minors].toSorted() }))
    .toSorted((a, b) => a.site.localeCompare(b.site));
}

/** Every file a `RECORD` in `tree` lists, relative to the tree, with the distribution that owns it. */
async function distributionsIn(tree: string): Promise<Map<string, Distribution>> {
  const owners = new Map<string, Distribution>();
  for await (const record of new Bun.Glob("**/*.dist-info/RECORD").scan({ cwd: tree, dot: true })) {
    const info = dirname(record);
    const site = dirname(info);
    const folder = basename(info, ".dist-info");
    const cut = folder.lastIndexOf("-");
    const wheel = existsSync(join(tree, info, "WHEEL"))
      ? readFileSync(join(tree, info, "WHEEL"), "utf8")
      : "";
    const named = /python(\d)\.(\d+)/u.exec(site);
    const [, major, minor] = named ?? /^Tag: cp(\d)(\d+)-/mu.exec(wheel) ?? [];
    const distribution = {
      site,
      requirement: `${folder.slice(0, cut)}==${folder.slice(cut + 1)}`,
      python: major === undefined || minor === undefined ? null : `${major}.${minor}`,
      named: named !== null,
    };
    for (const row of readFileSync(join(tree, record), "utf8").split("\n")) {
      const [, quoted, plain] = RECORD_PATH.exec(row) ?? [];
      const listed = quoted?.replaceAll('""', '"') ?? plain ?? "";
      if (listed !== "") owners.set(normalize(join(site, listed)), distribution);
    }
  }
  return owners;
}

/** The nearest folder above `path` in `tree` that is a CPython prefix, relative to the tree, or null. */
function prefixOf(tree: string, path: string): string | null {
  // The tree's own root among them: a Builder's `python -m venv .toolchain` makes it one.
  for (let dir = dirname(path); ; dir = dirname(dir)) {
    if (libraryOf(join(tree, dir)) !== null || venvOf(join(tree, dir)) !== null) return dir;
    if (dir === "." || dir === "/") return null;
  }
}

/** The Python version a virtual environment at `prefix` was made with (`version_info` as uv writes
 *  it, `version` as `venv` does), or null where `prefix` is none. */
function venvOf(prefix: string): string | null {
  const cfg = join(prefix, "pyvenv.cfg");
  if (!existsSync(cfg)) return null;
  return /^version(?:_info)?\s*=\s*(\d+\.\d+[\d.]*)/mu.exec(readFileSync(cfg, "utf8"))?.[1] ?? null;
}

/** `3.14` of `3.14.10`. */
const minorIn = (version: string) => version.split(".").slice(0, 2).join(".");

/** The `lib/pythonX.Y` folder name of a CPython prefix, or null where `prefix` is none. */
function libraryOf(prefix: string): string | null {
  const [os] = new Bun.Glob("lib/python[0-9].*/os.py").scanSync({ cwd: prefix });
  return os === undefined ? null : basename(dirname(os));
}

/** How the foreign interpreter at `prefix` is replaced from this machine's own, or why it cannot be. */
function interpreterFor(tree: string, prefix: string, files: readonly string[], python: PythonFor) {
  const at = join(tree, prefix);
  // A virtual environment (uv's or `venv`'s) links its interpreter to the machine it was made on;
  // given the place's CPython whole and its `pyvenv.cfg` dropped, it is a prefix of its own, whose
  // `site-packages` are the environment's.
  const venv = libraryOf(at) === null ? venvOf(at) : null;
  const library = libraryOf(at) ?? (venv === null ? "" : `python${minorIn(venv)}`);
  const header = join(at, "include", library, "patchlevel.h");
  const patch = existsSync(header)
    ? /PY_VERSION\s+"([^"]+)"/u.exec(readFileSync(header, "utf8"))?.[1]
    : undefined;
  const version = patch ?? venv ?? library.slice("python".length);
  const named = `${prefix} (CPython ${version})`;
  const host = python.interpreter(version) ?? (venv === null ? null : python.interpreter(minorIn(venv)));
  if (host === null) {
    return {
      named,
      refused: [`${named}, as uv installs no CPython ${version} built for it`],
      apply: () => undefined,
    };
  }
  // Each foreign file's stand-in is the host's executable of its name, or none, which only the
  // interpreter's own shared libraries may lack: those beside its `lib` and in `lib-dynload`. One
  // among its modules is a package, and dropping it would leave an import that fails.
  const modules = `${join(prefix, "lib", library)}/`;
  const own = (file: string) =>
    SHARED_LIBRARY.test(file) && (!file.startsWith(modules) || file.startsWith(`${modules}lib-dynload/`));
  const standIns = files.map((file) => {
    const executable = join(host, "bin", basename(file));
    if (existsSync(executable)) return { file, from: executable };
    const any = venv !== null && /^python[\d.]*$/u.test(basename(file));
    return { file, from: any ? join(host, "bin", library) : null };
  });
  const lacking = standIns.filter(({ file, from }) => from === null && !own(file)).map(({ file }) => file);
  const apply = () => {
    for (const { file } of standIns) rmSync(join(tree, file));
    if (venv !== null) rmSync(join(at, "pyvenv.cfg"));
    const theirs = join(host, "lib", library, "site-packages");
    // Only what the tree lacks: a file of the same path, the stdlib's own sources, keeps its bytes.
    cpSync(join(host, "lib"), join(at, "lib"), {
      recursive: true,
      force: false,
      verbatimSymlinks: true,
      filter: (from) => from !== theirs,
    });
    for (const { file, from } of standIns) {
      if (from !== null) copyFileSync(from, join(tree, file));
    }
  };
  return {
    named,
    refused: lacking.map(
      (file) => `${file}, a program of ${named} that this machine's CPython has no file named for`,
    ),
    apply,
  };
}

function refusal(place: Place, reasons: readonly string[]): PlatformRefusal {
  const shown = reasons.slice(0, 5).join("; ");
  return new PlatformRefusal(
    `the harness's programs cannot be made to run on ${place.name}: ${shown}${reasons.length > 5 ? `; and ${String(reasons.length - 5)} more` : ""}`,
  );
}

/** `uv` as `place`'s stand-in: a CPython and wheels built for the place's platform. */
export function uvPython(place: Place): PythonFor {
  const uv = hostTool("uv");
  const arch = place.machine === AARCH64 ? "aarch64" : "x86_64";
  const platform = `${arch}-${place.mac ? "apple-darwin" : "unknown-linux-gnu"}`;
  // Beside the Python a host is pinned to (`pinScript`), one folder a build. Installed by its key
  // and taken by its folder, since `uv python find` returns no interpreter this machine cannot run.
  const store = join(pinnedPythonDir(homedir()), "..", "versions");
  return {
    interpreter: (version) => {
      const key = `cpython-${version}-${place.mac ? "macos" : "linux"}-${arch}-${place.mac ? "none" : "gnu"}`;
      const { exitCode } = runSync([uv, "--no-config", "python", "install", "--no-bin", key], {
        env: { ...runtimeProcess.env, UV_PYTHON_INSTALL_DIR: store },
      });
      const prefix = join(store, key);
      return exitCode === 0 && libraryOf(prefix) !== null ? prefix : null;
    },
    install: (target, requirement, version) => {
      const { exitCode, stderr } = runSync([
        uv,
        "--no-config",
        "pip",
        "install",
        "--quiet",
        "--no-deps",
        "--only-binary",
        ":all:",
        "--target",
        target,
        "--python-version",
        version,
        "--python-platform",
        platform,
        requirement,
      ]);
      const said = decodeOutput(stderr).trim();
      if (exitCode === 0) return null;
      return said === "" ? `uv exited ${String(exitCode)}` : (said.split("\n").at(-1) ?? said);
    },
  };
}
