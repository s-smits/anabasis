import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import {
  applyLinuxBwrapPlan,
  prepareLinuxBwrap,
  verifyLinuxBwrapPlan,
} from "../src/verify/linux-bwrap-verifier.ts";
import { bwrapBaselineArgs, classifyBwrapRefusal, linuxBwrapSupport } from "../src/verify/linux-bwrap.ts";
import { verifierOsIsolation } from "../src/verify/os-isolation.ts";
import { runtimeProcess } from "../src/meta/process.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ana-linux-bwrap-verifier-"));
  dirs.push(root);
  const bwrap = join(root, "bwrap");
  const workdir = join(root, "workdir");
  const readable = join(root, "readable");
  const delegated = join(root, "delegated.dat");
  mkdirSync(workdir);
  mkdirSync(readable);
  writeFileSync(bwrap, "#!/bin/sh\nexit 0\n");
  chmodSync(bwrap, 0o755);
  writeFileSync(delegated, "before");
  return { bwrap, workdir, readable, delegated };
}

describe("Linux verifier bubblewrap plan", () => {
  it("binds the command, delegated bytes and declared roots while normalising the private workdir", () => {
    const f = fixture();
    const runtime = {
      platform: "linux" as const,
      bwrapPath: f.bwrap,
      outerSandboxed: false,
      skipNamespaceCheck: true,
    };
    const plan = prepareLinuxBwrap({
      runtime,
      workdir: f.workdir,
      resolvedCommand: Bun.argv[0]!,
      engineArgs: ["-e", "void 0"],
      attestedFiles: [f.delegated],
      sandboxReadRoots: [f.readable],
      environment: { PATH: "/usr/bin:/bin", LANG: "C" },
    });
    if ("unsupported" in plan) throw new Error(plan.unsupported);
    expect(plan.args.slice(0, plan.bwrapFlags.length)).toEqual(plan.bwrapFlags);
    expect(plan.args.slice(-2)).toEqual(["-e", "void 0"]);
    expect(plan.bwrapFlags).toContain("--chdir");
    expect(plan.bwrapFlags).toContain("--new-session");
    expect(plan.bwrapFlags).toEqual(expect.arrayContaining(["--cap-drop", "ALL"]));
    expect(plan.bwrapFlags).toContain("--disable-userns");
    expect(plan.bwrapFlags).toContain("--unshare-pid");
    expect(plan.bwrapFlags.indexOf("--unshare-pid")).toBeLessThan(plan.bwrapFlags.indexOf("--proc"));
    expect(plan.bwrapFlags).toContain("--clearenv");
    expect(plan.bwrapFlags).toEqual(expect.arrayContaining(["--setenv", "LANG", "C"]));
    expect(plan.bwrapFlags.indexOf("--clearenv")).toBeLessThan(plan.bwrapFlags.indexOf("--setenv"));
    expect(plan.bwrapFlags.indexOf("LANG")).toBeLessThan(plan.bwrapFlags.indexOf("PATH"));
    expect(plan.bwrapFlags).toContain(plan.workdir);
    expect<unknown>(plan.bwrapFlags).toContain(plan.readRoots[0]);
    // A private /tmp, laid before the binds: a workdir under the host's /tmp would otherwise be
    // covered by it.
    const privateTmp = plan.bwrapFlags.indexOf("/tmp");
    expect(plan.bwrapFlags[privateTmp - 1]).toBe("--tmpfs");
    expect(privateTmp).toBeLessThan(plan.bwrapFlags.indexOf("--bind"));
    expect(privateTmp).toBeLessThan(plan.bwrapFlags.indexOf(plan.readRoots[0] ?? ""));
    expect(plan.policyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyLinuxBwrapPlan(plan, runtime)).toBeNull();

    writeFileSync(f.delegated, "after");
    expect(verifyLinuxBwrapPlan(plan, runtime)).toMatchObject({
      kind: "changed",
      detail: expect.stringMatching(/command or attested input changed/),
    });
  });

  it("binds platform application and re-attestation to one prepared isolation", async () => {
    const f = fixture();
    const runtime = {
      platform: "linux" as const,
      bwrapPath: f.bwrap,
      outerSandboxed: false,
      skipNamespaceCheck: true,
    };
    const isolation = verifierOsIsolation(runtime);
    const input = {
      workdir: f.workdir,
      resolvedCommand: Bun.argv[0]!,
      engineArgs: ["-e", "void 0"],
      attestedFiles: [f.delegated],
      sandboxReadRoots: [f.readable],
      environment: { PATH: "/usr/bin:/bin" },
    };
    const plan = isolation.prepare(input);
    if ("unsupported" in plan) throw new Error(plan.unsupported);

    expect(isolation.prepare({ ...input, sandboxReadRoots: ["relative-root"] })).toEqual({
      unsupported: expect.stringMatching(/sandbox policy preparation threw/),
    });
    // The host never receives raw Linux arguments to cast back through a generic method. These
    // closures retain the exact plan prepared above, so a later caller has no cross-platform plan
    // value it could misroute.
    expect(await plan.apply()).toEqual({ ok: true });
    expect(plan.verify()).toBeNull();
  });

  it("names a user-namespace refusal and keeps one stderr line for any other canary failure", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-linux-bwrap-canary-"));
    dirs.push(root);
    const userns = join(root, "bwrap-userns");
    writeFileSync(userns, '#!/bin/sh\necho "bwrap: setting up uid map: Permission denied" >&2\nexit 1\n');
    chmodSync(userns, 0o755);
    const denied = linuxBwrapSupport({ platform: "linux", bwrapPath: userns, outerSandboxed: false });
    expect(denied.ok).toBe(false);
    expect(denied.reason).toMatch(/unprivileged user namespace/);

    const rejected = join(root, "bwrap-rejected");
    writeFileSync(
      rejected,
      '#!/bin/sh\necho "bwrap: Can\'t mkdir /nowhere: Read-only file system" >&2\nexit 1\n',
    );
    chmodSync(rejected, 0o755);
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

  it("refuses application and re-attestation when the workdir resolves elsewhere", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-linux-bwrap-swap-"));
    dirs.push(root);
    const bwrap = join(root, "bwrap");
    writeFileSync(bwrap, "#!/bin/sh\nexit 0\n");
    chmodSync(bwrap, 0o755);
    const parent = join(root, "parent");
    mkdirSync(join(parent, "workdir"), { recursive: true });
    const runtime = {
      platform: "linux" as const,
      bwrapPath: bwrap,
      outerSandboxed: false,
      skipNamespaceCheck: true,
    };
    const plan = prepareLinuxBwrap({
      runtime,
      workdir: join(parent, "workdir"),
      resolvedCommand: Bun.argv[0]!,
      engineArgs: ["-e", "void 0"],
      attestedFiles: [],
      sandboxReadRoots: [],
      environment: {},
    });
    if ("unsupported" in plan) throw new Error(plan.unsupported);
    expect(applyLinuxBwrapPlan(plan)).toEqual({ ok: true });

    renameSync(parent, join(root, "moved"));
    symlinkSync(join(root, "moved"), parent);
    expect(applyLinuxBwrapPlan(plan)).toEqual({
      ok: false,
      reason: expect.stringMatching(/workdir resolution changed/),
    });
    expect(verifyLinuxBwrapPlan(plan, runtime)).toEqual({
      kind: "changed",
      detail: expect.stringMatching(/workdir resolution changed/),
    });
  });
});

