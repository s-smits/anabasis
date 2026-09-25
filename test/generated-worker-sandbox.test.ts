/**
 * The generated-tool worker's OS wall, executed rather than read: on Darwin the Seatbelt profile
 * runs Bun from the exact bundle and refuses sibling reads, subprocesses and loopback egress; on
 * Linux the running Bun launches under Bubblewrap with no ambient PATH or inherited environment.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "../src/meta/filesystem.ts";
import { dirname, join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import {
  type GeneratedWorkerPolicy,
  generatedWorkerPolicy,
} from "../src/solve/generated-tool-source-policy.ts";
import { GeneratedToolWorkerNonResult } from "../src/solve/generated-tool-worker-protocol.ts";
import { bwrapBaselineArgs, bwrapEnvironmentArgs } from "../src/verify/linux-bwrap.ts";
import { osIsolationSupport } from "../src/verify/os-isolation.ts";
import { spawnTextSync as spawnSync } from "./helpers/bun-spawn-sync.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

afterAll(cleanupScratch);

const ROOT = realpathSync(scratchDir("ana-generated-worker-"));
const WORKER = join(ROOT, "worker.mjs");
const SIBLING = join(ROOT, "sibling-secret");
const BUN = Bun.argv[0]!;
writeFileSync(SIBLING, "SIBLING_SECRET");
/** Prints what the wall let it do; exit 9 marks an escape. With no mode it only reports ready. */
writeFileSync(
  WORKER,
  `const [mode, value] = Bun.argv.slice(2);
if (mode === "read") {
  try { await Bun.file(value).text(); console.log("READ_ALLOWED"); process.exit(9); }
  catch { console.log("READ_REFUSED"); }
} else if (mode === "spawn") {
  try {
    const child = Bun.spawn(["/usr/bin/true"], { stdout: "ignore", stderr: "ignore" });
    if ((await child.exited) === 0) { console.log("SPAWN_ALLOWED"); process.exit(9); }
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
} else process.stdout.write("WORKER_READY");`,
);
const BUNDLE = {
  file: WORKER,
  digest: new Bun.CryptoHasher("sha256").update(readFileSync(WORKER)).digest("hex"),
};

function confine(runtime: string = BUN): GeneratedWorkerPolicy {
  return generatedWorkerPolicy(BUNDLE, osIsolationSupport({ outerSandboxed: false }), runtime);
}

async function run(policy: GeneratedWorkerPolicy, ...args: string[]) {
  const child = Bun.spawn([policy.executable, ...policy.launchArgs, WORKER, ...args], {
    cwd: ROOT,
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

const refused = (line: string) => ({ status: 0, stdout: `${line}\n`, stderr: "" });
const onDarwin = it.if(runtimeProcess.platform === "darwin");

describe("generated worker Darwin runtime closure", () => {
  onDarwin("runs Bun from the exact bundle while denying sibling reads and subprocesses", async () => {
    const policy = confine();
    expect(await run(policy, "read", SIBLING)).toEqual(refused("READ_REFUSED"));
    expect(await run(policy, "spawn")).toEqual(refused("SPAWN_REFUSED"));
    expect(policy.profile).toContain(`(literal ${JSON.stringify(ROOT)})`);
    expect(policy.profile).not.toContain(`(subpath ${JSON.stringify(ROOT)})`);
  });

  onDarwin("denies a controller-witnessed loopback canary that succeeds without the wall", async () => {
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
      const port = String(listener.port);
      const direct = Bun.spawn([BUN, "--no-env-file", WORKER, "connect", port], {
        cwd: ROOT,
        env: {},
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await direct.exited).toBe(9);
      await Bun.sleep(10);
      expect(connections).toBe(1);
      expect(await run(confine(), "connect", port)).toEqual(refused("NETWORK_REFUSED"));
      await Bun.sleep(10);
      expect(connections).toBe(1);
    } finally {
      listener.stop(true);
    }
  });

  onDarwin(
    "launches pinned Bun while keeping runtime siblings and protected trees outside",
    async () => {
      const policy = confine();
      expect(await run(policy, "read", BUN)).toEqual({ status: 9, stdout: "READ_ALLOWED\n", stderr: "" });
      expect(policy.runtimeClosure.some(({ path }) => path === BUN)).toBe(true);
      expect(policy.profile).not.toContain(`(subpath ${JSON.stringify(dirname(BUN))})`);
      const sibling = join(dirname(BUN), "bunx");
      if (existsSync(sibling)) expect(await run(policy, "read", sibling)).toEqual(refused("READ_REFUSED"));
    },
    30_000,
  );

  // The tests above execute the refusals; this one reads the emitted profile too, so a broader
  // Built Harness shell policy cannot silently open network access for the generated worker.
  onDarwin("keeps egress closed in the emitted profile", () => {
    const { profile } = confine();
    expect(profile).toContain("(deny network*)");
    expect(profile).not.toContain("(allow network*)");
    expect(profile.split("\n")[1]).toBe("(deny default)");
  });

  onDarwin("types an unavailable host runtime as sandbox without exposing its path", () => {
    const missing = join(WORKER, "candidate-controlled-node");
    let refusal: unknown;
    try {
      confine(missing);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(GeneratedToolWorkerNonResult);
    expect(refusal).toMatchObject({
      kind: "sandbox",
      message: "generated-tool worker runtime closure could not be attested",
    });
    expect(String(refusal)).not.toContain(missing);
  });
});

describe("generated worker Linux runtime closure", () => {
  it.if(runtimeProcess.platform === "linux")(
    "admits the running Bun executable without an ambient runtime PATH",
    () => {
      const policy = confine(runtimeProcess.execPath);
      const launched = spawnSync(policy.executable, [...policy.launchArgs, WORKER], {
        cwd: ROOT,
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
        { env: { ANA_EXPLICIT: "parent-value", ANA_INHERITED_SECRET: "must-not-cross" }, timeout: 5_000 },
      );
      expect(clean.status).toBe(0);
      expect(clean.stdout).toContain("ANA_EXPLICIT=granted");
      expect(clean.stdout).not.toContain("ANA_INHERITED_SECRET=must-not-cross");
    },
    30_000,
  );
});
