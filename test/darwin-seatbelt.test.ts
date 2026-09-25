import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { sha256 } from "../src/meta/digest.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
import {
  applyDarwinSeatbeltPlan,
  darwinSeatbeltSupport,
  prepareDarwinSeatbelt,
  verifyDarwinSeatbeltPlan,
} from "../src/verify/darwin-seatbelt.ts";
import { DARWIN_SYSTEM_READ_ROOTS, darwinToolchainInstallRoots } from "../src/verify/wall-policy.ts";
import { runtimeProcess } from "../src/meta/process.ts";

const dirs: string[] = [];
setDefaultTimeout(60_000);

async function spawnText(
  command: string,
  args: string[],
  options: { cwd: string; env: Record<string, string>; timeout: number },
) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const child = Bun.spawn({
      cmd: [command, ...args],
      cwd: options.cwd,
      env: options.env,
      signal: controller.signal,
      detached: true,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const completed = Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    const expired = new Promise<null>((resolve) => {
      timeout = setTimeout(() => {
        controller.abort();
        try {
          runtimeProcess.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
        resolve(null);
      }, options.timeout);
    });
    const result = await Promise.race([completed, expired]);
    if (result === null) return { status: null, stdout: "", stderr: "" };
    const [status, stdout, stderr] = result;
    return { status, stdout, stderr };
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ana-seatbelt-policy-"));
  dirs.push(root);
  const executable = join(root, "sandbox-exec");
  const systemProfile = join(root, "system.sb");
  const importedProfile = join(root, "dyld-support.sb");
  const workdir = join(root, "workdir");
  const readable = join(root, "readable");
  mkdirSync(workdir);
  mkdirSync(readable);
  writeFileSync(executable, "fixture executable");
  writeFileSync(systemProfile, '(version 1)\n(import "dyld-support.sb")\n(allow system-fixture)');
  writeFileSync(importedProfile, "(version 1)\n(allow imported-fixture-v1)");
  // Every case here runs the same supported Darwin host; what each one changes is a file in it.
  const runtime = {
    platform: "darwin" as const,
    sandboxExecPath: executable,
    systemProfilePath: systemProfile,
    outerSandboxed: false,
  };
  return { root, executable, systemProfile, importedProfile, workdir, readable, runtime };
}

/** The launch every case prepares before it changes one file and asks what the identity did. */
function launch(f: ReturnType<typeof fixture>) {
  return {
    runtime: f.runtime,
    workdir: f.workdir,
    resolvedCommand: Bun.argv[0]!,
    engineArgs: ["-e", "void 0"],
    attestedFiles: [],
    sandboxReadRoots: [f.readable],
  };
}

/** A prepared plan, or the case fails naming why the host refused one. */
function prepared(input: Parameters<typeof prepareDarwinSeatbelt>[0]) {
  const plan = prepareDarwinSeatbelt(input);
  if ("unsupported" in plan) throw new Error(plan.unsupported);
  return plan;
}

/** The launch of one attested command, the shape the re-attestation cases change a byte under. */
const attested = (f: ReturnType<typeof fixture>, command: string) =>
  prepared({ ...launch(f), resolvedCommand: command, engineArgs: [], attestedFiles: [command] });

describe("Darwin verifier Seatbelt policy identity", () => {
  it.concurrent("orders imported profile records by code point before hashing stable JSON", () => {
    const f = fixture();
    const zProfile = join(f.root, "z.sb");
    const umlautProfile = join(f.root, "ä.sb");
    writeFileSync(zProfile, "(version 1)\n(allow z-profile)");
    writeFileSync(umlautProfile, "(version 1)\n(allow umlaut-profile)");
    writeFileSync(f.systemProfile, '(version 1)\n(import "z.sb")\n(import "ä.sb")');

    const support = darwinSeatbeltSupport(f.runtime);
    const records = [f.systemProfile, zProfile, umlautProfile]
      .map((path) => ({ path: realpathSync.native(path), sha256: sha256(readFileSync(path)) }))
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    expect(support.baselineDigest).toBe(hashJsonValue(records));
  });

  it.concurrent("attests the reused support again after a same-size rewrite or a retargeted import", () => {
    const f = fixture();
    const runtime = f.runtime;
    const first = darwinSeatbeltSupport(runtime);
    expect(first.ok).toBe(true);
    expect(darwinSeatbeltSupport(runtime)).toEqual(first);

    // The same number of bytes with the modification time restored: only ctime and the content differ.
    const before = statSync(f.importedProfile);
    writeFileSync(f.importedProfile, "(version 1)\n(allow imported-fixture-v2)");
    utimesSync(f.importedProfile, before.atime, before.mtime);
    const rewritten = darwinSeatbeltSupport(runtime);
    expect(rewritten.mechanismDigest).toBe(first.mechanismDigest);
    expect(rewritten.baselineDigest).not.toBe(first.baselineDigest);

    // An import through a directory link: every hashed file is unchanged, the link now names another.
    for (const name of ["one", "two"]) {
      mkdirSync(join(f.root, name));
      writeFileSync(join(f.root, name, "linked.sb"), `(version 1)\n(allow linked-${name})`);
    }
    symlinkSync(join(f.root, "one"), join(f.root, "current"));
    writeFileSync(f.systemProfile, '(version 1)\n(import "current/linked.sb")');
    const linkedOne = darwinSeatbeltSupport(runtime);
    unlinkSync(join(f.root, "current"));
    symlinkSync(join(f.root, "two"), join(f.root, "current"));
    const linkedTwo = darwinSeatbeltSupport(runtime);
    expect(linkedTwo.ok).toBe(true);
    expect(linkedTwo.baselineDigest).not.toBe(linkedOne.baselineDigest);
  });

  it.concurrent("binds imported system.sb bytes while normalising the private workdir path", () => {
    const f = fixture();
    const first = prepared(launch(f));
    expect(first.profile).toContain("(deny default)");
    expect(first.profile).toContain('(import "system.sb")');
    expect(first.profile).toContain("(deny network*)");
    expect(first.profile).not.toContain("(allow default)");
    expect(first.policyHash).toMatch(/^[0-9a-f]{64}$/);

    writeFileSync(f.importedProfile, "(version 1)\n(allow imported-fixture-v2)");
    const second = prepared(launch(f));
    expect(second.policyHash).not.toBe(first.policyHash);

    // A file inside a declared root is a grant, not a bound input: writing one leaves the policy
    // identity alone, so a toolchain that writes to its own directory does not move the identity
    // of the run reading it.
    writeFileSync(join(f.readable, "truth.dat"), "changed truth input");
    const third = prepared(launch(f));
    expect(third.policyHash).toBe(second.policyHash);

    writeFileSync(f.executable, "fixture executable v2");
    const fourth = prepared(launch(f));
    expect(fourth.policyHash).not.toBe(third.policyHash);
  });

  it.concurrent("refuses unsupported, missing-baseline and nested hosts without inventing proof", () => {
    const f = fixture();
    expect(darwinSeatbeltSupport({ platform: "linux" }).ok).toBe(false);
    expect(
      darwinSeatbeltSupport({
        platform: "darwin",
        sandboxExecPath: f.executable,
        systemProfilePath: join(f.root, "missing.sb"),
        outerSandboxed: false,
      }).ok,
    ).toBe(false);
    expect(
      darwinSeatbeltSupport({
        platform: "darwin",
        sandboxExecPath: f.executable,
        systemProfilePath: f.systemProfile,
        outerSandboxed: true,
      }).reason,
    ).toMatch(/surrounding sandbox/);
  });

  it.concurrent("grants a declared root without binding what changes inside it", () => {
    const f = fixture();
    const internal = join(f.readable, "libtool.0.so");
    writeFileSync(internal, "internal library");
    symlinkSync("libtool.0.so", join(f.readable, "libtool.so"));
    const input = launch(f);
    const internalPlan = prepared(input);
    expect(internalPlan.policyHash).toMatch(/^[0-9a-f]{64}$/);

    // A toolchain can contain many symlinks and create its own indexes, caches and build
    // directories. Declaring a read root grants access; it does not bind its contents to the
    // policy hash. Changes there therefore leave the policy identity unchanged.
    // The command and each attested file have separate checks of their exact bytes. A link
    // outside the root still needs a separate grant for its target.
    const outside = join(f.root, "outside.dat");
    writeFileSync(outside, "outside");
    const escape = join(f.readable, "escape");
    symlinkSync(outside, escape);
    const escapingPlan = prepared(input);
    expect(escapingPlan.policyHash).toBe(internalPlan.policyHash);
    expect(escapingPlan.readRoots).toEqual([realpathSync.native(f.readable)]);
    expect(escapingPlan.profile).not.toContain(outside);

    // A dangling link grants nothing, so it cannot disqualify the installation that contains it.
    rmSync(outside);
    const danglingPlan = prepared(input);
    expect(danglingPlan.policyHash).toBe(internalPlan.policyHash);
  });

  it.concurrent("re-attests the command, delegated files, wrapper and imported profile after preparation", () => {
    const make = () => {
      const f = fixture();
      const delegated = join(f.root, "delegated-tool");
      writeFileSync(delegated, "delegated-v1");
      const plan = attested(f, delegated);
      expect(verifyDarwinSeatbeltPlan(plan, f.runtime)).toBeNull();
      return { f, delegated, plan, runtime: f.runtime };
    };

    const command = make();
    writeFileSync(command.delegated, "delegated-v2");
    expect(verifyDarwinSeatbeltPlan(command.plan, command.runtime)).toMatchObject({
      kind: "changed",
      detail: expect.stringMatching(/command or attested input changed .*digest differs/),
    });

    const wrapper = make();
    writeFileSync(wrapper.f.executable, "fixture executable v2");
    expect(verifyDarwinSeatbeltPlan(wrapper.plan, wrapper.runtime)?.detail).toMatch(/Seatbelt executable/);

    const profile = make();
    writeFileSync(profile.f.importedProfile, "(version 1)\n(allow imported-fixture-v2)");
    expect(verifyDarwinSeatbeltPlan(profile.plan, profile.runtime)?.detail).toMatch(
      /imported profile closure/,
    );
  });

  // The test above detects changed sandbox files. Here the host cannot read those files
  // again, so it cannot establish whether they changed. That is an environment failure.
  // Treating unreadable files as changed bytes would refuse a host compiler on a loaded host and
  // invalidate every battery that used it.
  it.concurrent("distinguishes unavailable sandbox files from files whose bytes changed", () => {
    const f = fixture();
    const command = join(f.root, "command");
    writeFileSync(command, "command-v1");
    const runtime = f.runtime;
    const plan = attested(f, command);
    expect(verifyDarwinSeatbeltPlan(plan, runtime)).toBeNull();

    expect(
      verifyDarwinSeatbeltPlan(plan, { ...runtime, sandboxExecPath: join(f.root, "absent-sandbox-exec") }),
    ).toMatchObject({
      kind: "unavailable",
      detail: expect.stringMatching(/could not be re-attested/),
    });
    expect(
      verifyDarwinSeatbeltPlan(plan, { ...runtime, systemProfilePath: join(f.root, "absent-system.sb") }),
    ).toMatchObject({
      kind: "unavailable",
    });
    // A surrounding sandbox appearing mid-run is an environment condition too, not moved bytes.
    expect(verifyDarwinSeatbeltPlan(plan, { ...runtime, outerSandboxed: true })?.kind).toBe("unavailable");

    writeFileSync(f.executable, "fixture executable v2");
    expect(verifyDarwinSeatbeltPlan(plan, runtime)).toMatchObject({ kind: "changed" });
  });

  it.concurrent("rejects a byte-identical runtime file after its directory link is retargeted", () => {
    const f = fixture();
    const first = join(f.root, "runtime-v1");
    const second = join(f.root, "runtime-v2");
    mkdirSync(first);
    mkdirSync(second);
    writeFileSync(join(first, "engine"), "same engine bytes");
    writeFileSync(join(second, "engine"), "same engine bytes");
    const runtimeLink = join(f.root, "runtime");
    symlinkSync("runtime-v1", runtimeLink);
    const runtime = f.runtime;
    const plan = attested(f, join(runtimeLink, "engine"));
    expect(verifyDarwinSeatbeltPlan(plan, runtime)).toBeNull();

    unlinkSync(runtimeLink);
    symlinkSync("runtime-v2", runtimeLink);
    expect(verifyDarwinSeatbeltPlan(plan, runtime)).toMatchObject({
      kind: "changed",
      detail: expect.stringMatching(/command or attested input changed/),
    });
  });

  it.if(runtimeProcess.platform === "darwin")(
    "applies the concrete profile in the no-provider engine preflight",
    async () => {
      const workdir = mkdtempSync(join(tmpdir(), "ana-seatbelt-preflight-"));
      dirs.push(workdir);
      const plan = prepared({
        runtime: { outerSandboxed: false },
        workdir,
        resolvedCommand: Bun.argv[0]!,
        engineArgs: ["-e", "void 0"],
        attestedFiles: [],
        sandboxReadRoots: [],
      });
      expect(await applyDarwinSeatbeltPlan(plan)).toEqual({ ok: true });
    },
  );

  it.concurrent("times out a Seatbelt application probe that does not finish", async () => {
    const f = fixture();
    writeFileSync(f.executable, "#!/bin/sh\nsleep 60\n");
    chmodSync(f.executable, 0o755);
    const plan = prepared({ ...launch(f), sandboxReadRoots: [] });
    const started = performance.now();
    expect(await applyDarwinSeatbeltPlan(plan, 500)).toEqual({
      ok: false,
      reason: "the Darwin Seatbelt policy could not be applied",
    });
    // The probe sleeps for 60 s, so completing sooner checks that the timeout interrupted it.
    expect(performance.now() - started).toBeLessThan(30_000);
  });
});

/**
 * The platform baseline, exercised on the real mechanism rather than asserted from the profile
 * text. An engine that can start a second binary but not read it leaves a compiler spawned by a
 * checker dying on its own toolchain, which the checker reports as a failed submission.
 */
describe("Darwin verifier platform read baseline", () => {
  const onDarwin = runtimeProcess.platform === "darwin" && darwinSeatbeltSupport({}).ok;

  it.concurrent("names only system-owned roots and no home, campaign or repository path", () => {
    for (const root of DARWIN_SYSTEM_READ_ROOTS) {
      expect(root.startsWith("/")).toBe(true);
      expect(/^\/(?:Users|home|private\/tmp|tmp|Volumes)(?:\/|$)/.test(root)).toBe(false);
    }
  });

  it.concurrent("opens named toolchain directories inside a home without opening the home", () => {
    const roots = darwinToolchainInstallRoots("/Users/nobody");
    expect(roots).not.toContain("/Users/nobody");
    expect(roots).not.toContain("/Users");
    for (const root of roots) expect(root).not.toBe("/");
    // An absent home leaves only the shared prefixes, and a missing directory is skipped rather
    // than declared: a root that does not exist would refuse the whole policy at preparation.
    expect(darwinToolchainInstallRoots("")).toEqual(
      darwinToolchainInstallRoots("").filter((root) => root.startsWith("/usr/")),
    );
    // The Built Harness shell is the stricter of the two walls and receives none of these.
    for (const root of roots) expect([...DARWIN_SYSTEM_READ_ROOTS]).not.toContain(root);
  });

  it.if(onDarwin)("lets an engine's child process compile through the host toolchain", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "ana-nested-spawn-"));
    dirs.push(workdir);
    const script = join(workdir, "checker.js");
    const source = join(workdir, "probe.c");
    const output = join(workdir, "probe");
    writeFileSync(source, "int main(void) { return 0; }\n");
    writeFileSync(
      script,
      `const r = Bun.spawnSync({ cmd: ["/usr/bin/cc", ${JSON.stringify(source)}, "-o", ${JSON.stringify(output)}], stdout: "pipe", stderr: "pipe", timeout: 20000 });
console.log(JSON.stringify({ status: r.exitCode, output: await Bun.file(${JSON.stringify(output)}).exists(), stderr: new TextDecoder().decode(r.stderr).slice(0, 300) }));
`,
    );
    const environment = { PATH: "/usr/bin:/bin", TMPDIR: workdir, OPENSSL_CONF: "/dev/null" };
    // Exactly what an engine declaring no sandboxReadRoots of its own receives.
    const plan = prepared({
      workdir,
      resolvedCommand: realpathSync.native(Bun.argv[0]!),
      engineArgs: [script],
      attestedFiles: [],
      sandboxReadRoots: [],
    });
    expect(await applyDarwinSeatbeltPlan(plan)).toEqual({ ok: true });
    const run = await spawnText(plan.command, plan.args, {
      cwd: workdir,
      env: environment,
      timeout: 60000,
    });
    expect(run.status).toBe(0);
    // SAFETY: the child prints exactly this shape and nothing else, and the run exited 0 above.
    const inner = JSON.parse(run.stdout.trim()) as { status: number; output: boolean; stderr: string };
    // This exercises both halves: the compiler reads its toolchain and writes the scratch file it
    // selects through confstr rather than TMPDIR. A version banner alone did not exercise compilation.
    expect(inner.stderr).not.toContain("developer_dir");
    expect(inner.status).toBe(0);
    expect(inner.output).toBe(true);
  });

  it.if(onDarwin)("still refuses a read outside the workdir and the baseline", async () => {
    // A concurrent verification's workdir beside this one: the temp root is open for what a
    // toolchain creates there, and the product's own scratch trees stay closed by name.
    const root = mkdtempSync(join(tmpdir(), "ana-cell-outside-"));
    dirs.push(root);
    const workdir = join(root, "workdir");
    const secret = join(root, "answer-key.txt");
    mkdirSync(workdir);
    writeFileSync(secret, "expected");
    const script = join(workdir, "checker.js");
    writeFileSync(
      script,
      `try { await Bun.file(${JSON.stringify(secret)}).text(); console.log("READ"); }
catch (error) { console.log("REFUSED:" + String(error.code)); }
`,
    );
    const environment = { PATH: "/usr/bin:/bin", TMPDIR: workdir };
    const plan = prepared({
      workdir,
      resolvedCommand: realpathSync.native(Bun.argv[0]!),
      engineArgs: [script],
      attestedFiles: [],
      sandboxReadRoots: [],
    });
    const run = await spawnText(plan.command, plan.args, {
      cwd: workdir,
      env: environment,
      timeout: 30000,
    });
    expect(run.stdout.trim()).toBe("REFUSED:EPERM");
  });

  it("keeps a concurrent verification cell denied without a writable grant", () => {
    const f = fixture();
    const cellRules = prepared(launch(f))
      .profile.split("\n")
      .filter((line) => line.includes("ana-cell-"));
    expect(cellRules).toHaveLength(1);
    expect(cellRules[0]).toContain("(deny ");
  });
});
