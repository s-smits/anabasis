/**
 * A tool tree a campaign built on one machine, made to run on another: a tree built on a Mac holds
 * a CPython and compiled extension modules for the Mac, whose programs die at the first exec or
 * import on Linux. Each foreign program `foreignFiles` names is put down to its owner. A file a
 * distribution's `RECORD` lists: that distribution is installed again for this machine, same name
 * and version, without dependencies. Otherwise a file inside a CPython prefix (one holding
 * `lib/pythonX.Y/os.py` or a `pyvenv.cfg`, the tree's root included): that interpreter is replaced
 * by the place's CPython of the same version, foreign shared libraries dropped and its missing
 * `libpython`, `lib-dynload` and `_sysconfigdata` added. A compiled distribution in a flat
 * `--target` folder is reinstalled for the place's minor (`Place.python`), since wheels of 3.14
 * import only some of their modules under 3.12. Pure-Python distributions and the harness's own
 * programs keep their bytes. A program no owner accounts for, a version or distribution with no
 * build for the place, or a compiled file no reinstall puts back is refused whole
 * (`PlatformRefusal`) before anything moves. The place is the machine that will roll the tree, not
 * the exporter; `uv` does both jobs (`uvPython`), as it pins a host's Python (`pinScript`,
 * `tools/runs/sync.ts`), and a test stands in for it through `PythonFor`.
 */
import { copyFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "#src/meta/filesystem.ts";
import { TOOL_TREE_ENV } from "#src/meta/bundle-layout.ts";
import { hostTool } from "#src/meta/host-tool.ts";
import { homedir, tmpdir } from "#src/meta/os.ts";
import { basename, dirname, join, normalize, relative } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { decodeOutput, runSync } from "#src/meta/subprocess.ts";
import { pinnedPythonDir } from "#src/sandbox/policy.ts";
import { AARCH64, foreignFiles, foreignPrograms, type Place } from "#src/harness/place.ts";

export interface PythonFor {
  readonly interpreter: (version: string) => string | null;
  /** Installs `requirement` for Python `python` into `target` without its dependencies; returns why
   *  it could not, or null once installed. */
  readonly install: (target: string, requirement: string, python: string) => string | null;
}

interface Rebuilt {
  readonly interpreters: readonly string[];
  readonly distributions: readonly string[];
}

interface Distribution {
  readonly site: string;
  readonly requirement: string;
  readonly python: string | null;
  readonly named: boolean;
}

/** No machine loads a shared library under another's suffix, so one dropped breaks nothing. */
const SHARED_LIBRARY = /\.(?:so(?:\.\d+)*|dylib|dll|pyd)$/u;

const RECORD_PATH = /^(?:"((?:[^"]|"")*)"|([^,]*))/u;

export class PlatformRefusal extends Error {}

/** Makes the tool tree `tree` run on `place`, in place; returns what it replaced, or null where
 *  nothing needed it. */
