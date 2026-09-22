/**
 * Captured controller functions under global mutation. Process-group
 * checks and wrapper launch must use functions captured before generated code runs, so later
 * changes to structuredClone, spawn, kill and execPath cannot replace those functions.
 */
import { spawnTextSync as spawnSync } from "./helpers/bun-spawn-sync.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";

import { CAPTURE_MAX_BYTES, runTextSyncOrThrow } from "../src/meta/subprocess.ts";
import { errorMessage } from "../src/meta/runtime-values.ts";

import { afterEach, describe, expect, it } from "bun:test";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("controller primitive capture", () => {
  it("keeps group liveness and wrapper launch on the pre-generated primitives", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-trusted-runtime-"));
    dirs.push(root);
    mkdirSync(join(root, "correctness-model/reference"), { recursive: true });
    writeFileSync(
      join(root, "correctness-model/reference/index.ts"),
      "export function solve(task) { return { answer: task.publicInput.expected }; }\n",
    );

    const repoRoot = resolve(import.meta.dirname, "..");
    const solvabilityUrl = Bun.pathToFileURL(join(repoRoot, "src/truth/reference-solve.ts")).href;
    const subprocessUrl = Bun.pathToFileURL(join(repoRoot, "src/meta/subprocess.ts")).href;
    const lifetimeUrl = Bun.pathToFileURL(join(repoRoot, "src/verify/verifier-lifetime.ts")).href;
    const script = `
import { syncBuiltinESMExports } from "node:module";
const solvability = await import(${JSON.stringify(solvabilityUrl)});
const subprocess = await import(${JSON.stringify(subprocessUrl)});
const { createVerifierLifetime } = await import(${JSON.stringify(lifetimeUrl)});
const lifetime = createVerifierLifetime({ root: ${JSON.stringify(join(root, "receipts"))} });
const childProcess = process.getBuiltinModule("node:child_process");
const originalSpawn = childProcess.spawn;
const originalKill = process.kill;
const originalExecPath = Object.getOwnPropertyDescriptor(process, "execPath");
const originalClone = globalThis.structuredClone;
const live = originalSpawn(process.execPath, ["-e", "setInterval(() => {}, 60_000)"], {
  detached: true,
  stdio: "ignore",
});
await new Promise((resolve, reject) => {
  live.once("spawn", resolve);
  live.once("error", reject);
});
let result;
let failure;
try {
  globalThis.structuredClone = () => ({ poisoned: true });
  process.kill = function poisonedKill() {
    const error = new Error("poisoned kill");
    error.code = "ESRCH";
    throw error;
  };
  Object.defineProperty(process, "execPath", {
    ...originalExecPath,
    value: ${JSON.stringify(join(root, "missing-node"))},
  });
  childProcess.spawn = function poisonedSpawn() { throw new Error("poisoned spawn"); };
  syncBuiltinESMExports();

  const liveGroupSeen = subprocess.processGroupExists(live.pid);
  const solved = await solvability.executeIsolatedReferenceSolve(
    ${JSON.stringify(root)},
    { taskId: "a", family: "one", publicInput: { expected: "A" } },
    45_000,
    undefined,
    lifetime,
  );
  result = { liveGroupSeen, artifact: solved.artifact };
} catch (error) {
  failure = error instanceof Error ? error.stack : String(error);
} finally {
  globalThis.structuredClone = originalClone;
  process.kill = originalKill;
  if (originalExecPath) Object.defineProperty(process, "execPath", originalExecPath);
  childProcess.spawn = originalSpawn;
  syncBuiltinESMExports();
  try { originalKill.call(process, -live.pid, "SIGKILL"); } catch {}
  const pending = await lifetime.close();
  if (pending.length > 0) failure ??= "verifier cleanup remained pending";
}
if (failure) throw new Error(failure);
process.stdout.write(JSON.stringify(result));
`;
    // The production reference deadline remains inside the outer subprocess budget.
    const probe = spawnSync(Bun.argv[0]!, ["-e", script], {
      cwd: repoRoot,
      timeout: 90_000,
    });

    expect(probe.status, probe.stderr).toBe(0);
    expect(JSON.parse(probe.stdout)).toEqual({
      liveGroupSeen: true,
      artifact: { answer: "A" },
    });
  }, 120_000);
});
describe("a capture that returns no output", () => {
  /**
   * Four files spelled this capture out themselves, each with the comment that 64 MiB stops a
   * large working tree from truncating silently at "the 1 MiB default". That default is Node's
   * contract, not Bun's: Bun 1.4.2 caps nothing, so before the cap a runaway command was a host
   * process holding its whole output, and the number was never the thing being defended.
   */
  it("returns a capture far above the default any of the four copies believed in", () => {
    const wide = runTextSyncOrThrow(["/bin/sh", "-c", "yes abcdefgh | head -c 2000000"], {
      maxBuffer: CAPTURE_MAX_BYTES,
    });
    expect(wide.length).toBe(2_000_000);
  });

  /**
   * The four copies reported one ending — the captured stderr, or `git exited ${exitCode}` when
   * there was none — which covers a command that ran and refused and nothing else. A command the
   * host stopped exits null with empty streams, and so does one that never started, so a missing
   * tool and a command killed at the cap both arrived as `git exited null` with nothing after the
   * colon. The cap is exercised through a small `maxBuffer` because the number is not the
   * mechanism: what has to hold is that passing it throws rather than returning the short read.
   *
   * The cap ending is asserted on the capture and not on `SIGTERM`, because the kill Bun sends at
   * the cap is a race: this line read `died on SIG` until 2026-09-20, when a gate under a load
   * average of 26 caught the child finishing first and the whole assertion receiving `""` — the
   * short read returned as success, which is the case the paragraph above says must throw.
   */
  it("names the four endings apart and carries the reason a command could not start", () => {
    expect(() => runTextSyncOrThrow(["/bin/sh", "-c", "echo refused 1>&2; exit 3"])).toThrow(
      /^sh exited 3: refused$/,
    );

    let stopped = "";
    try {
      runTextSyncOrThrow(["/bin/sh", "-c", "yes abcdefgh | head -c 100000"], { maxBuffer: 4096 });
    } catch (error) {
      stopped = errorMessage(error);
    }
    expect(stopped).toMatch(/^sh filled its 4096-byte capture/);

    // The same ending with the race removed rather than waited for: three bytes past a one-byte
    // cap, from a command that has exited before any kill could be sent, so `signalCode` is null
    // and `exitCode` is 0. This is what a loaded host turns the line above into.
    let raced = "";
    try {
      runTextSyncOrThrow(["/bin/echo", "hi"], { maxBuffer: 1 });
    } catch (error) {
      raced = errorMessage(error);
    }
    expect(raced).toBe("echo filled its 1-byte capture: ");

    const root = mkdtempSync(join(tmpdir(), "ana-capture-"));
    dirs.push(root);
    let unstarted = "";
    try {
      runTextSyncOrThrow([join(root, "not-a-command")]);
    } catch (error) {
      unstarted = errorMessage(error);
    }
    expect(unstarted).toMatch(/^not-a-command could not start: .+/);
  });
});
