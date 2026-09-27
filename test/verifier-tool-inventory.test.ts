/**
 * Which executable a tool id resolves to, and what survives that resolution.
 *
 * `resolveToolInventory` is the first decision the verifier host makes and the one every later
 * row cites: the workspace toolchain before the host path, the kind and interpreter of each
 * program, and the exact command selected — which a Git hardlink or a symlink can otherwise
 * quietly replace with another name's bytes between inventory, wall preparation and execution.
 */
import { afterAll, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";

import { verifierEnvironmentHashOfTools } from "../src/correctness-bundle/verifier-environment.ts";
import { chmodSync, mkdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { sha256OfFile } from "../src/meta/digest.ts";
import { isString } from "../src/meta/json-shape.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { join } from "../src/meta/path.ts";
import { createVerifierHost } from "../src/verify/host.ts";
import { TOOL_ID_RE, resolveToolInventory } from "../src/verify/tool-inventory.ts";
import { commandSearchPath, toolTreeSearchDirs } from "../src/verify/solve-command-isolation.ts";
import { prepareVerifierReads } from "../src/verify/darwin-seatbelt.ts";
import { exactReadDrift } from "../src/verify/exact-read-attestation.ts";
import { createVerifierLifetime } from "../src/verify/verifier-lifetime.ts";
import { required } from "./helpers/doubles.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { TOOL_PATH, runOnce, script, subject, workspace } from "./helpers/verifier-host.ts";

afterAll(cleanupScratch);

/** Redirect one lookup while retaining native realpath's string/Buffer overloads. */
function redirectRealpath(selected: string, alias: string) {
  const { native } = fs.realpathSync;
  function redirected(path: fs.PathLike, options?: fs.EncodingOption): string;
  function redirected(path: fs.PathLike, options: fs.BufferEncodingOption): Buffer<ArrayBuffer>;
  function redirected(path: fs.PathLike, options?: fs.EncodingOption): string | Buffer<ArrayBuffer>;
  function redirected(
    path: fs.PathLike,
    options?: fs.EncodingOption | fs.BufferEncodingOption,
  ): string | Buffer<ArrayBuffer> {
    const target = path === selected ? alias : path;
    if (options === "buffer") return native(target, "buffer");
    if (!isString(options) && options?.encoding === "buffer") return native(target, { encoding: "buffer" });
    return native(target, options);
  }
  return spyOn(fs.realpathSync, "native").mockImplementation(redirected);
}

describe("resolving the tool inventory", () => {
  it("records what kind of executable each tool is: a shebang script names its interpreter, a binary names none", () => {
    // The 2026-09-04/05 truss and firmware runs verified through 179- and 290-line Python scripts
    // the Builder wrote under `.toolchain/bin`; a claim naming only a digest could not say so.
    const ws = workspace();
    const bin = join(ws.toolTree, "bin");
    script(bin, "sh-tool", ["exit 0"]);
    const python = join(bin, "py-tool");
    writeFileSync(python, "#!/usr/bin/env python3\nimport sys\nsys.exit(0)\n");
    chmodSync(python, 0o755);
    // Cover an absolute Python path as used by a virtual environment, plus `env` flags and
    // assignments before the interpreter command. These are inventory checks, not executions.
    const venv = join(bin, "venv-tool");
    writeFileSync(venv, "#!/Users/someone/.venv/bin/python\nimport sys\n");
    chmodSync(venv, 0o755);
    const envS = join(bin, "env-s-tool");
    writeFileSync(envS, "#!/usr/bin/env -S PYTHONUNBUFFERED=1 python3 -u\r\nimport sys\n");
    chmodSync(envS, 0o755);
    const resolved = resolveToolInventory({
      toolIds: ["sh-tool", "py-tool", "venv-tool", "env-s-tool", "cat"],
      toolTree: ws.toolTree,
      pathDirs: ["/bin"],
    });
    expect(resolved.inventory["sh-tool"]).toMatchObject({
      source: "workspace-toolchain",
      kind: "script",
      interpreter: "sh",
    });
    expect(resolved.inventory["py-tool"]).toMatchObject({
      source: "workspace-toolchain",
      kind: "script",
      interpreter: "python3",
    });
    expect(resolved.inventory["venv-tool"]).toMatchObject({ kind: "script", interpreter: "python" });
    expect(resolved.inventory["env-s-tool"]).toMatchObject({ kind: "script", interpreter: "python3" });
    expect(resolved.inventory.cat).toMatchObject({ source: "host", kind: "binary", interpreter: null });
  });

  it("lists the Python distributions beside a script's interpreter, and none for a shell script or a binary", () => {
    const ws = workspace();
    const venvBin = join(ws.toolTree, "venv", "bin");
    const python = script(venvBin, "python3", ["exit 0"]);
    const sitePackages = join(ws.toolTree, "venv", "lib", "python3.12", "site-packages");
    for (const dir of ["openseespy-3.5.1.dist-info", "numpy-2.1.0.dist-info", "numpy", "__pycache__"]) {
      mkdirSync(join(sitePackages, dir), { recursive: true });
    }
    const bin = join(ws.toolTree, "bin");
    const wrapper = join(bin, "frame-check");
    mkdirSync(bin, { recursive: true });
    writeFileSync(wrapper, `#!${python}\nimport openseespy\n`);
    chmodSync(wrapper, 0o755);
    script(bin, "sh-tool", ["exit 0"]);
    const resolved = resolveToolInventory({
      toolIds: ["frame-check", "sh-tool", "cat"],
      toolTree: ws.toolTree,
      pathDirs: ["/bin"],
    });
    expect(resolved.inventory["frame-check"]?.packages).toEqual(["numpy==2.1.0", "openseespy==3.5.1"]);
    expect(resolved.inventory["sh-tool"]).not.toHaveProperty("packages");
    expect(resolved.inventory.cat).not.toHaveProperty("packages");
  });

  // One program search for the inventory, the check cell and the Built shell (2026-09-16): a program
  // installed under .toolchain/home/.local/bin is on every one of them, after .toolchain/bin.
  it("searches the same nested program directories for checks and the solver shell", () => {
    const tree = scratchDir("ana-tree-");
    const nested = join(tree, "home", ".local", "bin");
    const hidden = join(tree, "lib", "node_modules", "pkg", "bin");
    for (const dir of [join(tree, "bin"), nested, hidden]) mkdirSync(dir, { recursive: true });
    for (const path of [join(nested, "nested-tool"), join(hidden, "hidden-tool")]) {
      writeFileSync(path, "#!/bin/sh\nexit 0\n");
      chmodSync(path, 0o755);
    }
    expect(toolTreeSearchDirs(tree)).toEqual([join(tree, "bin"), nested]);
    expect(commandSearchPath(tree).split(":").slice(0, 2)).toEqual([join(tree, "bin"), nested]);
    const resolved = resolveToolInventory({
      toolIds: ["nested-tool", "hidden-tool"],
      toolTree: tree,
      pathDirs: [],
    });
    expect(resolved.inventory["nested-tool"]).toMatchObject({
      source: "workspace-toolchain",
      path: join(nested, "nested-tool"),
    });
    expect(resolved.missing).toEqual(["hidden-tool"]);
    expect(toolTreeSearchDirs(join(tree, "absent"))).toEqual([]);
  });

  it.skipIf(runtimeProcess.platform !== "darwin")(
    "runs Apple's selected compiler under the wall despite a Git hardlink realpath",
    async () => {
      const realpath = redirectRealpath("/usr/bin/cc", "/usr/bin/git");
      try {
        const resolved = resolveToolInventory({ toolIds: ["cc"], toolTree: null, pathDirs: ["/usr/bin"] });
        const host = createVerifierHost({
          inventory: resolved.inventory,
          parentEnv: { PATH: TOOL_PATH },
          lifetime: createVerifierLifetime({ root: scratchDir("ana-host-compiler-") }),
        });
        for (const source of ["int main(void) { return 0; }", "invalid C source"]) {
          const result = await runOnce(host, subject({ source }), {
            toolId: "cc",
            checkId: "compile",
            args: ["-fsyntax-only", "-x", "c", "-"],
            stdin: source,
          });
          expect(result.executed).toBe(true);
          expect(result.exitCode).toBe(source.startsWith("int") ? 0 : 1);
          expect(result.evidence.command).toBe("/usr/bin/cc");
          expect(result.evidence.sandbox).toBe("darwin-seatbelt/v1");
        }
      } finally {
        realpath.mockRestore();
      }
    },
  );

  it.each(["hardlink", "symlink"])(
    "preserves the selected %s command through inventory, wall preparation and execution",
    async (kind) => {
      const ws = workspace();
      const bin = join(ws.toolTree, "bin");
      const alias = script(bin, "other-name", ['printf "%s" "$0"']);
      const selected = join(bin, "selected-name");
      if (kind === "hardlink") fs.linkSync(alias, selected);
      else fs.symlinkSync(alias, selected);
      const realpath = redirectRealpath(selected, alias);
      let resolved;
      let snapshots;
      try {
        resolved = resolveToolInventory({ toolIds: ["selected-name"], toolTree: ws.toolTree, pathDirs: [] });
        expect(resolved.inventory["selected-name"]?.path).toBe(selected);
        const prepared = prepareVerifierReads(
          {
            resolvedCommand: selected,
            workdir: ws.cells,
            engineArgs: [],
            attestedFiles: [],
            sandboxReadRoots: [],
          },
          "unavailable",
        );
        if ("unsupported" in prepared) throw new Error(prepared.unsupported);
        expect(prepared.command).toBe(selected);
        expect(exactReadDrift(prepared.exactReadSnapshots)).toBeNull();
        snapshots = prepared.exactReadSnapshots;
      } finally {
        realpath.mockRestore();
      }
      const host = createVerifierHost({
        inventory: resolved.inventory,
        toolTree: ws.toolTree,
        baseDir: ws.cells,
        requireOsSandbox: false,
      });
      const result = await runOnce(host, subject({}), { toolId: "selected-name", checkId: "command-name" });
      expect(result.executed).toBe(true);
      expect(result.stdout).toBe(selected);
      expect(result.evidence.command).toBe(selected);
      fs.unlinkSync(selected);
      script(bin, "selected-name", ["exit 9"]);
      expect(exactReadDrift(snapshots)?.kind).toBe("changed");
      const refused = await runOnce(host, subject({}), { toolId: "selected-name", checkId: "command-name" });
      expect(refused.nonResult?.kind).toBe("sandbox");
    },
  );

  it("takes the workspace toolchain first, the host path second, and names the rest", () => {
    const ws = workspace();
    script(join(ws.toolTree, "bin"), "tool-a", ["exit 0"]);
    script(join(ws.toolTree, "pkg", "sub", "bin"), "tool-b", ["exit 0"]);
    const hostDir = join(ws.dir, "hostbin");
    script(hostDir, "tool-c", ["exit 0"]);
    const shadowed = script(hostDir, "tool-a", ["exit 7"]);

    const resolved = resolveToolInventory({
      toolIds: ["tool-a", "tool-b", "tool-c", "tool-absent", "bad/id"],
      toolTree: ws.toolTree,
      pathDirs: [hostDir],
    });

    const a = required(resolved.inventory["tool-a"], "tool-a");
    expect(a.source).toBe("workspace-toolchain");
    expect(a.path.endsWith(join(".toolchain", "bin", "tool-a"))).toBe(true);
    // The workspace copy shadows the host one of the same name, digest included.
    expect(a.digest).toBe(sha256OfFile(join(ws.toolTree, "bin", "tool-a")));
    expect(a.digest).not.toBe(sha256OfFile(shadowed));

    const b = required(resolved.inventory["tool-b"], "tool-b");
    expect(b.source).toBe("workspace-toolchain");
    expect(b.path.endsWith(join("pkg", "sub", "bin", "tool-b"))).toBe(true);

    expect(required(resolved.inventory["tool-c"], "tool-c").source).toBe("host");
    expect(resolved.missing).toEqual(["tool-absent"]);
    expect(resolved.invalid).toEqual(["bad/id"]);
    // An invalid id is not also reported missing: it never entered resolution.
    expect(resolved.inventory["bad/id"]).toBeUndefined();
  });

  it("counts a large file behind a shim by its bytes, so a same-length change moves the tree digest", () => {
    // An engine or shared library over 1 MiB behind an unchanged wrapper can change without
    // changing its length; a tree digest counting it by size would call both one environment.
    const large = new Uint8Array((1 << 20) + 512).fill(7);
    const treeDigest = (bytes: Uint8Array) => {
      const ws = workspace();
      script(join(ws.toolTree, "bin"), "engine", ['exec "$(dirname "$0")/../lib/engine.bin" "$@"']);
      mkdirSync(join(ws.toolTree, "lib"), { recursive: true });
      const engine = join(ws.toolTree, "lib", "engine.bin");
      writeFileSync(engine, bytes);
      const read = () => resolveToolInventory({ toolIds: ["engine"], toolTree: ws.toolTree, pathDirs: [] });
      return { digest: required(read().inventory["engine"], "engine").treeDigest, engine, read };
    };
    const original = treeDigest(large);
    const changed = large.slice();
    changed[changed.length - 1] = 8;

    expect(treeDigest(changed).digest).not.toBe(original.digest);
    // A byte-identical copy elsewhere keeps the identity, since a copy keeps no time or inode.
    expect(treeDigest(large).digest).toBe(original.digest);
    // A rewrite in place that puts the mtime back to the nanosecond is still reread rather than
    // answered from memory, since only the kernel sets the ctime.
    const stamp = `${original.engine}.stamp`;
    expect(Bun.spawnSync(["touch", "-r", original.engine, stamp]).exitCode).toBe(0);
    writeFileSync(original.engine, changed);
    expect(Bun.spawnSync(["touch", "-r", stamp, original.engine]).exitCode).toBe(0);
    fs.unlinkSync(stamp);
    expect(required(original.read().inventory["engine"], "engine").treeDigest).not.toBe(original.digest);
  });

  it("counts a tool tree copied to another path as the same tree, and any byte the copy changed as a new one", () => {
    // A reseed copies `.toolchain` into the next epoch's workspace and rewrites its launchers,
    // activation scripts and wrappers to name the new path. Counted by raw bytes, that moved the
    // tree digest and the environment hash on every reseed, so a task-only round read as scoring
    // moved and was recorded as a new baseline.
    const seed = (edit: (root: string) => Record<string, string | Uint8Array> = () => ({})) => {
      const ws = workspace();
      const root = fs.realpathSync.native(ws.toolTree);
      // One occurrence straddles the 1 MiB read boundary, so only a carried tail can see it whole.
      const engine = new Uint8Array((1 << 20) + 4096).fill(7);
      engine.set(new TextEncoder().encode(root), (1 << 20) - 5);
      const files: Record<string, string | Uint8Array> = {
        "bin/truss-solve": `#!/bin/sh\nexec "${root}/venv/bin/python" "${root}/truss_cli.py" "$@"\n`,
        "venv/bin/truss": `#!/bin/sh\n'''exec' "${root}/venv/bin/python" "$0" "$@"\n' '''\nimport truss\n`,
        "venv/bin/activate": `VIRTUAL_ENV="${root}/venv"\nexport VIRTUAL_ENV\n`,
        "truss_cli.py": "print('solve')\n",
        "lib/engine.bin": engine,
        ...edit(root),
      };
      for (const [rel, bytes] of Object.entries(files)) {
        mkdirSync(join(root, rel, ".."), { recursive: true });
        writeFileSync(join(root, rel), bytes);
        chmodSync(join(root, rel), 0o755);
      }
      const resolved = resolveToolInventory({
        toolIds: ["truss-solve"],
        toolTree: ws.toolTree,
        pathDirs: [],
      });
      return {
        root,
        tree: required(resolved.inventory["truss-solve"], "truss-solve").treeDigest,
        environment: verifierEnvironmentHashOfTools(resolved.inventory),
      };
    };
    const original = seed();
    const copy = seed();
    expect(copy.root).not.toBe(original.root);
    expect(copy.tree).toBe(original.tree);
    expect(copy.environment).toBe(original.environment);

    const moved = [
      // A byte of a script the wrapper runs, and a byte of the wrapper beside the path it names.
      seed(() => ({ "truss_cli.py": "print('solve!')\n" })),
      seed((root) => ({
        "bin/truss-solve": `#!/bin/sh\nexec "${root}/venv/bin/python" -u "${root}/truss_cli.py"\n`,
      })),
      // The same bytes around the path with the path somewhere else in them.
      seed((root) => ({ "venv/bin/activate": `VIRTUAL_ENV="/venv${root}"\nexport VIRTUAL_ENV\n` })),
      // A copy still naming the tree it came from runs that tree's interpreter, not its own.
      seed(() => ({
        "bin/truss-solve": `#!/bin/sh\nexec "${original.root}/venv/bin/python" "${original.root}/truss_cli.py" "$@"\n`,
      })),
    ];
    for (const changed of moved) {
      expect(changed.tree).not.toBe(original.tree);
      expect(changed.environment).not.toBe(original.environment);
    }
  });

  it("admits a plain command name and refuses anything that can address a file", () => {
    for (const id of ["gcc", "g++", "python3.12", "iverilog-13"]) expect(TOOL_ID_RE.test(id)).toBe(true);
    for (const id of ["", "../gcc", "bin/gcc", "/usr/bin/gcc", ".hidden"]) {
      expect(TOOL_ID_RE.test(id)).toBe(false);
    }
  });
});
