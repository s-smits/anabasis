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
import { afterEach, describe, expect, it } from "bun:test";
import { bwrapOpenReadArgs, linuxBwrapSupport, nodeRuntimeReadRoots } from "../src/verify/linux-bwrap.ts";
import { runtimeProcess } from "../src/meta/process.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A bwrap that is a shell script, so a case on any host decides what its canary prints. */
function fakeBwrap(name: string, script: string): string {
  const root = mkdtempSync(join(tmpdir(), `ana-linux-bwrap-${name}-`));
  dirs.push(root);
  const path = join(root, "bwrap");
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return path;
}

describe("Linux bubblewrap support", () => {
  it("names a user-namespace refusal and keeps one stderr line for any other canary failure", () => {
    const userns = fakeBwrap(
      "userns",
      '#!/bin/sh\necho "bwrap: setting up uid map: Permission denied" >&2\nexit 1\n',
    );
    const denied = linuxBwrapSupport({ platform: "linux", bwrapPath: userns, outerSandboxed: false });
    expect(denied.ok).toBe(false);
    expect(denied.reason).toMatch(/unprivileged user namespace/);

    const rejected = fakeBwrap(
      "rejected",
      '#!/bin/sh\necho "bwrap: Can\'t mkdir /nowhere: Read-only file system" >&2\nexit 1\n',
    );
    const refused = linuxBwrapSupport({ platform: "linux", bwrapPath: rejected, outerSandboxed: false });
    expect(refused.ok).toBe(false);
    expect(refused.reason).toMatch(/refused its baseline policy: bwrap: Can't mkdir/);
  });

  it("runs the canary once per unchanged bwrap binary and again after the binary is rewritten", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-linux-bwrap-reuse-"));
    dirs.push(root);
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

  it.if(runtimeProcess.platform === "linux")("binds the resolved resolver when the network is open", () => {
    const args = bwrapOpenReadArgs({ network: true });
    expect(args).not.toContain("--unshare-net");
    const resolver = realpathSync("/etc/resolv.conf");
    expect(args.filter((arg) => arg === resolver)).toEqual([resolver, resolver]);
  });
});

describe("bubblewrap refusal classification", () => {
  // An operator on Ubuntu 22.04 LTS (bubblewrap 0.6.1) previously saw a bare
  // "bwrap: Unknown option --disable-userns" repeated across every confined call site, with no
  // statement of which package was too old or what to install. The isolation must still fail closed —
  // the flag is what stops a confined child nesting its own user namespace — so the fix is the
  // remedy text, not a weaker baseline.
  /** Why a fake bwrap whose canary prints `stderr` and fails is refused. */
  const refusal = (name: string, stderr: string, version = "") => {
    const answers =
      version === "" ? "" : `[ "$1" = --version ] && { echo "bubblewrap ${version}"; exit 0; }\n`;
    const bwrap = fakeBwrap(name, `#!/bin/sh\n${answers}printf '%s' '${stderr}' >&2\nexit 1\n`);
    return linuxBwrapSupport({ platform: "linux", bwrapPath: bwrap, outerSandboxed: false }).reason;
  };

  it("names the unsupported option, the required bubblewrap and the one installed", () => {
    expect(refusal("old", "bwrap: Unknown option --disable-userns\n", "0.6.1")).toBe(
      "this bubblewrap does not support --disable-userns (installed bubblewrap 0.6.1) — the OS isolation needs bubblewrap 0.8.0 or newer; upgrade the bubblewrap package",
    );
    // A binary that cannot state its version still gets the option named.
    expect(refusal("mute", "bwrap: Unknown option --disable-userns\n")).toStartWith(
      "this bubblewrap does not support --disable-userns — ",
    );
  });

  it("keeps the user-namespace remedy for a kernel refusal, and carries one capped line for any other", () => {
    expect(refusal("kernel", "bwrap: No permissions to create a new namespace\n")).toBe(
      "bubblewrap could not create an unprivileged user namespace — the kernel may have user namespaces disabled",
    );
    expect(refusal("long", `\nbwrap: ${"y".repeat(300)}\nsecond line\n`)).toBe(
      `bubblewrap refused its baseline policy: bwrap: ${"y".repeat(193)} […107 bytes omitted]`,
    );
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
