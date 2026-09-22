import { spawnTextSync as spawnSync } from "./helpers/bun-spawn-sync.ts";

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import {
  type GeneratedWorkerPolicy,
  generatedWorkerPolicy,
} from "../src/solve/generated-tool-source-policy.ts";
import { GeneratedToolWorkerNonResult } from "../src/solve/generated-tool-worker-protocol.ts";
import { bwrapBaselineArgs, bwrapEnvironmentArgs } from "../src/verify/linux-bwrap.ts";
import { osIsolationSupport } from "../src/verify/os-isolation.ts";
import { runtimeProcess } from "../src/meta/process.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ana-generated-worker-isolation-"));
  dirs.push(root);
  const workdir = join(root, "worker");
  const candidate = join(root, "candidate-sibling");
  const credential = join(root, "credential-store");
  mkdirSync(workdir);
  mkdirSync(join(candidate, "agent"), { recursive: true });
  mkdirSync(join(candidate, "correctness-model"), { recursive: true });
  mkdirSync(credential);
  const stagedBundle = join(workdir, "worker.cjs");
  writeFileSync(stagedBundle, 'process.stdout.write("WORKER_READY")');
  const bundleFile = realpathSync(stagedBundle);
  const hostile = [
    join(candidate, "agent", "tools.ts"),
    join(candidate, "correctness-model", "evaluator.ts"),
    join(credential, "token"),
  ];
  for (const path of hostile) writeFileSync(path, "HOSTILE_CANARY");
  return {
    workdir,
    bundle: {
      file: bundleFile,
      digest: new Bun.CryptoHasher("sha256").update(readFileSync(bundleFile)).digest("hex"),
    },
    hostile,
  };
}