export async function rebuildForeignPython(
  tree: string,
  place: Place,
  python: PythonFor,
): Promise<Rebuilt | null> {
  if (!existsSync(tree)) return null;
  const found = await foreignFiles(tree, place);
  const foreign = found.map(({ path }) => path);
  const owners = await distributionsIn(tree);
  const carried = new Set(
    [...new Bun.Glob("**/lib/python[0-9].*/os.py").scanSync({ cwd: tree, dot: true })].map((os) =>
      basename(dirname(os)).slice("python".length),
    ),
  );
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
    ...unowned.map((entry) =>
      entry.startsWith(`${TOOL_TREE_ENV} (`)
        ? entry
        : `${entry}, which no Python distribution or interpreter in the tree installed`,
    ),
    ...interpreters.flatMap(({ refused: why }) => why),
    // A reinstall writes a distribution's packages into its folder, and nothing beside it or under `bin`.
    ...foreign.flatMap((path) => {
      const owner = owners.get(path);
      if (owner === undefined) return [];
      return inFolder(path, owner)
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
    const staged = [...distributions].map((one, index) => {
      const into = join(stage, String(index));
      return { one, into, why: python.install(into, one.requirement, minorOf(one) ?? "") };
    });
    const missing = staged.flatMap(({ one, why }) =>
      why === null ? [] : [`no build of ${one.requirement} (${why})`],
    );
    if (missing.length > 0) throw refusal(place, missing);
    for (const one of interpreters) one.apply();
    for (const { one, into } of staged) {
      // Its files for another machine or minor go; those under `bin` stay, as the copy leaves `bin` out.
      for (const [path, owner] of owners) {
        if (owner === one && inFolder(path, one)) rmSync(join(tree, path), { force: true });
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
      distributions: [...new Set(staged.map(({ one }) => one.requirement))].toSorted(),
    };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

/** Whether `path` lies in the package folders of `site`, which a reinstall writes: inside it and not
 *  under its `bin`. `site` is `.` for a folder at the tree's root. */
function inFolder(path: string, { site }: Distribution) {
  const inside = relative(site, path);
  return !inside.startsWith("../") && !inside.startsWith("bin/");
}

/** The tree's package folders with the Python minors they were built for: what an export tells a
 *  solver whose own interpreter reads none of them. */
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

function prefixOf(tree: string, path: string): string | null {
  // The tree's own root among them: a Builder's `python -m venv .toolchain` makes it one.
  for (let dir = dirname(path); ; dir = dirname(dir)) {
    if (libraryOf(join(tree, dir)) !== null || venvOf(join(tree, dir)) !== null) return dir;
    if (dir === "." || dir === "/") return null;
  }
}

/** `version_info` as uv writes it, `version` as `venv` does. */
function venvOf(prefix: string): string | null {
  const cfg = join(prefix, "pyvenv.cfg");
  if (!existsSync(cfg)) return null;
  return /^version(?:_info)?\s*=\s*(\d+(?:\.\d+)+)/mu.exec(readFileSync(cfg, "utf8"))?.[1] ?? null;
}

function libraryOf(prefix: string): string | null {
  const [os] = new Bun.Glob("lib/python[0-9].*/os.py").scanSync({ cwd: prefix });
  return os === undefined ? null : basename(dirname(os));
}

function interpreterFor(tree: string, prefix: string, files: readonly string[], python: PythonFor) {
  const at = join(tree, prefix);
  // A virtual environment (uv's or `venv`'s) links its interpreter to the machine it was made on;
  // given the place's CPython whole and its `pyvenv.cfg` dropped, it is a prefix of its own, whose
  // `site-packages` are the environment's.
  const lib = libraryOf(at);
  const venv = lib === null ? venvOf(at) : null;
  const library = lib ?? `python${(venv ?? "").split(".").slice(0, 2).join(".")}`;
  const header = join(at, "include", library, "patchlevel.h");
  const patch = existsSync(header)
    ? /PY_VERSION\s+"([^"]+)"/u.exec(readFileSync(header, "utf8"))?.[1]
    : undefined;
  const version = patch ?? venv ?? library.slice("python".length);
  const named = `${prefix} (CPython ${version})`;
  const host = python.interpreter(version);
  if (host === null) {
    return {
      named,
      refused: [`${named}, as uv installs no CPython ${version} built for it`],
      apply: () => undefined,
    };
  }
  // Each foreign file's stand-in is the host's executable of its name, or none, which only the
  // interpreter's own shared libraries may lack: those beside its `lib` and in `lib-dynload`.
  const modules = `${join(prefix, "lib", library)}/`;
  const own = (file: string) =>
    SHARED_LIBRARY.test(file) && (!file.startsWith(modules) || file.startsWith(`${modules}lib-dynload/`));
  const standIns = files.map((file) => {
    const executable = join(host, "bin", basename(file));
    return { file, from: existsSync(executable) ? executable : null };
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

export function uvPython(place: Place): PythonFor {
  const uv = hostTool("uv");
  const arch = place.machine === AARCH64 ? "aarch64" : "x86_64";
  const platform = `${arch}-${place.mac ? "apple-darwin" : "unknown-linux-gnu"}`;
  // Beside the Python a host is pinned to (`pinScript`), one folder a build. Taken by its folder, since
  // `uv python find` returns no interpreter this machine cannot run.
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
