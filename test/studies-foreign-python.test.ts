import { afterAll, describe, expect, it } from "bun:test";
import { foreignPrograms } from "../studies/shared/bundle.ts";
import { PlatformRefusal, type PythonFor, rebuildForeignPython } from "../studies/shared/foreign-python.ts";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
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
      /tools\/fast, which no Python distribution or interpreter in the tree installed; py\/cp312 \(CPython 3\.12\.15\), as this machine has no managed CPython 3\.12\.15$/u,
    );
    expect(bare.asked).toStrictEqual(["interpreter 3.12.15"]);
  });

  it("touches nothing and asks nothing of a tree whose programs already run here", async () => {
    const tree = join(root, "native");
    put(tree, { "bin/tool": elf("native"), [`${SITE}/six.py`]: "# six\n" });
    const { python, asked } = standIn();
    expect(await rebuildForeignPython(tree, LINUX, python)).toBeNull();
    expect(asked).toStrictEqual([]);
  });
});