async function runBunPolicy(policy: GeneratedWorkerPolicy, cwd: string, args: string[]) {
  const child = Bun.spawn([policy.executable, ...policy.launchArgs, ...args], {
    cwd,
    env: policy.runtimeEnvironment,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { status, stdout, stderr };
}

function bunPolicyFixture() {
  const root = mkdtempSync(join(tmpdir(), "ana-generated-worker-bun-policy-"));
  dirs.push(root);
  const worker = join(root, "worker.mjs");
  const sibling = join(root, "sibling-secret");
  writeFileSync(sibling, "SIBLING_SECRET");
  writeFileSync(
    worker,
    `const [mode, value] = Bun.argv.slice(2);
if (mode === "read") {
  try { await Bun.file(value).text(); console.log("READ_ALLOWED"); process.exit(9); }
  catch { console.log("READ_REFUSED"); }
} else if (mode === "spawn") {
  try {
    const child = Bun.spawn(["/usr/bin/true"], { stdout: "ignore", stderr: "ignore" });
    const status = await child.exited;
    if (status === 0) { console.log("SPAWN_ALLOWED"); process.exit(9); }
  } catch {}
  console.log("SPAWN_REFUSED");
} else if (mode === "connect") {
  try {
    const socket = await Bun.connect({ hostname: "127.0.0.1", port: Number(value), socket: { data() {}, error() {} } });
    socket.write("generated-worker-network-canary");
    socket.end();
    console.log("NETWORK_ALLOWED");
    process.exit(9);
  } catch { console.log("NETWORK_REFUSED"); }
}`,
  );
  const bundle = {
    file: realpathSync(worker),
    digest: new Bun.CryptoHasher("sha256").update(readFileSync(worker)).digest("hex"),
  };
  return { root, worker, sibling, bundle };
}

describe("generated worker Darwin runtime closure", () => {
  it.if(runtimeProcess.platform === "darwin")(
    "runs Bun from the exact bundle while denying sibling reads and subprocesses",
    async () => {
      const f = bunPolicyFixture();
      const policy = generatedWorkerPolicy(
        f.bundle,
        osIsolationSupport({ outerSandboxed: false }),
        Bun.argv[0],
      );
      const read = await runBunPolicy(policy, f.root, [f.worker, "read", f.sibling]);
      expect(read).toEqual({ status: 0, stdout: "READ_REFUSED\n", stderr: "" });
      const spawn = await runBunPolicy(policy, f.root, [f.worker, "spawn"]);
      expect(spawn).toEqual({ status: 0, stdout: "SPAWN_REFUSED\n", stderr: "" });
      const bundleDirectory = dirname(f.bundle.file);
      expect(policy.profile).toContain(`(literal ${JSON.stringify(bundleDirectory)})`);
      expect(policy.profile).not.toContain(`(subpath ${JSON.stringify(bundleDirectory)})`);
    },
  );

  it.if(runtimeProcess.platform === "darwin")(
    "denies a controller-witnessed loopback canary that succeeds without the wall",
    async () => {
      const f = bunPolicyFixture();
      let connections = 0;
      const listener = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
          open(socket) {
            connections += 1;
            socket.end();
          },
          data() {},
          error() {},
        },
      });
      try {
        const direct = Bun.spawn(
          [Bun.argv[0]!, "--no-env-file", f.worker, "connect", String(listener.port)],
          {
            cwd: f.root,
            env: {},
            stdout: "pipe",
            stderr: "pipe",
          },
        );
        expect(await direct.exited).toBe(9);
        await Bun.sleep(10);
        expect(connections).toBe(1);

        const policy = generatedWorkerPolicy(
          f.bundle,
          osIsolationSupport({ outerSandboxed: false }),
          Bun.argv[0],
        );
        const confined = await runBunPolicy(policy, f.root, [f.worker, "connect", String(listener.port)]);
        expect(confined).toEqual({ status: 0, stdout: "NETWORK_REFUSED\n", stderr: "" });
        await Bun.sleep(10);
        expect(connections).toBe(1);
      } finally {
        listener.stop(true);
      }
    },
  );

  it.if(runtimeProcess.platform === "darwin")(
    "launches pinned Bun while keeping runtime siblings and protected trees outside",
    async () => {
      const f = bunPolicyFixture();
      const support = osIsolationSupport({ outerSandboxed: false });
      const policy = generatedWorkerPolicy(f.bundle, support, Bun.argv[0]);
      const launched = await runBunPolicy(policy, f.root, [f.worker, "read", Bun.argv[0]!]);
      expect(launched).toEqual({ status: 9, stdout: "READ_ALLOWED\n", stderr: "" });
      expect(policy.runtimeClosure.some(({ path }) => path === Bun.argv[0]!)).toBe(true);
      expect(policy.profile).not.toContain(`(subpath ${JSON.stringify(dirname(Bun.argv[0]!))})`);

      const sibling = join(dirname(Bun.argv[0]!), "bunx");
      if (existsSync(sibling)) {
        const refused = await runBunPolicy(policy, f.root, [f.worker, "read", sibling]);
        expect(refused).toEqual({ status: 0, stdout: "READ_REFUSED\n", stderr: "" });
      }
    },
    30_000,
  );

  // The tests above execute file, process and network refusals with Bun on macOS. This one
  // also checks the emitted profile directly, so a broader Built Harness shell policy cannot
  // silently open network access for the generated worker.
  it.if(runtimeProcess.platform === "darwin")("keeps egress closed in the emitted profile", () => {
    const f = fixture();
    const support = osIsolationSupport({ outerSandboxed: false });
    const policy = generatedWorkerPolicy(f.bundle, support, Bun.argv[0]);
    expect(policy.profile).toContain("(deny network*)");
    expect(policy.profile).not.toContain("(allow network*)");
    expect(policy.profile.split("\n")[1]).toBe("(deny default)");
  });

  it.if(runtimeProcess.platform === "darwin")(
    "types an unavailable host runtime as sandbox without exposing its path",
    () => {
      const f = fixture();
      const support = osIsolationSupport({ outerSandboxed: false });
      const missing = join(f.bundle.file, "candidate-controlled-node");
      let refusal: unknown;
      try {
        generatedWorkerPolicy(f.bundle, support, missing);
      } catch (error) {
        refusal = error;
      }
      expect(refusal).toBeInstanceOf(GeneratedToolWorkerNonResult);
      expect(refusal).toMatchObject({
        kind: "sandbox",
        message: "generated-tool worker runtime closure could not be attested",
      });
      expect(String(refusal)).not.toContain(missing);
    },
  );
});

describe("generated worker Linux runtime closure", () => {
  it.if(runtimeProcess.platform === "linux")(
    "admits the running Bun executable without an ambient runtime PATH",
    () => {
      const f = fixture();
      const policy = generatedWorkerPolicy(f.bundle, osIsolationSupport({ outerSandboxed: false }));
      const launched = spawnSync(policy.executable, [...policy.launchArgs, f.bundle.file], {
        cwd: f.workdir,
        env: policy.runtimeEnvironment,
        timeout: 5_000,
      });
      expect(launched).toMatchObject({ status: 0, stdout: "WORKER_READY", stderr: "" });
      expect(policy.runtimeEnvironment.PATH).toBeUndefined();

      const clean = spawnSync(
        policy.executable,
        [
          ...bwrapBaselineArgs({ network: false }),
          ...bwrapEnvironmentArgs({ ANA_EXPLICIT: "granted" }),
          "/usr/bin/env",
        ],
        {
          env: { ANA_EXPLICIT: "parent-value", ANA_INHERITED_SECRET: "must-not-cross" },
          timeout: 5_000,
        },
      );
      expect(clean.status).toBe(0);
      expect(clean.stdout).toContain("ANA_EXPLICIT=granted");
      expect(clean.stdout).not.toContain("ANA_INHERITED_SECRET=must-not-cross");
    },
    30_000,
  );
});
