// pi-durable's own environment conformance suite, run against the walled environment, so that the
// file and shell operations durable's tools call behave as durable's NodeExecutionEnv does. Its
// `watch` cases are skipped: a command on the wall lives only as long as one operation, so the
// environment answers `not_supported`, and no durable tool or the Harness calls `env.watch`.
import { describe, expect, it } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { registerEnvConformance } from "@earendil-works/pi-durable/testing";
import { mkdtempSync, realpathSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { solveDirs, walledBase } from "../src/tools/command.ts";
import { walledEnv } from "../src/tools/env.ts";
import { claimRoot } from "../src/wall/seat-root.ts";

const runner = {
  describe,
  expect,
  it: (name: string, test: () => Promise<void>, timeoutMs?: number) =>
    (name.startsWith("watch ") ? it.skip : it)(name, test, timeoutMs),
};

registerEnvConformance(runner, "the walled environment", async (use) => {
  const repoRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-conformance-repo-")));
  const dirs = solveDirs(`conformance-${crypto.randomUUID()}`);
  const release = claimRoot(dirs.root);
  const base = await walledBase(dirs, { repoRoot }, "the conformance suite");
  const env = walledEnv({
    base,
    dirs,
    toolTree: null,
    limits: { shellDefaultSeconds: 30, shellMaxSeconds: 60 },
  });
  try {
    await use(env);
  } finally {
    await env.cleanup(BACKGROUND_CONTEXT);
    await release();
    rmSync(dirs.host, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
