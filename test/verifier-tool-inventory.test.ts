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

  it("admits a plain command name and refuses anything that can address a file", () => {
    for (const id of ["gcc", "g++", "python3.12", "iverilog-13"]) expect(TOOL_ID_RE.test(id)).toBe(true);
    for (const id of ["", "../gcc", "bin/gcc", "/usr/bin/gcc", ".hidden"]) {
      expect(TOOL_ID_RE.test(id)).toBe(false);
    }
  });
});
