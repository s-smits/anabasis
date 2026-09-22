import { existsSync, mkdirSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { afterEach, describe, expect, it } from "bun:test";
import { hostTool } from "../src/meta/host-tool.ts";

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("hostTool", () => {
  it("keeps a custom git that PATH names first, instead of moving selection to Apple's", () => {
    const fakeDir = join(tmpdir(), `ana-hosttool-fake-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    scratch.push(fakeDir);
    mkdirSync(fakeDir, { recursive: true });
    const fake = join(fakeDir, "git");
    writeFileSync(fake, "#!/bin/sh\nexit 0\n");
    const previousPath = Bun.env.PATH;
    Bun.env.PATH = `${fakeDir}:${previousPath ?? ""}`;
    try {
      expect(hostTool("git")).toBe(fake);
    } finally {
      if (previousPath === undefined) delete Bun.env.PATH;
      else Bun.env.PATH = previousPath;
    }
  });

  it.skipIf(runtimeProcess.platform !== "darwin")(
    "takes a tool from wherever the developer directory holds it, and keeps the shim where it holds none",
    () => {
      // A full Xcode keeps nm in usr/bin and otool in its default toolchain. The GitHub macOS runner
      // selects one, and the unchecked usr/bin/otool failed every runtime-closure attestation there.
      const developer = join(
        tmpdir(),
        `ana-hosttool-xcode-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      scratch.push(developer);
      const usrBin = join(developer, "usr", "bin");
      const toolchain = join(developer, "Toolchains", "XcodeDefault.xctoolchain", "usr", "bin");
      mkdirSync(usrBin, { recursive: true });
      mkdirSync(toolchain, { recursive: true });
      writeFileSync(join(usrBin, "nm"), "#!/bin/sh\nexit 0\n");
      writeFileSync(join(toolchain, "otool"), "#!/bin/sh\nexit 0\n");
      expect(existsSync("/usr/bin/lipo")).toBe(true);
      // A spawn without `env` passes the environment the process started with, so xcode-select
      // sees DEVELOPER_DIR only in a child started with it.
      const module = join(import.meta.dir, "../src/meta/host-tool.ts");
      const child = Bun.spawnSync({
        cmd: [
          runtimeProcess.execPath,
          "-e",
          `const { hostTool } = await import(${JSON.stringify(module)});` +
            'console.log(JSON.stringify(["otool", "nm", "lipo"].map(hostTool)));',
        ],
        env: { ...Bun.env, PATH: "/usr/bin:/bin", DEVELOPER_DIR: developer },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(child.stderr.toString()).toBe("");
      expect(JSON.parse(child.stdout.toString())).toEqual([
        join(toolchain, "otool"),
        join(usrBin, "nm"),
        "/usr/bin/lipo",
      ]);
    },
  );
});