describe("the resolver an open network needs", () => {
  // Opening egress is not the same as reaching a name. In the Lima VM the Built Harness shell
  // could open a socket and still failed every lookup, because Ubuntu points /etc/resolv.conf
  // into /run and the wall binds only /etc, so the resolver was a dangling symlink.
  it("binds nothing extra while the network stays closed", () => {
    const args = bwrapBaselineArgs({ network: false });
    expect(args).toContain("--unshare-net");
    expect(args.filter((arg) => arg.endsWith("resolv.conf"))).toEqual([]);
  });

  it.if(runtimeProcess.platform === "linux")("binds the resolved resolver when the network is open", () => {
    const args = bwrapBaselineArgs({ network: true });
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
  it("names the unsupported option and the required bubblewrap", () => {
    const reason = classifyBwrapRefusal("bwrap: Unknown option --disable-userns\n");
    expect(reason).toContain("--disable-userns");
    expect(reason).toContain("0.8.0");
  });

  it("reports the installed version when the binary can state one", () => {
    const reason = classifyBwrapRefusal("bwrap: Unknown option --disable-userns\n", "/usr/bin/bwrap");
    // Only asserted when this host actually has bwrap: the version variant is a remedy detail, and a
    // host without the binary must still get the option name rather than a thrown error.
    if (existsSync("/usr/bin/bwrap")) expect(reason).toMatch(/installed bubblewrap \d/);
    expect(reason).toContain("--disable-userns");
  });

  it("keeps the user-namespace remedy for a kernel refusal", () => {
    const reason = classifyBwrapRefusal("bwrap: No permissions to create a new namespace\n");
    expect(reason).toContain("user namespace");
    expect(reason).not.toContain("--disable-userns");
  });

  it("carries one capped stderr line for any other refusal", () => {
    const reason = classifyBwrapRefusal(
      "bwrap: Can't mount proc on /newroot/proc: Operation not permitted\n",
    );
    expect(reason).toContain("Can't mount proc");
    expect(classifyBwrapRefusal(`\nbwrap: ${"y".repeat(300)}\nsecond line\n`)).toBe(
      `bubblewrap refused its baseline policy: bwrap: ${"y".repeat(193)} […107 bytes omitted]`,
    );
  });
});

describe("the runtime prefix a baseline bind set exposes", () => {
  it("holds the captured executable's prefix when generated code reassigns process.execPath", () => {
    const honest = bwrapBaselineArgs({ network: false });
    const descriptor = Object.getOwnPropertyDescriptor(runtimeProcess, "execPath");
    Object.defineProperty(runtimeProcess, "execPath", {
      ...descriptor,
      value: join(tmpdir(), "ana-absent-runtime", "bin", "bun"),
    });
    try {
      // The controller launches `capturedExecPath`, captured before any generated module ran. Read
      // from the live global instead, the bind set loses the runtime's own prefix and bubblewrap
      // refuses the launch with "execvp <the real bun>: No such file or directory" — the
      // substitution test/trusted-runtime.test.ts exists to refuse.
      expect(bwrapBaselineArgs({ network: false })).toEqual(honest);
    } finally {
      if (descriptor) Object.defineProperty(runtimeProcess, "execPath", descriptor);
    }
  });
});
