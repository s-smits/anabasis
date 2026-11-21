import { afterAll, describe, expect, it } from "bun:test";
import { foreignPrograms } from "../src/harness/place.ts";
import {
  packageFolders,
  PlatformRefusal,
  type PythonFor,
  rebuildForeignPython,
} from "../studies/shared/foreign-python.ts";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";

const LINUX = { name: "a Linux machine", mac: false, machine: 62, roots: null };
const SITE = "py/cp312/lib/python3.12/site-packages";
/** The opening of an arm64 Mach-O file, and of an x86-64 ELF one with `tag` after it. */
const MACH_O = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0, 0, 0x01]);
const elf = (tag: string) => {
  const bytes = Buffer.alloc(20);
  bytes.writeUInt32BE(0x7f_45_4c_46, 0);
  bytes.writeUInt16LE(62, 18);
  return Buffer.concat([bytes, Buffer.from(tag)]);
};

const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-foreign-python-test-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function put(dir: string, files: Readonly<Record<string, string | Buffer>>): void {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body, { mode: 0o755 });
  }
}

/** A tool tree as a Builder on a Mac leaves one: a copied CPython, a compiled distribution and a
 *  pure one in its site packages, the harness's own programs, and `extra`. */
function macTree(name: string, extra: Readonly<Record<string, string | Buffer>> = {}): string {
  const tree = join(root, name);
  put(tree, {
    "bin/python3": '#!/bin/sh\nexec "$(dirname "$0")/../py/cp312/pyexe/python3.12" "$@"\n',
    "lib/py/stats.py": "print('stats')\n",
    "py/cp312/pyexe/python3.12": MACH_O,
    "py/cp312/include/python3.12/patchlevel.h": '#define PY_VERSION              "3.12.15"\n',
    "py/cp312/lib/libpython3.12.dylib": MACH_O,
    "py/cp312/lib/python3.12/os.py": "# os\n",
    "py/cp312/lib/python3.12/lib-dynload/_dbm.cpython-312-darwin.so": MACH_O,
    [`${SITE}/numpy/__init__.py`]: "# numpy 2.5.4\n",
    [`${SITE}/numpy/_core.cpython-312-darwin.so`]: MACH_O,
    [`${SITE}/numpy-2.5.4.dist-info/WHEEL`]: "Tag: cp312-cp312-macosx_14_0_arm64\n",
    [`${SITE}/numpy-2.5.4.dist-info/RECORD`]:
      "numpy/__init__.py,sha256=a,14\nnumpy/_core.cpython-312-darwin.so,sha256=b,8\nnumpy-2.5.4.dist-info/RECORD,,\n",
    [`${SITE}/six.py`]: "# six\n",
    [`${SITE}/six-1.17.0.dist-info/RECORD`]: "six.py,sha256=c,6\nsix-1.17.0.dist-info/RECORD,,\n",
    ...extra,
  });
  return tree;
}

/** A managed CPython 3.12.15 for Linux, as `uv python install` lays one out. */
const host = join(root, "host-python");
put(host, {
  "bin/python3.12": elf("host python"),
  "lib/libpython3.12.so.1.0": elf("host libpython"),
  "lib/python3.12/os.py": "# the host's os\n",
  "lib/python3.12/_sysconfigdata__linux_x86_64-linux-gnu.py": "build_time_vars = {}\n",
  "lib/python3.12/site-packages/pip/__init__.py": "# pip\n",
});

/** An installer that has a Linux build of every distribution but those in `missing`, and the calls
 *  it was given. */
function standIn(missing: readonly string[] = [], interpreter: string | null = host) {
  const asked: string[] = [];
  const python: PythonFor = {
    interpreter: (version) => {
      asked.push(`interpreter ${version}`);
      return interpreter;
    },
    install: (target, requirement, version) => {
      asked.push(`install ${requirement} for ${version}`);
      if (missing.includes(requirement)) return `no wheel for ${requirement}`;
      put(target, {
        "numpy/__init__.py": "# numpy 2.5.4\n",
        "numpy/_core.cpython-312-x86_64-linux-gnu.so": elf("numpy core"),
        "numpy-2.5.4.dist-info/RECORD": "numpy/__init__.py,sha256=a,14\n",
        "bin/f2py": "#!/tmp/somewhere/python\n",
      });
      return null;
    },
  };
  return { python, asked };
}

