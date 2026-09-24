/**
 * The process half of the isolation runtime: what spawnCollected does with a child that will not
 * read its input, and what closing the controller does to a command still running. Neither case
 * needs a policy or a sandbox — they are about the lifetime of the child itself, which every
 * isolated command inherits.
 */
import { afterAll, expect, it } from "bun:test";
import { realpathSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { spawnCollected, stopIsolatedCommands } from "../src/builder/candidate-isolation-runtime.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

const SCRATCH = realpathSync.native(scratchDir("ana-isolation-"));
afterAll(cleanupScratch);

it("drains output while writing input and reaps a child that rejects its stdin", async () => {
  const payload = "x".repeat(1024 * 1024);
  const outcome = await spawnCollected(
    Bun.argv[0]!,
    [
      "--no-env-file",
      "-e",
      'await Bun.write(Bun.stdout, "y".repeat(1024 * 1024)); console.error((await new Response(Bun.stdin.stream()).text()).length);',
    ],
    SCRATCH,
    Bun.env,
    { stdin: payload },
  );
  expect(outcome.status).toBe(0);
  expect(outcome.stdout).toBe("y".repeat(1024 * 1024));
  expect(outcome.stderr.trim()).toBe(String(payload.length));
  const marker = join(SCRATCH, "closed-stdin-pid");
  await expect(
    spawnCollected(
      Bun.argv[0]!,
      [
        "--no-env-file",
        "-e",
        `import { closeSync, writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, String(process.pid)); closeSync(0); await Bun.sleep(30000);`,
      ],
      SCRATCH,
      Bun.env,
      { stdin: payload },
    ),
  ).rejects.toThrow(/EPIPE/);
  const pid = Number(await Bun.file(marker).text());
  expect(pid).toBeGreaterThan(1);
  expect(() => runtimeProcess.kill(pid, 0)).toThrow(/ESRCH/);
});

it("stops a live isolated command when the controller closes", async () => {
  const started = Date.now();
  const running = spawnCollected("/bin/sleep", ["30"], SCRATCH, Bun.env);
  await Bun.sleep(50);
  stopIsolatedCommands();
  const outcome = await running;
  expect(outcome.signal).toBe("SIGKILL");
  expect(outcome.timedOut).toBe(false);
  expect(Date.now() - started).toBeLessThan(5_000);
});

it("stops a live isolated command when its caller aborts", async () => {
  const started = Date.now();
  const controller = new AbortController();
  const running = spawnCollected("/bin/sleep", ["30"], SCRATCH, Bun.env, { signal: controller.signal });
  await Bun.sleep(50);
  controller.abort();
  const outcome = await running;
  expect(outcome.signal).toBe("SIGKILL");
  expect(outcome.timedOut).toBe(false);
  expect(Date.now() - started).toBeLessThan(5_000);

  // Aborted before it starts, the command never runs to completion either.
  const early = await spawnCollected("/bin/sleep", ["30"], SCRATCH, Bun.env, { signal: controller.signal });
  expect(early.signal).toBe("SIGKILL");
});
