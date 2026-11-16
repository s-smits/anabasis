/**
 * A tool tree a campaign built on one machine, made to run on another. A Builder that wants Python
 * packages copies an interpreter and installs wheels into its `.toolchain`, so a tree built on a Mac
 * holds a CPython and compiled extension modules for the Mac, and on a Linux machine its programs
 * die at the first exec or import. On 16 November one promoted jobstat reference held a
 * python-build-standalone CPython 3.12.15 (executable, `libpython`, Tcl/Tk and three `lib-dynload`
 * modules) and 196 extension modules of numpy, scipy, pandas, statsmodels and wrapt, beside 5,106
 * Python files that run anywhere.
 *
 * Each program `foreignFiles` names (`foreignHead`, the rollout's own test) is put down to its owner:
 * - a file a distribution's `RECORD` lists: that distribution is installed again for this machine,
 *   the same name at the same version, without its dependencies, over its foreign files;
 * - otherwise a file inside a CPython prefix (one holding `lib/pythonX.Y/os.py`): that interpreter
 *   is replaced by the place's CPython of the same version, each executable by the one of its name
 *   and each foreign shared library dropped, and what that CPython's `lib` holds that the tree
 *   lacks (its own `libpython`, `lib-dynload` and `_sysconfigdata`) is added, its `site-packages`
 *   left out.
 * Nothing else changes: pure-Python distributions, the harness's own programs and its data keep their
 * bytes, and a tree with no foreign program is not touched. A program no owner accounts for, a
 * version with no CPython for the place, or a distribution with no build for it is refused whole
 * (`PlatformRefusal`), so no tree is written that fails at its first import.
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
  const foreign = (await foreignFiles(tree, place)).map(({ path }) => path);
  if (foreign.length === 0) return null;
  const owners = await distributionsIn(tree);
  const distributions = new Map<string, Distribution>();
  const prefixes = new Map<string, string[]>();
  const unowned: string[] = [];
  for (const path of foreign) {
    const distribution = owners.get(path);
    const prefix = distribution === undefined ? prefixOf(tree, path) : null;
    if (distribution !== undefined) distributions.set(distribution.requirement, distribution);
    else if (prefix === null) unowned.push(path);
    else prefixes.set(prefix, [...(prefixes.get(prefix) ?? []), path]);
  }
  const interpreters = [...prefixes].map(([prefix, files]) => interpreterFor(tree, prefix, files, python));
  const refused = [
    ...unowned.map((path) => `${path}, which no Python distribution or interpreter in the tree installed`),
    ...interpreters.flatMap(({ refused: why }) => why),
    ...[...distributions.values()].flatMap(({ requirement, python: version }) =>
      version === null ? [`${requirement}, whose Python version neither its folder nor its wheel names`] : [],
    ),
  ];
  if (refused.length > 0) throw refusal(place, refused);
  const stage = mkdtempSync(join(tmpdir(), "ana-foreign-python-"));
  try {
    const staged = [...distributions.values()].map((one, index) => {
      const into = join(stage, String(index));
      return { ...one, into, why: python.install(into, one.requirement, one.python ?? "") };
    });
    const missing = staged.flatMap(({ requirement, why }) =>
      why === null ? [] : [`no build of ${requirement} (${why})`],
    );
    if (missing.length > 0) throw refusal(place, missing);
    for (const one of interpreters) one.apply();
    for (const { site, into, requirement } of staged) {
      for (const path of foreign) if (owners.get(path)?.requirement === requirement) rmSync(join(tree, path));
      // A console script `--target` writes under its own `bin` names the installer's interpreter, and a
      // harness's programs never called one there.
      cpSync(into, join(tree, site), {
        recursive: true,
        verbatimSymlinks: true,
        filter: (from) => from !== join(into, "bin"),
      });
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  await foreignPrograms(tree, place);
  return {
    interpreters: interpreters.map(({ named }) => named),
    distributions: [...distributions.keys()].toSorted(),
  };
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
    const [, major, minor] = /python(\d)\.(\d+)/u.exec(site) ?? /^Tag: cp(\d)(\d+)-/mu.exec(wheel) ?? [];
    const distribution = {
      site,
      requirement: `${folder.slice(0, cut)}==${folder.slice(cut + 1)}`,
      python: major === undefined || minor === undefined ? null : `${major}.${minor}`,
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
  for (let dir = dirname(path); dir !== "." && dir !== "/"; dir = dirname(dir)) {
    if (libraryOf(join(tree, dir)) !== null) return dir;
  }
  return null;
}

/** The `lib/pythonX.Y` folder name of a CPython prefix, or null where `prefix` is none. */
function libraryOf(prefix: string): string | null {
  const [os] = new Bun.Glob("lib/python[0-9].*/os.py").scanSync({ cwd: prefix });
  return os === undefined ? null : basename(dirname(os));
}

/** How the foreign interpreter at `prefix` is replaced from this machine's own, or why it cannot be. */
function interpreterFor(tree: string, prefix: string, files: readonly string[], python: PythonFor) {
  const at = join(tree, prefix);
  const library = libraryOf(at) ?? "";
  const header = join(at, "include", library, "patchlevel.h");
  const patch = existsSync(header)
    ? /PY_VERSION\s+"([^"]+)"/u.exec(readFileSync(header, "utf8"))?.[1]
    : undefined;
  const version = patch ?? library.slice("python".length);
  const named = `${prefix} (CPython ${version})`;
  const host = python.interpreter(version);
  if (host === null) {
    return {
      named,
      refused: [`${named}, as uv installs no CPython ${version} built for it`],
      apply: () => undefined,
    };
  }
  // Each foreign file's stand-in is the host's executable of its name, or none, which only a shared
  // library may lack.
  const standIns = files.map((file) => {
    const executable = join(host, "bin", basename(file));
    return { file, from: existsSync(executable) ? executable : null };
  });
  const lacking = standIns
    .filter(({ file, from }) => from === null && !SHARED_LIBRARY.test(file))
    .map(({ file }) => file);
  const apply = () => {
    for (const { file } of standIns) rmSync(join(tree, file));
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
