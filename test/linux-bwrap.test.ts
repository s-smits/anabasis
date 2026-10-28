import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import { bwrapOpenReadArgs, linuxBwrapSupport, nodeRuntimeReadRoots } from "../src/wall/linux-bwrap.ts";
import { runtimeProcess } from "../src/meta/process.ts";

const root = mkdtempSync(join(tmpdir(), "ana-linux-bwrap-reuse-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("Linux bubblewrap support", () => {
  it("runs the canary once per unchanged bwrap binary and again after the binary is rewritten", () => {
    const bwrap = join(root, "bwrap");
    const log = join(root, "canary.log");
    const script = (marker: string) => `#!/bin/sh\n# ${marker}\necho ran >> "${log}"\nexit 0\n`;
    writeFileSync(bwrap, script("one"));
    chmodSync(bwrap, 0o755);
    const runtime = { platform: "linux" as const, bwrapPath: bwrap, outerSandboxed: false };
    const first = linuxBwrapSupport(runtime);
    expect(first.ok).toBe(true);
    expect(linuxBwrapSupport(runtime)).toEqual(first);
    expect(readFileSync(log, "utf8")).toBe("ran\n");

    writeFileSync(bwrap, script("two-with-more-bytes"));
    const rewritten = linuxBwrapSupport(runtime);
    expect(rewritten.ok).toBe(true);
    expect(rewritten.mechanismDigest).not.toBe(first.mechanismDigest);
    expect(readFileSync(log, "utf8")).toBe("ran\nran\n");
  });
});

describe("the resolver an open network needs", () => {
  // Opening egress is not the same as reaching a name. In the Lima VM the Built Harness shell
  // could open a socket and still failed every lookup, because Ubuntu points /etc/resolv.conf
  // into /run and the wall bound only /etc, so the resolver was a dangling symlink.
  it("binds nothing extra while the network stays closed", () => {
    const args = bwrapOpenReadArgs({ network: false });
    expect(args).toContain("--unshare-net");
    expect(args.filter((arg) => arg.endsWith("resolv.conf"))).toEqual([]);
  });

  // A resolver that is a file under /etc already reads through the root bind; GitHub's Ubuntu
  // runner had one by 28 October, where on 27 October it still pointed into /run.
  it.if(runtimeProcess.platform === "linux")("binds the resolved resolver when the network is open", () => {
    const args = bwrapOpenReadArgs({ network: true });
    expect(args).not.toContain("--unshare-net");
    const resolver = realpathSync("/etc/resolv.conf");
    const own = resolver.startsWith("/run/") ? [resolver, resolver] : [];
    expect(args.filter((arg) => arg === resolver)).toEqual(own);
  });
});

describe("the runtime prefix a wall reopens", () => {
  it("holds the captured executable's prefix when generated code reassigns process.execPath", () => {
    const honest = nodeRuntimeReadRoots();
    const descriptor = Object.getOwnPropertyDescriptor(runtimeProcess, "execPath");
    Object.defineProperty(runtimeProcess, "execPath", {
      ...descriptor,
      value: join(tmpdir(), "ana-absent-runtime", "bin", "bun"),
    });
    try {
      // The controller launches `capturedExecPath`, captured before any generated module ran. Read
      // from the live global instead, the reopened roots lose the runtime's own prefix and a walled
      // command cannot start it — the substitution test/trusted-runtime.test.ts exists to refuse.
      expect(nodeRuntimeReadRoots()).toEqual(honest);
    } finally {
      if (descriptor) Object.defineProperty(runtimeProcess, "execPath", descriptor);
    }
  });
});
