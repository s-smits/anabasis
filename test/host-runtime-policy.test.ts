import { spawnTextSync as spawnSync } from "./helpers/bun-spawn-sync.ts";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";

import { afterEach, describe, expect, it } from "bun:test";
import {
  HOST_RUNTIME_IDENTITY_SCHEMA,
  PINNED_BUN_VERSION,
  PINNED_BUN_REVISION,
  hostRuntimeIdentity,
} from "../src/run/host-runtime-policy.ts";
import { runtimeProcess } from "../src/meta/process.ts";

const scratch: string[] = [];
afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("host runtime admission", () => {
  it("runs on the exact Bun release the manifests pin", () => {
    expect(PINNED_BUN_VERSION).toBe(readFileSync(join(import.meta.dir, "../.bun-version"), "utf8").trim());
    const manifest = JSON.parse(readFileSync(join(import.meta.dir, "../package.json"), "utf8"));
    expect(manifest.engines.bun).toBe(PINNED_BUN_VERSION);
    expect(manifest.packageManager).toBe(`bun@${PINNED_BUN_VERSION}`);
    expect(Bun.version).toBe(PINNED_BUN_VERSION);
    expect(Bun.revision).toBe(PINNED_BUN_REVISION);
  });

  it("records a digest instead of the executable path", () => {
    const evidence = hostRuntimeIdentity();
    expect(evidence).toMatchObject({
      schema: HOST_RUNTIME_IDENTITY_SCHEMA,
      name: "bun",
      version: Bun.version,
      platform: runtimeProcess.platform,
      arch: runtimeProcess.arch,
      executableSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(JSON.stringify(evidence)).not.toContain(Bun.argv[0]!);
  });

  it("refuses a different Bun release before lock, epoch, provider, or campaign writes", () => {
    const repo = mkdtempSync(join(tmpdir(), "ana-runtime-refusal-"));
    scratch.push(repo);
    const script = `
      const { mock } = await import("bun:test");
      const runtimePolicyPath = ${JSON.stringify(join(import.meta.dir, "../src/run/host-runtime-policy.ts"))};
      const actualRuntimePolicy = await import(runtimePolicyPath);
      mock.module(runtimePolicyPath, () => ({
        ...actualRuntimePolicy,
        assertSupportedHostRuntime: () => { throw new Error("unsupported runtime fixture"); },
      }));
      const { runFullRun } = await import(${JSON.stringify(join(import.meta.dir, "../src/run/full-run.ts"))});
      try { await runFullRun(
        { prompt: "runtime refusal", runId: "wrong-runtime", dcg: true },
        ${JSON.stringify(repo)},
        {
          ensureDcg: () => { throw new Error("dcg installer ran before runtime admission"); },
          build: async () => { throw new Error("Builder opened before runtime admission"); },
          drive: async () => { throw new Error("measurement opened before runtime admission"); },
          analyse: async () => { throw new Error("analysis opened before runtime admission"); },
        },
      ); }
      catch (error) {
        // Spelled out rather than sent to errorMessage: this string is a whole program, run by a
        // fresh Bun with -e, and nothing this file imports exists inside it.
        const message = error instanceof Error ? error.message : String(error);
        if (message !== "unsupported runtime fixture") throw error;
        console.error(message);
      }
    `;
    const run = spawnSync(Bun.argv[0]!, ["--no-env-file", "-e", script]);
    expect(run.status).toBe(0);
    expect(run.stderr).toContain("unsupported runtime fixture");
    expect(existsSync(join(repo, ".harness"))).toBe(false);
    expect(existsSync(join(repo, "campaigns"))).toBe(false);
  }, 15_000);
});
