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
    "bypasses the shim only where PATH itself named /usr/bin, keeping DEVELOPER_DIR semantics with the spawn",
    () => {
      // A tool only /usr/bin holds: PATH's canonical resolution is the Apple shim path, so the
      // active developer directory's direct binary is the answer.
      expect(existsSync("/usr/bin/otool")).toBe(true);
      const previousPath = Bun.env.PATH;
      Bun.env.PATH = "/usr/bin:/bin";
      try {
        const probe = Bun.spawnSync({ cmd: ["xcode-select", "-p"], stdout: "pipe", stderr: "pipe" });
        const directory = probe.success ? probe.stdout.toString().trim() : "";
        if (directory === "") {
          expect(hostTool("otool")).toBe("/usr/bin/otool");
        } else {
          expect(hostTool("otool")).toBe(join(directory, "usr", "bin", "otool"));
        }
      } finally {
        if (previousPath === undefined) delete Bun.env.PATH;
        else Bun.env.PATH = previousPath;
      }
    },
  );
});