describe("a tool tree built on a Mac, made to run on Linux", () => {
  it("replaces the interpreter and the compiled distribution at their versions and leaves every other file's bytes", async () => {
    const tree = macTree("every-build");
    const kept = ["bin/python3", "lib/py/stats.py", "py/cp312/lib/python3.12/os.py", `${SITE}/six.py`];
    const before = kept.map((path) => readFileSync(join(tree, path)));
    const { python, asked } = standIn();
    expect(await rebuildForeignPython(tree, LINUX, python)).toStrictEqual({
      interpreters: ["py/cp312 (CPython 3.12.15)"],
      distributions: ["numpy==2.5.4"],
    });
    expect(asked).toStrictEqual(["interpreter 3.12.15", "install numpy==2.5.4 for 3.12"]);
    expect(kept.map((path) => readFileSync(join(tree, path)))).toStrictEqual(before);
    expect(readFileSync(join(tree, "py/cp312/pyexe/python3.12"))).toStrictEqual(elf("host python"));
    expect(statSync(join(tree, "py/cp312/pyexe/python3.12")).mode & 0o111).not.toBe(0);
    expect(existsSync(join(tree, "py/cp312/lib/libpython3.12.so.1.0"))).toBe(true);
    expect(existsSync(join(tree, "py/cp312/lib/python3.12/_sysconfigdata__linux_x86_64-linux-gnu.py"))).toBe(
      true,
    );
    expect(existsSync(join(tree, `${SITE}/numpy/_core.cpython-312-x86_64-linux-gnu.so`))).toBe(true);
    // The host's own packages, and the console scripts `--target` writes, stay out of the tree.
    expect(existsSync(join(tree, `${SITE}/pip`))).toBe(false);
    expect(existsSync(join(tree, `${SITE}/bin`))).toBe(false);
    await foreignPrograms(tree, LINUX);
  });

  it("replaces an interpreter's program that links out of the tree, and leaves what it linked to as it was", async () => {
    const tree = macTree("prefix-link");
    const outside = join(root, "a-mac-python3.12");
    writeFileSync(outside, MACH_O);
    rmSync(join(tree, "py/cp312/pyexe/python3.12"));
    symlinkSync(outside, join(tree, "py/cp312/pyexe/python3.12"));
    await rebuildForeignPython(tree, LINUX, standIn().python);
    expect(lstatSync(join(tree, "py/cp312/pyexe/python3.12")).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(tree, "py/cp312/pyexe/python3.12"))).toStrictEqual(elf("host python"));
    expect(readFileSync(outside)).toStrictEqual(MACH_O);
    await foreignPrograms(tree, LINUX);
  });

  it("makes an environment that links out to its maker's interpreter a prefix of its own", async () => {
    // uv's `.venv` beside the harness's programs, and `python -m venv` making the tool tree one.
    const layouts = [
      { name: "uv-venv", at: ".venv", cfg: "version_info = 3.12.15", interpreter: ".venv (CPython 3.12.15)" },
      { name: "tree-venv", at: ".", cfg: "version = 3.12.15", interpreter: ". (CPython 3.12.15)" },
    ];
    for (const { name, at, cfg, interpreter } of layouts) {
      const tree = join(root, name);
      const env = join(tree, at);
      const site = join(env, "lib/python3.12/site-packages");
      put(tree, { "lib/py/stats.py": "print('stats')\n" });
      put(env, { "pyvenv.cfg": `home = /Users/someone/python/bin\n${cfg}\n` });
      put(site, {
        "numpy/_core.cpython-312-darwin.so": MACH_O,
        "numpy-2.5.4.dist-info/RECORD": "numpy/_core.cpython-312-darwin.so,,\n",
      });
      const outside = join(root, `${name}-python3.12`);
      writeFileSync(outside, MACH_O);
      mkdirSync(join(env, "bin"), { recursive: true });
      symlinkSync(outside, join(env, "bin/python3.12"));
      symlinkSync("python3.12", join(env, "bin/python3"));
      const { python, asked } = standIn();
      expect(await rebuildForeignPython(tree, LINUX, python)).toStrictEqual({
        interpreters: [interpreter],
        distributions: ["numpy==2.5.4"],
      });
      expect(asked).toStrictEqual(["interpreter 3.12.15", "install numpy==2.5.4 for 3.12"]);
      expect(readFileSync(join(env, "bin/python3"))).toStrictEqual(elf("host python"));
      expect(existsSync(join(env, "pyvenv.cfg"))).toBe(false);
      expect(existsSync(join(env, "lib/python3.12/os.py"))).toBe(true);
      expect(existsSync(join(site, "pip"))).toBe(false);
      expect(readFileSync(join(tree, "lib/py/stats.py"), "utf8")).toBe("print('stats')\n");
      expect(readFileSync(outside)).toStrictEqual(MACH_O);
      await foreignPrograms(tree, LINUX);
    }
  });

  it("refuses whole, naming each, a distribution with no build here, a version with no interpreter here and a program nothing installed", async () => {
    const tree = macTree("no-build");
    const original = readFileSync(join(tree, `${SITE}/numpy/_core.cpython-312-darwin.so`));
    const { python } = standIn(["numpy==2.5.4"]);
    const refused = rebuildForeignPython(tree, LINUX, python);
    await expect(refused).rejects.toBeInstanceOf(PlatformRefusal);
    await expect(refused).rejects.toThrow(
      /on a Linux machine: no build of numpy==2\.5\.4 \(no wheel for numpy==2\.5\.4\)$/u,
    );
    // Refused before anything moved: the Mac's interpreter and module are where they were.
    expect(readFileSync(join(tree, "py/cp312/pyexe/python3.12"))).toStrictEqual(MACH_O);
    expect(readFileSync(join(tree, `${SITE}/numpy/_core.cpython-312-darwin.so`))).toStrictEqual(original);

    const lone = macTree("no-interpreter", { "tools/fast": MACH_O });
    const bare = standIn([], null);
    await expect(rebuildForeignPython(lone, LINUX, bare.python)).rejects.toThrow(
      /tools\/fast \(a Mach-O binary\), which no Python distribution or interpreter in the tree installed; py\/cp312 \(CPython 3\.12\.15\), as uv installs no CPython 3\.12\.15 built for it$/u,
    );
    expect(bare.asked).toStrictEqual(["interpreter 3.12.15"]);

    // A virtual environment whose interpreter is a link to the Mac's own: no interpreter in the tree
    // owns it, so the tree is refused whole, naming the link.
    const venv = macTree("venv-link");
    mkdirSync(join(venv, "venv", "bin"), { recursive: true });
    symlinkSync("/opt/somewhere/bin/python3.14", join(venv, "venv", "bin", "python3.14"));
    await expect(rebuildForeignPython(venv, LINUX, standIn().python)).rejects.toThrow(
      /venv\/bin\/python3\.14 \(a link to \/opt\/somewhere\/bin\/python3\.14, outside the tree\), which no Python distribution or interpreter in the tree installed/u,
    );
  });

  it("refuses a compiled file no reinstall would put back, and refills a distribution in each folder that holds it", async () => {
    // A module no `RECORD` lists, among the installed packages: dropped as a shared library, it
    // would be gone at the first import.
    const stray = macTree("stray-module", { [`${SITE}/fastmath.cpython-312-darwin.so`]: MACH_O });
    await expect(rebuildForeignPython(stray, LINUX, standIn().python)).rejects.toThrow(
      /site-packages\/fastmath\.cpython-312-darwin\.so, a program of py\/cp312 \(CPython 3\.12\.15\)/u,
    );
    expect(readFileSync(join(stray, "py/cp312/pyexe/python3.12"))).toStrictEqual(MACH_O);

    // A distribution's compiled program under `bin`, which the reinstall leaves out.
    const program = macTree("bin-program", {
      [`${SITE}/bin/f2py`]: MACH_O,
      [`${SITE}/numpy-2.5.4.dist-info/RECORD`]:
        "numpy/__init__.py,sha256=a,14\nnumpy/_core.cpython-312-darwin.so,sha256=b,8\nbin/f2py,sha256=d,8\n",
    });
    await expect(rebuildForeignPython(program, LINUX, standIn().python)).rejects.toThrow(
      /bin\/f2py, a compiled program of numpy==2\.5\.4 outside its package folders/u,
    );
    expect(readFileSync(join(program, `${SITE}/bin/f2py`))).toStrictEqual(MACH_O);

    const other = "vendor/site";
    const twice = macTree("two-folders", {
      [`${other}/numpy/_core.cpython-312-darwin.so`]: MACH_O,
      [`${other}/numpy-2.5.4.dist-info/WHEEL`]: "Tag: cp312-cp312-macosx_14_0_arm64\n",
      [`${other}/numpy-2.5.4.dist-info/RECORD`]: "numpy/_core.cpython-312-darwin.so,sha256=b,8\n",
    });
    const { python, asked } = standIn();
    expect((await rebuildForeignPython(twice, LINUX, python))?.distributions).toStrictEqual(["numpy==2.5.4"]);
    expect(
      [SITE, other].map((site) =>
        existsSync(join(twice, site, "numpy/_core.cpython-312-x86_64-linux-gnu.so")),
      ),
    ).toStrictEqual([true, true]);
    expect(asked.filter((call) => call.startsWith("install"))).toHaveLength(2);
  });

  it("builds a folder that names no minor for the place's python3, and one that names its minor for that", async () => {
    // As a reference with no interpreter of its own leaves it: a launcher that takes the machine's
    // `python3` with a flat `--target` folder of wheels for its campaign's 3.14, and a second folder
    // laid out for 3.14 by name.
    const flat = (name: string) => {
      const tree = join(root, name);
      put(tree, {
        "bin/python3": '#!/bin/sh\nPYTHONPATH="$(dirname "$0")/../pylib" exec python3 "$@"\n',
        "pylib/numpy/_core.cpython-314-darwin.so": MACH_O,
        "pylib/numpy-2.5.4.dist-info/WHEEL": "Tag: cp314-cp314-macosx_11_0_arm64\n",
        "pylib/numpy-2.5.4.dist-info/RECORD": "numpy/_core.cpython-314-darwin.so,,\n",
        "lib/python3.14/site-packages/wrapt/_w.cpython-314-darwin.so": MACH_O,
        "lib/python3.14/site-packages/wrapt-2.0.dist-info/RECORD": "wrapt/_w.cpython-314-darwin.so,,\n",
      });
      return tree;
    };
    const runs = { ...LINUX, python: "3.12" };
    const { python, asked } = standIn();
    expect(await rebuildForeignPython(flat("flat-for-place"), runs, python)).toStrictEqual({
      interpreters: [],
      distributions: ["numpy==2.5.4", "wrapt==2.0"],
    });
    expect(asked.toSorted()).toStrictEqual(["install numpy==2.5.4 for 3.12", "install wrapt==2.0 for 3.14"]);
    // Where the place's minor has no build, the export is refused whole and the tree keeps its bytes.
    const none: PythonFor = {
      interpreter: () => null,
      install: (_target, _requirement, version) => (version === "3.12" ? "no wheel for 3.12" : null),
    };
    const refused = flat("flat-none");
    const before = readFileSync(join(refused, "pylib/numpy/_core.cpython-314-darwin.so"));
    await expect(rebuildForeignPython(refused, runs, none)).rejects.toThrow(
      /no build of numpy==2\.5\.4 \(no wheel for 3\.12\)/u,
    );
    expect(readFileSync(join(refused, "pylib/numpy/_core.cpython-314-darwin.so"))).toStrictEqual(before);
    // Wheels already built for the place's system, but for another minor than its python3, as a
    // Builder installs with `--python-platform`: installed again for that minor, the old files gone.
    const native = (name: string) => {
      const tree = join(root, name);
      put(tree, {
        "pylib/numpy/__init__.py": "# numpy 2.5.4\n",
        "pylib/numpy/_core.cpython-314-x86_64-linux-gnu.so": elf("numpy 314"),
        "pylib/numpy-2.5.4.dist-info/WHEEL": "Tag: cp314-cp314-manylinux_2_27_x86_64\n",
        "pylib/numpy-2.5.4.dist-info/RECORD":
          "numpy/__init__.py,,\nnumpy/_core.cpython-314-x86_64-linux-gnu.so,,\nnumpy-2.5.4.dist-info/RECORD,,\n",
      });
      return tree;
    };
    const moved = native("native-other-minor");
    expect(await rebuildForeignPython(moved, runs, standIn().python)).toStrictEqual({
      interpreters: [],
      distributions: ["numpy==2.5.4"],
    });
    expect(
      ["_core.cpython-314-x86_64-linux-gnu.so", "_core.cpython-312-x86_64-linux-gnu.so"].map((file) =>
        existsSync(join(moved, "pylib/numpy", file)),
      ),
    ).toStrictEqual([false, true]);
    expect(await rebuildForeignPython(native("native-unknown-minor"), LINUX, standIn().python)).toBeNull();
    // A tree that carries its own interpreter of the folder's minor reads it with that one.
    const own = macTree("flat-with-own", {
      "pylib/numpy/_core.cpython-312-darwin.so": MACH_O,
      "pylib/numpy-2.5.4.dist-info/WHEEL": "Tag: cp312-cp312-macosx_11_0_arm64\n",
      "pylib/numpy-2.5.4.dist-info/RECORD": "numpy/_core.cpython-312-darwin.so,,\n",
    });
    const carried = standIn();
    await rebuildForeignPython(own, { ...LINUX, python: "3.14" }, carried.python);
    expect(carried.asked.filter((call) => call.startsWith("install"))).toStrictEqual([
      "install numpy==2.5.4 for 3.12",
      "install numpy==2.5.4 for 3.12",
    ]);
  });

  it("touches nothing and asks nothing of a tree whose programs already run here", async () => {
    const tree = join(root, "native");
    put(tree, { "bin/tool": elf("native"), [`${SITE}/six.py`]: "# six\n" });
    const { python, asked } = standIn();
    expect(await rebuildForeignPython(tree, LINUX, python)).toBeNull();
    expect(asked).toStrictEqual([]);
  });
});

describe("the folders a tool tree keeps its packages in", () => {
  it("names each with the Python its wheels were built for, and none in a tree that installed nothing", async () => {
    const tree = join(root, "pointed");
    put(tree, {
      "bin/python3": "#!/bin/sh\nexec /somewhere/else/python3.14\n",
      "pylib/own.py": "# the harness's module\n",
      "pylib/fast-1.0.dist-info/RECORD": "fast/core.so,,\n",
      "pylib/fast-1.0.dist-info/WHEEL": "Tag: cp314-cp314-macosx_11_0_arm64\n",
      "pylib/plain-2.0.dist-info/RECORD": "plain.py,,\n",
      "pylib/plain-2.0.dist-info/WHEEL": "Tag: py3-none-any\n",
    });
    expect(await packageFolders(tree)).toStrictEqual([{ site: "pylib", pythons: ["3.14"] }]);
    const bare = join(root, "no-packages");
    put(bare, { "bin/tool": "#!/bin/sh\n" });
    expect(await packageFolders(bare)).toStrictEqual([]);
  });
});
